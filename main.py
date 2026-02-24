import asyncio
import base64
import hashlib
import hmac
import json
import logging
import math
import os
import random
import re
import smtplib
import string
import time
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from html import escape as xml_escape
from io import BytesIO
from pathlib import Path
from typing import Any, Literal
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, desc, func, inspect, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db import (
    cache_key,
    cached_query,
    init_db,
    make_engine,
    make_session,
    redis_delete,
    redis_get_json,
    redis_incr,
    redis_set_json,
    set_redis_resolver,
)
from models import (
    AdminExportTask,
    AlertEvent,
    AlertThresholdConfig,
    ApiCallLog,
    ApiPermissionRule,
    CommunityPost,
    CommunityPostComment,
    CommunityPostLike,
    CommunityPostReport,
    CreditLedger,
    EmailCode,
    ForumAnswer,
    ForumQuestion,
    ForumQuestionLike,
    GenerationRecord,
    ImageGenerationCandidate,
    ImageGenerationTask,
    ImageSelectionSequence,
    CounterSyncSnapshot,
    Notification,
    OnlineSnapshot,
    ModerationTicket,
    ModerationTicketLog,
    PromptPreset,
    PromptVersionRecord,
    RefreshSession,
    SecurityAuditLog,
    Subscription,
    User,
    UserFeedback,
    UserFollow,
    UserOnlineSession,
    VisitorProfile,
    WebsiteVisitLog,
)

try:
    import redis.asyncio as aioredis
except Exception:  # pragma: no cover - fallback for environments using standalone aioredis
    try:
        import aioredis  # type: ignore
    except Exception:  # pragma: no cover
        aioredis = None  # type: ignore

try:
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
except Exception:  # pragma: no cover
    AsyncIOScheduler = None  # type: ignore

SUPERTOKENS_AVAILABLE = False
try:
    from supertokens_python import InputAppInfo, SupertokensConfig, init as supertokens_init
    from supertokens_python.recipe import emailpassword as st_emailpassword
    from supertokens_python.recipe import session as st_session
    from supertokens_python.recipe.emailpassword.asyncio import (
        sign_in as st_sign_in,
        sign_up as st_sign_up,
        update_email_or_password as st_update_email_or_password,
    )
    from supertokens_python.recipe.emailpassword.interfaces import (
        EmailAlreadyExistsError as STEmailAlreadyExistsError,
        PasswordPolicyViolationError as STPasswordPolicyViolationError,
        SignInOkResult as STSignInOkResult,
        SignUpOkResult as STSignUpOkResult,
        UnknownUserIdError as STUnknownUserIdError,
        WrongCredentialsError as STWrongCredentialsError,
    )
    from supertokens_python.types import RecipeUserId

    SUPERTOKENS_AVAILABLE = True
except Exception:
    pass

try:
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env", override=False)
except Exception:
    pass


def utcnow() -> datetime:
    return datetime.utcnow()


EPOCH_UTC_NAIVE = datetime(1970, 1, 1)


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int = 0) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw.strip())
    except Exception:
        return default


def parse_terms(raw: str) -> list[str]:
    return [x.strip().lower() for x in (raw or "").split(",") if x.strip()]


def to_unix_seconds(dt: datetime) -> int:
    # Treat naive datetime as UTC to avoid local-time reinterpretation on .timestamp().
    if dt.tzinfo is None:
        return int((dt - EPOCH_UTC_NAIVE).total_seconds())
    return int(dt.timestamp())


def normalize_phone(phone: str) -> str:
    return re.sub(r"\s+", "", phone or "").strip()


def hash_password(password: str, iterations: int = 240_000) -> str:
    salt = os.urandom(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${base64.b64encode(derived).decode('utf-8')}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iter_s, salt_hex, digest_b64 = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iter_s)
        salt = bytes.fromhex(salt_hex)
        expected = base64.b64decode(digest_b64.encode("utf-8"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def supertokens_enabled() -> bool:
    return settings.supertokens_enabled and SUPERTOKENS_READY


def synthetic_supertokens_email(user_id: str) -> str:
    safe_uid = re.sub(r"[^a-z0-9]", "", (user_id or "").lower())[:48] or uuid.uuid4().hex[:16]
    return f"u_{safe_uid}@auth.inkai.local"


def _password_policy_message(reason: str | None) -> str:
    detail = (reason or "").strip()
    if detail:
        return f"Password rejected by SuperTokens policy: {detail}"
    return "Password rejected by SuperTokens policy"


def init_supertokens_if_needed() -> None:
    global SUPERTOKENS_READY

    if SUPERTOKENS_READY:
        return
    if not settings.supertokens_enabled:
        return
    if not SUPERTOKENS_AVAILABLE:
        raise RuntimeError(
            "SUPERTOKENS_ENABLED=true but supertokens-python is unavailable. "
            "Install it with: python -m pip install supertokens-python"
        )

    supertokens_init(
        app_info=InputAppInfo(
            app_name=settings.supertokens_app_name,
            api_domain=settings.supertokens_api_domain,
            website_domain=settings.supertokens_website_domain,
            api_base_path=settings.supertokens_api_base_path,
            website_base_path=settings.supertokens_website_base_path,
        ),
        framework="fastapi",
        supertokens_config=SupertokensConfig(
            connection_uri=settings.supertokens_connection_uri,
            api_key=settings.supertokens_api_key or None,
        ),
        recipe_list=[
            st_session.init(anti_csrf="NONE"),
            st_emailpassword.init(),
        ],
        mode="asgi",
        telemetry=False,
        debug=False,
    )
    SUPERTOKENS_READY = True
    logger.info("SuperTokens enabled using core at %s", settings.supertokens_connection_uri)


async def create_supertokens_credentials(user: User, password: str) -> None:
    if not supertokens_enabled():
        return

    st_email = user.supertokens_email or synthetic_supertokens_email(user.id)
    try:
        result = await st_sign_up(settings.supertokens_tenant_id, st_email, password)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"SuperTokens sign-up unavailable: {exc}") from exc

    if isinstance(result, STEmailAlreadyExistsError):
        try:
            login_result = await st_sign_in(settings.supertokens_tenant_id, st_email, password)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"SuperTokens sign-in unavailable: {exc}") from exc
        if isinstance(login_result, STWrongCredentialsError):
            raise HTTPException(status_code=409, detail="SuperTokens email conflict during account provisioning")
        if not isinstance(login_result, STSignInOkResult):
            raise HTTPException(status_code=500, detail="Unexpected SuperTokens sign-in result")
        user.supertokens_user_id = login_result.user.id
        user.supertokens_email = st_email
        return
    if isinstance(result, STPasswordPolicyViolationError):
        raise HTTPException(status_code=400, detail=_password_policy_message(result.failure_reason))
    if not isinstance(result, STSignUpOkResult):
        raise HTTPException(status_code=500, detail="Unexpected SuperTokens sign-up result")

    user.supertokens_user_id = result.user.id
    user.supertokens_email = st_email


async def verify_password_with_supertokens(user: User, password: str) -> bool:
    if not supertokens_enabled():
        return False
    if not (user.supertokens_email or "").strip():
        return False

    try:
        result = await st_sign_in(settings.supertokens_tenant_id, user.supertokens_email.strip(), password)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"SuperTokens sign-in unavailable: {exc}") from exc

    if isinstance(result, STWrongCredentialsError):
        return False
    if not isinstance(result, STSignInOkResult):
        raise HTTPException(status_code=500, detail="Unexpected SuperTokens sign-in result")

    user.supertokens_user_id = result.user.id
    return True


async def ensure_supertokens_credentials(session: AsyncSession, user: User, password: str) -> None:
    if not supertokens_enabled():
        return
    if (user.supertokens_user_id or "").strip() and (user.supertokens_email or "").strip():
        return

    await create_supertokens_credentials(user, password)
    session.add(user)


async def update_password_with_supertokens(user: User, new_password: str) -> None:
    if not supertokens_enabled():
        return

    recipe_user_id = (user.supertokens_user_id or "").strip()
    if not recipe_user_id:
        raise HTTPException(status_code=500, detail="SuperTokens account mapping missing")

    try:
        result = await st_update_email_or_password(
            RecipeUserId(recipe_user_id),
            password=new_password,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"SuperTokens password update unavailable: {exc}") from exc

    if isinstance(result, STPasswordPolicyViolationError):
        raise HTTPException(status_code=400, detail=_password_policy_message(result.failure_reason))
    if isinstance(result, STUnknownUserIdError):
        user.supertokens_user_id = None
        await create_supertokens_credentials(user, new_password)


class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    database_url: str = Field(default_factory=lambda: os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./inkai.db"))
    database_read_url: str = Field(
        default_factory=lambda: os.getenv(
            "DATABASE_READ_URL",
            os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./inkai.db"),
        ).strip()
    )
    cors_allow_origins: list[str] = Field(
        default_factory=lambda: [
            x.strip()
            for x in os.getenv("CORS_ALLOW_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",")
            if x.strip()
        ]
    )
    redis_enabled: bool = Field(default_factory=lambda: env_bool("REDIS_ENABLED", env_bool("REDIS_CACHE_ENABLED", True)))
    redis_cache_enabled: bool = Field(default_factory=lambda: env_bool("REDIS_CACHE_ENABLED", env_bool("REDIS_ENABLED", True)))
    redis_url: str = Field(default_factory=lambda: os.getenv("REDIS_URL", "").strip())
    redis_host: str = Field(default_factory=lambda: os.getenv("REDIS_HOST", "127.0.0.1").strip() or "127.0.0.1")
    redis_port: int = Field(default_factory=lambda: max(1, env_int("REDIS_PORT", 6379)))
    redis_password: str = Field(default_factory=lambda: os.getenv("REDIS_PASSWORD", "").strip())
    redis_db: int = Field(default_factory=lambda: env_int("REDIS_DB", 0))
    redis_timeout_sec: int = Field(default_factory=lambda: max(1, env_int("REDIS_TIMEOUT_SEC", 3)))
    redis_stream_gen_key: str = Field(default_factory=lambda: os.getenv("REDIS_STREAM_GEN_KEY", "inkai:stream:gen"))
    redis_stream_gen_dlq_key: str = Field(
        default_factory=lambda: os.getenv("REDIS_STREAM_GEN_DLQ_KEY", "inkai:stream:gen:dlq")
    )
    redis_stream_group: str = Field(default_factory=lambda: os.getenv("REDIS_STREAM_GROUP", "inkai-gen-workers"))
    redis_stream_consumer_prefix: str = Field(
        default_factory=lambda: os.getenv("REDIS_STREAM_CONSUMER_PREFIX", "worker")
    )
    generation_queue_enabled: bool = Field(default_factory=lambda: env_bool("GENERATION_QUEUE_ENABLED", True))
    generation_queue_max_retry: int = Field(default_factory=lambda: max(0, env_int("GENERATION_QUEUE_MAX_RETRY", 2)))
    generation_queue_wait_timeout_sec: int = Field(
        default_factory=lambda: max(10, env_int("GENERATION_QUEUE_WAIT_TIMEOUT_SEC", 140))
    )
    generation_queue_poll_interval_ms: int = Field(
        default_factory=lambda: max(200, env_int("GENERATION_QUEUE_POLL_INTERVAL_MS", 800))
    )
    admin_stats_cache_ttl_sec: int = Field(default_factory=lambda: max(10, env_int("ADMIN_STATS_CACHE_TTL_SEC", 45)))
    export_queue_enabled: bool = Field(default_factory=lambda: env_bool("EXPORT_QUEUE_ENABLED", True))
    export_queue_wait_timeout_sec: int = Field(
        default_factory=lambda: max(10, env_int("EXPORT_QUEUE_WAIT_TIMEOUT_SEC", 300))
    )
    redis_stream_export_key: str = Field(default_factory=lambda: os.getenv("REDIS_STREAM_EXPORT_KEY", "inkai:stream:export"))
    redis_stream_export_dlq_key: str = Field(
        default_factory=lambda: os.getenv("REDIS_STREAM_EXPORT_DLQ_KEY", "inkai:stream:export:dlq")
    )
    redis_stream_export_group: str = Field(default_factory=lambda: os.getenv("REDIS_STREAM_EXPORT_GROUP", "inkai-export-workers"))
    redis_stream_export_consumer_prefix: str = Field(
        default_factory=lambda: os.getenv("REDIS_STREAM_EXPORT_CONSUMER_PREFIX", "export-worker")
    )
    admin_export_dir: str = Field(default_factory=lambda: os.getenv("ADMIN_EXPORT_DIR", "./tmp_exports").strip() or "./tmp_exports")
    admin_export_retention_hours: int = Field(default_factory=lambda: max(1, env_int("ADMIN_EXPORT_RETENTION_HOURS", 24)))
    rate_limit_enabled: bool = Field(default_factory=lambda: env_bool("RATE_LIMIT_ENABLED", True))
    rate_limit_ip_limit: int = Field(default_factory=lambda: max(10, env_int("RATE_LIMIT_IP_LIMIT", 180)))
    rate_limit_ip_window_sec: int = Field(default_factory=lambda: max(1, env_int("RATE_LIMIT_IP_WINDOW_SEC", 60)))
    rate_limit_user_limit: int = Field(default_factory=lambda: max(10, env_int("RATE_LIMIT_USER_LIMIT", 240)))
    rate_limit_user_window_sec: int = Field(default_factory=lambda: max(1, env_int("RATE_LIMIT_USER_WINDOW_SEC", 60)))
    counter_sync_enabled: bool = Field(default_factory=lambda: env_bool("COUNTER_SYNC_ENABLED", True))
    counter_sync_hourly_cron_minute: int = Field(
        default_factory=lambda: min(59, max(0, env_int("COUNTER_SYNC_HOURLY_CRON_MINUTE", 5)))
    )
    counter_sync_daily_cron_hour: int = Field(
        default_factory=lambda: min(23, max(0, env_int("COUNTER_SYNC_DAILY_CRON_HOUR", 1)))
    )
    counter_sync_daily_cron_minute: int = Field(
        default_factory=lambda: min(59, max(0, env_int("COUNTER_SYNC_DAILY_CRON_MINUTE", 10)))
    )
    content_safety_provider: str = Field(default_factory=lambda: os.getenv("CONTENT_SAFETY_PROVIDER", "off").strip())
    content_safety_endpoint: str = Field(default_factory=lambda: os.getenv("CONTENT_SAFETY_ENDPOINT", "").strip())
    content_safety_access_key: str = Field(default_factory=lambda: os.getenv("CONTENT_SAFETY_ACCESS_KEY", "").strip())
    content_safety_secret_key: str = Field(default_factory=lambda: os.getenv("CONTENT_SAFETY_SECRET_KEY", "").strip())
    content_safety_timeout_sec: int = Field(default_factory=lambda: max(3, env_int("CONTENT_SAFETY_TIMEOUT_SEC", 10)))

    backend_admin_token: str = Field(default_factory=lambda: os.getenv("BACKEND_ADMIN_TOKEN", "").strip())
    demo_user_id: str = Field(default_factory=lambda: os.getenv("DEMO_USER_ID", "demo-user"))

    jwt_secret_key: str = Field(default_factory=lambda: os.getenv("JWT_SECRET_KEY", "change-this-in-production"))
    jwt_algorithm: str = Field(default_factory=lambda: os.getenv("JWT_ALGORITHM", "HS256"))
    jwt_access_exp_minutes: int = Field(default_factory=lambda: int(os.getenv("JWT_ACCESS_EXP_MINUTES", "15")))
    jwt_refresh_exp_days: int = Field(default_factory=lambda: int(os.getenv("JWT_REFRESH_EXP_DAYS", "14")))

    auth_debug_return_sms_code: bool = Field(default_factory=lambda: env_bool("AUTH_DEBUG_RETURN_SMS_CODE", True))
    root_username: str = Field(default_factory=lambda: os.getenv("ROOT_USERNAME", "admin"))
    root_password: str = Field(default_factory=lambda: os.getenv("ROOT_PASSWORD", "Yangfan724@"))

    supertokens_enabled: bool = Field(default_factory=lambda: env_bool("SUPERTOKENS_ENABLED", False))
    supertokens_connection_uri: str = Field(
        default_factory=lambda: os.getenv("SUPERTOKENS_CONNECTION_URI", "http://127.0.0.1:3567").strip()
    )
    supertokens_api_key: str = Field(default_factory=lambda: os.getenv("SUPERTOKENS_API_KEY", "").strip())
    supertokens_app_name: str = Field(default_factory=lambda: os.getenv("SUPERTOKENS_APP_NAME", "Ink-Aesthetics AI"))
    supertokens_api_domain: str = Field(
        default_factory=lambda: os.getenv("SUPERTOKENS_API_DOMAIN", "http://127.0.0.1:8787").strip()
    )
    supertokens_website_domain: str = Field(
        default_factory=lambda: os.getenv("SUPERTOKENS_WEBSITE_DOMAIN", "http://127.0.0.1:5173").strip()
    )
    supertokens_api_base_path: str = Field(
        default_factory=lambda: os.getenv("SUPERTOKENS_API_BASE_PATH", "/auth").strip() or "/auth"
    )
    supertokens_website_base_path: str = Field(
        default_factory=lambda: os.getenv("SUPERTOKENS_WEBSITE_BASE_PATH", "/auth").strip() or "/auth"
    )
    supertokens_tenant_id: str = Field(
        default_factory=lambda: os.getenv("SUPERTOKENS_TENANT_ID", "public").strip() or "public"
    )

    deepseek_base_url: str = Field(default_factory=lambda: os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"))
    deepseek_api_key: str = Field(default_factory=lambda: os.getenv("DEEPSEEK_API_KEY", "").strip())
    deepseek_model: str = Field(default_factory=lambda: os.getenv("DEEPSEEK_MODEL", "deepseek-chat"))

    liblibai_base_url: str = Field(default_factory=lambda: os.getenv("LIBLIBAI_BASE_URL", "").strip())
    liblibai_uri: str = Field(default_factory=lambda: os.getenv("LIBLIBAI_URI", "/api/generate/webui/text2img"))
    liblibai_access_key: str = Field(default_factory=lambda: os.getenv("LIBLIBAI_ACCESS_KEY", "").strip())
    liblibai_secret_key: str = Field(default_factory=lambda: os.getenv("LIBLIBAI_SECRET_KEY", "").strip())
    liblibai_timeout_sec: int = Field(default_factory=lambda: int(os.getenv("LIBLIBAI_TIMEOUT_SEC", "120")))
    liblibai_status_uri: str = Field(default_factory=lambda: os.getenv("LIBLIBAI_STATUS_URI", "/api/generate/webui/status"))
    liblibai_template_uuid: str = Field(
        default_factory=lambda: os.getenv("LIBLIBAI_TEMPLATE_UUID", "6f7c4652458d4802969f8d089cf5b91f")
    )
    liblibai_width: int = Field(default_factory=lambda: int(os.getenv("LIBLIBAI_WIDTH", "768")))
    liblibai_height: int = Field(default_factory=lambda: int(os.getenv("LIBLIBAI_HEIGHT", "768")))
    liblibai_steps: int = Field(default_factory=lambda: int(os.getenv("LIBLIBAI_STEPS", "25")))

    prompt_guard_enabled: bool = Field(default_factory=lambda: env_bool("PROMPT_GUARD_ENABLED", True))
    prompt_guard_block_terms: str = Field(default_factory=lambda: os.getenv("PROMPT_GUARD_BLOCK_TERMS", "").strip())

    billing_cost_prompt_optimize: int = Field(default_factory=lambda: max(0, env_int("BILLING_COST_PROMPT_OPTIMIZE", 0)))
    billing_cost_liblibai_gen_img: int = Field(default_factory=lambda: max(0, env_int("BILLING_COST_LIBLIBAI_GEN_IMG", 60)))
    billing_cost_deepseek_chat: int = Field(default_factory=lambda: max(0, env_int("BILLING_COST_DEEPSEEK_CHAT", 0)))

    smtp_from: str = Field(default_factory=lambda: os.getenv("SMTP_FROM", "").strip())
    smtp_password: str = Field(default_factory=lambda: os.getenv("SMTP_PASSWORD", "").strip())
    smtp_server: str = Field(default_factory=lambda: os.getenv("SMTP_SERVER", "smtp.qq.com").strip())
    smtp_port: int = Field(default_factory=lambda: int(os.getenv("SMTP_PORT", "465")))

    turnstile_enabled: bool = Field(default_factory=lambda: env_bool("TURNSTILE_ENABLED", False))
    turnstile_fail_open: bool = Field(default_factory=lambda: env_bool("TURNSTILE_FAIL_OPEN", True))
    turnstile_allow_local_bypass: bool = Field(default_factory=lambda: env_bool("TURNSTILE_ALLOW_LOCAL_BYPASS", True))
    turnstile_secret_key: str = Field(default_factory=lambda: os.getenv("TURNSTILE_SECRET_KEY", "").strip())


settings = Settings()
WRITE_ENGINE = make_engine(settings.database_url)
READ_ENGINE = make_engine(settings.database_read_url or settings.database_url)
engine = WRITE_ENGINE
SessionLocal = make_session(WRITE_ENGINE, READ_ENGINE)

ROOT_USER_ID = "root"
INITIAL_USER_CREDITS = 1000
DAILY_RESTORE_CREDITS = 100
DAILY_RESTORE_BALANCE_CAP = 500
PUBLISH_REWARD_CREDITS = 80
FORUM_ANSWER_REWARD_CREDITS = 50
ONLINE_ACTIVE_SECONDS = 90
ALERT_DEDUPE_SECONDS = 120
API_BREAKER_FAILURE_STREAK = 5
API_BREAKER_OPEN_SECONDS = 30
NOTIFICATION_TYPE_EXPORT_SUCCESS = "EXPORT_SUCCESS"
NOTIFICATION_TYPE_EXPORT_FAILED = "EXPORT_FAILED"
NOTIFICATION_TYPE_MODERATION_TICKET_ASSIGNED = "MODERATION_TICKET_ASSIGNED"
NOTIFICATION_TYPE_MODERATION_APPEAL_SUBMITTED = "MODERATION_APPEAL_SUBMITTED"
NOTIFICATION_TYPE_VALUES = {
    NOTIFICATION_TYPE_EXPORT_SUCCESS,
    NOTIFICATION_TYPE_EXPORT_FAILED,
    NOTIFICATION_TYPE_MODERATION_TICKET_ASSIGNED,
    NOTIFICATION_TYPE_MODERATION_APPEAL_SUBMITTED,
}

API_PERMISSION_CACHE: dict[str, bool] = {}
API_BREAKER_STATE: dict[str, dict[str, Any]] = {}
REDIS_CLIENT: Any | None = None
REDIS_AVAILABLE = False
SCHEDULER: Any | None = None
GENERATION_WORKER_TASK: asyncio.Task[Any] | None = None
EXPORT_WORKER_TASK: asyncio.Task[Any] | None = None
NOTIFICATION_WORKER_TASK: asyncio.Task[Any] | None = None
NOTIFICATION_QUEUE: asyncio.Queue[dict[str, Any]] | None = None
WS_PROGRESS_CHANNELS: defaultdict[str, set[WebSocket]] = defaultdict(set)
LOCAL_RATE_BUCKETS: dict[str, tuple[int, float]] = {}
SUPERTOKENS_READY = False
logger = logging.getLogger("inkai.auth")


def _redis_client_resolver():
    if REDIS_AVAILABLE and REDIS_CLIENT is not None:
        return REDIS_CLIENT
    return None


def _resolved_redis_url() -> str:
    configured_url = (settings.redis_url or "").strip()
    if configured_url:
        return configured_url
    return f"redis://{settings.redis_host}:{int(settings.redis_port)}/{int(settings.redis_db)}"


async def init_redis_runtime() -> None:
    global REDIS_CLIENT, REDIS_AVAILABLE

    if not settings.redis_enabled:
        set_redis_resolver(None)
        REDIS_CLIENT = None
        REDIS_AVAILABLE = False
        return

    if aioredis is None:
        logger.warning("Redis client library not installed, Redis features disabled")
        set_redis_resolver(None)
        REDIS_CLIENT = None
        REDIS_AVAILABLE = False
        return

    try:
        redis_url = _resolved_redis_url()
        kwargs: dict[str, Any] = {
            "db": int(settings.redis_db),
            "decode_responses": True,
            "socket_connect_timeout": int(settings.redis_timeout_sec),
            "socket_timeout": int(settings.redis_timeout_sec),
        }
        if settings.redis_password:
            kwargs["password"] = settings.redis_password
        REDIS_CLIENT = aioredis.from_url(redis_url, **kwargs)
        await REDIS_CLIENT.ping()
        REDIS_AVAILABLE = True
        set_redis_resolver(_redis_client_resolver)
        logger.info("Redis runtime initialized: %s", redis_url)
    except Exception as exc:
        logger.warning("Redis unavailable (%s), fallback to in-memory mode", exc)
        set_redis_resolver(None)
        REDIS_CLIENT = None
        REDIS_AVAILABLE = False


async def close_redis_runtime() -> None:
    global REDIS_CLIENT, REDIS_AVAILABLE

    cli = REDIS_CLIENT
    REDIS_CLIENT = None
    REDIS_AVAILABLE = False
    set_redis_resolver(None)
    if cli is None:
        return

    try:
        close_fn = getattr(cli, "close", None)
        if callable(close_fn):
            maybe = close_fn()
            if asyncio.iscoroutine(maybe):
                await maybe
        pool = getattr(cli, "connection_pool", None)
        if pool is not None and hasattr(pool, "disconnect"):
            maybe = pool.disconnect()
            if asyncio.iscoroutine(maybe):
                await maybe
    except Exception:
        return


def _progress_cache_key(task_id: str) -> str:
    return cache_key("gen_progress", task_id)


def _task_result_cache_key(task_id: str) -> str:
    return cache_key("gen_result", task_id)


def _task_queue_msg_cache_key(task_id: str) -> str:
    return cache_key("gen_queue_msg", task_id)


def _export_status_cache_key(task_id: str) -> str:
    return cache_key("export_status", task_id)


def _counter_key(counter_type: str, entity_id: str = "") -> str:
    return cache_key("counter", counter_type, entity_id)


async def _set_generation_progress(
    task_id: str,
    status: str,
    progress: int,
    message: str = "",
    failure_reason: str = "",
) -> None:
    payload = {
        "task_id": task_id,
        "status": (status or "").strip() or "queued",
        "progress": max(0, min(100, int(progress))),
        "message": (message or "")[:280],
        "failure_reason": (failure_reason or "")[:400],
        "updated_at": _iso_ts(utcnow()),
    }
    await redis_set_json(_progress_cache_key(task_id), payload, ttl_sec=3600)
    await _broadcast_generation_progress(task_id, payload)


async def _get_generation_progress(task_id: str) -> dict[str, Any] | None:
    data = await redis_get_json(_progress_cache_key(task_id))
    if isinstance(data, dict):
        return data
    return None


async def _broadcast_generation_progress(task_id: str, payload: dict[str, Any]) -> None:
    sockets = list(WS_PROGRESS_CHANNELS.get(task_id, set()))
    if not sockets:
        return
    text_payload = json.dumps(payload, ensure_ascii=False)
    stale: list[WebSocket] = []
    for ws in sockets:
        try:
            await ws.send_text(text_payload)
        except Exception:
            stale.append(ws)
    for ws in stale:
        WS_PROGRESS_CHANNELS.get(task_id, set()).discard(ws)


def _ratelimit_key(scope: str, identity: str, path: str) -> str:
    safe_identity = re.sub(r"[^a-zA-Z0-9_.:-]+", "_", identity or "anon")
    safe_path = re.sub(r"[^a-zA-Z0-9_.:/-]+", "_", path or "/")
    return cache_key("ratelimit", scope, safe_identity, safe_path)


async def _hit_rate_limit(scope: str, identity: str, path: str, limit: int, window_sec: int) -> tuple[bool, int]:
    safe_limit = max(1, int(limit))
    safe_window = max(1, int(window_sec))
    key = _ratelimit_key(scope, identity, path)

    if REDIS_AVAILABLE:
        current = await redis_incr(key, amount=1, ttl_sec=safe_window)
        if current <= 0:
            return False, safe_limit
        return current > safe_limit, max(0, safe_limit - current)

    now = time.monotonic()
    count, reset_at = LOCAL_RATE_BUCKETS.get(key, (0, now + safe_window))
    if now >= reset_at:
        count = 0
        reset_at = now + safe_window
    count += 1
    LOCAL_RATE_BUCKETS[key] = (count, reset_at)
    return count > safe_limit, max(0, safe_limit - count)


async def _should_block_by_rate_limit(request: Request) -> tuple[bool, str]:
    if not settings.rate_limit_enabled:
        return False, ""

    path = request.url.path
    if not path.startswith("/api/"):
        return False, ""
    if path.startswith("/api/admin/export"):
        return False, ""

    ip = _client_ip_from_request(request) or "unknown"
    ip_blocked, _ = await _hit_rate_limit(
        "ip",
        ip,
        path,
        settings.rate_limit_ip_limit,
        settings.rate_limit_ip_window_sec,
    )
    if ip_blocked:
        return True, "Rate limit exceeded for this IP"

    user_id = _safe_user_id_from_authorization(request.headers.get("authorization")) or ""
    if user_id:
        user_blocked, _ = await _hit_rate_limit(
            "user",
            user_id,
            path,
            settings.rate_limit_user_limit,
            settings.rate_limit_user_window_sec,
        )
        if user_blocked:
            return True, "Rate limit exceeded for this user"

    return False, ""


async def _append_audit_log(
    session: AsyncSession,
    action: str,
    actor_user_id: str | None = None,
    actor_ip: str = "",
    target_type: str = "",
    target_id: str = "",
    payload: dict[str, Any] | None = None,
) -> None:
    session.add(
        SecurityAuditLog(
            actor_user_id=(actor_user_id or "").strip() or None,
            actor_ip=(actor_ip or "")[:64],
            action=(action or "")[:128],
            target_type=(target_type or "")[:64],
            target_id=(target_id or "")[:128],
            payload_json=_json_dump_safe(payload or {}),
            created_at=utcnow(),
        )
    )


async def _invalidate_hot_caches() -> None:
    await redis_delete(
        cache_key("community_hot", "public"),
        cache_key("forum_hot", "public"),
        cache_key("sys_threshold", "singleton"),
    )


def generate_email_code(n: int = 6) -> str:
    chars = ""
    for _ in range(n):
        number = random.randint(0, 9)
        upper_alpha = chr(random.randint(65, 90))
        lower_alpha = chr(random.randint(97, 122))
        char = random.choice([number, upper_alpha, lower_alpha])
        chars += str(char)
    return chars


def send_email_code(to_email: str, code: str) -> bool:
    if not settings.smtp_from or not settings.smtp_password:
        logger.warning("SMTP not configured, skipping email send")
        return False
    try:
        content = f"【验证码】您的验证码是：{code} ，请在五分钟内完成验证码认证，如非本人操作，请忽略本条信息。"
        message = MIMEText(content, "plain", "utf-8")
        message["From"] = settings.smtp_from
        message["To"] = to_email
        message["Subject"] = "验证码"
        smtp = smtplib.SMTP_SSL(settings.smtp_server, settings.smtp_port, "utf-8")
        smtp.login(settings.smtp_from, settings.smtp_password)
        smtp.sendmail(settings.smtp_from, to_email, message.as_string())
        smtp.quit()
        logger.info(f"Email code sent to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        return False


async def verify_turnstile(token: str, remote_ip: str = "") -> bool:
    if not settings.turnstile_enabled:
        return True
    if settings.turnstile_allow_local_bypass and remote_ip in {"127.0.0.1", "::1", "localhost"}:
        # Local development should not be blocked by captcha network/config issues.
        return True
    if not settings.turnstile_secret_key:
        logger.warning("TURNSTILE_ENABLED=true but TURNSTILE_SECRET_KEY is empty")
        return bool(settings.turnstile_fail_open)
    if not token:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data={
                    "secret": settings.turnstile_secret_key,
                    "response": token,
                    "remoteip": remote_ip,
                },
            )
        data = resp.json()
        ok = bool(data.get("success", False))
        if not ok:
            logger.warning("Turnstile rejected request: %s", data)
            if settings.turnstile_fail_open:
                error_codes = {str(x).strip().lower() for x in (data.get("error-codes") or [])}
                config_errors = {"missing-input-secret", "invalid-input-secret", "internal-error"}
                if error_codes & config_errors:
                    logger.warning("Turnstile fail-open activated due to config/internal error: %s", error_codes)
                    return True
        return ok
    except Exception as e:
        logger.error(f"Turnstile verification failed: {e}")
        return bool(settings.turnstile_fail_open)


DEFAULT_PROMPT_BLOCK_TERMS: tuple[str, ...] = (
    "儿童色情",
    "未成年人色情",
    "性虐待",
    "强奸",
    "乱伦",
    "bloodbath",
    "gore",
    "beheading",
    "dismember",
    "sexual assault",
    "child porn",
    "terrorist attack",
    "爆炸物制作",
    "枪支制造",
    "毒品制作",
    "仇恨言论",
)
PROMPT_BLOCK_TERMS: set[str] = set(parse_terms(settings.prompt_guard_block_terms)) or set(DEFAULT_PROMPT_BLOCK_TERMS)

RUNTIME_BILLING_RULES: dict[str, int] = {
    "prompt_optimize": int(max(0, settings.billing_cost_prompt_optimize)),
    "liblibai_gen_img": int(max(0, settings.billing_cost_liblibai_gen_img)),
    "deepseek_chat": int(max(0, settings.billing_cost_deepseek_chat)),
}

ASYNC_TASK_MONITOR: dict[str, dict[str, Any]] = {
    "liblibai_gen": {
        "running": 0,
        "started_total": 0,
        "completed_total": 0,
        "failed_total": 0,
        "last_duration_ms": 0,
        "recent": [],
    },
    "admin_export": {
        "running": 0,
        "started_total": 0,
        "completed_total": 0,
        "failed_total": 0,
        "last_duration_ms": 0,
        "recent": [],
    },
}


def _sanitize_term(term: str) -> str:
    return re.sub(r"[\W_]+", "", (term or "").lower())


def _detect_prompt_violations(raw_prompt: str) -> list[str]:
    if not settings.prompt_guard_enabled:
        return []
    normalized = _sanitize_term(raw_prompt)
    if not normalized:
        return []
    hit: list[str] = []
    for term in sorted(PROMPT_BLOCK_TERMS):
        safe_term = _sanitize_term(term)
        if not safe_term:
            continue
        if safe_term in normalized:
            hit.append(term)
    return hit[:5]


def _ensure_prompt_allowed(raw_prompt: str) -> None:
    violations = _detect_prompt_violations(raw_prompt)
    if violations:
        raise HTTPException(
            status_code=400,
            detail=f"Prompt blocked by safety policy. Forbidden terms: {', '.join(violations)}",
        )


POLICY_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("违法违规", re.compile(r"(炸弹|制毒|枪支|恐袭|洗钱|诈骗|黑产|恐怖袭击)", re.I)),
    ("色情低俗", re.compile(r"(色情|裸聊|约炮|性服务|强奸|未成年|porn|nsfw|hentai)", re.I)),
    ("暴力血腥", re.compile(r"(虐杀|碎尸|爆头|血腥|gore|beheading|dismember)", re.I)),
    ("侵权盗版", re.compile(r"(盗版|侵权|搬运未授权|商标盗用|版权违法)", re.I)),
    ("敏感内容", re.compile(r"(仇恨言论|极端主义|种族清洗|煽动暴乱)", re.I)),
)

MACHINE_REVIEW_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("擦边内容", re.compile(r"(陪聊|约聊|制服|露骨|软色情|暧昧)", re.I)),
    ("可能涉政敏感", re.compile(r"(敏感事件|政治人物|国家机密|颠覆)", re.I)),
    ("可能引战仇恨", re.compile(r"(民族歧视|地域黑|仇恨)", re.I)),
)


def moderation_reason_for_text(text_value: str) -> str | None:
    cleaned = (text_value or "").strip()
    if not cleaned:
        return "内容为空"
    for label, regex in POLICY_PATTERNS:
        if regex.search(cleaned):
            return f"命中审核规则：{label}"
    return None


async def _machine_review_text(text_value: str) -> tuple[str, str]:
    """
    Returns:
      - ("pass", reason)
      - ("review", reason)
      - ("reject", reason)
    """
    cleaned = (text_value or "").strip()
    if not cleaned:
        return "review", "内容为空，进入人工审核"

    hard_reason = moderation_reason_for_text(cleaned)
    if hard_reason:
        return "reject", hard_reason

    for label, regex in MACHINE_REVIEW_PATTERNS:
        if regex.search(cleaned):
            return "review", f"命中机审可疑规则：{label}"

    provider = (settings.content_safety_provider or "off").strip().lower()
    if provider in {"off", ""}:
        return "pass", "机审通过（本地规则）"

    endpoint = (settings.content_safety_endpoint or "").strip()
    if not endpoint:
        return "review", "机审服务未配置，进入人工审核"

    payload = {
        "provider": provider,
        "content": cleaned[:12000],
        "content_type": "text",
    }
    headers = {
        "Content-Type": "application/json",
        "X-Content-Safety-Access-Key": settings.content_safety_access_key or "",
        "X-Content-Safety-Secret-Key": settings.content_safety_secret_key or "",
    }
    try:
        async with httpx.AsyncClient(timeout=max(3, int(settings.content_safety_timeout_sec))) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
        if resp.status_code >= 500:
            return "review", f"机审服务异常({resp.status_code})，进入人工审核"
        if resp.status_code >= 400:
            return "reject", f"机审拒绝({resp.status_code})"

        data = resp.json() if resp.content else {}
        verdict = str((data or {}).get("verdict", "")).strip().lower()
        reason = str((data or {}).get("reason", "")).strip()[:255]
        if verdict in {"allow", "pass", "approved"}:
            return "pass", reason or "机审通过"
        if verdict in {"block", "reject", "denied"}:
            return "reject", reason or "机审拦截"
        return "review", reason or "机审不确定，进入人工审核"
    except Exception as exc:
        return "review", f"机审调用失败：{str(exc)[:180]}"


def _parse_iso_datetime(value: str | None) -> datetime:
    raw = (value or "").strip()
    if not raw:
        return utcnow()
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return utcnow()


def _json_dump_safe(value: Any) -> str:
    try:
        return json.dumps(value or {}, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        return "{}"


def _json_load_safe(value: str | None, default: Any) -> Any:
    try:
        return json.loads((value or "").strip() or "null")
    except Exception:
        return default


async def _grant_reward_credits(session: AsyncSession, user: User, amount: int, note: str) -> int:
    grant = max(0, int(amount))
    if grant <= 0:
        return 0
    user.credits_balance = int(user.credits_balance or 0) + grant
    session.add(
        CreditLedger(
            user_id=user.id,
            type="reward",
            amount=grant,
            note=(note or "reward")[:255],
        )
    )
    await redis_set_json(cache_key("user_credit", user.id), {"credits_balance": int(user.credits_balance or 0)}, ttl_sec=120)
    return grant


def _decode_data_url_bytes(value: str) -> tuple[bytes, str]:
    raw = (value or "").strip()
    if not raw:
        return b"", ".bin"
    if raw.startswith("data:") and ";base64," in raw:
        head, b64_body = raw.split(";base64,", 1)
        mime = head[5:].strip().lower()
        ext = ".png"
        if "jpeg" in mime or "jpg" in mime:
            ext = ".jpg"
        elif "webp" in mime:
            ext = ".webp"
        elif "svg" in mime:
            ext = ".svg"
        elif "gif" in mime:
            ext = ".gif"
        try:
            return base64.b64decode(b64_body.encode("utf-8"), validate=False), ext
        except Exception:
            return b"", ext
    if re.fullmatch(r"[A-Za-z0-9+/=\s]+", raw) and len(raw) > 100:
        try:
            return base64.b64decode(raw.encode("utf-8"), validate=False), ".png"
        except Exception:
            return raw.encode("utf-8"), ".txt"
    return raw.encode("utf-8"), ".txt"


def _billing_rules_snapshot() -> dict[str, int]:
    return {
        "prompt_optimize": int(RUNTIME_BILLING_RULES.get("prompt_optimize", 0)),
        "liblibai_gen_img": int(RUNTIME_BILLING_RULES.get("liblibai_gen_img", 0)),
        "deepseek_chat": int(RUNTIME_BILLING_RULES.get("deepseek_chat", 0)),
    }


def _track_task_start(task_name: str, context: str = "") -> tuple[str, float]:
    task = ASYNC_TASK_MONITOR.setdefault(
        task_name,
        {
            "running": 0,
            "started_total": 0,
            "completed_total": 0,
            "failed_total": 0,
            "last_duration_ms": 0,
            "recent": [],
        },
    )
    task_id = uuid.uuid4().hex[:12]
    now = utcnow()
    task["running"] = int(task.get("running", 0)) + 1
    task["started_total"] = int(task.get("started_total", 0)) + 1
    recent = list(task.get("recent", []))
    recent.insert(
        0,
        {
            "task_id": task_id,
            "status": "running",
            "context": (context or "")[:120],
            "started_at": _iso_ts(now),
            "ended_at": None,
            "duration_ms": 0,
            "error": "",
        },
    )
    task["recent"] = recent[:40]
    return task_id, time.perf_counter()


def _track_task_end(task_name: str, task_id: str, started_perf: float, ok: bool, error: str = "") -> None:
    task = ASYNC_TASK_MONITOR.get(task_name)
    if not task:
        return
    duration_ms = int(max((time.perf_counter() - started_perf) * 1000, 0))
    task["running"] = max(int(task.get("running", 0)) - 1, 0)
    if ok:
        task["completed_total"] = int(task.get("completed_total", 0)) + 1
    else:
        task["failed_total"] = int(task.get("failed_total", 0)) + 1
    task["last_duration_ms"] = duration_ms
    recent = list(task.get("recent", []))
    now_iso = _iso_ts(utcnow())
    for item in recent:
        if item.get("task_id") == task_id:
            item["status"] = "completed" if ok else "failed"
            item["ended_at"] = now_iso
            item["duration_ms"] = duration_ms
            item["error"] = (error or "")[:240]
            break
    task["recent"] = recent[:40]


def _task_monitor_snapshot() -> dict[str, Any]:
    snapshot: dict[str, Any] = {}
    for name, info in ASYNC_TASK_MONITOR.items():
        snapshot[name] = {
            "running": int(info.get("running", 0)),
            "started_total": int(info.get("started_total", 0)),
            "completed_total": int(info.get("completed_total", 0)),
            "failed_total": int(info.get("failed_total", 0)),
            "last_duration_ms": int(info.get("last_duration_ms", 0)),
            "recent": list(info.get("recent", []))[:20],
        }
    return snapshot


def _normalize_stream_fields(fields: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    if isinstance(fields, dict):
        for key, value in fields.items():
            k = key.decode("utf-8", errors="ignore") if isinstance(key, bytes) else str(key)
            if isinstance(value, bytes):
                out[k] = value.decode("utf-8", errors="ignore")
            else:
                out[k] = str(value)
    return out


async def _ensure_generation_stream_group() -> None:
    if not REDIS_AVAILABLE or REDIS_CLIENT is None:
        return
    try:
        await REDIS_CLIENT.xgroup_create(
            name=settings.redis_stream_gen_key,
            groupname=settings.redis_stream_group,
            id="0",
            mkstream=True,
        )
    except Exception as exc:
        if "BUSYGROUP" not in str(exc).upper():
            logger.warning("Failed to create Redis stream group: %s", exc)


async def _enqueue_generation_task(task: ImageGenerationTask, image_count: int) -> str:
    if not REDIS_AVAILABLE or REDIS_CLIENT is None:
        raise RuntimeError("Redis queue is not available")
    fields = {
        "task_id": task.id,
        "user_id": task.user_id,
        "n": str(max(1, min(int(image_count), 4))),
    }
    msg_id = await REDIS_CLIENT.xadd(
        settings.redis_stream_gen_key,
        fields,
        maxlen=200000,
        approximate=True,
    )
    msg = msg_id.decode("utf-8", errors="ignore") if isinstance(msg_id, bytes) else str(msg_id)
    await redis_set_json(_task_queue_msg_cache_key(task.id), {"msg_id": msg}, ttl_sec=86400)
    return msg


async def _build_generation_result_from_db(session: AsyncSession, task: ImageGenerationTask) -> dict[str, Any]:
    q = await session.execute(
        select(ImageGenerationCandidate)
        .where(ImageGenerationCandidate.task_id == task.id)
        .order_by(ImageGenerationCandidate.candidate_index.asc())
    )
    rows = q.scalars().all()
    images = [x.data_url for x in rows]
    candidate_ids = [x.id for x in rows]
    candidate_indexes = [int(x.candidate_index) for x in rows]
    return {
        "images": images,
        "artistic_prompt": task.artistic_prompt,
        "used_prompt": task.artistic_prompt,
        "generation_task_id": task.id,
        "candidate_ids": candidate_ids,
        "candidate_indexes": candidate_indexes,
        "meta": {"liblibai_base_url": settings.liblibai_base_url, "liblibai_uri": settings.liblibai_uri},
    }


async def _persist_generation_candidates(
    session: AsyncSession,
    task: ImageGenerationTask,
    images: list[str],
) -> tuple[list[str], list[int]]:
    await session.execute(
        text("DELETE FROM image_generation_candidates WHERE task_id = :task_id"),
        {"task_id": task.id},
    )
    candidate_ids: list[str] = []
    candidate_indexes: list[int] = []
    for idx, image_value in enumerate(images, start=1):
        candidate_id = uuid.uuid4().hex
        candidate_ids.append(candidate_id)
        candidate_indexes.append(idx)
        session.add(
            ImageGenerationCandidate(
                id=candidate_id,
                task_id=task.id,
                user_id=task.user_id,
                candidate_index=idx,
                data_url=(image_value or "").strip(),
                created_at=utcnow(),
                image_code=None,
                image_bucket=None,
                assigned_seq=None,
                assigned_at=None,
            )
        )
    return candidate_ids, candidate_indexes


async def _handle_generation_stream_message(message_id: str, fields: dict[str, str]) -> None:
    task_id = (fields.get("task_id") or "").strip()
    if not task_id:
        return

    async with SessionLocal() as session:
        tq = await session.execute(select(ImageGenerationTask).where(ImageGenerationTask.id == task_id))
        task = tq.scalars().first()
        if not task:
            return

        if bool(task.cancelled):
            task.status = "cancelled"
            task.progress = 100
            task.finished_at = utcnow()
            task.updated_at = utcnow()
            await session.commit()
            await _set_generation_progress(task.id, "cancelled", 100, message="task cancelled")
            return

        if bool(task.paused):
            task.status = "queued"
            task.updated_at = utcnow()
            await session.commit()
            await _set_generation_progress(task.id, "queued", max(1, int(task.progress or 1)), message="task paused")
            await _enqueue_generation_task(task, int(fields.get("n") or 4))
            return

        task.status = "running"
        task.progress = max(10, int(task.progress or 0))
        task.started_at = task.started_at or utcnow()
        task.updated_at = utcnow()
        await session.commit()

    await _set_generation_progress(task_id, "running", 10, message="optimizing prompt")

    try:
        async with SessionLocal() as session:
            tq = await session.execute(select(ImageGenerationTask).where(ImageGenerationTask.id == task_id))
            task = tq.scalars().first()
            if not task:
                return
            if bool(task.cancelled):
                task.status = "cancelled"
                task.progress = 100
                task.finished_at = utcnow()
                task.updated_at = utcnow()
                await session.commit()
                await _set_generation_progress(task.id, "cancelled", 100, message="task cancelled")
                return
            raw_prompt = task.raw_prompt

        artistic = await _optimize_prompt_text(raw_prompt)
        await _set_generation_progress(task_id, "running", 45, message="calling image provider")
        images = await liblibai_gen_images({"prompt": artistic, "n": int(fields.get("n") or 4)})
        await _set_generation_progress(task_id, "running", 85, message="saving outputs")

        async with SessionLocal() as session:
            tq = await session.execute(select(ImageGenerationTask).where(ImageGenerationTask.id == task_id))
            task = tq.scalars().first()
            if not task:
                return
            if bool(task.cancelled):
                task.status = "cancelled"
                task.progress = 100
                task.finished_at = utcnow()
                task.updated_at = utcnow()
                await session.commit()
                await _set_generation_progress(task.id, "cancelled", 100, message="task cancelled")
                return

            uq = await session.execute(select(User).where(User.id == task.user_id))
            owner = uq.scalars().first()
            if owner is None:
                raise RuntimeError("Task owner not found")
            await _charge_operation_credits(
                session=session,
                user=owner,
                operation="liblibai_gen_img",
                note=f"liblibai_gen:{len(images)}",
            )

            task.artistic_prompt = artistic
            candidate_ids, candidate_indexes = await _persist_generation_candidates(session, task, images)
            session.add(
                GenerationRecord(
                    user_id=task.user_id,
                    raw_prompt=task.raw_prompt,
                    artistic_prompt=artistic,
                    provider="liblibai",
                )
            )
            task.status = "completed"
            task.progress = 100
            task.failure_reason = ""
            task.finished_at = utcnow()
            task.updated_at = utcnow()
            await session.commit()

            result_payload = {
                "images": images,
                "artistic_prompt": artistic,
                "used_prompt": artistic,
                "generation_task_id": task.id,
                "candidate_ids": candidate_ids,
                "candidate_indexes": candidate_indexes,
                "meta": {"liblibai_base_url": settings.liblibai_base_url, "liblibai_uri": settings.liblibai_uri},
            }
        day_key = utcnow().strftime("%Y%m%d")
        hour_key = utcnow().strftime("%Y%m%d%H")
        await redis_incr(_counter_key("generation_images_day", day_key), amount=len(images), ttl_sec=90 * 24 * 3600)
        await redis_incr(_counter_key("generation_images_hour", hour_key), amount=len(images), ttl_sec=14 * 24 * 3600)
        await redis_incr(_counter_key("generation_task_day", day_key), amount=1, ttl_sec=90 * 24 * 3600)
        await redis_set_json(_task_result_cache_key(task_id), result_payload, ttl_sec=3600)
        await _set_generation_progress(task_id, "completed", 100, message="completed")
    except Exception as exc:
        reason = str(exc)
        should_retry = False
        non_retry_errors = (
            "Insufficient credits",
            "Prompt blocked",
            "Task owner not found",
        )
        async with SessionLocal() as session:
            tq = await session.execute(select(ImageGenerationTask).where(ImageGenerationTask.id == task_id))
            task = tq.scalars().first()
            if task is not None:
                task.retry_count = int(task.retry_count or 0) + 1
                if (
                    (not task.cancelled)
                    and task.retry_count <= int(task.max_retries or settings.generation_queue_max_retry)
                    and not any(marker in reason for marker in non_retry_errors)
                ):
                    task.status = "queued"
                    task.progress = max(1, min(90, 10 * task.retry_count))
                    task.updated_at = utcnow()
                    should_retry = True
                else:
                    task.status = "failed"
                    task.progress = 100
                    task.failure_reason = reason[:800]
                    task.finished_at = utcnow()
                    task.updated_at = utcnow()
                await session.commit()

        if should_retry:
            async with SessionLocal() as session:
                tq = await session.execute(select(ImageGenerationTask).where(ImageGenerationTask.id == task_id))
                task = tq.scalars().first()
                if task is not None:
                    await _enqueue_generation_task(task, int(fields.get("n") or 4))
            await _set_generation_progress(task_id, "queued", 15, message="retry scheduled")
        else:
            if REDIS_AVAILABLE and REDIS_CLIENT is not None:
                try:
                    await REDIS_CLIENT.xadd(
                        settings.redis_stream_gen_dlq_key,
                        {
                            "task_id": task_id,
                            "error": reason[:500],
                            "failed_at": _iso_ts(utcnow()),
                        },
                        maxlen=100000,
                        approximate=True,
                    )
                except Exception:
                    pass
            await _set_generation_progress(task_id, "failed", 100, failure_reason=reason[:500])


async def _generation_worker_loop() -> None:
    if not REDIS_AVAILABLE or REDIS_CLIENT is None or not settings.generation_queue_enabled:
        return
    await _ensure_generation_stream_group()
    consumer = f"{settings.redis_stream_consumer_prefix}-{uuid.uuid4().hex[:8]}"
    while True:
        try:
            batches = await REDIS_CLIENT.xreadgroup(
                groupname=settings.redis_stream_group,
                consumername=consumer,
                streams={settings.redis_stream_gen_key: ">"},
                count=1,
                block=2000,
            )
            if not batches:
                await asyncio.sleep(0.05)
                continue
            for _, entries in batches:
                for msg_id, raw_fields in entries:
                    stream_id = msg_id.decode("utf-8", errors="ignore") if isinstance(msg_id, bytes) else str(msg_id)
                    fields = _normalize_stream_fields(raw_fields)
                    try:
                        await _handle_generation_stream_message(stream_id, fields)
                    finally:
                        try:
                            await REDIS_CLIENT.xack(settings.redis_stream_gen_key, settings.redis_stream_group, msg_id)
                        except Exception:
                            pass
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("Generation worker loop error: %s", exc)
            await asyncio.sleep(1.0)


async def _ensure_export_stream_group() -> None:
    if not REDIS_AVAILABLE or REDIS_CLIENT is None:
        return
    try:
        await REDIS_CLIENT.xgroup_create(
            name=settings.redis_stream_export_key,
            groupname=settings.redis_stream_export_group,
            id="0",
            mkstream=True,
        )
    except Exception as exc:
        if "BUSYGROUP" not in str(exc).upper():
            logger.warning("Failed to create Redis export stream group: %s", exc)


async def _enqueue_export_task(task: AdminExportTask) -> str:
    if not REDIS_AVAILABLE or REDIS_CLIENT is None:
        raise RuntimeError("Redis queue is not available")
    msg_id = await REDIS_CLIENT.xadd(
        settings.redis_stream_export_key,
        {
            "task_id": task.id,
            "scope": task.scope,
            "file_format": task.file_format,
            "request_user_id": task.request_user_id,
        },
        maxlen=100000,
        approximate=True,
    )
    return msg_id.decode("utf-8", errors="ignore") if isinstance(msg_id, bytes) else str(msg_id)


def _schedule_local_export_task(task: AdminExportTask) -> str:
    local_msg_id = f"local-{uuid.uuid4().hex}"
    asyncio.create_task(
        _handle_export_stream_message(
            local_msg_id,
            {
                "task_id": task.id,
                "scope": task.scope,
                "file_format": task.file_format,
                "request_user_id": task.request_user_id,
            },
        ),
        name=f"inkai-export-local-{task.id[:8]}",
    )
    return local_msg_id


def _serialize_export_task_item(task: AdminExportTask) -> dict[str, Any]:
    download_token = task.download_token or ""
    return {
        "task_id": task.id,
        "request_user_id": task.request_user_id,
        "scope": task.scope,
        "file_format": task.file_format,
        "status": task.status,
        "progress": int(task.progress or 0),
        "download_token": download_token,
        "download_url": f"/api/admin/export/download/{task.id}?token={download_token}" if task.status == "completed" else None,
        "error": task.error or "",
        "file_size": int(task.file_size or 0),
        "created_at": _iso_ts(task.created_at),
        "started_at": _iso_ts(task.started_at) if task.started_at else None,
        "finished_at": _iso_ts(task.finished_at) if task.finished_at else None,
    }


async def _write_export_status_cache(task: AdminExportTask) -> None:
    payload = _serialize_export_task_item(task)
    ttl = max(3600, int(settings.admin_export_retention_hours) * 3600)
    await redis_set_json(_export_status_cache_key(task.id), payload, ttl_sec=ttl)


async def _cleanup_expired_export_files() -> None:
    retention_hours = max(1, int(settings.admin_export_retention_hours))
    cutoff = utcnow() - timedelta(hours=retention_hours)

    async with SessionLocal() as session:
        q = await session.execute(
            select(AdminExportTask).where(
                AdminExportTask.finished_at.is_not(None),
                AdminExportTask.finished_at < cutoff,
            )
        )
        rows = q.scalars().all()
        for row in rows:
            path = (row.storage_path or "").strip()
            if path:
                try:
                    p = Path(path)
                    if p.exists():
                        p.unlink(missing_ok=True)
                except Exception:
                    pass
            row.storage_path = ""
            row.download_token = ""
        if rows:
            await session.commit()


async def _handle_export_stream_message(message_id: str, fields: dict[str, str]) -> None:
    task_id = (fields.get("task_id") or "").strip()
    if not task_id:
        return

    monitor_task_id, monitor_started = _track_task_start("admin_export", context=f"task={task_id}")
    try:
        async with SessionLocal() as session:
            q = await session.execute(select(AdminExportTask).where(AdminExportTask.id == task_id))
            task = q.scalars().first()
            if not task:
                _track_task_end("admin_export", monitor_task_id, monitor_started, ok=False, error="task not found")
                return
            if task.status in {"completed", "failed"}:
                _track_task_end("admin_export", monitor_task_id, monitor_started, ok=True)
                return

            task.status = "processing"
            task.progress = 10
            task.started_at = task.started_at or utcnow()
            task.error = ""
            await session.commit()
            await _write_export_status_cache(task)

        scope = (fields.get("scope") or "all").strip().lower()
        async with SessionLocal() as session:
            content = await _build_export_workbook(session, scope=scope)
            output_dir = Path(settings.admin_export_dir).resolve()
            output_dir.mkdir(parents=True, exist_ok=True)
            file_name = f"inkai-export-{task_id}-{utcnow().strftime('%Y%m%d%H%M%S')}.xlsx"
            file_path = output_dir / file_name
            file_path.write_bytes(content)
            file_size = file_path.stat().st_size if file_path.exists() else 0

            q = await session.execute(select(AdminExportTask).where(AdminExportTask.id == task_id))
            task = q.scalars().first()
            if not task:
                _track_task_end("admin_export", monitor_task_id, monitor_started, ok=False, error="task lost")
                return
            task.status = "completed"
            task.progress = 100
            task.storage_path = str(file_path)
            task.download_token = task.download_token or uuid.uuid4().hex
            task.file_size = int(file_size)
            task.finished_at = utcnow()
            task.error = ""
            await session.commit()
            await _write_export_status_cache(task)
            _notify_export_task_result(task, ok=True)
        _track_task_end("admin_export", monitor_task_id, monitor_started, ok=True)
    except Exception as exc:
        err = str(exc)
        async with SessionLocal() as session:
            q = await session.execute(select(AdminExportTask).where(AdminExportTask.id == task_id))
            task = q.scalars().first()
            if task:
                task.status = "failed"
                task.progress = 100
                task.error = err[:800]
                task.finished_at = utcnow()
                await session.commit()
                await _write_export_status_cache(task)
                _notify_export_task_result(task, ok=False)
        if REDIS_AVAILABLE and REDIS_CLIENT is not None:
            try:
                await REDIS_CLIENT.xadd(
                    settings.redis_stream_export_dlq_key,
                    {
                        "task_id": task_id,
                        "error": err[:500],
                        "failed_at": _iso_ts(utcnow()),
                        "source_msg_id": message_id,
                    },
                    maxlen=100000,
                    approximate=True,
                )
            except Exception:
                pass
        _track_task_end("admin_export", monitor_task_id, monitor_started, ok=False, error=err)


async def _export_worker_loop() -> None:
    if not REDIS_AVAILABLE or REDIS_CLIENT is None or not settings.export_queue_enabled:
        return
    await _ensure_export_stream_group()
    consumer = f"{settings.redis_stream_export_consumer_prefix}-{uuid.uuid4().hex[:8]}"
    while True:
        try:
            batches = await REDIS_CLIENT.xreadgroup(
                groupname=settings.redis_stream_export_group,
                consumername=consumer,
                streams={settings.redis_stream_export_key: ">"},
                count=1,
                block=2000,
            )
            if not batches:
                await asyncio.sleep(0.05)
                continue
            for _, entries in batches:
                for msg_id, raw_fields in entries:
                    stream_id = msg_id.decode("utf-8", errors="ignore") if isinstance(msg_id, bytes) else str(msg_id)
                    fields = _normalize_stream_fields(raw_fields)
                    try:
                        await _handle_export_stream_message(stream_id, fields)
                    finally:
                        try:
                            await REDIS_CLIENT.xack(settings.redis_stream_export_key, settings.redis_stream_export_group, msg_id)
                        except Exception:
                            pass
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("Export worker loop error: %s", exc)
            await asyncio.sleep(1.0)


def _serialize_notification(row: Notification) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "user_id": row.user_id,
        "type": row.type,
        "title": row.title,
        "content": row.content,
        "related_id": row.related_id,
        "is_read": bool(row.is_read),
        "created_at": _iso_ts(row.created_at),
    }


async def _persist_notification_payload(payload: dict[str, Any]) -> None:
    user_id = str(payload.get("user_id") or "").strip()
    if not user_id:
        return
    notification_type = str(payload.get("type") or "").strip().upper()
    if notification_type not in NOTIFICATION_TYPE_VALUES:
        return
    title = str(payload.get("title") or "").strip()[:200]
    if not title:
        return
    content = str(payload.get("content") or "").strip()[:4000]
    related_id = str(payload.get("related_id") or "").strip()[:64] or None

    async with SessionLocal() as session:
        session.add(
            Notification(
                user_id=user_id,
                type=notification_type,
                title=title,
                content=content,
                related_id=related_id,
                is_read=False,
                created_at=utcnow(),
            )
        )
        await session.commit()


def _enqueue_notification(
    *,
    user_id: str,
    notification_type: str,
    title: str,
    content: str,
    related_id: str | None = None,
) -> None:
    payload = {
        "user_id": (user_id or "").strip(),
        "type": (notification_type or "").strip().upper(),
        "title": (title or "").strip(),
        "content": (content or "").strip(),
        "related_id": (related_id or "").strip() or None,
    }
    queue = NOTIFICATION_QUEUE
    if queue is not None:
        try:
            queue.put_nowait(payload)
            return
        except Exception:
            pass
    try:
        asyncio.create_task(_persist_notification_payload(payload), name="inkai-notification-direct")
    except Exception as exc:
        logger.warning("Failed to enqueue notification task: %s", exc)


async def _notification_worker_loop() -> None:
    queue = NOTIFICATION_QUEUE
    if queue is None:
        return
    while True:
        try:
            payload = await queue.get()
        except asyncio.CancelledError:
            break
        except Exception:
            await asyncio.sleep(0.2)
            continue
        try:
            await _persist_notification_payload(payload)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("Notification worker failed to persist payload: %s", exc)
        finally:
            try:
                queue.task_done()
            except Exception:
                pass


def _notify_export_task_result(task: AdminExportTask, *, ok: bool) -> None:
    notif_type = NOTIFICATION_TYPE_EXPORT_SUCCESS if ok else NOTIFICATION_TYPE_EXPORT_FAILED
    title = "导出任务完成" if ok else "导出任务失败"
    if ok:
        content = f"导出任务 {task.id} 已完成，可在导出列表下载。"
    else:
        content = f"导出任务 {task.id} 失败：{(task.error or 'unknown')[:240]}"
    _enqueue_notification(
        user_id=task.request_user_id,
        notification_type=notif_type,
        title=title,
        content=content,
        related_id=task.id,
    )


def _notify_moderation_ticket_assigned(ticket: ModerationTicket) -> None:
    target_user_id = (ticket.assigned_admin_user_id or "").strip()
    if not target_user_id:
        return
    _enqueue_notification(
        user_id=target_user_id,
        notification_type=NOTIFICATION_TYPE_MODERATION_TICKET_ASSIGNED,
        title="收到审核工单",
        content=f"工单 {ticket.id} 已分配给你，请尽快处理。",
        related_id=ticket.id,
    )


def _notify_moderation_appeal_submitted(ticket: ModerationTicket) -> None:
    target_user_id = (ticket.assigned_admin_user_id or ROOT_USER_ID).strip() or ROOT_USER_ID
    _enqueue_notification(
        user_id=target_user_id,
        notification_type=NOTIFICATION_TYPE_MODERATION_APPEAL_SUBMITTED,
        title="收到工单申诉",
        content=f"工单 {ticket.id} 出现新的申诉，请复核处理。",
        related_id=ticket.id,
    )


async def _wait_for_generation_result(task_id: str, user_id: str) -> dict[str, Any]:
    deadline = time.time() + int(settings.generation_queue_wait_timeout_sec)
    poll_seconds = max(0.2, settings.generation_queue_poll_interval_ms / 1000.0)

    while time.time() < deadline:
        cached = await redis_get_json(_task_result_cache_key(task_id))
        if isinstance(cached, dict) and isinstance(cached.get("images"), list):
            return cached

        async with SessionLocal() as session:
            tq = await session.execute(
                select(ImageGenerationTask).where(
                    ImageGenerationTask.id == task_id,
                    ImageGenerationTask.user_id == user_id,
                )
            )
            task = tq.scalars().first()
            if not task:
                raise HTTPException(status_code=404, detail="Generation task not found")
            if task.status == "completed":
                payload = await _build_generation_result_from_db(session, task)
                await redis_set_json(_task_result_cache_key(task_id), payload, ttl_sec=3600)
                return payload
            if task.status == "failed":
                raise HTTPException(status_code=500, detail=f"Image generation failed: {task.failure_reason or 'unknown'}")
            if task.status == "cancelled":
                raise HTTPException(status_code=409, detail="Generation task cancelled")

        await asyncio.sleep(poll_seconds)

    raise HTTPException(status_code=504, detail="Generation task timeout")


def _parse_counter_cache_key(key: str) -> tuple[str, str] | None:
    parts = (key or "").split(":")
    if len(parts) < 4:
        return None
    if parts[0] != "inkai" or parts[1] != "counter":
        return None
    counter_type = parts[2]
    entity_id = ":".join(parts[3:]) if len(parts) > 3 else ""
    return counter_type, entity_id


async def _sync_redis_counters_to_mysql(window: Literal["hour", "day"]) -> None:
    if not REDIS_AVAILABLE or REDIS_CLIENT is None:
        return
    now = utcnow()
    if window == "hour":
        window_start = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=1)
        window_end = window_start + timedelta(hours=1)
    else:
        window_start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
        window_end = window_start + timedelta(days=1)

    pairs: list[tuple[str, str, int]] = []
    try:
        async for key in REDIS_CLIENT.scan_iter(match="inkai:counter:*"):
            parsed = _parse_counter_cache_key(key)
            if parsed is None:
                continue
            value_raw = await REDIS_CLIENT.get(key)
            if value_raw is None:
                continue
            try:
                value = int(float(value_raw))
            except Exception:
                continue
            counter_type, entity_id = parsed
            pairs.append((counter_type, entity_id, value))
    except Exception as exc:
        logger.warning("Counter scan failed: %s", exc)
        return

    if not pairs:
        return

    async with SessionLocal() as session:
        for counter_type, entity_id, value in pairs:
            q = await session.execute(
                select(CounterSyncSnapshot).where(
                    CounterSyncSnapshot.counter_type == counter_type,
                    CounterSyncSnapshot.entity_id == entity_id,
                    CounterSyncSnapshot.window_start == window_start,
                    CounterSyncSnapshot.window_end == window_end,
                )
            )
            row = q.scalars().first()
            if row:
                row.value = value
                row.synced_at = now
            else:
                session.add(
                    CounterSyncSnapshot(
                        counter_type=counter_type,
                        entity_id=entity_id,
                        value=value,
                        window_start=window_start,
                        window_end=window_end,
                        synced_at=now,
                    )
                )
        await session.commit()


async def _start_background_runtime() -> None:
    global SCHEDULER, GENERATION_WORKER_TASK, EXPORT_WORKER_TASK, NOTIFICATION_QUEUE, NOTIFICATION_WORKER_TASK

    if AsyncIOScheduler is not None and (settings.counter_sync_enabled or settings.export_queue_enabled):
        scheduler = AsyncIOScheduler(timezone="UTC")
        if settings.counter_sync_enabled:
            scheduler.add_job(
                _sync_redis_counters_to_mysql,
                trigger="cron",
                args=("hour",),
                minute=settings.counter_sync_hourly_cron_minute,
                id="counter_sync_hourly",
                replace_existing=True,
                coalesce=True,
                max_instances=1,
            )
            scheduler.add_job(
                _sync_redis_counters_to_mysql,
                trigger="cron",
                args=("day",),
                hour=settings.counter_sync_daily_cron_hour,
                minute=settings.counter_sync_daily_cron_minute,
                id="counter_sync_daily",
                replace_existing=True,
                coalesce=True,
                max_instances=1,
            )
        scheduler.add_job(
            _cleanup_expired_export_files,
            trigger="cron",
            minute=17,
            id="admin_export_cleanup",
            replace_existing=True,
            coalesce=True,
            max_instances=1,
        )
        scheduler.start()
        SCHEDULER = scheduler

    if settings.generation_queue_enabled and REDIS_AVAILABLE and GENERATION_WORKER_TASK is None:
        GENERATION_WORKER_TASK = asyncio.create_task(_generation_worker_loop(), name="inkai-generation-worker")
    if settings.export_queue_enabled and REDIS_AVAILABLE and EXPORT_WORKER_TASK is None:
        EXPORT_WORKER_TASK = asyncio.create_task(_export_worker_loop(), name="inkai-export-worker")
    if NOTIFICATION_QUEUE is None:
        NOTIFICATION_QUEUE = asyncio.Queue()
    if NOTIFICATION_WORKER_TASK is None:
        NOTIFICATION_WORKER_TASK = asyncio.create_task(_notification_worker_loop(), name="inkai-notification-worker")


async def _stop_background_runtime() -> None:
    global SCHEDULER, GENERATION_WORKER_TASK, EXPORT_WORKER_TASK, NOTIFICATION_QUEUE, NOTIFICATION_WORKER_TASK

    if GENERATION_WORKER_TASK is not None:
        GENERATION_WORKER_TASK.cancel()
        try:
            await GENERATION_WORKER_TASK
        except Exception:
            pass
        GENERATION_WORKER_TASK = None
    if EXPORT_WORKER_TASK is not None:
        EXPORT_WORKER_TASK.cancel()
        try:
            await EXPORT_WORKER_TASK
        except Exception:
            pass
        EXPORT_WORKER_TASK = None
    if NOTIFICATION_WORKER_TASK is not None:
        NOTIFICATION_WORKER_TASK.cancel()
        try:
            await NOTIFICATION_WORKER_TASK
        except Exception:
            pass
        NOTIFICATION_WORKER_TASK = None
    NOTIFICATION_QUEUE = None

    if SCHEDULER is not None:
        try:
            SCHEDULER.shutdown(wait=False)
        except Exception:
            pass
        SCHEDULER = None


async def _charge_operation_credits(
    session: AsyncSession,
    user: User,
    operation: Literal["prompt_optimize", "liblibai_gen_img", "deepseek_chat"],
    amount_multiplier: int = 1,
    note: str = "",
) -> int:
    unit_cost = int(RUNTIME_BILLING_RULES.get(operation, 0))
    total_cost = max(0, unit_cost * max(1, int(amount_multiplier)))
    if total_cost <= 0:
        return 0
    current = int(user.credits_balance or 0)
    if current < total_cost:
        raise HTTPException(
            status_code=402,
            detail=f"Insufficient credits. Needed {total_cost}, current {current}.",
        )
    user.credits_balance = current - total_cost
    session.add(
        CreditLedger(
            user_id=user.id,
            type="spend",
            amount=-total_cost,
            note=(note or operation)[:255],
        )
    )
    await redis_set_json(cache_key("user_credit", user.id), {"credits_balance": int(user.credits_balance or 0)}, ttl_sec=120)
    return total_cost


async def _grant_daily_restore_if_needed(session: AsyncSession, user: User) -> int:
    current = int(user.credits_balance or 0)
    if current >= DAILY_RESTORE_BALANCE_CAP:
        return 0

    day_start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    q = await session.execute(
        select(CreditLedger.id)
        .where(
            CreditLedger.user_id == user.id,
            CreditLedger.type == "daily_restore",
            CreditLedger.created_at >= day_start,
        )
        .limit(1)
    )
    if q.scalar_one_or_none() is not None:
        return 0

    grant = min(DAILY_RESTORE_CREDITS, DAILY_RESTORE_BALANCE_CAP - current)
    if grant <= 0:
        return 0

    user.credits_balance = current + grant
    session.add(
        CreditLedger(
            user_id=user.id,
            type="daily_restore",
            amount=grant,
            note=f"daily_restore:+{grant}",
        )
    )
    await redis_set_json(cache_key("user_credit", user.id), {"credits_balance": int(user.credits_balance or 0)}, ttl_sec=120)
    return grant


def _is_root_user(user: User) -> bool:
    return user.id == ROOT_USER_ID or user.username == settings.root_username


def _client_ip_from_request(request: Request) -> str:
    xff = (request.headers.get("x-forwarded-for") or "").strip()
    if xff:
        return xff.split(",")[0].strip()
    xrip = (request.headers.get("x-real-ip") or "").strip()
    if xrip:
        return xrip
    if request.client and request.client.host:
        return request.client.host
    return ""


def _normalize_terminal_type(user_agent: str) -> str:
    ua = (user_agent or "").lower()
    if not ua:
        return "unknown"
    if "ipad" in ua or "tablet" in ua:
        return "tablet"
    if "mobile" in ua or "android" in ua or "iphone" in ua:
        return "mobile"
    if "bot" in ua or "spider" in ua or "crawler" in ua:
        return "bot"
    return "desktop"


def _normalize_region(raw_region: str | None, timezone: str | None = None) -> str:
    region = (raw_region or "").strip()
    if region:
        return region[:64]
    tz = (timezone or "").strip()
    if tz:
        return tz[:64]
    return "Unknown"


def _safe_user_id_from_authorization(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        payload = jwt.decode(
            token,
            options={"verify_signature": False, "verify_exp": False, "verify_iat": False},
            algorithms=[settings.jwt_algorithm],
        )
        user_id = str(payload.get("sub", "")).strip()
        return user_id or None
    except Exception:
        return None


def _bucket_start(dt: datetime, granularity: Literal["hour", "day", "week", "month"]) -> datetime:
    if granularity == "hour":
        return dt.replace(minute=0, second=0, microsecond=0)
    if granularity == "day":
        return dt.replace(hour=0, minute=0, second=0, microsecond=0)
    if granularity == "week":
        d0 = dt.replace(hour=0, minute=0, second=0, microsecond=0)
        return d0 - timedelta(days=d0.weekday())
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _next_bucket(dt: datetime, granularity: Literal["hour", "day", "week", "month"]) -> datetime:
    if granularity == "hour":
        return dt + timedelta(hours=1)
    if granularity == "day":
        return dt + timedelta(days=1)
    if granularity == "week":
        return dt + timedelta(days=7)
    year = dt.year + (1 if dt.month == 12 else 0)
    month = 1 if dt.month == 12 else dt.month + 1
    return dt.replace(year=year, month=month, day=1)


def _time_window_for_range(range_key: Literal["hour", "day", "week", "month"]) -> tuple[datetime, str]:
    now = utcnow()
    if range_key == "hour":
        return now - timedelta(hours=24), "hour"
    if range_key == "day":
        return now - timedelta(days=30), "day"
    if range_key == "week":
        return now - timedelta(days=7 * 12), "week"
    return now - timedelta(days=365), "month"


def _series_template(start: datetime, end: datetime, granularity: Literal["hour", "day", "week", "month"]) -> dict[datetime, dict[str, Any]]:
    out: dict[datetime, dict[str, Any]] = {}
    cur = _bucket_start(start, granularity)
    end_bucket = _bucket_start(end, granularity)
    while cur <= end_bucket:
        out[cur] = {"calls": 0, "errors": 0, "latency_sum": 0}
        cur = _next_bucket(cur, granularity)
    return out


def _iso_ts(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat() + "Z"


def _update_breaker(path: str, status_code: int) -> None:
    state = API_BREAKER_STATE.setdefault(
        path,
        {
            "consecutive_failures": 0,
            "total_calls": 0,
            "failed_calls": 0,
            "open_until": None,
            "last_status_code": 200,
            "last_seen": utcnow(),
        },
    )
    now = utcnow()
    state["total_calls"] += 1
    state["last_status_code"] = status_code
    state["last_seen"] = now
    success = 200 <= status_code < 400
    if success:
        state["consecutive_failures"] = 0
        if state.get("open_until") and state["open_until"] <= now:
            state["open_until"] = None
        return

    state["failed_calls"] += 1
    state["consecutive_failures"] += 1
    if state["consecutive_failures"] >= API_BREAKER_FAILURE_STREAK:
        state["open_until"] = now + timedelta(seconds=API_BREAKER_OPEN_SECONDS)


def _breaker_status_for(path: str) -> str:
    state = API_BREAKER_STATE.get(path)
    if not state:
        return "closed"
    open_until = state.get("open_until")
    if isinstance(open_until, datetime) and open_until > utcnow():
        return "open"
    return "closed"


def _create_token(user_id: str, token_type: Literal["access", "refresh"], exp: datetime, jti: str) -> str:
    payload = {
        "sub": user_id,
        "typ": token_type,
        "jti": jti,
        "iat": to_unix_seconds(utcnow()),
        "exp": to_unix_seconds(exp),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _decode_token(token: str, expected_type: Literal["access", "refresh"]) -> dict[str, Any]:
    try:
        data = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if data.get("typ") != expected_type:
        raise HTTPException(status_code=401, detail="Invalid token type")
    return data


def _issue_token_pair(user_id: str) -> tuple[str, str, str, datetime]:
    access_exp = utcnow() + timedelta(minutes=settings.jwt_access_exp_minutes)
    refresh_exp = utcnow() + timedelta(days=settings.jwt_refresh_exp_days)
    access_jti = uuid.uuid4().hex
    refresh_jti = uuid.uuid4().hex
    access_token = _create_token(user_id, "access", access_exp, access_jti)
    refresh_token = _create_token(user_id, "refresh", refresh_exp, refresh_jti)
    return access_token, refresh_token, refresh_jti, refresh_exp


class AuthUserView(BaseModel):
    id: str
    username: str
    display_name: str
    email: str | None = None
    created_at: datetime


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: AuthUserView


class SendCodeRequest(BaseModel):
    email: str
    purpose: Literal["register", "login"]
    captcha_token: str | None = None


class SendCodeResponse(BaseModel):
    ok: bool
    message: str
    dev_code: str | None = None


class RegisterRequest(BaseModel):
    username: str
    email: str
    code: str
    password: str
    display_name: str | None = None
    captcha_token: str | None = None


class LoginPasswordRequest(BaseModel):
    account: str
    password: str
    captcha_token: str | None = None


class LoginEmailRequest(BaseModel):
    email: str
    code: str
    captcha_token: str | None = None


class LoginOAuthMockRequest(BaseModel):
    provider: Literal["qq", "wechat"]
    open_id: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    display_name: str


class DeepSeekChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class DeepSeekChatRequest(BaseModel):
    messages: list[DeepSeekChatMessage]


class PromptOptimizeRequest(BaseModel):
    raw_prompt: str


class LiblibaiGenRequest(BaseModel):
    raw_prompt: str
    n: int = 4


class LiblibaiGenResponse(BaseModel):
    images: list[str]
    artistic_prompt: str
    used_prompt: str
    generation_task_id: str | None = None
    candidate_ids: list[str] = []
    candidate_indexes: list[int] = []
    meta: dict[str, Any]


class BillingMeResponse(BaseModel):
    user_id: str
    credits_balance: int
    subscription_mode: str | None = None


class CommunityPublishRequest(BaseModel):
    archive_id: str = ""
    publish_source: Literal["generated", "upload"] = "generated"
    title: str
    data_url: str
    prompt_artistic: str = ""
    params: dict[str, Any] = Field(default_factory=dict)
    created_at: str | None = None
    published_at: str | None = None
    ai_generated: bool = True
    ai_label: str = "AI生成"
    minted: bool = False


class CommunityListResponse(BaseModel):
    items: list[dict[str, Any]]
    page: int
    page_size: int
    total: int


class CommunityCommentRequest(BaseModel):
    content: str


class CommunityReportRequest(BaseModel):
    reason: str


class ForumAskRequest(BaseModel):
    title: str
    content: str
    tags: list[str] = Field(default_factory=list)
    invited_user_ids: list[str] = Field(default_factory=list)


class ForumAnswerRequest(BaseModel):
    content: str


class ForumInviteRequest(BaseModel):
    invited_user_ids: list[str] = Field(default_factory=list)


class ForumListResponse(BaseModel):
    items: list[dict[str, Any]]
    page: int
    page_size: int
    total: int


class SelectGenerationImageRequest(BaseModel):
    generation_task_id: str
    selected_candidate_id: str


class DataCenterListResponse(BaseModel):
    items: list[dict[str, Any]]
    page: int
    page_size: int
    total: int


class SubscribeRequest(BaseModel):
    mode: Literal["usage", "bundle"]
    plan_key: str


class TopUpRequest(BaseModel):
    amount: int = Field(gt=0)
    note: str | None = None


class BillingRulePatchRequest(BaseModel):
    prompt_optimize: int | None = Field(default=None, ge=0, le=100000)
    liblibai_gen_img: int | None = Field(default=None, ge=0, le=100000)
    deepseek_chat: int | None = Field(default=None, ge=0, le=100000)


class PromptGuardPatchRequest(BaseModel):
    enabled: bool | None = None
    blocked_terms: list[str] | None = None


class PageViewRequest(BaseModel):
    visitor_id: str = Field(min_length=6, max_length=64)
    session_id: str = Field(min_length=6, max_length=64)
    page_path: str = Field(min_length=1, max_length=255)
    source_channel: str | None = Field(default=None, max_length=64)
    referrer: str | None = Field(default=None, max_length=512)
    region: str | None = Field(default=None, max_length=64)
    timezone: str | None = Field(default=None, max_length=64)


class HeartbeatRequest(BaseModel):
    session_id: str = Field(min_length=6, max_length=64)
    page_path: str = Field(min_length=1, max_length=255)
    region: str | None = Field(default=None, max_length=64)
    timezone: str | None = Field(default=None, max_length=64)


class ThresholdPatchRequest(BaseModel):
    api_fail_rate_threshold: float | None = Field(default=None, ge=0, le=1)
    online_surge_threshold: float | None = Field(default=None, ge=0, le=10)
    online_drop_threshold: float | None = Field(default=None, ge=0, le=1)
    refresh_interval_sec: int | None = Field(default=None, ge=1, le=60)


class ApiPermissionPatchRequest(BaseModel):
    path: str = Field(min_length=1, max_length=255)
    enabled: bool
    note: str | None = Field(default=None, max_length=255)


class AlertResolveRequest(BaseModel):
    note: str | None = Field(default=None, max_length=255)


class ModerationTicketDecisionRequest(BaseModel):
    action: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=4000)


class ModerationTicketAppealRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=4000)


class ModerationTicketFinalJudgmentRequest(BaseModel):
    final_result: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=4000)


class AdminExportCreateRequest(BaseModel):
    scope: Literal["all", "api", "online", "traffic", "users", "billing"] = "all"
    file_format: Literal["xlsx"] = "xlsx"
    filters: dict[str, Any] = Field(default_factory=dict)


class FeedbackSubmitRequest(BaseModel):
    category: str = Field(default="general", max_length=32)
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=4000)
    contact: str | None = Field(default=None, max_length=120)


class FeedbackResolveRequest(BaseModel):
    note: str | None = Field(default=None, max_length=255)


class PromptVersionSaveRequest(BaseModel):
    raw_prompt: str = Field(min_length=1, max_length=5000)
    artistic_prompt: str | None = Field(default=None, max_length=12000)


class PromptPresetUpsertRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str | None = Field(default=None, max_length=64)
    prompt_hint: str | None = Field(default=None, max_length=12000)
    params: dict[str, Any] = Field(default_factory=dict)


app = FastAPI(title="Ink-Aesthetics AI Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PERMISSION_EXEMPT_PREFIXES = (
    "/api/admin/",
    "/api/auth/",
    "/api/telemetry/",
)


def _api_permission_blocked(path: str) -> bool:
    if not path.startswith("/api/"):
        return False
    for prefix in API_PERMISSION_EXEMPT_PREFIXES:
        if path.startswith(prefix):
            return False
    enabled = API_PERMISSION_CACHE.get(path)
    if enabled is None:
        return False
    return not enabled


async def _persist_api_log(
    method: str,
    path: str,
    status_code: int,
    latency_ms: int,
    success: bool,
    client_ip: str,
    user_id: str | None,
    error_detail: str,
) -> None:
    try:
        async with SessionLocal() as s:
            s.add(
                ApiCallLog(
                    method=method,
                    path=path,
                    status_code=status_code,
                    latency_ms=latency_ms,
                    success=success,
                    client_ip=client_ip,
                    user_id=user_id,
                    error_detail=(error_detail or "")[:2000],
                )
            )
            await s.commit()
    except Exception:
        # Monitoring must never block business APIs.
        return


async def _fast_credit_breaker(path: str, authorization: str | None) -> str | None:
    if path != "/api/liblibai/gen-img":
        return None
    unit_cost = int(RUNTIME_BILLING_RULES.get("liblibai_gen_img", 0))
    if unit_cost <= 0:
        return None
    user_id = _safe_user_id_from_authorization(authorization)
    if not user_id:
        return None

    credit_key = cache_key("user_credit", user_id)
    cached_credit = await redis_get_json(credit_key)
    if isinstance(cached_credit, dict):
        try:
            balance = int(cached_credit.get("credits_balance", 0))
            if balance < unit_cost:
                return f"Insufficient credits. Needed {unit_cost}, current {balance}."
        except Exception:
            pass

    try:
        async with SessionLocal() as s:
            q = await s.execute(select(User).where(User.id == user_id))
            user = q.scalar_one_or_none()
            if not user:
                return None
            balance = int(user.credits_balance or 0)
            await redis_set_json(credit_key, {"credits_balance": balance}, ttl_sec=120)
            if balance < unit_cost:
                return f"Insufficient credits. Needed {unit_cost}, current {balance}."
    except Exception:
        return None
    return None


@app.middleware("http")
async def monitor_api_calls(request: Request, call_next):
    path = request.url.path
    started_at = time.perf_counter()
    response = None
    captured_error = ""
    captured_exception: Exception | None = None

    if _api_permission_blocked(path):
        response = JSONResponse(status_code=403, content={"detail": "API disabled by root policy"})
    else:
        blocked, reason = await _should_block_by_rate_limit(request)
        if blocked:
            response = JSONResponse(status_code=429, content={"detail": reason})
    if response is None:
        credit_block_reason = await _fast_credit_breaker(path, request.headers.get("authorization"))
        if credit_block_reason:
            response = JSONResponse(status_code=402, content={"detail": credit_block_reason})

    if response is None:
        try:
            response = await call_next(request)
        except Exception as exc:  # pragma: no cover - still logged at runtime
            captured_exception = exc
            captured_error = str(exc)
    else:
        captured_error = ""

    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
    status_code = response.status_code if response else 500
    success = 200 <= status_code < 400
    _update_breaker(path, status_code)

    if path.startswith("/api/"):
        await _persist_api_log(
            method=request.method,
            path=path,
            status_code=status_code,
            latency_ms=elapsed_ms,
            success=success,
            client_ip=_client_ip_from_request(request),
            user_id=_safe_user_id_from_authorization(request.headers.get("authorization")),
            error_detail=captured_error,
        )
        now = utcnow()
        day_key = now.strftime("%Y%m%d")
        hour_key = now.strftime("%Y%m%d%H")
        await redis_incr(_counter_key("api_calls_day", day_key), amount=1, ttl_sec=90 * 24 * 3600)
        await redis_incr(_counter_key("api_calls_hour", hour_key), amount=1, ttl_sec=14 * 24 * 3600)
        if not success:
            await redis_incr(_counter_key("api_errors_day", day_key), amount=1, ttl_sec=90 * 24 * 3600)
            await redis_incr(_counter_key("api_errors_hour", hour_key), amount=1, ttl_sec=14 * 24 * 3600)

    if captured_exception is not None:
        raise captured_exception
    return response


async def get_session() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


async def require_admin(x_inkai_token: str | None = Header(default=None)) -> None:
    expected = settings.backend_admin_token
    if not expected:
        return
    if (x_inkai_token or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid admin token")


async def get_current_user(
    session: AsyncSession = Depends(get_session),
    authorization: str | None = Header(default=None),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    data = _decode_token(token, "access")
    user_id = str(data.get("sub", "")).strip()
    token_jti = str(data.get("jti", "")).strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    q = await session.execute(select(User).where(User.id == user_id))
    user = q.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    granted = await _grant_daily_restore_if_needed(session, user)
    if granted > 0:
        await session.commit()
        await session.refresh(user)
    if token_jti:
        await redis_set_json(
            cache_key("session_access", token_jti),
            {"user_id": user.id, "is_active": bool(user.is_active), "ts": _iso_ts(utcnow())},
            ttl_sec=max(60, settings.jwt_access_exp_minutes * 60),
        )
    await redis_set_json(
        cache_key("user_credit", user.id),
        {"credits_balance": int(user.credits_balance or 0)},
        ttl_sec=120,
    )
    return user


async def get_optional_user(
    session: AsyncSession = Depends(get_session),
    authorization: str | None = Header(default=None),
) -> User | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    try:
        return await get_current_user(session=session, authorization=authorization)
    except HTTPException:
        return None


async def require_root_user(user: User = Depends(get_current_user)) -> User:
    if not _is_root_user(user):
        raise HTTPException(status_code=403, detail="Only admin can access this resource")
    return user


def _dialect_type_varchar(dialect_name: str, n: int) -> str:
    return f"VARCHAR({n})" if dialect_name != "sqlite" else "TEXT"


async def migrate_legacy_schema() -> None:
    async with engine.begin() as conn:
        def _sync_migrate(sync_conn):
            insp = inspect(sync_conn)
            if "users" not in insp.get_table_names():
                return
            cols = {c["name"] for c in insp.get_columns("users")}
            dialect = sync_conn.dialect.name

            def add_col(name: str, sql_type: str, default_sql: str = "", nullable: bool = True):
                if name in cols:
                    return
                null_sql = "" if nullable else "NOT NULL"
                sql = f"ALTER TABLE users ADD COLUMN {name} {sql_type} {default_sql} {null_sql}".strip()
                sync_conn.execute(text(sql))

            add_col("username", _dialect_type_varchar(dialect, 64), "DEFAULT ''", False)
            add_col("phone", _dialect_type_varchar(dialect, 32), "", True)
            add_col("email", _dialect_type_varchar(dialect, 255), "", True)
            add_col("display_name", _dialect_type_varchar(dialect, 64), "DEFAULT ''", False)
            add_col("password_hash", "TEXT", "DEFAULT ''", False)
            add_col("is_active", "BOOLEAN", "DEFAULT 1", False)
            add_col("credits_balance", "INTEGER", "DEFAULT 0", False)
            add_col("supertokens_user_id", _dialect_type_varchar(dialect, 128), "", True)
            add_col("supertokens_email", _dialect_type_varchar(dialect, 255), "", True)

            for idx_name, idx_sql in [
                ("ix_users_username", "CREATE INDEX ix_users_username ON users (username)"),
                ("ix_users_phone", "CREATE INDEX ix_users_phone ON users (phone)"),
                ("ix_users_email", "CREATE INDEX ix_users_email ON users (email)"),
                (
                    "ix_users_supertokens_user_id",
                    "CREATE UNIQUE INDEX ix_users_supertokens_user_id ON users (supertokens_user_id)",
                ),
                (
                    "ix_users_supertokens_email",
                    "CREATE UNIQUE INDEX ix_users_supertokens_email ON users (supertokens_email)",
                ),
            ]:
                idxs = {i["name"] for i in insp.get_indexes("users")}
                if idx_name not in idxs:
                    sync_conn.execute(text(idx_sql))

            if "user_feedback" in insp.get_table_names():
                fb_cols = {c["name"] for c in insp.get_columns("user_feedback")}

                def add_fb_col(name: str, sql_type: str, default_sql: str = "", nullable: bool = True):
                    if name in fb_cols:
                        return
                    null_sql = "" if nullable else "NOT NULL"
                    sql = f"ALTER TABLE user_feedback ADD COLUMN {name} {sql_type} {default_sql} {null_sql}".strip()
                    sync_conn.execute(text(sql))

                add_fb_col("replied_at", "DATETIME", "", True)
                add_fb_col("user_read_at", "DATETIME", "", True)

            if "image_generation_tasks" in insp.get_table_names():
                task_cols = {c["name"] for c in insp.get_columns("image_generation_tasks")}

                def add_task_col(name: str, sql_type: str, default_sql: str = "", nullable: bool = True):
                    if name in task_cols:
                        return
                    null_sql = "" if nullable else "NOT NULL"
                    sql = f"ALTER TABLE image_generation_tasks ADD COLUMN {name} {sql_type} {default_sql} {null_sql}".strip()
                    sync_conn.execute(text(sql))

                add_task_col("status", _dialect_type_varchar(dialect, 24), "DEFAULT 'completed'", False)
                add_task_col("progress", "INTEGER", "DEFAULT 0", False)
                add_task_col("failure_reason", "TEXT", "DEFAULT ''", False)
                add_task_col("retry_count", "INTEGER", "DEFAULT 0", False)
                add_task_col("max_retries", "INTEGER", "DEFAULT 3", False)
                add_task_col("queue_message_id", _dialect_type_varchar(dialect, 64), "", True)
                add_task_col("queued_at", "DATETIME", "", True)
                add_task_col("started_at", "DATETIME", "", True)
                add_task_col("finished_at", "DATETIME", "", True)
                add_task_col("updated_at", "DATETIME", "", True)
                add_task_col("paused", "BOOLEAN", "DEFAULT 0", False)
                add_task_col("cancelled", "BOOLEAN", "DEFAULT 0", False)

                for idx_name, idx_sql in [
                    ("ix_image_generation_tasks_status", "CREATE INDEX ix_image_generation_tasks_status ON image_generation_tasks (status)"),
                    (
                        "ix_image_generation_tasks_queue_message_id",
                        "CREATE INDEX ix_image_generation_tasks_queue_message_id ON image_generation_tasks (queue_message_id)",
                    ),
                    (
                        "ix_image_generation_tasks_updated_at",
                        "CREATE INDEX ix_image_generation_tasks_updated_at ON image_generation_tasks (updated_at)",
                    ),
                    ("ix_image_generation_tasks_paused", "CREATE INDEX ix_image_generation_tasks_paused ON image_generation_tasks (paused)"),
                    (
                        "ix_image_generation_tasks_cancelled",
                        "CREATE INDEX ix_image_generation_tasks_cancelled ON image_generation_tasks (cancelled)",
                    ),
                ]:
                    idxs = {i["name"] for i in insp.get_indexes("image_generation_tasks")}
                    if idx_name not in idxs:
                        sync_conn.execute(text(idx_sql))

            if "forum_questions" in insp.get_table_names():
                forum_cols = {c["name"] for c in insp.get_columns("forum_questions")}

                def add_forum_col(name: str, sql_type: str, default_sql: str = "", nullable: bool = True):
                    if name in forum_cols:
                        return
                    null_sql = "" if nullable else "NOT NULL"
                    sql = f"ALTER TABLE forum_questions ADD COLUMN {name} {sql_type} {default_sql} {null_sql}".strip()
                    sync_conn.execute(text(sql))

                add_forum_col("tags_json", "TEXT", "DEFAULT '[]'", False)
                add_forum_col("invited_user_ids_json", "TEXT", "DEFAULT '[]'", False)

                for idx_name, idx_sql in [
                    (
                        "ix_forum_questions_mod_created",
                        "CREATE INDEX ix_forum_questions_mod_created ON forum_questions (moderation_status, created_at)",
                    ),
                    (
                        "ix_forum_questions_user_created",
                        "CREATE INDEX ix_forum_questions_user_created ON forum_questions (user_id, created_at)",
                    ),
                    (
                        "ix_forum_questions_solved_created",
                        "CREATE INDEX ix_forum_questions_solved_created ON forum_questions (solved, created_at)",
                    ),
                ]:
                    idxs = {i["name"] for i in insp.get_indexes("forum_questions")}
                    if idx_name not in idxs:
                        sync_conn.execute(text(idx_sql))

            if "forum_answers" in insp.get_table_names():
                for idx_name, idx_sql in [
                    (
                        "ix_forum_answers_question_created",
                        "CREATE INDEX ix_forum_answers_question_created ON forum_answers (question_id, created_at)",
                    ),
                ]:
                    idxs = {i["name"] for i in insp.get_indexes("forum_answers")}
                    if idx_name not in idxs:
                        sync_conn.execute(text(idx_sql))

            if "community_posts" in insp.get_table_names():
                for idx_name, idx_sql in [
                    (
                        "ix_community_posts_mod_published",
                        "CREATE INDEX ix_community_posts_mod_published ON community_posts (moderation_status, published_at)",
                    ),
                    (
                        "ix_community_posts_owner_created",
                        "CREATE INDEX ix_community_posts_owner_created ON community_posts (owner_user_id, created_at)",
                    ),
                ]:
                    idxs = {i["name"] for i in insp.get_indexes("community_posts")}
                    if idx_name not in idxs:
                        sync_conn.execute(text(idx_sql))

            if "credit_ledger" in insp.get_table_names():
                for idx_name, idx_sql in [
                    (
                        "ix_credit_ledger_user_created",
                        "CREATE INDEX ix_credit_ledger_user_created ON credit_ledger (user_id, created_at)",
                    ),
                    (
                        "ix_credit_ledger_user_type_created",
                        "CREATE INDEX ix_credit_ledger_user_type_created ON credit_ledger (user_id, type, created_at)",
                    ),
                ]:
                    idxs = {i["name"] for i in insp.get_indexes("credit_ledger")}
                    if idx_name not in idxs:
                        sync_conn.execute(text(idx_sql))

            if "api_call_logs" in insp.get_table_names():
                for idx_name, idx_sql in [
                    (
                        "ix_api_call_logs_created_path",
                        "CREATE INDEX ix_api_call_logs_created_path ON api_call_logs (created_at, path)",
                    ),
                    (
                        "ix_api_call_logs_status_created",
                        "CREATE INDEX ix_api_call_logs_status_created ON api_call_logs (status_code, created_at)",
                    ),
                ]:
                    idxs = {i["name"] for i in insp.get_indexes("api_call_logs")}
                    if idx_name not in idxs:
                        sync_conn.execute(text(idx_sql))

            if "website_visit_logs" in insp.get_table_names():
                for idx_name, idx_sql in [
                    (
                        "ix_website_visit_logs_created_page",
                        "CREATE INDEX ix_website_visit_logs_created_page ON website_visit_logs (created_at, page_path)",
                    ),
                    (
                        "ix_website_visit_logs_visitor_created",
                        "CREATE INDEX ix_website_visit_logs_visitor_created ON website_visit_logs (visitor_id, created_at)",
                    ),
                ]:
                    idxs = {i["name"] for i in insp.get_indexes("website_visit_logs")}
                    if idx_name not in idxs:
                        sync_conn.execute(text(idx_sql))

        await conn.run_sync(_sync_migrate)


def user_view(user: User) -> AuthUserView:
    return AuthUserView(
        id=user.id,
        username=user.username,
        display_name=user.display_name or user.username,
        email=user.email,
        created_at=user.created_at,
    )


async def persist_refresh_session(session: AsyncSession, user_id: str, refresh_jti: str, refresh_exp: datetime) -> None:
    session.add(
        RefreshSession(
            user_id=user_id,
            token_jti=refresh_jti,
            expires_at=refresh_exp,
            revoked=False,
        )
    )
    await session.commit()
    ttl = max(60, int((refresh_exp - utcnow()).total_seconds()))
    await redis_set_json(
        cache_key("session_refresh", refresh_jti),
        {"user_id": user_id, "expires_at": _iso_ts(refresh_exp)},
        ttl_sec=ttl,
    )


async def consume_email_code(session: AsyncSession, email: str, purpose: str, code: str) -> None:
    q = await session.execute(
        select(EmailCode)
        .where(
            EmailCode.email == email,
            EmailCode.purpose == purpose,
            EmailCode.consumed.is_(False),
            EmailCode.expires_at > utcnow(),
        )
        .order_by(desc(EmailCode.created_at))
    )
    rec = q.scalar_one_or_none()
    if not rec or rec.code != code:
        raise HTTPException(status_code=400, detail="验证码无效或已过期")
    rec.consumed = True
    await session.commit()


DEFAULT_PERMISSION_RULES: list[tuple[str, str]] = [
    ("/api/deepseek/chat", "DeepSeek chat"),
    ("/api/public/deepseek/chat", "DeepSeek chat public"),
    ("/api/prompt/optimize", "Prompt optimizer"),
    ("/api/public/prompt/optimize", "Prompt optimizer public"),
    ("/api/liblibai/gen-img", "Image generation"),
    ("/api/liblibai/ping", "LiblibAI health"),
    ("/api/billing/me", "Billing profile"),
    ("/api/billing/subscribe", "Billing subscribe"),
    ("/api/billing/topup", "Billing topup"),
]


async def _get_or_create_threshold_config(session: AsyncSession) -> AlertThresholdConfig:
    q = await session.execute(select(AlertThresholdConfig).order_by(AlertThresholdConfig.id.asc()).limit(1))
    cfg = q.scalars().first()
    if cfg:
        await redis_set_json(
            cache_key("sys_threshold", "singleton"),
            {
                "api_fail_rate_threshold": float(cfg.api_fail_rate_threshold),
                "online_surge_threshold": float(cfg.online_surge_threshold),
                "online_drop_threshold": float(cfg.online_drop_threshold),
                "refresh_interval_sec": int(cfg.refresh_interval_sec),
                "updated_at": _iso_ts(cfg.updated_at),
            },
            ttl_sec=300,
        )
        return cfg
    cfg = AlertThresholdConfig(
        api_fail_rate_threshold=0.15,
        online_surge_threshold=0.5,
        online_drop_threshold=0.4,
        refresh_interval_sec=5,
        updated_at=utcnow(),
    )
    session.add(cfg)
    await session.flush()
    await redis_set_json(
        cache_key("sys_threshold", "singleton"),
        {
            "api_fail_rate_threshold": float(cfg.api_fail_rate_threshold),
            "online_surge_threshold": float(cfg.online_surge_threshold),
            "online_drop_threshold": float(cfg.online_drop_threshold),
            "refresh_interval_sec": int(cfg.refresh_interval_sec),
            "updated_at": _iso_ts(cfg.updated_at),
        },
        ttl_sec=300,
    )
    return cfg


async def _seed_default_permission_rules(session: AsyncSession) -> None:
    for path, note in DEFAULT_PERMISSION_RULES:
        q = await session.execute(select(ApiPermissionRule).where(ApiPermissionRule.path == path))
        row = q.scalars().first()
        if row:
            continue
        session.add(ApiPermissionRule(path=path, enabled=True, note=note, updated_at=utcnow()))


async def _reload_api_permission_cache(session: AsyncSession | None = None) -> None:
    owned_session = False
    if session is None:
        session = SessionLocal()
        owned_session = True

    try:
        q = await session.execute(select(ApiPermissionRule))
        rows = q.scalars().all()
        cache = {r.path: bool(r.enabled) for r in rows}
        API_PERMISSION_CACHE.clear()
        API_PERMISSION_CACHE.update(cache)
    finally:
        if owned_session:
            await session.close()


async def _ensure_monitoring_seed_data(session: AsyncSession) -> None:
    await _get_or_create_threshold_config(session)
    await _seed_default_permission_rules(session)
    await session.commit()
    await _reload_api_permission_cache(session)


def _bucketized_api_series(
    logs: list[ApiCallLog], range_key: Literal["hour", "day", "week", "month"]
) -> list[dict[str, Any]]:
    start, granularity = _time_window_for_range(range_key)
    now = utcnow()
    buckets = _series_template(start, now, granularity)
    for log in logs:
        if log.created_at < start:
            continue
        b = _bucket_start(log.created_at, granularity)
        item = buckets.get(b)
        if item is None:
            item = {"calls": 0, "errors": 0, "latency_sum": 0}
            buckets[b] = item
        item["calls"] += 1
        if not log.success:
            item["errors"] += 1
        item["latency_sum"] += int(log.latency_ms or 0)

    out: list[dict[str, Any]] = []
    for b in sorted(buckets.keys()):
        item = buckets[b]
        calls = int(item["calls"])
        errors = int(item["errors"])
        out.append(
            {
                "bucket": _iso_ts(b),
                "calls": calls,
                "errors": errors,
                "avg_latency_ms": round((item["latency_sum"] / calls), 2) if calls > 0 else 0.0,
            }
        )
    return out


async def _collect_api_metrics(
    session: AsyncSession, range_key: Literal["hour", "day", "week", "month"], detail_limit: int
) -> dict[str, Any]:
    now = utcnow()
    five_min_ago = now - timedelta(minutes=5)
    one_min_ago = now - timedelta(minutes=1)
    one_day_ago = now - timedelta(days=1)
    trend_start, _ = _time_window_for_range(range_key)
    detail_limit = max(50, min(detail_limit, 1000))

    q_recent = await session.execute(select(ApiCallLog).where(ApiCallLog.created_at >= five_min_ago))
    recent_logs = q_recent.scalars().all()
    q_last_minute = await session.execute(select(func.count(ApiCallLog.id)).where(ApiCallLog.created_at >= one_min_ago))
    calls_last_minute = int(q_last_minute.scalar() or 0)
    q_trend = await session.execute(select(ApiCallLog).where(ApiCallLog.created_at >= trend_start))
    trend_logs = q_trend.scalars().all()
    q_details = await session.execute(
        select(ApiCallLog).where(ApiCallLog.created_at >= one_day_ago).order_by(desc(ApiCallLog.created_at)).limit(detail_limit)
    )
    detail_logs = q_details.scalars().all()

    recent_total = len(recent_logs)
    recent_fail = sum(1 for x in recent_logs if not x.success)
    recent_success = max(0, recent_total - recent_fail)
    success_rate = (recent_success / recent_total) if recent_total else 1.0
    failure_rate = (recent_fail / recent_total) if recent_total else 0.0
    avg_latency = round(sum(int(x.latency_ms or 0) for x in recent_logs) / recent_total, 2) if recent_total else 0.0

    fail_cnt = func.count(ApiCallLog.id).label("fail_cnt")
    q_abnormal = await session.execute(
        select(ApiCallLog.path, fail_cnt)
        .where(ApiCallLog.created_at >= one_day_ago, ApiCallLog.success.is_(False))
        .group_by(ApiCallLog.path)
        .order_by(desc(fail_cnt))
        .limit(5)
    )
    abnormal_top5 = [{"path": row[0], "failures": int(row[1])} for row in q_abnormal.all()]

    ip_cnt = func.count(ApiCallLog.id).label("ip_cnt")
    q_ip = await session.execute(
        select(ApiCallLog.client_ip, ip_cnt)
        .where(ApiCallLog.created_at >= one_day_ago, ApiCallLog.client_ip != "")
        .group_by(ApiCallLog.client_ip)
        .order_by(desc(ip_cnt))
        .limit(10)
    )
    ip_sources = [{"ip": row[0], "calls": int(row[1])} for row in q_ip.all()]

    exception_logs = [
        {
            "time": _iso_ts(x.created_at),
            "path": x.path,
            "status_code": x.status_code,
            "ip": x.client_ip,
            "error": (x.error_detail or "")[:240],
        }
        for x in detail_logs
        if not x.success
    ][:50]

    call_logs = [
        {
            "id": x.id,
            "time": _iso_ts(x.created_at),
            "method": x.method,
            "path": x.path,
            "status_code": x.status_code,
            "latency_ms": int(x.latency_ms or 0),
            "success": bool(x.success),
            "ip": x.client_ip,
            "user_id": x.user_id,
            "error": (x.error_detail or "")[:200],
        }
        for x in detail_logs
    ]

    tracked_paths = set(API_BREAKER_STATE.keys()) | set(API_PERMISSION_CACHE.keys())
    rate_limit_states = []
    for path in sorted(tracked_paths):
        state = API_BREAKER_STATE.get(path, {})
        total = int(state.get("total_calls", 0))
        failed = int(state.get("failed_calls", 0))
        rate_limit_states.append(
            {
                "path": path,
                "enabled": bool(API_PERMISSION_CACHE.get(path, True)),
                "breaker_state": _breaker_status_for(path),
                "total_calls": total,
                "failed_calls": failed,
                "failure_rate": round((failed / total), 4) if total > 0 else 0.0,
                "last_status_code": int(state.get("last_status_code", 0)) if state else 0,
            }
        )
    rate_limit_states.sort(
        key=lambda x: (0 if not x["enabled"] else 1, 0 if x["breaker_state"] == "open" else 1, -x["failure_rate"])
    )

    return {
        "realtime": {
            "calls_last_minute": calls_last_minute,
            "success_rate": round(success_rate, 4),
            "failure_rate": round(failure_rate, 4),
            "avg_latency_ms": avg_latency,
            "abnormal_top5": abnormal_top5,
        },
        "trends": _bucketized_api_series(trend_logs, range_key),
        "details": {
            "call_logs": call_logs,
            "ip_sources": ip_sources,
            "exception_logs": exception_logs,
            "rate_limit_states": rate_limit_states[:30],
        },
    }


async def _record_online_snapshot(session: AsyncSession, online_count: int) -> None:
    q = await session.execute(select(OnlineSnapshot).order_by(desc(OnlineSnapshot.created_at)).limit(1))
    last = q.scalars().first()
    now = utcnow()
    if last and (now - last.created_at).total_seconds() < 10:
        return
    session.add(OnlineSnapshot(online_count=online_count, created_at=now))


async def _collect_online_metrics(session: AsyncSession) -> dict[str, Any]:
    now = utcnow()
    cutoff = now - timedelta(seconds=ONLINE_ACTIVE_SECONDS)
    q = await session.execute(
        select(UserOnlineSession).where(UserOnlineSession.last_seen >= cutoff).order_by(desc(UserOnlineSession.last_seen)).limit(500)
    )
    active_sessions = q.scalars().all()
    user_ids = list({s.user_id for s in active_sessions})
    user_map: dict[str, str] = {}
    if user_ids:
        uq = await session.execute(select(User.id, User.display_name, User.username).where(User.id.in_(user_ids)))
        for uid, display_name, username in uq.all():
            user_map[str(uid)] = display_name or username or str(uid)

    online_user_count = len(set(user_ids))
    cached_online = await redis_get_json(cache_key("online_count", "realtime"))
    if isinstance(cached_online, dict):
        try:
            online_user_count = max(online_user_count, int(cached_online.get("online_count", 0)))
        except Exception:
            pass
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    pq = await session.execute(select(func.max(OnlineSnapshot.online_count)).where(OnlineSnapshot.created_at >= day_start))
    peak_today = int(pq.scalar() or 0)

    terminal_counter = Counter((s.terminal_type or "unknown") for s in active_sessions)
    region_counter = Counter((s.region or "Unknown") for s in active_sessions)
    avg_duration_sec = (
        round(sum(max((now - s.first_seen).total_seconds(), 0.0) for s in active_sessions) / len(active_sessions), 2)
        if active_sessions
        else 0.0
    )

    online_list = [
        {
            "session_id": s.session_id,
            "user_id": s.user_id,
            "user_name": user_map.get(s.user_id, s.user_id),
            "terminal_type": s.terminal_type,
            "region": s.region,
            "last_path": s.last_path,
            "duration_sec": int(max((now - s.first_seen).total_seconds(), 0)),
            "last_seen": _iso_ts(s.last_seen),
        }
        for s in active_sessions
    ][:100]

    user_duration: defaultdict[str, int] = defaultdict(int)
    for s in active_sessions:
        user_duration[s.user_id] += int(max((now - s.first_seen).total_seconds(), 0))
    active_ranking = [
        {"user_id": uid, "user_name": user_map.get(uid, uid), "online_duration_sec": sec}
        for uid, sec in sorted(user_duration.items(), key=lambda kv: kv[1], reverse=True)[:20]
    ]

    new_login_reminders = [
        {
            "user_id": s.user_id,
            "user_name": user_map.get(s.user_id, s.user_id),
            "session_id": s.session_id,
            "first_seen": _iso_ts(s.first_seen),
        }
        for s in active_sessions
        if (now - s.first_seen).total_seconds() <= 300
    ][:20]

    return {
        "realtime": {
            "online_users": online_user_count,
            "peak_online_today": max(peak_today, online_user_count),
            "avg_online_duration_sec": avg_duration_sec,
            "terminal_distribution": [{"type": k, "count": int(v)} for k, v in terminal_counter.most_common()],
            "region_distribution": [{"region": k, "count": int(v)} for k, v in region_counter.most_common()],
        },
        "boards": {
            "online_users": online_list,
            "active_ranking": active_ranking,
            "new_login_reminders": new_login_reminders,
        },
    }


def _bucketized_traffic_series(
    rows: list[tuple[datetime, str]], range_key: Literal["hour", "day", "week", "month"]
) -> list[dict[str, Any]]:
    start, granularity = _time_window_for_range(range_key)
    now = utcnow()
    buckets = _series_template(start, now, granularity)
    uv_sets: dict[datetime, set[str]] = {k: set() for k in buckets.keys()}
    for created_at, visitor_id in rows:
        if created_at < start:
            continue
        b = _bucket_start(created_at, granularity)
        item = buckets.get(b)
        if item is None:
            item = {"calls": 0, "errors": 0, "latency_sum": 0}
            buckets[b] = item
            uv_sets[b] = set()
        item["calls"] += 1
        uv_sets.setdefault(b, set()).add(visitor_id)

    out: list[dict[str, Any]] = []
    for b in sorted(buckets.keys()):
        out.append(
            {
                "bucket": _iso_ts(b),
                "pv": int(buckets[b]["calls"]),
                "uv": int(len(uv_sets.get(b, set()))),
            }
        )
    return out


async def _collect_traffic_metrics(
    session: AsyncSession, range_key: Literal["hour", "day", "week", "month"]
) -> dict[str, Any]:
    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    trend_start, _ = _time_window_for_range(range_key)

    total_pv_q = await session.execute(select(func.count(WebsiteVisitLog.id)))
    total_pv = int(total_pv_q.scalar() or 0)
    total_uv_q = await session.execute(select(func.count(func.distinct(WebsiteVisitLog.visitor_id))))
    total_uv = int(total_uv_q.scalar() or 0)
    today_pv_q = await session.execute(select(func.count(WebsiteVisitLog.id)).where(WebsiteVisitLog.created_at >= today_start))
    today_pv = int(today_pv_q.scalar() or 0)
    today_uv_q = await session.execute(
        select(func.count(func.distinct(WebsiteVisitLog.visitor_id))).where(WebsiteVisitLog.created_at >= today_start)
    )
    today_uv = int(today_uv_q.scalar() or 0)

    today_visitors_q = await session.execute(
        select(WebsiteVisitLog.visitor_id).where(WebsiteVisitLog.created_at >= today_start).distinct()
    )
    today_visitors = [str(x[0]) for x in today_visitors_q.all()]
    new_visitor_count = 0
    if today_visitors:
        profiles_q = await session.execute(select(VisitorProfile).where(VisitorProfile.visitor_id.in_(today_visitors)))
        profiles = profiles_q.scalars().all()
        new_visitor_count = sum(1 for p in profiles if p.first_seen >= today_start)
    returning_visitor_count = max(0, today_uv - new_visitor_count)
    new_visitor_ratio = round((new_visitor_count / today_uv), 4) if today_uv else 0.0

    sess_stats_q = await session.execute(
        select(
            WebsiteVisitLog.session_id,
            func.count(WebsiteVisitLog.id).label("pv"),
            func.min(WebsiteVisitLog.created_at).label("min_ts"),
            func.max(WebsiteVisitLog.created_at).label("max_ts"),
        )
        .where(WebsiteVisitLog.created_at >= today_start)
        .group_by(WebsiteVisitLog.session_id)
    )
    sess_stats = sess_stats_q.all()
    total_sessions = len(sess_stats)
    bounce_sessions = sum(1 for r in sess_stats if int(r.pv) <= 1)
    bounce_rate = round((bounce_sessions / total_sessions), 4) if total_sessions else 0.0
    avg_page_stay_sec = 0.0
    if sess_stats:
        dwell_values = []
        for r in sess_stats:
            pv = int(r.pv or 0)
            if pv <= 1:
                dwell_values.append(0.0)
                continue
            seconds = max((r.max_ts - r.min_ts).total_seconds(), 0.0)
            dwell_values.append(seconds / max(pv - 1, 1))
        avg_page_stay_sec = round(sum(dwell_values) / len(dwell_values), 2)

    source_cnt = func.count(WebsiteVisitLog.id).label("cnt")
    source_q = await session.execute(
        select(WebsiteVisitLog.source_channel, source_cnt)
        .where(WebsiteVisitLog.created_at >= today_start)
        .group_by(WebsiteVisitLog.source_channel)
        .order_by(desc(source_cnt))
        .limit(10)
    )
    source_distribution = [{"source": str(r[0] or "direct"), "pv": int(r[1])} for r in source_q.all()]

    page_cnt = func.count(WebsiteVisitLog.id).label("cnt")
    page_q = await session.execute(
        select(WebsiteVisitLog.page_path, page_cnt)
        .where(WebsiteVisitLog.created_at >= today_start)
        .group_by(WebsiteVisitLog.page_path)
        .order_by(desc(page_cnt))
        .limit(10)
    )
    top_pages = [{"page": str(r[0]), "pv": int(r[1])} for r in page_q.all()]

    funnel_q = await session.execute(
        select(WebsiteVisitLog.session_id, WebsiteVisitLog.page_path, WebsiteVisitLog.created_at)
        .where(WebsiteVisitLog.created_at >= today_start)
        .order_by(WebsiteVisitLog.session_id.asc(), WebsiteVisitLog.created_at.asc())
        .limit(10000)
    )
    transition_counter: Counter[tuple[str, str]] = Counter()
    last_page_by_session: dict[str, str] = {}
    for session_id, page_path, _ in funnel_q.all():
        sid = str(session_id)
        page = str(page_path or "/")
        prev = last_page_by_session.get(sid)
        if prev and prev != page:
            transition_counter[(prev, page)] += 1
        last_page_by_session[sid] = page
    path_funnel = [
        {"from": src, "to": dst, "count": int(cnt)}
        for (src, dst), cnt in transition_counter.most_common(10)
    ]

    trend_q = await session.execute(
        select(WebsiteVisitLog.created_at, WebsiteVisitLog.visitor_id).where(WebsiteVisitLog.created_at >= trend_start)
    )
    trend_rows = [(r[0], str(r[1])) for r in trend_q.all()]

    return {
        "realtime": {
            "today_pv": today_pv,
            "today_uv": today_uv,
            "total_pv": total_pv,
            "total_uv": total_uv,
            "new_visitor_count": new_visitor_count,
            "returning_visitor_count": returning_visitor_count,
            "new_visitor_ratio": new_visitor_ratio,
            "bounce_rate": bounce_rate,
            "avg_page_stay_sec": avg_page_stay_sec,
        },
        "analysis": {
            "source_distribution": source_distribution,
            "top_pages": top_pages,
            "path_funnel": path_funnel,
            "time_trend": _bucketized_traffic_series(trend_rows, range_key),
        },
    }


async def _collect_billing_metrics(session: AsyncSession) -> dict[str, Any]:
    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    total_balance_q = await session.execute(select(func.coalesce(func.sum(User.credits_balance), 0)))
    total_balance = int(total_balance_q.scalar() or 0)

    topup_q = await session.execute(
        select(func.coalesce(func.sum(CreditLedger.amount), 0)).where(
            CreditLedger.type == "topup",
            CreditLedger.created_at >= today_start,
            CreditLedger.amount > 0,
        )
    )
    today_topup = int(topup_q.scalar() or 0)

    spend_q = await session.execute(
        select(func.coalesce(func.sum(CreditLedger.amount), 0)).where(
            CreditLedger.type == "spend",
            CreditLedger.created_at >= today_start,
            CreditLedger.amount < 0,
        )
    )
    today_spend = abs(int(spend_q.scalar() or 0))

    users_q = await session.execute(
        select(User.id, User.username, User.display_name, User.credits_balance).order_by(desc(User.credits_balance)).limit(15)
    )
    rich_list = [
        {
            "user_id": str(uid),
            "username": str(username or ""),
            "display_name": str(display_name or username or uid),
            "credits_balance": int(credits or 0),
        }
        for uid, username, display_name, credits in users_q.all()
    ]

    ledger_q = await session.execute(select(CreditLedger).order_by(desc(CreditLedger.created_at)).limit(80))
    recent_ledger = [
        {
            "id": int(x.id),
            "user_id": x.user_id,
            "type": x.type,
            "amount": int(x.amount or 0),
            "note": (x.note or "")[:255],
            "created_at": _iso_ts(x.created_at),
        }
        for x in ledger_q.scalars().all()
    ]

    root_balance_q = await session.execute(
        select(User.credits_balance).where(or_(User.id == ROOT_USER_ID, User.username == settings.root_username)).limit(1)
    )
    root_balance = int(root_balance_q.scalar() or 0)

    return {
        "realtime": {
            "total_balance": total_balance,
            "today_topup": today_topup,
            "today_spend": today_spend,
            "root_balance": root_balance,
            "operation_costs": _billing_rules_snapshot(),
            "prompt_guard_enabled": bool(settings.prompt_guard_enabled),
            "prompt_guard_block_terms_count": len(PROMPT_BLOCK_TERMS),
        },
        "analysis": {
            "rich_list": rich_list,
            "recent_ledger": recent_ledger,
        },
    }


async def _emit_alert_if_needed(
    session: AsyncSession,
    category: str,
    message: str,
    current_value: float,
    threshold_value: float,
    severity: str = "warning",
    meta: dict[str, Any] | None = None,
) -> None:
    q = await session.execute(
        select(AlertEvent)
        .where(AlertEvent.category == category, AlertEvent.status == "open")
        .order_by(desc(AlertEvent.created_at))
        .limit(1)
    )
    last_open = q.scalars().first()
    if last_open and (utcnow() - last_open.created_at).total_seconds() < ALERT_DEDUPE_SECONDS:
        return
    session.add(
        AlertEvent(
            category=category,
            severity=severity,
            message=message[:255],
            current_value=float(current_value),
            threshold_value=float(threshold_value),
            status="open",
            meta_json=json.dumps(meta or {}, ensure_ascii=False),
            created_at=utcnow(),
        )
    )


async def _evaluate_alerts(
    session: AsyncSession,
    cfg: AlertThresholdConfig,
    api_failure_rate: float,
    online_users: int,
) -> None:
    if api_failure_rate > float(cfg.api_fail_rate_threshold):
        await _emit_alert_if_needed(
            session,
            category="api_fail_rate",
            message="API failure rate exceeded threshold",
            current_value=api_failure_rate,
            threshold_value=float(cfg.api_fail_rate_threshold),
            severity="critical" if api_failure_rate >= float(cfg.api_fail_rate_threshold) * 2 else "warning",
            meta={"online_users": online_users},
        )

    sq = await session.execute(select(OnlineSnapshot).order_by(desc(OnlineSnapshot.created_at)).limit(6))
    snaps = sq.scalars().all()
    if len(snaps) < 2:
        return
    baseline = sum(int(s.online_count or 0) for s in snaps[1:]) / max(len(snaps) - 1, 1)
    if baseline <= 0:
        return
    if online_users >= baseline * (1 + float(cfg.online_surge_threshold)):
        await _emit_alert_if_needed(
            session,
            category="online_surge",
            message="Online users surged",
            current_value=float(online_users),
            threshold_value=float(round(baseline * (1 + float(cfg.online_surge_threshold)), 2)),
            meta={"baseline": baseline},
        )
    elif online_users <= baseline * (1 - float(cfg.online_drop_threshold)):
        await _emit_alert_if_needed(
            session,
            category="online_drop",
            message="Online users dropped",
            current_value=float(online_users),
            threshold_value=float(round(baseline * (1 - float(cfg.online_drop_threshold)), 2)),
            meta={"baseline": baseline},
        )


def _serialize_alert_event(x: AlertEvent) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    if x.meta_json:
        try:
            meta = json.loads(x.meta_json)
        except Exception:
            meta = {}
    return {
        "id": x.id,
        "category": x.category,
        "severity": x.severity,
        "message": x.message,
        "current_value": x.current_value,
        "threshold_value": x.threshold_value,
        "status": x.status,
        "meta": meta,
        "created_at": _iso_ts(x.created_at),
        "resolved_at": _iso_ts(x.resolved_at) if x.resolved_at else None,
        "resolved_note": x.resolved_note or "",
    }


def _serialize_feedback_item(x: UserFeedback) -> dict[str, Any]:
    has_unread_reply = bool(x.replied_at and (x.user_read_at is None or x.user_read_at < x.replied_at))
    return {
        "id": int(x.id),
        "user_id": x.user_id,
        "user_name": x.user_name or "",
        "category": x.category,
        "title": x.title,
        "content": x.content,
        "contact": x.contact or "",
        "status": x.status,
        "admin_note": x.admin_note or "",
        "created_at": _iso_ts(x.created_at),
        "replied_at": _iso_ts(x.replied_at) if x.replied_at else None,
        "user_read_at": _iso_ts(x.user_read_at) if x.user_read_at else None,
        "has_unread_reply": has_unread_reply,
        "resolved_at": _iso_ts(x.resolved_at) if x.resolved_at else None,
    }


def _serialize_community_post(
    post: CommunityPost,
    likes: list[CommunityPostLike],
    comments: list[CommunityPostComment],
    reports: list[CommunityPostReport],
) -> dict[str, Any]:
    return {
        "id": post.id,
        "archiveId": post.archive_id or "",
        "publishSource": post.publish_source or "generated",
        "ownerUserId": post.owner_user_id,
        "ownerUserName": post.owner_user_name or "",
        "title": post.title,
        "dataUrl": post.data_url,
        "promptArtistic": post.prompt_artistic or "",
        "params": _json_load_safe(post.params_json, {}) or {},
        "createdAt": _iso_ts(post.created_at),
        "publishedAt": _iso_ts(post.published_at),
        "aiGenerated": bool(post.ai_generated),
        "aiLabel": post.ai_label or ("AI生成" if post.ai_generated else "用户上传"),
        "moderationStatus": post.moderation_status or "approved",
        "moderationReason": (post.moderation_reason or "").strip() or None,
        "minted": bool(post.minted),
        "likes": [x.user_id for x in likes],
        "comments": [
            {
                "id": x.id,
                "userId": x.user_id,
                "userName": x.user_name or "",
                "content": x.content,
                "createdAt": _iso_ts(x.created_at),
                "moderationStatus": x.moderation_status or "approved",
                "moderationReason": (x.moderation_reason or "").strip() or None,
            }
            for x in comments
        ],
        "reports": [
            {
                "id": x.id,
                "reporterUserId": x.reporter_user_id,
                "reporterUserName": x.reporter_user_name or "",
                "reason": x.reason or "",
                "createdAt": _iso_ts(x.created_at),
            }
            for x in reports
        ],
    }


async def _load_community_post_bundle(
    session: AsyncSession, post_ids: list[str]
) -> tuple[dict[str, list[CommunityPostLike]], dict[str, list[CommunityPostComment]], dict[str, list[CommunityPostReport]]]:
    likes_map: dict[str, list[CommunityPostLike]] = defaultdict(list)
    comments_map: dict[str, list[CommunityPostComment]] = defaultdict(list)
    reports_map: dict[str, list[CommunityPostReport]] = defaultdict(list)
    if not post_ids:
        return likes_map, comments_map, reports_map

    likes_q = await session.execute(select(CommunityPostLike).where(CommunityPostLike.post_id.in_(post_ids)))
    for row in likes_q.scalars().all():
        likes_map[row.post_id].append(row)

    comments_q = await session.execute(
        select(CommunityPostComment)
        .where(CommunityPostComment.post_id.in_(post_ids))
        .order_by(CommunityPostComment.created_at.asc())
    )
    for row in comments_q.scalars().all():
        comments_map[row.post_id].append(row)

    reports_q = await session.execute(
        select(CommunityPostReport)
        .where(CommunityPostReport.post_id.in_(post_ids))
        .order_by(CommunityPostReport.created_at.asc())
    )
    for row in reports_q.scalars().all():
        reports_map[row.post_id].append(row)
    return likes_map, comments_map, reports_map


def _parse_json_string_list(raw: str | None, max_items: int = 20, max_length: int = 64) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    out: list[str] = []
    for item in parsed:
        if len(out) >= max_items:
            break
        text = str(item or "").strip()
        if not text:
            continue
        text = text[:max_length]
        if text in out:
            continue
        out.append(text)
    return out


def _normalize_string_list(
    values: list[str] | None,
    *,
    max_items: int,
    max_length: int,
    lowercase: bool = False,
) -> list[str]:
    out: list[str] = []
    for raw in values or []:
        text = str(raw or "").strip()
        if not text:
            continue
        text = text[:max_length]
        if lowercase:
            text = text.lower()
        if text in out:
            continue
        out.append(text)
        if len(out) >= max_items:
            break
    return out


def _forum_answers_sorted(question: ForumQuestion, answers: list[ForumAnswer]) -> list[ForumAnswer]:
    # Asker's reply first, then latest replies first.
    return sorted(
        answers,
        key=lambda x: (
            0 if x.user_id == question.user_id else 1,
            -(x.created_at.timestamp() if isinstance(x.created_at, datetime) else 0),
        ),
    )


def _serialize_forum_question(
    question: ForumQuestion,
    likes: list[ForumQuestionLike],
    answers: list[ForumAnswer],
) -> dict[str, Any]:
    tags = _parse_json_string_list(question.tags_json, max_items=8, max_length=24)
    invited_user_ids = _parse_json_string_list(question.invited_user_ids_json, max_items=20, max_length=64)
    sorted_answers = _forum_answers_sorted(question, answers)
    return {
        "id": question.id,
        "userId": question.user_id,
        "userName": question.user_name or "",
        "title": question.title,
        "content": question.content,
        "tags": tags,
        "invitedUserIds": invited_user_ids,
        "createdAt": _iso_ts(question.created_at),
        "solved": bool(question.solved),
        "likes": [x.user_id for x in likes],
        "answers": [
            {
                "id": x.id,
                "questionId": x.question_id,
                "userId": x.user_id,
                "userName": x.user_name or "",
                "content": x.content,
                "createdAt": _iso_ts(x.created_at),
            }
            for x in sorted_answers
        ],
    }


def _serialize_moderation_ticket_log(x: ModerationTicketLog) -> dict[str, Any]:
    return {
        "id": int(x.id),
        "ticket_id": x.ticket_id,
        "action": x.action,
        "actor_user_id": x.actor_user_id,
        "actor_user_name": x.actor_user_name or "",
        "from_status": x.from_status or "",
        "to_status": x.to_status or "",
        "note": x.note or "",
        "meta": _json_load_safe(x.meta_json, {}) or {},
        "created_at": _iso_ts(x.created_at),
    }


def _serialize_moderation_ticket(
    row: ModerationTicket,
    *,
    content_meta: dict[str, Any] | None = None,
    logs: list[ModerationTicketLog] | None = None,
) -> dict[str, Any]:
    return {
        "id": row.id,
        "source": row.source,
        "content_type": row.content_type,
        "content_id": row.content_id,
        "report_id": row.report_id,
        "status": row.status,
        "machine_result": row.machine_result,
        "machine_reason": row.machine_reason or "",
        "assigned_admin_user_id": row.assigned_admin_user_id,
        "assigned_admin_user_name": row.assigned_admin_user_name or "",
        "decision_reason": row.decision_reason or "",
        "appeal_reason": row.appeal_reason or "",
        "final_result": row.final_result,
        "created_by_user_id": row.created_by_user_id,
        "created_at": _iso_ts(row.created_at),
        "claimed_at": _iso_ts(row.claimed_at) if row.claimed_at else None,
        "decided_at": _iso_ts(row.decided_at) if row.decided_at else None,
        "appealed_at": _iso_ts(row.appealed_at) if row.appealed_at else None,
        "final_judged_at": _iso_ts(row.final_judged_at) if row.final_judged_at else None,
        "updated_at": _iso_ts(row.updated_at),
        "content_meta": content_meta or {},
        "logs": [_serialize_moderation_ticket_log(x) for x in (logs or [])],
    }


async def _append_moderation_ticket_log(
    session: AsyncSession,
    ticket: ModerationTicket,
    *,
    action: str,
    actor_user: User | None,
    from_status: str,
    to_status: str,
    note: str = "",
    meta: dict[str, Any] | None = None,
) -> None:
    session.add(
        ModerationTicketLog(
            ticket_id=ticket.id,
            action=(action or "")[:32],
            actor_user_id=actor_user.id if actor_user else None,
            actor_user_name=((actor_user.display_name or actor_user.username) if actor_user else "")[:64],
            from_status=(from_status or "")[:24],
            to_status=(to_status or "")[:24],
            note=(note or "")[:4000],
            meta_json=_json_dump_safe(meta or {}),
            created_at=utcnow(),
        )
    )


async def _ticket_content_meta(session: AsyncSession, ticket: ModerationTicket) -> dict[str, Any]:
    ctype = (ticket.content_type or "").strip()
    cid = (ticket.content_id or "").strip()
    if not ctype or not cid:
        return {}

    if ctype == "community_post":
        q = await session.execute(select(CommunityPost).where(CommunityPost.id == cid))
        row = q.scalars().first()
        if not row:
            return {"missing": True}
        return {
            "title": row.title,
            "text_preview": (row.prompt_artistic or "")[:200],
            "image_url": row.data_url,
            "owner_user_id": row.owner_user_id,
            "owner_user_name": row.owner_user_name or "",
            "moderation_status": row.moderation_status,
            "created_at": _iso_ts(row.created_at),
        }
    if ctype == "forum_question":
        q = await session.execute(select(ForumQuestion).where(ForumQuestion.id == cid))
        row = q.scalars().first()
        if not row:
            return {"missing": True}
        return {
            "title": row.title,
            "text_preview": (row.content or "")[:500],
            "owner_user_id": row.user_id,
            "owner_user_name": row.user_name or "",
            "moderation_status": row.moderation_status,
            "created_at": _iso_ts(row.created_at),
        }
    if ctype == "forum_answer":
        q = await session.execute(select(ForumAnswer).where(ForumAnswer.id == cid))
        row = q.scalars().first()
        if not row:
            return {"missing": True}
        q2 = await session.execute(select(ForumQuestion.title).where(ForumQuestion.id == row.question_id))
        q_title = q2.scalar() or ""
        return {
            "question_id": row.question_id,
            "question_title": str(q_title),
            "text_preview": (row.content or "")[:500],
            "owner_user_id": row.user_id,
            "owner_user_name": row.user_name or "",
            "moderation_status": row.moderation_status,
            "created_at": _iso_ts(row.created_at),
        }
    if ctype == "community_comment":
        q = await session.execute(select(CommunityPostComment).where(CommunityPostComment.id == cid))
        row = q.scalars().first()
        if not row:
            return {"missing": True}
        return {
            "post_id": row.post_id,
            "text_preview": (row.content or "")[:500],
            "owner_user_id": row.user_id,
            "owner_user_name": row.user_name or "",
            "moderation_status": row.moderation_status,
            "created_at": _iso_ts(row.created_at),
        }
    return {}


async def _default_admin_user(session: AsyncSession) -> User | None:
    q = await session.execute(
        select(User).where(or_(User.id == ROOT_USER_ID, User.username == settings.root_username)).limit(1)
    )
    return q.scalars().first()


async def _create_or_get_open_ticket(
    session: AsyncSession,
    *,
    source: str,
    content_type: str,
    content_id: str,
    report_id: str | None = None,
    machine_result: str = "review",
    machine_reason: str = "",
    created_by_user_id: str | None = None,
) -> ModerationTicket:
    q = await session.execute(
        select(ModerationTicket)
        .where(
            ModerationTicket.content_type == content_type,
            ModerationTicket.content_id == content_id,
            ModerationTicket.status.in_(["pending", "appealed"]),
        )
        .order_by(desc(ModerationTicket.created_at))
        .limit(1)
    )
    row = q.scalars().first()
    now = utcnow()
    if row:
        if report_id and not row.report_id:
            row.report_id = report_id
        row.updated_at = now
        return row

    assigned = await _default_admin_user(session)
    row = ModerationTicket(
        id=uuid.uuid4().hex,
        source=(source or "report")[:24],
        content_type=(content_type or "")[:32],
        content_id=(content_id or "")[:64],
        report_id=(report_id or None),
        status="pending",
        machine_result=(machine_result or "review")[:24],
        machine_reason=(machine_reason or "")[:4000],
        assigned_admin_user_id=assigned.id if assigned else None,
        assigned_admin_user_name=((assigned.display_name or assigned.username) if assigned else "")[:64],
        decision_reason="",
        appeal_reason="",
        final_result=None,
        created_by_user_id=(created_by_user_id or None),
        created_at=now,
        claimed_at=now if assigned else None,
        decided_at=None,
        appealed_at=None,
        final_judged_at=None,
        updated_at=now,
    )
    session.add(row)
    await _append_moderation_ticket_log(
        session,
        row,
        action="create",
        actor_user=assigned,
        from_status="",
        to_status="pending",
        note="工单创建",
        meta={
            "source": source,
            "machine_result": machine_result,
            "report_id": report_id,
        },
    )
    return row


def _is_ticket_transition_valid(current: str, target: str) -> bool:
    flow = {
        "pending": {"approved", "rejected"},
        "approved": {"appealed"},
        "rejected": {"appealed"},
        "appealed": {"final_judgment"},
        "final_judgment": set(),
    }
    return target in flow.get(current, set())


async def _load_forum_question_bundle(
    session: AsyncSession, question_ids: list[str]
) -> tuple[dict[str, list[ForumQuestionLike]], dict[str, list[ForumAnswer]]]:
    likes_map: dict[str, list[ForumQuestionLike]] = defaultdict(list)
    answers_map: dict[str, list[ForumAnswer]] = defaultdict(list)
    if not question_ids:
        return likes_map, answers_map

    likes_q = await session.execute(select(ForumQuestionLike).where(ForumQuestionLike.question_id.in_(question_ids)))
    for row in likes_q.scalars().all():
        likes_map[row.question_id].append(row)

    answers_q = await session.execute(
        select(ForumAnswer).where(ForumAnswer.question_id.in_(question_ids)).order_by(ForumAnswer.created_at.asc())
    )
    for row in answers_q.scalars().all():
        answers_map[row.question_id].append(row)
    return likes_map, answers_map


async def _collect_alerts(session: AsyncSession, cfg: AlertThresholdConfig) -> dict[str, Any]:
    open_q = await session.execute(
        select(AlertEvent).where(AlertEvent.status == "open").order_by(desc(AlertEvent.created_at)).limit(20)
    )
    recent_q = await session.execute(select(AlertEvent).order_by(desc(AlertEvent.created_at)).limit(80))
    return {
        "thresholds": {
            "api_fail_rate_threshold": float(cfg.api_fail_rate_threshold),
            "online_surge_threshold": float(cfg.online_surge_threshold),
            "online_drop_threshold": float(cfg.online_drop_threshold),
            "refresh_interval_sec": int(cfg.refresh_interval_sec),
        },
        "open": [_serialize_alert_event(x) for x in open_q.scalars().all()],
        "recent": [_serialize_alert_event(x) for x in recent_q.scalars().all()],
    }


async def _collect_feedback_summary(session: AsyncSession) -> dict[str, Any]:
    open_q = await session.execute(select(func.count(UserFeedback.id)).where(UserFeedback.status == "open"))
    total_q = await session.execute(select(func.count(UserFeedback.id)))
    recent_q = await session.execute(select(UserFeedback).order_by(desc(UserFeedback.created_at)).limit(20))
    return {
        "open_count": int(open_q.scalar() or 0),
        "total_count": int(total_q.scalar() or 0),
        "recent": [_serialize_feedback_item(x) for x in recent_q.scalars().all()],
    }


async def _collect_data_center_summary(session: AsyncSession) -> dict[str, Any]:
    selected_count_q = await session.execute(
        select(func.count(ImageGenerationCandidate.id)).where(ImageGenerationCandidate.image_bucket == "selected")
    )
    rejected_count_q = await session.execute(
        select(func.count(ImageGenerationCandidate.id)).where(ImageGenerationCandidate.image_bucket == "rejected")
    )
    selected_recent_q = await session.execute(
        select(ImageGenerationCandidate)
        .where(ImageGenerationCandidate.image_bucket == "selected")
        .order_by(desc(ImageGenerationCandidate.assigned_seq), desc(ImageGenerationCandidate.assigned_at))
        .limit(20)
    )
    rejected_recent_q = await session.execute(
        select(ImageGenerationCandidate)
        .where(ImageGenerationCandidate.image_bucket == "rejected")
        .order_by(desc(ImageGenerationCandidate.assigned_seq), desc(ImageGenerationCandidate.assigned_at))
        .limit(20)
    )
    return {
        "selected_count": int(selected_count_q.scalar() or 0),
        "rejected_count": int(rejected_count_q.scalar() or 0),
        "selected_recent": [_serialize_generation_candidate(x) for x in selected_recent_q.scalars().all()],
        "rejected_recent": [_serialize_generation_candidate(x) for x in rejected_recent_q.scalars().all()],
    }


async def _build_super_dashboard(
    session: AsyncSession,
    range_key: Literal["hour", "day", "week", "month"] = "hour",
    detail_limit: int = 200,
) -> dict[str, Any]:
    cfg = await _get_or_create_threshold_config(session)
    api_data = await _collect_api_metrics(session, range_key=range_key, detail_limit=detail_limit)
    online_data = await _collect_online_metrics(session)
    await _record_online_snapshot(session, int(online_data["realtime"]["online_users"]))
    await _evaluate_alerts(
        session,
        cfg=cfg,
        api_failure_rate=float(api_data["realtime"]["failure_rate"]),
        online_users=int(online_data["realtime"]["online_users"]),
    )
    traffic_data = await _collect_traffic_metrics(session, range_key=range_key)
    billing_data = await _collect_billing_metrics(session)
    async_tasks = _task_monitor_snapshot()
    await session.commit()

    alerts = await _collect_alerts(session, cfg)
    feedback = await _collect_feedback_summary(session)
    data_center = await _collect_data_center_summary(session)
    today_start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    users_q = await session.execute(select(func.count(User.id)))
    users_total = int(users_q.scalar() or 0)
    api_today_q = await session.execute(select(func.count(ApiCallLog.id)).where(ApiCallLog.created_at >= today_start))
    api_calls_today = int(api_today_q.scalar() or 0)

    return {
        "generated_at": _iso_ts(utcnow()),
        "overview": {
            "users_total": users_total,
            "online_now": int(online_data["realtime"]["online_users"]),
            "api_calls_today": api_calls_today,
            "pv_today": int(traffic_data["realtime"]["today_pv"]),
            "uv_today": int(traffic_data["realtime"]["today_uv"]),
            "credits_total": int(billing_data["realtime"]["total_balance"]),
            "credits_spend_today": int(billing_data["realtime"]["today_spend"]),
        },
        "api": api_data,
        "online": online_data,
        "traffic": traffic_data,
        "billing": billing_data,
        "async_tasks": async_tasks,
        "alerts": alerts,
        "feedback": feedback,
        "data_center": data_center,
    }


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return default


async def _read_counter_int(counter_key: str) -> int:
    data = await redis_get_json(counter_key)
    if isinstance(data, (int, float)):
        return int(data)
    if isinstance(data, str) and data.strip():
        return _safe_int(data, 0)
    return 0


@cached_query(
    lambda range_key: cache_key("admin_stats", "user_growth", range_key),
    ttl_sec=settings.admin_stats_cache_ttl_sec,
)
async def _cached_admin_user_growth(range_key: Literal["hour", "day", "week", "month"]) -> dict[str, Any]:
    start, granularity = _time_window_for_range(range_key)
    now = utcnow()
    bucket_template = _series_template(start, now, granularity)
    bucket_new_users: dict[datetime, int] = {k: 0 for k in bucket_template.keys()}

    async with SessionLocal() as session:
        base_q = await session.execute(select(func.count(User.id)).where(User.created_at < start))
        base_total = int(base_q.scalar() or 0)

        rows_q = await session.execute(select(User.created_at).where(User.created_at >= start))
        for (created_at,) in rows_q.all():
            b = _bucket_start(created_at, granularity)
            if b in bucket_new_users:
                bucket_new_users[b] += 1
            else:
                bucket_new_users[b] = 1

    running_total = base_total
    series: list[dict[str, Any]] = []
    for b in sorted(bucket_new_users.keys()):
        new_users = int(bucket_new_users.get(b, 0))
        running_total += new_users
        series.append(
            {
                "bucket": _iso_ts(b),
                "new_users": new_users,
                "total_users": running_total,
            }
        )
    return {
        "range_key": range_key,
        "series": series,
    }


@cached_query(
    lambda range_key: cache_key("admin_stats", "generation_trend", range_key),
    ttl_sec=settings.admin_stats_cache_ttl_sec,
)
async def _cached_admin_generation_trend(range_key: Literal["hour", "day", "week", "month"]) -> dict[str, Any]:
    start, granularity = _time_window_for_range(range_key)
    now = utcnow()
    bucket_template = _series_template(start, now, granularity)
    task_total: dict[datetime, int] = {k: 0 for k in bucket_template.keys()}
    completed_total: dict[datetime, int] = {k: 0 for k in bucket_template.keys()}

    async with SessionLocal() as session:
        rows_q = await session.execute(
            select(ImageGenerationTask.created_at, ImageGenerationTask.status).where(ImageGenerationTask.created_at >= start)
        )
        for created_at, status in rows_q.all():
            b = _bucket_start(created_at, granularity)
            task_total[b] = int(task_total.get(b, 0)) + 1
            if (status or "").strip().lower() == "completed":
                completed_total[b] = int(completed_total.get(b, 0)) + 1

    series = [
        {
            "bucket": _iso_ts(b),
            "task_total": int(task_total.get(b, 0)),
            "completed_total": int(completed_total.get(b, 0)),
        }
        for b in sorted(task_total.keys())
    ]
    return {"range_key": range_key, "series": series}


@cached_query(
    lambda range_key: cache_key("admin_stats", "api_latency", range_key),
    ttl_sec=settings.admin_stats_cache_ttl_sec,
)
async def _cached_admin_api_latency(range_key: Literal["hour", "day", "week", "month"]) -> dict[str, Any]:
    start, granularity = _time_window_for_range(range_key)
    now = utcnow()
    bucket_template = _series_template(start, now, granularity)
    trend_calls: dict[datetime, int] = {k: 0 for k in bucket_template.keys()}
    trend_latency_sum: dict[datetime, int] = {k: 0 for k in bucket_template.keys()}

    histogram_defs: list[tuple[str, int, int | None]] = [
        ("0-50ms", 0, 50),
        ("50-100ms", 50, 100),
        ("100-200ms", 100, 200),
        ("200-400ms", 200, 400),
        ("400-800ms", 400, 800),
        ("800-1600ms", 800, 1600),
        ("1600ms+", 1600, None),
    ]
    histogram_counts: dict[str, int] = {label: 0 for label, _, _ in histogram_defs}

    async with SessionLocal() as session:
        rows_q = await session.execute(
            select(ApiCallLog.created_at, ApiCallLog.latency_ms).where(ApiCallLog.created_at >= start)
        )
        rows = rows_q.all()
        for created_at, latency_ms in rows:
            b = _bucket_start(created_at, granularity)
            latency = max(0, _safe_int(latency_ms, 0))
            trend_calls[b] = int(trend_calls.get(b, 0)) + 1
            trend_latency_sum[b] = int(trend_latency_sum.get(b, 0)) + latency
            for label, lower, upper in histogram_defs:
                if upper is None and latency >= lower:
                    histogram_counts[label] += 1
                    break
                if upper is not None and lower <= latency < upper:
                    histogram_counts[label] += 1
                    break

    trend = []
    for b in sorted(trend_calls.keys()):
        calls = int(trend_calls.get(b, 0))
        latency_sum = int(trend_latency_sum.get(b, 0))
        avg_latency = round(latency_sum / calls, 2) if calls else 0.0
        trend.append(
            {
                "bucket": _iso_ts(b),
                "calls": calls,
                "avg_latency_ms": avg_latency,
            }
        )
    histogram = [{"bucket": label, "count": int(histogram_counts[label])} for label, _, _ in histogram_defs]
    return {"range_key": range_key, "trend": trend, "histogram": histogram}


async def _admin_stats_realtime_overview() -> dict[str, Any]:
    realtime_cache_key = cache_key("admin_stats", "realtime")
    cached = await redis_get_json(realtime_cache_key)
    if isinstance(cached, dict):
        return cached

    now = utcnow()
    day_key = now.strftime("%Y%m%d")
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hour_start = now - timedelta(hours=1)

    gen_images_today = await _read_counter_int(_counter_key("generation_images_day", day_key))
    api_calls_today = await _read_counter_int(_counter_key("api_calls_day", day_key))
    api_errors_today = await _read_counter_int(_counter_key("api_errors_day", day_key))
    pv_today = await _read_counter_int(_counter_key("website_pv_day", day_key))
    online_snapshot = await redis_get_json(cache_key("online_count", "realtime"))
    online_users = 0
    if isinstance(online_snapshot, dict):
        online_users = _safe_int(online_snapshot.get("online_count"), 0)

    async with SessionLocal() as session:
        if gen_images_today <= 0:
            q = await session.execute(
                select(func.count(ImageGenerationCandidate.id)).where(ImageGenerationCandidate.created_at >= today_start)
            )
            gen_images_today = int(q.scalar() or 0)
        if api_calls_today <= 0:
            q = await session.execute(select(func.count(ApiCallLog.id)).where(ApiCallLog.created_at >= today_start))
            api_calls_today = int(q.scalar() or 0)
        if api_errors_today <= 0:
            q = await session.execute(
                select(func.count(ApiCallLog.id)).where(ApiCallLog.created_at >= today_start, ApiCallLog.success.is_(False))
            )
            api_errors_today = int(q.scalar() or 0)
        if pv_today <= 0:
            q = await session.execute(select(func.count(WebsiteVisitLog.id)).where(WebsiteVisitLog.created_at >= today_start))
            pv_today = int(q.scalar() or 0)
        users_today_q = await session.execute(select(func.count(User.id)).where(User.created_at >= today_start))
        users_today = int(users_today_q.scalar() or 0)
        uv_today_q = await session.execute(
            select(func.count(func.distinct(WebsiteVisitLog.visitor_id))).where(WebsiteVisitLog.created_at >= today_start)
        )
        uv_today = int(uv_today_q.scalar() or 0)
        latency_hour_q = await session.execute(
            select(func.avg(ApiCallLog.latency_ms)).where(ApiCallLog.created_at >= hour_start)
        )
        avg_latency_last_hour = float(latency_hour_q.scalar() or 0.0)
        if online_users <= 0:
            q = await session.execute(
                select(func.count(func.distinct(UserOnlineSession.user_id))).where(
                    UserOnlineSession.last_seen >= now - timedelta(seconds=ONLINE_ACTIVE_SECONDS)
                )
            )
            online_users = int(q.scalar() or 0)

    api_failure_rate = round((api_errors_today / max(api_calls_today, 1)), 4) if api_calls_today > 0 else 0.0
    payload = {
        "generated_at": _iso_ts(now),
        "cards": {
            "today_generation_images": int(gen_images_today),
            "online_users": int(online_users),
            "today_api_calls": int(api_calls_today),
            "today_api_errors": int(api_errors_today),
            "today_api_failure_rate": api_failure_rate,
            "today_new_users": int(users_today),
            "today_pv": int(pv_today),
            "today_uv": int(uv_today),
            "avg_latency_last_hour_ms": round(avg_latency_last_hour, 2),
        },
    }
    await redis_set_json(realtime_cache_key, payload, ttl_sec=min(60, settings.admin_stats_cache_ttl_sec))
    return payload


def _excel_col_name(col_idx: int) -> str:
    col = ""
    n = col_idx
    while True:
        n, rem = divmod(n, 26)
        col = chr(65 + rem) + col
        if n == 0:
            break
        n -= 1
    return col


def _make_sheet_xml(headers: list[str], rows: list[list[Any]]) -> bytes:
    lines: list[str] = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    ]
    all_rows = [headers] + rows
    for row_idx, row in enumerate(all_rows, start=1):
        lines.append(f'<row r="{row_idx}">')
        for col_idx, value in enumerate(row):
            cell_ref = f"{_excel_col_name(col_idx)}{row_idx}"
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                lines.append(f'<c r="{cell_ref}"><v>{value}</v></c>')
            else:
                text = xml_escape("" if value is None else str(value))
                lines.append(f'<c r="{cell_ref}" t="inlineStr"><is><t>{text}</t></is></c>')
        lines.append("</row>")
    lines.append("</sheetData></worksheet>")
    return "".join(lines).encode("utf-8")


def _build_xlsx_bytes(sheets: list[tuple[str, list[str], list[list[Any]]]]) -> bytes:
    if not sheets:
        raise ValueError("No sheets to export")

    content_types_parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ]
    for i in range(1, len(sheets) + 1):
        content_types_parts.append(
            f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
            f'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
    content_types_parts.append("</Types>")
    content_types_xml = "".join(content_types_parts)

    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        "</Relationships>"
    )

    workbook_sheets_parts = []
    workbook_rels_parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ]
    for i, (name, _, _) in enumerate(sheets, start=1):
        safe_name = xml_escape(name[:31] or f"Sheet{i}")
        workbook_sheets_parts.append(f'<sheet name="{safe_name}" sheetId="{i}" r:id="rId{i}"/>')
        workbook_rels_parts.append(
            f'<Relationship Id="rId{i}" '
            f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="worksheets/sheet{i}.xml"/>'
        )
    style_rid = len(sheets) + 1
    workbook_rels_parts.append(
        f'<Relationship Id="rId{style_rid}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
    )
    workbook_rels_parts.append("</Relationships>")
    workbook_rels_xml = "".join(workbook_rels_parts)

    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f"<sheets>{''.join(workbook_sheets_parts)}</sheets>"
        "</workbook>"
    )

    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
        '<borders count="1"><border/></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
        "</styleSheet>"
    )

    buf = BytesIO()
    with ZipFile(buf, "w", compression=ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("_rels/.rels", rels_xml)
        zf.writestr("xl/workbook.xml", workbook_xml)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml)
        zf.writestr("xl/styles.xml", styles_xml)
        for i, (_, headers, rows) in enumerate(sheets, start=1):
            zf.writestr(f"xl/worksheets/sheet{i}.xml", _make_sheet_xml(headers, rows))
    return buf.getvalue()


async def _build_export_workbook(session: AsyncSession, scope: str) -> bytes:
    scope = (scope or "all").strip().lower()
    sheets: list[tuple[str, list[str], list[list[Any]]]] = []

    if scope in ("all", "api"):
        q = await session.execute(select(ApiCallLog).order_by(desc(ApiCallLog.created_at)).limit(2000))
        logs = q.scalars().all()
        sheets.append(
            (
                "API Logs",
                ["Time", "Method", "Path", "Status", "Latency(ms)", "Success", "IP", "UserId", "Error"],
                [
                    [
                        _iso_ts(x.created_at),
                        x.method,
                        x.path,
                        x.status_code,
                        int(x.latency_ms or 0),
                        1 if x.success else 0,
                        x.client_ip,
                        x.user_id or "",
                        (x.error_detail or "")[:200],
                    ]
                    for x in logs
                ],
            )
        )

    if scope in ("all", "online"):
        cutoff = utcnow() - timedelta(seconds=ONLINE_ACTIVE_SECONDS)
        q = await session.execute(
            select(UserOnlineSession).where(UserOnlineSession.last_seen >= cutoff).order_by(desc(UserOnlineSession.last_seen))
        )
        rows = q.scalars().all()
        sheets.append(
            (
                "Online Users",
                ["SessionId", "UserId", "Terminal", "Region", "LastPath", "FirstSeen", "LastSeen", "Heartbeats"],
                [
                    [
                        x.session_id,
                        x.user_id,
                        x.terminal_type,
                        x.region,
                        x.last_path,
                        _iso_ts(x.first_seen),
                        _iso_ts(x.last_seen),
                        int(x.total_heartbeats or 0),
                    ]
                    for x in rows
                ],
            )
        )

    if scope in ("all", "traffic"):
        q = await session.execute(select(WebsiteVisitLog).order_by(desc(WebsiteVisitLog.created_at)).limit(5000))
        rows = q.scalars().all()
        sheets.append(
            (
                "Traffic Logs",
                ["Time", "VisitorId", "SessionId", "UserId", "Path", "Source", "Referrer", "Terminal", "Region", "IP"],
                [
                    [
                        _iso_ts(x.created_at),
                        x.visitor_id,
                        x.session_id,
                        x.user_id or "",
                        x.page_path,
                        x.source_channel,
                        (x.referrer or "")[:180],
                        x.terminal_type,
                        x.region,
                        x.client_ip,
                    ]
                    for x in rows
                ],
            )
        )

    if scope in ("all", "users", "user"):
        q = await session.execute(select(User).order_by(desc(User.created_at)).limit(5000))
        users = q.scalars().all()
        sheets.append(
            (
                "Users",
                ["UserId", "Username", "DisplayName", "Phone", "IsActive", "Credits", "CreatedAt"],
                [
                    [
                        u.id,
                        u.username,
                        u.display_name,
                        getattr(u, "phone", "") or "",
                        1 if u.is_active else 0,
                        int(u.credits_balance or 0),
                        _iso_ts(u.created_at),
                    ]
                    for u in users
                ],
            )
        )

    if scope in ("all", "billing"):
        q = await session.execute(select(CreditLedger).order_by(desc(CreditLedger.created_at)).limit(5000))
        rows = q.scalars().all()
        sheets.append(
            (
                "Credit Ledger",
                ["Id", "UserId", "Type", "Amount", "Note", "CreatedAt"],
                [
                    [
                        int(x.id),
                        x.user_id,
                        x.type,
                        int(x.amount or 0),
                        (x.note or "")[:200],
                        _iso_ts(x.created_at),
                    ]
                    for x in rows
                ],
            )
        )

    if not sheets:
        raise HTTPException(status_code=400, detail="Invalid export scope")
    return _build_xlsx_bytes(sheets)


@app.on_event("startup")
async def _startup() -> None:
    init_supertokens_if_needed()
    try:
        Path(settings.admin_export_dir).resolve().mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    await init_redis_runtime()
    await init_db(engine)
    await migrate_legacy_schema()
    async with SessionLocal() as s:
        root_hash = hash_password(settings.root_password)
        for uid, username, display_name, password_hash in [
            (settings.demo_user_id, settings.demo_user_id, settings.demo_user_id, hash_password("demo-password")),
            ("root", settings.root_username, settings.root_username, root_hash),
        ]:
            q = await s.execute(select(User).where(or_(User.id == uid, User.username == username)))
            u = q.scalar_one_or_none()
            if not u:
                s.add(
                    User(
                        id=uid,
                        username=username,
                        email=None,
                        display_name=display_name,
                        password_hash=password_hash,
                        is_active=True,
                        credits_balance=INITIAL_USER_CREDITS,
                    )
                )
            else:
                if u.username == settings.root_username or u.id == "root":
                    u.username = settings.root_username
                    u.display_name = settings.root_username
                    u.password_hash = root_hash
                    u.is_active = True
                elif not (u.password_hash or "").strip():
                    u.password_hash = password_hash
                if not (u.username or "").strip():
                    u.username = u.id
                if not (u.display_name or "").strip():
                    u.display_name = u.username
                if u.credits_balance is None:
                    u.credits_balance = INITIAL_USER_CREDITS
        await s.commit()
        await _ensure_monitoring_seed_data(s)
    await _start_background_runtime()


@app.on_event("shutdown")
async def _shutdown() -> None:
    await _stop_background_runtime()
    await close_redis_runtime()
    try:
        await WRITE_ENGINE.dispose()
    except Exception:
        pass
    if READ_ENGINE is not WRITE_ENGINE:
        try:
            await READ_ENGINE.dispose()
        except Exception:
            pass


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "deepseek_configured": bool(settings.deepseek_api_key),
        "liblibai_configured": bool(settings.liblibai_base_url),
        "database_url": settings.database_url,
        "database_read_url": settings.database_read_url,
        "demo_user_id": settings.demo_user_id,
        "liblibai_base_url": settings.liblibai_base_url,
        "liblibai_uri": settings.liblibai_uri,
        "supertokens_enabled": settings.supertokens_enabled,
        "supertokens_ready": SUPERTOKENS_READY,
        "supertokens_connection_uri": settings.supertokens_connection_uri if settings.supertokens_enabled else "",
        "prompt_guard_enabled": settings.prompt_guard_enabled,
        "prompt_guard_block_terms_count": len(PROMPT_BLOCK_TERMS),
        "operation_costs": _billing_rules_snapshot(),
        "redis_enabled": settings.redis_enabled,
        "redis_available": REDIS_AVAILABLE,
        "generation_queue_enabled": bool(settings.generation_queue_enabled and REDIS_AVAILABLE),
        "export_queue_enabled": bool(settings.export_queue_enabled),
        "export_dispatch_mode": "redis" if REDIS_AVAILABLE else "local",
    }


@app.post("/api/telemetry/page-view")
async def telemetry_page_view(
    req: PageViewRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    now = utcnow()
    user_agent = request.headers.get("user-agent", "")
    user_id = _safe_user_id_from_authorization(request.headers.get("authorization"))
    source_channel = (req.source_channel or "").strip().lower() or "direct"
    if len(source_channel) > 64:
        source_channel = source_channel[:64]

    session.add(
        WebsiteVisitLog(
            visitor_id=req.visitor_id.strip(),
            session_id=req.session_id.strip(),
            user_id=user_id,
            page_path=req.page_path.strip()[:255],
            source_channel=source_channel,
            referrer=(req.referrer or "").strip()[:512],
            terminal_type=_normalize_terminal_type(user_agent),
            region=_normalize_region(req.region, req.timezone),
            client_ip=_client_ip_from_request(request),
            user_agent=user_agent[:512],
            created_at=now,
        )
    )

    profile_q = await session.execute(select(VisitorProfile).where(VisitorProfile.visitor_id == req.visitor_id.strip()))
    profile = profile_q.scalars().first()
    if not profile:
        profile = VisitorProfile(
            visitor_id=req.visitor_id.strip(),
            first_seen=now,
            last_seen=now,
            visit_count=1,
            last_user_id=user_id,
        )
        session.add(profile)
    else:
        profile.last_seen = now
        profile.visit_count = int(profile.visit_count or 0) + 1
        if user_id:
            profile.last_user_id = user_id

    await session.commit()
    day_key = now.strftime("%Y%m%d")
    hour_key = now.strftime("%Y%m%d%H")
    await redis_incr(_counter_key("website_pv_total"), amount=1, ttl_sec=90 * 24 * 3600)
    await redis_incr(_counter_key("website_pv_day", day_key), amount=1, ttl_sec=90 * 24 * 3600)
    await redis_incr(_counter_key("website_pv_hour", hour_key), amount=1, ttl_sec=14 * 24 * 3600)
    await redis_incr(_counter_key("website_pv_page", req.page_path.strip()[:128]), amount=1, ttl_sec=14 * 24 * 3600)
    return {"ok": True}


@app.post("/api/telemetry/heartbeat")
async def telemetry_heartbeat(
    req: HeartbeatRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    now = utcnow()
    session_id = req.session_id.strip()
    q = await session.execute(select(UserOnlineSession).where(UserOnlineSession.session_id == session_id))
    row = q.scalars().first()
    user_agent = request.headers.get("user-agent", "")
    if not row:
        row = UserOnlineSession(
            session_id=session_id,
            user_id=user.id,
            terminal_type=_normalize_terminal_type(user_agent),
            region=_normalize_region(req.region, req.timezone),
            timezone=(req.timezone or "").strip()[:64],
            client_ip=_client_ip_from_request(request),
            user_agent=user_agent[:512],
            last_path=req.page_path.strip()[:255],
            first_seen=now,
            last_seen=now,
            total_heartbeats=1,
        )
        session.add(row)
    else:
        row.user_id = user.id
        row.terminal_type = _normalize_terminal_type(user_agent)
        row.region = _normalize_region(req.region, req.timezone)
        row.timezone = (req.timezone or "").strip()[:64]
        row.client_ip = _client_ip_from_request(request)
        row.user_agent = user_agent[:512]
        row.last_path = req.page_path.strip()[:255]
        row.last_seen = now
        row.total_heartbeats = int(row.total_heartbeats or 0) + 1
    await session.commit()
    await redis_incr(_counter_key("heartbeat_total"), amount=1, ttl_sec=14 * 24 * 3600)
    if REDIS_AVAILABLE and REDIS_CLIENT is not None:
        try:
            presence_key = cache_key("online_users", "zset")
            now_ts = int(time.time())
            await REDIS_CLIENT.zadd(presence_key, {user.id: now_ts})
            await REDIS_CLIENT.zremrangebyscore(presence_key, "-inf", now_ts - ONLINE_ACTIVE_SECONDS)
            await REDIS_CLIENT.expire(presence_key, ONLINE_ACTIVE_SECONDS * 4)
            online_count = int(await REDIS_CLIENT.zcard(presence_key))
            await redis_set_json(
                cache_key("online_count", "realtime"),
                {"online_count": online_count, "updated_at": _iso_ts(now)},
                ttl_sec=120,
            )
        except Exception:
            pass
    return {"ok": True, "session_id": session_id, "server_time": _iso_ts(now)}


def _normalize_feedback_category(raw: str) -> str:
    allowed = {"general", "bug", "feature", "abuse", "other"}
    normalized = (raw or "general").strip().lower()
    return normalized if normalized in allowed else "general"


@app.post("/api/feedback")
async def api_feedback_submit(
    req: FeedbackSubmitRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    title = req.title.strip()
    content = req.content.strip()
    if not title:
        raise HTTPException(status_code=400, detail="反馈标题不能为空")
    if not content:
        raise HTTPException(status_code=400, detail="反馈内容不能为空")

    row = UserFeedback(
        user_id=user.id,
        user_name=(user.display_name or user.username or "")[:64],
        category=_normalize_feedback_category(req.category),
        title=title[:120],
        content=content[:4000],
        contact=(req.contact or "").strip()[:120],
        status="open",
        admin_note="",
        created_at=utcnow(),
        resolved_at=None,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {"item": _serialize_feedback_item(row)}


@app.get("/api/feedback/mine")
async def api_feedback_mine(
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    cap = max(1, min(int(limit), 200))
    stmt = (
        select(UserFeedback)
        .where(UserFeedback.user_id == user.id)
        .order_by(desc(UserFeedback.created_at))
        .limit(cap)
    )
    q = await session.execute(stmt)
    items = [_serialize_feedback_item(x) for x in q.scalars().all()]
    unread_count = sum(1 for x in items if bool(x.get("has_unread_reply")))
    return {"items": items, "unread_reply_count": int(unread_count)}


@app.post("/api/feedback/{feedback_id}/read")
async def api_feedback_mark_read(
    feedback_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    q = await session.execute(
        select(UserFeedback).where(UserFeedback.id == feedback_id, UserFeedback.user_id == user.id)
    )
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if row.replied_at:
        row.user_read_at = utcnow()
        await session.commit()
    return {"item": _serialize_feedback_item(row)}


def _normalize_pagination(page: int, page_size: int, max_page_size: int = 100) -> tuple[int, int, int]:
    safe_page = max(1, int(page))
    safe_page_size = max(1, min(int(page_size), max_page_size))
    offset = (safe_page - 1) * safe_page_size
    return safe_page, safe_page_size, offset


async def _load_single_community_post(session: AsyncSession, post_id: str) -> CommunityPost | None:
    q = await session.execute(select(CommunityPost).where(CommunityPost.id == post_id))
    return q.scalars().first()


async def _serialize_single_community_post(session: AsyncSession, post: CommunityPost) -> dict[str, Any]:
    likes_map, comments_map, reports_map = await _load_community_post_bundle(session, [post.id])
    return _serialize_community_post(
        post,
        likes_map.get(post.id, []),
        comments_map.get(post.id, []),
        reports_map.get(post.id, []),
    )


@app.get("/api/community/posts", response_model=CommunityListResponse)
async def api_community_list(
    page: int = 1,
    page_size: int = 20,
    owner_only: bool = False,
    include_hidden: bool = False,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> CommunityListResponse:
    safe_page, safe_page_size, offset = _normalize_pagination(page, page_size, max_page_size=100)
    should_use_hot_cache = (not owner_only) and (not include_hidden) and safe_page == 1
    hot_cache_key = cache_key("community_hot", "public", safe_page_size)
    if should_use_hot_cache:
        cached = await redis_get_json(hot_cache_key)
        if isinstance(cached, dict):
            try:
                return CommunityListResponse(**cached)
            except Exception:
                pass

    likes_sub = (
        select(CommunityPostLike.post_id.label("post_id"), func.count(CommunityPostLike.id).label("like_count"))
        .group_by(CommunityPostLike.post_id)
        .subquery()
    )
    like_count_col = func.coalesce(likes_sub.c.like_count, 0)
    stmt = select(CommunityPost, like_count_col.label("like_count")).outerjoin(
        likes_sub, likes_sub.c.post_id == CommunityPost.id
    )

    if owner_only:
        stmt = stmt.where(CommunityPost.owner_user_id == user.id)
    elif not (include_hidden and _is_root_user(user)):
        stmt = stmt.where(CommunityPost.moderation_status == "approved")

    count_stmt = select(func.count()).select_from(stmt.with_only_columns(CommunityPost.id).order_by(None).subquery())
    total_q = await session.execute(count_stmt)
    total = int(total_q.scalar() or 0)

    data_q = await session.execute(
        stmt.order_by(desc(like_count_col), desc(CommunityPost.published_at)).offset(offset).limit(safe_page_size)
    )
    posts = [row[0] for row in data_q.all()]
    post_ids = [x.id for x in posts]
    likes_map, comments_map, reports_map = await _load_community_post_bundle(session, post_ids)
    items = [
        _serialize_community_post(
            post,
            likes_map.get(post.id, []),
            comments_map.get(post.id, []),
            reports_map.get(post.id, []),
        )
        for post in posts
    ]
    resp = CommunityListResponse(items=items, page=safe_page, page_size=safe_page_size, total=total)
    if should_use_hot_cache:
        await redis_set_json(hot_cache_key, resp.model_dump(), ttl_sec=45)
    return resp


@app.get("/api/community/following")
async def api_community_following(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    q = await session.execute(
        select(UserFollow.followed_user_id).where(UserFollow.follower_user_id == user.id).order_by(UserFollow.created_at.desc())
    )
    return {"items": [str(x[0]) for x in q.all()]}


@app.post("/api/community/follow/{target_user_id}")
async def api_community_toggle_follow(
    target_user_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    target = target_user_id.strip()
    if not target:
        raise HTTPException(status_code=400, detail="target user is required")
    if target == user.id:
        raise HTTPException(status_code=400, detail="cannot follow yourself")

    target_q = await session.execute(select(User.id).where(User.id == target))
    if target_q.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="target user not found")

    q = await session.execute(
        select(UserFollow).where(
            UserFollow.follower_user_id == user.id,
            UserFollow.followed_user_id == target,
        )
    )
    row = q.scalars().first()
    following = False
    if row:
        await session.execute(
            text(
                "DELETE FROM user_follows WHERE follower_user_id = :follower AND followed_user_id = :followed"
            ),
            {"follower": user.id, "followed": target},
        )
    else:
        session.add(
            UserFollow(
                follower_user_id=user.id,
                followed_user_id=target,
                created_at=utcnow(),
            )
        )
        following = True
    await session.commit()
    return {"following": following, "target_user_id": target}


@app.get("/api/community/feed/following", response_model=CommunityListResponse)
async def api_community_follow_feed(
    page: int = 1,
    page_size: int = 20,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> CommunityListResponse:
    safe_page, safe_page_size, offset = _normalize_pagination(page, page_size, max_page_size=100)
    fq = await session.execute(
        select(UserFollow.followed_user_id).where(UserFollow.follower_user_id == user.id)
    )
    followed_ids = [str(x[0]) for x in fq.all()]
    if not followed_ids:
        return CommunityListResponse(items=[], page=safe_page, page_size=safe_page_size, total=0)

    likes_sub = (
        select(CommunityPostLike.post_id.label("post_id"), func.count(CommunityPostLike.id).label("like_count"))
        .group_by(CommunityPostLike.post_id)
        .subquery()
    )
    like_count_col = func.coalesce(likes_sub.c.like_count, 0)
    stmt = (
        select(CommunityPost, like_count_col.label("like_count"))
        .outerjoin(likes_sub, likes_sub.c.post_id == CommunityPost.id)
        .where(
            CommunityPost.owner_user_id.in_(followed_ids),
            CommunityPost.moderation_status == "approved",
        )
    )

    count_stmt = select(func.count()).select_from(stmt.with_only_columns(CommunityPost.id).order_by(None).subquery())
    total_q = await session.execute(count_stmt)
    total = int(total_q.scalar() or 0)

    data_q = await session.execute(
        stmt.order_by(desc(like_count_col), desc(CommunityPost.published_at)).offset(offset).limit(safe_page_size)
    )
    posts = [row[0] for row in data_q.all()]
    post_ids = [x.id for x in posts]
    likes_map, comments_map, reports_map = await _load_community_post_bundle(session, post_ids)
    items = [
        _serialize_community_post(
            post,
            likes_map.get(post.id, []),
            comments_map.get(post.id, []),
            reports_map.get(post.id, []),
        )
        for post in posts
    ]
    return CommunityListResponse(items=items, page=safe_page, page_size=safe_page_size, total=total)


@app.post("/api/community/posts")
async def api_community_publish(
    req: CommunityPublishRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="请填写作品标题。")
    data_url = req.data_url.strip()
    if not data_url:
        raise HTTPException(status_code=400, detail="请先上传作品图片。")

    review_target = title if not req.ai_generated else f"{title}\n{req.prompt_artistic or ''}"
    machine_result, machine_reason = await _machine_review_text(review_target)
    if machine_result == "reject":
        raise HTTPException(status_code=400, detail=f"发布失败：内容审核未通过（{machine_reason}）")

    archive_id = req.archive_id.strip()
    existed = False
    row: CommunityPost | None = None
    if archive_id and req.publish_source == "generated":
        q = await session.execute(
            select(CommunityPost).where(
                CommunityPost.owner_user_id == user.id,
                CommunityPost.archive_id == archive_id,
                CommunityPost.publish_source == "generated",
            )
        )
        row = q.scalars().first()
        existed = row is not None

    if not row:
        row = CommunityPost(
            id=uuid.uuid4().hex,
            archive_id=archive_id,
            publish_source=req.publish_source,
            owner_user_id=user.id,
            owner_user_name=(user.display_name or user.username or "")[:64],
            title=title[:160],
            data_url=data_url,
            prompt_artistic=(req.prompt_artistic or "").strip()[:4000],
            params_json=_json_dump_safe(req.params),
            created_at=_parse_iso_datetime(req.created_at),
            published_at=_parse_iso_datetime(req.published_at),
            ai_generated=bool(req.ai_generated),
            ai_label=(req.ai_label or ("AI生成" if req.ai_generated else "用户上传")).strip()[:32],
            moderation_status="approved" if machine_result == "pass" else "hidden",
            moderation_reason="" if machine_result == "pass" else f"机审待人工复核：{machine_reason}",
            minted=bool(req.minted),
        )
        session.add(row)
    else:
        row.title = title[:160]
        row.data_url = data_url
        row.prompt_artistic = (req.prompt_artistic or "").strip()[:4000]
        row.params_json = _json_dump_safe(req.params)
        row.ai_generated = bool(req.ai_generated)
        row.ai_label = (req.ai_label or ("AI生成" if req.ai_generated else "用户上传")).strip()[:32]
        row.moderation_status = "approved" if machine_result == "pass" else "hidden"
        row.moderation_reason = "" if machine_result == "pass" else f"机审待人工复核：{machine_reason}"
        row.minted = bool(req.minted)

    if not existed:
        await _grant_reward_credits(
            session,
            user,
            PUBLISH_REWARD_CREDITS,
            "publish_artwork" if req.publish_source == "generated" else "publish_upload_artwork",
        )

    if machine_result == "review":
        await _create_or_get_open_ticket(
            session,
            source="machine",
            content_type="community_post",
            content_id=row.id,
            report_id=None,
            machine_result=machine_result,
            machine_reason=machine_reason,
            created_by_user_id=user.id,
        )

    await session.commit()
    await _invalidate_hot_caches()
    await redis_incr(_counter_key("community_publish_total"), amount=1, ttl_sec=31 * 24 * 3600)
    item = await _serialize_single_community_post(session, row)
    return {"item": item}


@app.delete("/api/community/posts/{post_id}")
async def api_community_remove_post(
    post_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = await _load_single_community_post(session, post_id.strip())
    if not row:
        raise HTTPException(status_code=404, detail="作品不存在。")
    if not (row.owner_user_id == user.id or _is_root_user(user)):
        raise HTTPException(status_code=403, detail="仅作者或管理员可删除。")

    await session.execute(text("DELETE FROM community_post_likes WHERE post_id = :post_id"), {"post_id": row.id})
    await session.execute(text("DELETE FROM community_post_comments WHERE post_id = :post_id"), {"post_id": row.id})
    await session.execute(text("DELETE FROM community_post_reports WHERE post_id = :post_id"), {"post_id": row.id})
    await session.execute(text("DELETE FROM community_posts WHERE id = :post_id"), {"post_id": row.id})
    await session.commit()
    await _invalidate_hot_caches()
    return {"ok": True}


@app.post("/api/community/posts/{post_id}/toggle-like")
async def api_community_toggle_like(
    post_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = await _load_single_community_post(session, post_id.strip())
    if not row:
        raise HTTPException(status_code=404, detail="作品不存在。")
    if row.moderation_status == "hidden":
        raise HTTPException(status_code=400, detail="该作品已下线，无法点赞。")

    q = await session.execute(
        select(CommunityPostLike).where(CommunityPostLike.post_id == row.id, CommunityPostLike.user_id == user.id)
    )
    liked = q.scalars().first()
    if liked:
        await session.execute(
            text("DELETE FROM community_post_likes WHERE post_id = :post_id AND user_id = :user_id"),
            {"post_id": row.id, "user_id": user.id},
        )
    else:
        session.add(CommunityPostLike(post_id=row.id, user_id=user.id, created_at=utcnow()))
    await session.commit()
    await redis_incr(_counter_key("community_like", row.id), amount=-1 if liked else 1, ttl_sec=31 * 24 * 3600)
    await _invalidate_hot_caches()
    item = await _serialize_single_community_post(session, row)
    return {"item": item}


@app.post("/api/community/posts/{post_id}/comments")
async def api_community_comment(
    post_id: str,
    req: CommunityCommentRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    content = req.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论不能为空。")
    machine_result, machine_reason = await _machine_review_text(content)
    if machine_result == "reject":
        raise HTTPException(status_code=400, detail=f"评论未通过审核（{machine_reason}）")

    row = await _load_single_community_post(session, post_id.strip())
    if not row:
        raise HTTPException(status_code=404, detail="作品不存在。")
    if row.moderation_status == "hidden":
        raise HTTPException(status_code=400, detail="该作品已下线，无法评论。")

    comment_row = CommunityPostComment(
        id=uuid.uuid4().hex,
        post_id=row.id,
        user_id=user.id,
        user_name=(user.display_name or user.username or "")[:64],
        content=content[:4000],
        created_at=utcnow(),
        moderation_status="approved" if machine_result == "pass" else "hidden",
        moderation_reason="" if machine_result == "pass" else f"机审待人工复核：{machine_reason}",
    )
    session.add(comment_row)
    if machine_result == "review":
        await _create_or_get_open_ticket(
            session,
            source="machine",
            content_type="community_comment",
            content_id=comment_row.id,
            report_id=None,
            machine_result=machine_result,
            machine_reason=machine_reason,
            created_by_user_id=user.id,
        )
    await session.commit()
    await redis_incr(_counter_key("community_comment", row.id), amount=1, ttl_sec=31 * 24 * 3600)
    await _invalidate_hot_caches()
    item = await _serialize_single_community_post(session, row)
    return {"item": item}


@app.post("/api/community/posts/{post_id}/reports")
async def api_community_report(
    post_id: str,
    req: CommunityReportRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    reason = req.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="请填写举报原因。")
    row = await _load_single_community_post(session, post_id.strip())
    if not row:
        raise HTTPException(status_code=404, detail="作品不存在。")
    if row.owner_user_id == user.id:
        raise HTTPException(status_code=400, detail="不能举报自己的作品。")

    existed_q = await session.execute(
        select(CommunityPostReport).where(
            CommunityPostReport.post_id == row.id,
            CommunityPostReport.reporter_user_id == user.id,
        )
    )
    if existed_q.scalars().first():
        raise HTTPException(status_code=400, detail="你已举报过该作品。")

    report_row = CommunityPostReport(
        id=uuid.uuid4().hex,
        post_id=row.id,
        reporter_user_id=user.id,
        reporter_user_name=(user.display_name or user.username or "")[:64],
        reason=reason[:240],
        created_at=utcnow(),
    )
    session.add(report_row)

    report_count_q = await session.execute(
        select(func.count(CommunityPostReport.id)).where(CommunityPostReport.post_id == row.id)
    )
    report_count = int(report_count_q.scalar() or 0) + 1
    should_hide = report_count >= 3 or (moderation_reason_for_text(reason) is not None)
    if should_hide:
        row.moderation_status = "hidden"
        row.moderation_reason = "已触发应急下线，等待复核"

    await _create_or_get_open_ticket(
        session,
        source="report",
        content_type="community_post",
        content_id=row.id,
        report_id=report_row.id,
        machine_result="review",
        machine_reason=f"用户举报：{reason[:180]}",
        created_by_user_id=user.id,
    )

    await session.commit()
    await redis_incr(_counter_key("community_report", row.id), amount=1, ttl_sec=31 * 24 * 3600)
    await _invalidate_hot_caches()
    item = await _serialize_single_community_post(session, row)
    return {"item": item}


async def _load_single_forum_question(session: AsyncSession, question_id: str) -> ForumQuestion | None:
    q = await session.execute(select(ForumQuestion).where(ForumQuestion.id == question_id))
    return q.scalars().first()


async def _serialize_single_forum_question(session: AsyncSession, question: ForumQuestion) -> dict[str, Any]:
    likes_map, answers_map = await _load_forum_question_bundle(session, [question.id])
    return _serialize_forum_question(
        question,
        likes_map.get(question.id, []),
        answers_map.get(question.id, []),
    )


@app.get("/api/forum/questions", response_model=ForumListResponse)
async def api_forum_list(
    page: int = 1,
    page_size: int = 20,
    q: str | None = None,
    tag: str | None = None,
    sort: Literal["hot", "latest", "unanswered"] = "hot",
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ForumListResponse:
    safe_page, safe_page_size, offset = _normalize_pagination(page, page_size, max_page_size=100)
    q_text = (q or "").strip()[:120]
    tag_text = (tag or "").strip().lower()[:24]
    sort_key = sort if sort in {"hot", "latest", "unanswered"} else "hot"
    should_use_hot_cache = safe_page == 1 and not q_text and not tag_text and sort_key == "hot"
    hot_cache_key = cache_key("forum_hot", "public", safe_page_size, sort_key)
    if should_use_hot_cache:
        cached = await redis_get_json(hot_cache_key)
        if isinstance(cached, dict):
            try:
                return ForumListResponse(**cached)
            except Exception:
                pass
    likes_sub = (
        select(ForumQuestionLike.question_id.label("question_id"), func.count(ForumQuestionLike.id).label("like_count"))
        .group_by(ForumQuestionLike.question_id)
        .subquery()
    )
    answers_sub = (
        select(ForumAnswer.question_id.label("question_id"), func.count(ForumAnswer.id).label("answer_count"))
        .group_by(ForumAnswer.question_id)
        .subquery()
    )
    like_count_col = func.coalesce(likes_sub.c.like_count, 0)
    answer_count_col = func.coalesce(answers_sub.c.answer_count, 0)
    stmt = (
        select(ForumQuestion, like_count_col.label("like_count"), answer_count_col.label("answer_count"))
        .outerjoin(likes_sub, likes_sub.c.question_id == ForumQuestion.id)
        .outerjoin(answers_sub, answers_sub.c.question_id == ForumQuestion.id)
        .where(ForumQuestion.moderation_status == "approved")
    )
    if q_text:
        like_term = f"%{q_text}%"
        stmt = stmt.where(or_(ForumQuestion.title.ilike(like_term), ForumQuestion.content.ilike(like_term)))
    if tag_text:
        stmt = stmt.where(ForumQuestion.tags_json.like(f"%\"{tag_text}\"%"))

    count_stmt = select(func.count()).select_from(stmt.with_only_columns(ForumQuestion.id).order_by(None).subquery())
    total_q = await session.execute(count_stmt)
    total = int(total_q.scalar() or 0)

    if sort_key == "latest":
        order_expr = [desc(ForumQuestion.created_at)]
    elif sort_key == "unanswered":
        order_expr = [answer_count_col.asc(), desc(ForumQuestion.created_at)]
    else:
        order_expr = [desc(like_count_col), desc(ForumQuestion.created_at)]

    data_q = await session.execute(
        stmt.order_by(*order_expr).offset(offset).limit(safe_page_size)
    )
    rows = [x[0] for x in data_q.all()]
    question_ids = [x.id for x in rows]
    likes_map, answers_map = await _load_forum_question_bundle(session, question_ids)
    items = [
        _serialize_forum_question(
            q,
            likes_map.get(q.id, []),
            answers_map.get(q.id, []),
        )
        for q in rows
    ]
    resp = ForumListResponse(items=items, page=safe_page, page_size=safe_page_size, total=total)
    if should_use_hot_cache:
        await redis_set_json(hot_cache_key, resp.model_dump(), ttl_sec=45)
    return resp


@app.post("/api/forum/questions")
async def api_forum_ask(
    req: ForumAskRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    title = req.title.strip()
    content = req.content.strip()
    if not title:
        raise HTTPException(status_code=400, detail="问题标题不能为空。")
    if not content:
        raise HTTPException(status_code=400, detail="问题内容不能为空。")

    tags = _normalize_string_list(req.tags, max_items=8, max_length=24, lowercase=True)
    invited_user_ids = [x for x in _normalize_string_list(req.invited_user_ids, max_items=20, max_length=64) if x != user.id]
    moderation_payload = "\n".join([title, content, " ".join(tags)])
    machine_result, machine_reason = await _machine_review_text(moderation_payload)
    if machine_result == "reject":
        raise HTTPException(status_code=400, detail=f"发布失败：{machine_reason}")

    row = ForumQuestion(
        id=uuid.uuid4().hex,
        user_id=user.id,
        user_name=(user.display_name or user.username or "")[:64],
        title=title[:200],
        content=content[:4000],
        tags_json=json.dumps(tags, ensure_ascii=False),
        invited_user_ids_json=json.dumps(invited_user_ids, ensure_ascii=False),
        created_at=utcnow(),
        solved=False,
        moderation_status="approved" if machine_result == "pass" else "hidden",
        moderation_reason="" if machine_result == "pass" else f"机审待人工复核：{machine_reason}",
    )
    session.add(row)
    if machine_result == "review":
        await _create_or_get_open_ticket(
            session,
            source="machine",
            content_type="forum_question",
            content_id=row.id,
            report_id=None,
            machine_result=machine_result,
            machine_reason=machine_reason,
            created_by_user_id=user.id,
        )
    await session.commit()
    await redis_incr(_counter_key("forum_question_total"), amount=1, ttl_sec=31 * 24 * 3600)
    await _invalidate_hot_caches()
    item = await _serialize_single_forum_question(session, row)
    return {"item": item}


@app.post("/api/forum/questions/{question_id}/toggle-like")
async def api_forum_toggle_like(
    question_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = await _load_single_forum_question(session, question_id.strip())
    if not row:
        raise HTTPException(status_code=404, detail="问题不存在。")
    if row.moderation_status != "approved":
        raise HTTPException(status_code=400, detail="该问题当前不可点赞。")

    q = await session.execute(
        select(ForumQuestionLike).where(ForumQuestionLike.question_id == row.id, ForumQuestionLike.user_id == user.id)
    )
    liked = q.scalars().first()
    if liked:
        await session.execute(
            text("DELETE FROM forum_question_likes WHERE question_id = :qid AND user_id = :uid"),
            {"qid": row.id, "uid": user.id},
        )
    else:
        session.add(ForumQuestionLike(question_id=row.id, user_id=user.id, created_at=utcnow()))
    await session.commit()
    await redis_incr(_counter_key("forum_like", row.id), amount=-1 if liked else 1, ttl_sec=31 * 24 * 3600)
    await _invalidate_hot_caches()
    item = await _serialize_single_forum_question(session, row)
    return {"item": item}


@app.post("/api/forum/questions/{question_id}/answers")
async def api_forum_answer(
    question_id: str,
    req: ForumAnswerRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    content = req.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="回答内容不能为空。")
    machine_result, machine_reason = await _machine_review_text(content)
    if machine_result == "reject":
        raise HTTPException(status_code=400, detail=f"回答未通过审核：{machine_reason}")

    row = await _load_single_forum_question(session, question_id.strip())
    if not row:
        raise HTTPException(status_code=404, detail="问题不存在。")

    answer_row = ForumAnswer(
        id=uuid.uuid4().hex,
        question_id=row.id,
        user_id=user.id,
        user_name=(user.display_name or user.username or "")[:64],
        content=content[:4000],
        created_at=utcnow(),
        moderation_status="approved" if machine_result == "pass" else "hidden",
        moderation_reason="" if machine_result == "pass" else f"机审待人工复核：{machine_reason}",
    )
    session.add(answer_row)
    if machine_result == "review":
        await _create_or_get_open_ticket(
            session,
            source="machine",
            content_type="forum_answer",
            content_id=answer_row.id,
            report_id=None,
            machine_result=machine_result,
            machine_reason=machine_reason,
            created_by_user_id=user.id,
        )
    await _grant_reward_credits(session, user, FORUM_ANSWER_REWARD_CREDITS, "forum_answer")
    await session.commit()
    await redis_incr(_counter_key("forum_answer", row.id), amount=1, ttl_sec=31 * 24 * 3600)
    await _invalidate_hot_caches()
    item = await _serialize_single_forum_question(session, row)
    return {"item": item}


@app.post("/api/forum/questions/{question_id}/invite")
async def api_forum_invite_answer(
    question_id: str,
    req: ForumInviteRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = await _load_single_forum_question(session, question_id.strip())
    if not row:
        raise HTTPException(status_code=404, detail="问题不存在。")
    if not (row.user_id == user.id or _is_root_user(user)):
        raise HTTPException(status_code=403, detail="仅提问者或管理员可邀请回答。")

    existing = _parse_json_string_list(row.invited_user_ids_json, max_items=20, max_length=64)
    merged = existing + _normalize_string_list(req.invited_user_ids, max_items=20, max_length=64)
    merged = _normalize_string_list(merged, max_items=20, max_length=64)
    if row.user_id in merged:
        merged = [x for x in merged if x != row.user_id]
    row.invited_user_ids_json = json.dumps(merged, ensure_ascii=False)
    await session.commit()
    await _invalidate_hot_caches()
    item = await _serialize_single_forum_question(session, row)
    return {"item": item}


@app.post("/api/forum/questions/{question_id}/toggle-solved")
async def api_forum_toggle_solved(
    question_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = await _load_single_forum_question(session, question_id.strip())
    if not row:
        raise HTTPException(status_code=404, detail="问题不存在。")
    if not (row.user_id == user.id or _is_root_user(user)):
        raise HTTPException(status_code=403, detail="仅提问者或管理员可操作。")
    row.solved = not bool(row.solved)
    await session.commit()
    await _invalidate_hot_caches()
    item = await _serialize_single_forum_question(session, row)
    return {"item": item}


def _serialize_generation_candidate(row: ImageGenerationCandidate) -> dict[str, Any]:
    return {
        "candidate_id": row.id,
        "task_id": row.task_id,
        "user_id": row.user_id,
        "candidate_index": int(row.candidate_index),
        "data_url": row.data_url,
        "image_code": row.image_code,
        "image_bucket": row.image_bucket,
        "assigned_seq": row.assigned_seq,
        "assigned_at": _iso_ts(row.assigned_at) if row.assigned_at else None,
        "created_at": _iso_ts(row.created_at),
    }


@app.post("/api/generation/select")
async def api_generation_select(
    req: SelectGenerationImageRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    task_id = req.generation_task_id.strip()
    selected_candidate_id = req.selected_candidate_id.strip()
    if not task_id or not selected_candidate_id:
        raise HTTPException(status_code=400, detail="generation_task_id 和 selected_candidate_id 不能为空。")

    task_q = await session.execute(
        select(ImageGenerationTask).where(ImageGenerationTask.id == task_id, ImageGenerationTask.user_id == user.id)
    )
    task = task_q.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="生成任务不存在。")

    candidates_q = await session.execute(
        select(ImageGenerationCandidate)
        .where(ImageGenerationCandidate.task_id == task.id)
        .order_by(ImageGenerationCandidate.candidate_index.asc())
    )
    candidates = candidates_q.scalars().all()
    if not candidates:
        raise HTTPException(status_code=404, detail="候选图片不存在。")

    selected_row = next((x for x in candidates if x.id == selected_candidate_id), None)
    if not selected_row:
        raise HTTPException(status_code=404, detail="所选图片不存在。")

    seq_q = await session.execute(select(ImageSelectionSequence).where(ImageSelectionSequence.task_id == task.id))
    seq_row = seq_q.scalars().first()
    if seq_row and task.selected_candidate_id and task.selected_candidate_id != selected_row.id:
        raise HTTPException(status_code=409, detail="该任务已完成选图，不能重复选择。")

    if not seq_row:
        seq_row = ImageSelectionSequence(task_id=task.id, user_id=user.id, created_at=utcnow())
        session.add(seq_row)
        await session.flush()

    seq_no = int(seq_row.id)
    task.selected_candidate_id = selected_row.id

    if not selected_row.image_code:
        selected_row.image_code = f"a{seq_no:08d}"
        selected_row.image_bucket = "selected"
        selected_row.assigned_seq = seq_no
        selected_row.assigned_at = utcnow()

        rejected_rows = [x for x in candidates if x.id != selected_row.id]
        rejected_rows.sort(key=lambda x: int(x.candidate_index))
        for idx, row in enumerate(rejected_rows):
            prefix = ["b", "c", "d"][idx] if idx < 3 else "d"
            row.image_code = f"{prefix}{seq_no:08d}"
            row.image_bucket = "rejected"
            row.assigned_seq = seq_no
            row.assigned_at = utcnow()

    task.status = "completed"
    task.progress = 100
    task.updated_at = utcnow()
    task.finished_at = task.finished_at or utcnow()
    await session.commit()
    await redis_incr(_counter_key("generation_select_total"), amount=1, ttl_sec=31 * 24 * 3600)
    await _set_generation_progress(task.id, "completed", 100, message="selection completed")
    return {
        "task_id": task.id,
        "selected_candidate_id": selected_row.id,
        "sequence": seq_no,
        "selected_code": selected_row.image_code,
        "items": [_serialize_generation_candidate(x) for x in candidates],
    }


def _serialize_generation_task_state(task: ImageGenerationTask) -> dict[str, Any]:
    return {
        "task_id": task.id,
        "status": task.status,
        "progress": int(task.progress or 0),
        "failure_reason": task.failure_reason or "",
        "paused": bool(task.paused),
        "cancelled": bool(task.cancelled),
        "created_at": _iso_ts(task.created_at),
        "updated_at": _iso_ts(task.updated_at or task.created_at),
        "started_at": _iso_ts(task.started_at) if task.started_at else None,
        "finished_at": _iso_ts(task.finished_at) if task.finished_at else None,
        "queue_message_id": task.queue_message_id,
    }


def _serialize_prompt_version(row: PromptVersionRecord) -> dict[str, Any]:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "raw_prompt": row.raw_prompt,
        "artistic_prompt": row.artistic_prompt or "",
        "content_hash": row.content_hash,
        "created_at": _iso_ts(row.created_at),
    }


def _serialize_prompt_preset(row: PromptPreset) -> dict[str, Any]:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "name": row.name,
        "category": row.category or "general",
        "prompt_hint": row.prompt_hint or "",
        "params": _json_load_safe(row.params_json, {}),
        "created_at": _iso_ts(row.created_at),
        "updated_at": _iso_ts(row.updated_at),
    }


async def _load_owned_generation_task(
    session: AsyncSession,
    task_id: str,
    user_id: str,
) -> ImageGenerationTask:
    q = await session.execute(
        select(ImageGenerationTask).where(
            ImageGenerationTask.id == task_id,
            ImageGenerationTask.user_id == user_id,
        )
    )
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Generation task not found")
    return row


@app.get("/api/generation/tasks/{task_id}")
async def api_generation_task_status(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = await _load_owned_generation_task(session, task_id.strip(), user.id)
    progress = await _get_generation_progress(row.id)
    if progress:
        return {"item": progress}
    return {"item": _serialize_generation_task_state(row)}


@app.post("/api/generation/tasks/{task_id}/pause")
async def api_generation_task_pause(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = await _load_owned_generation_task(session, task_id.strip(), user.id)
    if row.status in {"completed", "failed", "cancelled"}:
        return {"item": _serialize_generation_task_state(row)}
    row.paused = True
    if row.status == "running":
        row.status = "queued"
    row.updated_at = utcnow()
    await session.commit()
    await _set_generation_progress(row.id, "queued", max(1, int(row.progress or 1)), message="paused")
    return {"item": _serialize_generation_task_state(row)}


@app.post("/api/generation/tasks/{task_id}/resume")
async def api_generation_task_resume(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = await _load_owned_generation_task(session, task_id.strip(), user.id)
    row.paused = False
    if row.status in {"completed", "failed", "cancelled"}:
        await session.commit()
        return {"item": _serialize_generation_task_state(row)}
    row.status = "queued"
    row.updated_at = utcnow()
    await session.commit()
    if settings.generation_queue_enabled and REDIS_AVAILABLE:
        msg_id = await _enqueue_generation_task(row, 4)
        row.queue_message_id = msg_id
        row.updated_at = utcnow()
        await session.commit()
    await _set_generation_progress(row.id, "queued", max(1, int(row.progress or 1)), message="resumed")
    return {"item": _serialize_generation_task_state(row)}


@app.post("/api/generation/tasks/{task_id}/cancel")
async def api_generation_task_cancel(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = await _load_owned_generation_task(session, task_id.strip(), user.id)
    row.cancelled = True
    row.paused = False
    if row.status not in {"completed", "failed", "cancelled"}:
        row.status = "cancelled"
    row.progress = 100
    row.finished_at = utcnow()
    row.updated_at = utcnow()
    await session.commit()
    await _set_generation_progress(row.id, "cancelled", 100, message="cancelled")
    return {"item": _serialize_generation_task_state(row)}


@app.websocket("/api/ws/generation/{task_id}")
async def ws_generation_progress(websocket: WebSocket, task_id: str) -> None:
    await websocket.accept()

    authorization = websocket.headers.get("authorization")
    if not authorization:
        token = (websocket.query_params.get("token") or "").strip()
        if token:
            authorization = f"Bearer {token}"
    if not authorization or not authorization.lower().startswith("bearer "):
        await websocket.close(code=4401)
        return

    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = _decode_token(token, "access")
        user_id = str(payload.get("sub", "")).strip()
    except HTTPException:
        await websocket.close(code=4401)
        return
    if not user_id:
        await websocket.close(code=4401)
        return

    async with SessionLocal() as session:
        q = await session.execute(
            select(ImageGenerationTask).where(
                ImageGenerationTask.id == task_id.strip(),
                ImageGenerationTask.user_id == user_id,
            )
        )
        task = q.scalars().first()
        if not task:
            await websocket.close(code=4404)
            return
        fallback = _serialize_generation_task_state(task)

    WS_PROGRESS_CHANNELS[task_id].add(websocket)
    try:
        initial = await _get_generation_progress(task_id)
        await websocket.send_text(json.dumps(initial or fallback, ensure_ascii=False))
        while True:
            try:
                _ = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                latest = await _get_generation_progress(task_id)
                if latest:
                    await websocket.send_text(json.dumps(latest, ensure_ascii=False))
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": "ping", "ts": _iso_ts(utcnow())}))
    except WebSocketDisconnect:
        pass
    finally:
        WS_PROGRESS_CHANNELS.get(task_id, set()).discard(websocket)


@app.get("/api/workspace/prompt-versions")
async def api_workspace_prompt_versions(
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit), 200))
    q = await session.execute(
        select(PromptVersionRecord)
        .where(PromptVersionRecord.user_id == user.id)
        .order_by(desc(PromptVersionRecord.created_at))
        .limit(safe_limit)
    )
    rows = q.scalars().all()
    return {"items": [_serialize_prompt_version(x) for x in rows]}


@app.post("/api/workspace/prompt-versions")
async def api_workspace_save_prompt_version(
    req: PromptVersionSaveRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    raw_prompt = req.raw_prompt.strip()
    artistic_prompt = (req.artistic_prompt or "").strip()
    signature = hashlib.sha256(f"{raw_prompt}\n{artistic_prompt}".encode("utf-8")).hexdigest()

    latest_q = await session.execute(
        select(PromptVersionRecord)
        .where(PromptVersionRecord.user_id == user.id)
        .order_by(desc(PromptVersionRecord.created_at))
        .limit(1)
    )
    latest = latest_q.scalars().first()
    if latest and latest.content_hash == signature:
        return {"item": _serialize_prompt_version(latest)}

    row = PromptVersionRecord(
        id=uuid.uuid4().hex,
        user_id=user.id,
        raw_prompt=raw_prompt,
        artistic_prompt=artistic_prompt,
        content_hash=signature,
        created_at=utcnow(),
    )
    session.add(row)
    await session.commit()

    # Keep the latest 100 versions per user.
    old_q = await session.execute(
        select(PromptVersionRecord.id)
        .where(PromptVersionRecord.user_id == user.id)
        .order_by(desc(PromptVersionRecord.created_at))
        .offset(100)
    )
    old_ids = [x[0] for x in old_q.all()]
    if old_ids:
        for old_id in old_ids:
            await session.execute(text("DELETE FROM prompt_version_records WHERE id = :id"), {"id": old_id})
        await session.commit()
    return {"item": _serialize_prompt_version(row)}


@app.get("/api/workspace/presets")
async def api_workspace_list_presets(
    category: str | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    stmt = select(PromptPreset).where(PromptPreset.user_id == user.id)
    if (category or "").strip():
        stmt = stmt.where(PromptPreset.category == category.strip())
    q = await session.execute(stmt.order_by(desc(PromptPreset.updated_at)).limit(300))
    rows = q.scalars().all()
    return {"items": [_serialize_prompt_preset(x) for x in rows]}


@app.post("/api/workspace/presets")
async def api_workspace_create_preset(
    req: PromptPresetUpsertRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = PromptPreset(
        id=uuid.uuid4().hex,
        user_id=user.id,
        name=req.name.strip()[:120],
        category=(req.category or "general").strip()[:64] or "general",
        prompt_hint=(req.prompt_hint or "").strip()[:12000],
        params_json=_json_dump_safe(req.params),
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    session.add(row)
    await session.commit()
    return {"item": _serialize_prompt_preset(row)}


@app.patch("/api/workspace/presets/{preset_id}")
async def api_workspace_update_preset(
    preset_id: str,
    req: PromptPresetUpsertRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    q = await session.execute(
        select(PromptPreset).where(PromptPreset.id == preset_id.strip(), PromptPreset.user_id == user.id)
    )
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Preset not found")
    row.name = req.name.strip()[:120]
    row.category = (req.category or "general").strip()[:64] or "general"
    row.prompt_hint = (req.prompt_hint or "").strip()[:12000]
    row.params_json = _json_dump_safe(req.params)
    row.updated_at = utcnow()
    await session.commit()
    return {"item": _serialize_prompt_preset(row)}


@app.delete("/api/workspace/presets/{preset_id}")
async def api_workspace_delete_preset(
    preset_id: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    q = await session.execute(
        select(PromptPreset).where(PromptPreset.id == preset_id.strip(), PromptPreset.user_id == user.id)
    )
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Preset not found")
    await session.execute(text("DELETE FROM prompt_presets WHERE id = :pid"), {"pid": row.id})
    await session.commit()
    return {"ok": True}


def _data_center_filters(
    bucket: Literal["selected", "rejected"],
    start_code: str | None,
    end_code: str | None,
    start_time: str | None,
    end_time: str | None,
) -> list[Any]:
    conds: list[Any] = [
        ImageGenerationCandidate.image_bucket == bucket,
        ImageGenerationCandidate.image_code.is_not(None),
    ]
    if (start_code or "").strip():
        conds.append(ImageGenerationCandidate.image_code >= start_code.strip().lower())
    if (end_code or "").strip():
        conds.append(ImageGenerationCandidate.image_code <= end_code.strip().lower())
    if (start_time or "").strip():
        conds.append(ImageGenerationCandidate.assigned_at >= _parse_iso_datetime(start_time))
    if (end_time or "").strip():
        conds.append(ImageGenerationCandidate.assigned_at <= _parse_iso_datetime(end_time))
    return conds


async def _query_data_center_items(
    session: AsyncSession,
    bucket: Literal["selected", "rejected"],
    page: int,
    page_size: int,
    start_code: str | None,
    end_code: str | None,
    start_time: str | None,
    end_time: str | None,
) -> DataCenterListResponse:
    safe_page, safe_page_size, offset = _normalize_pagination(page, page_size, max_page_size=200)
    conds = _data_center_filters(bucket, start_code, end_code, start_time, end_time)

    base = select(ImageGenerationCandidate).where(and_(*conds))
    total_q = await session.execute(select(func.count()).select_from(base.order_by(None).subquery()))
    total = int(total_q.scalar() or 0)
    rows_q = await session.execute(
        base.order_by(desc(ImageGenerationCandidate.assigned_seq), desc(ImageGenerationCandidate.assigned_at))
        .offset(offset)
        .limit(safe_page_size)
    )
    rows = rows_q.scalars().all()
    items = []
    for idx, row in enumerate(rows, start=1):
        item = _serialize_generation_candidate(row)
        item["row_no"] = offset + idx
        items.append(item)
    return DataCenterListResponse(items=items, page=safe_page, page_size=safe_page_size, total=total)


def _zip_stream_from_candidates(rows: list[ImageGenerationCandidate], folder: str):
    import tempfile

    temp = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
    with ZipFile(temp, "w", compression=ZIP_DEFLATED) as zf:
        for row in rows:
            code = (row.image_code or "").strip().lower()
            if not code:
                continue
            body, ext = _decode_data_url_bytes(row.data_url or "")
            safe_name = f"{folder}/{code}{ext}"
            zf.writestr(safe_name, body)
    temp.seek(0)

    def _iter():
        try:
            while True:
                chunk = temp.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            temp.close()

    return _iter()


async def _query_data_center_download_rows(
    session: AsyncSession,
    bucket: Literal["selected", "rejected"],
    page: int,
    page_size: int,
    start_code: str | None,
    end_code: str | None,
    start_time: str | None,
    end_time: str | None,
) -> list[ImageGenerationCandidate]:
    _, safe_page_size, offset = _normalize_pagination(page, page_size, max_page_size=500)
    conds = _data_center_filters(bucket, start_code, end_code, start_time, end_time)
    q = await session.execute(
        select(ImageGenerationCandidate)
        .where(and_(*conds))
        .order_by(desc(ImageGenerationCandidate.assigned_seq), desc(ImageGenerationCandidate.assigned_at))
        .offset(offset)
        .limit(safe_page_size)
    )
    return q.scalars().all()


@app.get("/api/admin/data-center/selected-images", response_model=DataCenterListResponse)
async def admin_selected_images(
    page: int = 1,
    page_size: int = 20,
    start_code: str | None = None,
    end_code: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> DataCenterListResponse:
    return await _query_data_center_items(
        session=session,
        bucket="selected",
        page=page,
        page_size=page_size,
        start_code=start_code,
        end_code=end_code,
        start_time=start_time,
        end_time=end_time,
    )


@app.get("/api/admin/data-center/rejected-images", response_model=DataCenterListResponse)
async def admin_rejected_images(
    page: int = 1,
    page_size: int = 20,
    start_code: str | None = None,
    end_code: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> DataCenterListResponse:
    return await _query_data_center_items(
        session=session,
        bucket="rejected",
        page=page,
        page_size=page_size,
        start_code=start_code,
        end_code=end_code,
        start_time=start_time,
        end_time=end_time,
    )


@app.get("/api/admin/data-center/selected-images/download")
async def admin_selected_images_download(
    page: int = 1,
    page_size: int = 20,
    start_code: str | None = None,
    end_code: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
):
    rows = await _query_data_center_download_rows(
        session,
        "selected",
        page,
        page_size,
        start_code,
        end_code,
        start_time,
        end_time,
    )
    stream = _zip_stream_from_candidates(rows, "selected")
    filename = f"selected-images-{utcnow().strftime('%Y%m%d-%H%M%S')}.zip"
    return StreamingResponse(
        stream,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/admin/data-center/rejected-images/download")
async def admin_rejected_images_download(
    page: int = 1,
    page_size: int = 20,
    start_code: str | None = None,
    end_code: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
):
    rows = await _query_data_center_download_rows(
        session,
        "rejected",
        page,
        page_size,
        start_code,
        end_code,
        start_time,
        end_time,
    )
    stream = _zip_stream_from_candidates(rows, "rejected")
    filename = f"rejected-images-{utcnow().strftime('%Y%m%d-%H%M%S')}.zip"
    return StreamingResponse(
        stream,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/admin/feedback")
async def admin_get_feedback(
    limit: int = 100,
    only_open: bool = False,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    cap = max(1, min(int(limit), 200))
    stmt = select(UserFeedback)
    if only_open:
        stmt = stmt.where(UserFeedback.status == "open")
    stmt = stmt.order_by(desc(UserFeedback.created_at)).limit(cap)
    q = await session.execute(stmt)
    open_q = await session.execute(select(func.count(UserFeedback.id)).where(UserFeedback.status == "open"))
    total_q = await session.execute(select(func.count(UserFeedback.id)))
    return {
        "items": [_serialize_feedback_item(x) for x in q.scalars().all()],
        "open_count": int(open_q.scalar() or 0),
        "total_count": int(total_q.scalar() or 0),
    }


@app.post("/api/admin/feedback/{feedback_id}/resolve")
async def admin_resolve_feedback(
    feedback_id: int,
    req: FeedbackResolveRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    q = await session.execute(select(UserFeedback).where(UserFeedback.id == feedback_id))
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found")
    row.status = "resolved"
    row.admin_note = (req.note or "").strip()[:255]
    row.replied_at = utcnow()
    row.resolved_at = utcnow()
    await session.commit()
    return {"item": _serialize_feedback_item(row)}


@app.get("/api/admin/super-dashboard")
async def admin_super_dashboard(
    range_key: Literal["hour", "day", "week", "month"] = "hour",
    detail_limit: int = 200,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    return await _build_super_dashboard(session=session, range_key=range_key, detail_limit=detail_limit)


@app.get("/api/admin/stats/realtime")
async def admin_stats_realtime(_: User = Depends(require_root_user)) -> dict[str, Any]:
    data = await _admin_stats_realtime_overview()
    data["read_from"] = settings.database_read_url
    return data


@app.get("/api/admin/stats/trends")
async def admin_stats_trends(
    range_key: Literal["hour", "day", "week", "month"] = "day",
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    user_growth = await _cached_admin_user_growth(range_key)
    generation = await _cached_admin_generation_trend(range_key)
    return {
        "range_key": range_key,
        "user_growth": user_growth,
        "generation": generation,
        "read_from": settings.database_read_url,
    }


@app.get("/api/admin/stats/api-latency")
async def admin_stats_api_latency(
    range_key: Literal["hour", "day", "week", "month"] = "day",
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    latency = await _cached_admin_api_latency(range_key)
    latency["read_from"] = settings.database_read_url
    return latency


@app.get("/api/admin/stats/all")
async def admin_stats_all(
    range_key: Literal["hour", "day", "week", "month"] = "day",
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    realtime = await _admin_stats_realtime_overview()
    user_growth = await _cached_admin_user_growth(range_key)
    generation = await _cached_admin_generation_trend(range_key)
    latency = await _cached_admin_api_latency(range_key)
    return {
        "generated_at": _iso_ts(utcnow()),
        "range_key": range_key,
        "realtime": realtime,
        "user_growth": user_growth,
        "generation": generation,
        "api_latency": latency,
        "read_from": settings.database_read_url,
    }


async def _apply_moderation_ticket_decision_to_content(
    session: AsyncSession,
    ticket: ModerationTicket,
    *,
    approved: bool,
    reason: str,
) -> None:
    status_value = "approved" if approved else "hidden"
    reason_value = "" if approved else (reason or "审核驳回")[:4000]
    ctype = (ticket.content_type or "").strip()
    cid = (ticket.content_id or "").strip()

    if ctype == "community_post":
        q = await session.execute(select(CommunityPost).where(CommunityPost.id == cid))
        row = q.scalars().first()
        if row:
            row.moderation_status = status_value
            row.moderation_reason = reason_value
        return
    if ctype == "forum_question":
        q = await session.execute(select(ForumQuestion).where(ForumQuestion.id == cid))
        row = q.scalars().first()
        if row:
            row.moderation_status = status_value
            row.moderation_reason = reason_value
        return
    if ctype == "forum_answer":
        q = await session.execute(select(ForumAnswer).where(ForumAnswer.id == cid))
        row = q.scalars().first()
        if row:
            row.moderation_status = status_value
            row.moderation_reason = reason_value
        return
    if ctype == "community_comment":
        q = await session.execute(select(CommunityPostComment).where(CommunityPostComment.id == cid))
        row = q.scalars().first()
        if row:
            row.moderation_status = status_value
            row.moderation_reason = reason_value
        return


async def _ticket_owner_user_id(session: AsyncSession, ticket: ModerationTicket) -> str | None:
    ctype = (ticket.content_type or "").strip()
    cid = (ticket.content_id or "").strip()
    if ctype == "community_post":
        q = await session.execute(select(CommunityPost.owner_user_id).where(CommunityPost.id == cid))
        return q.scalar()
    if ctype == "forum_question":
        q = await session.execute(select(ForumQuestion.user_id).where(ForumQuestion.id == cid))
        return q.scalar()
    if ctype == "forum_answer":
        q = await session.execute(select(ForumAnswer.user_id).where(ForumAnswer.id == cid))
        return q.scalar()
    if ctype == "community_comment":
        q = await session.execute(select(CommunityPostComment.user_id).where(CommunityPostComment.id == cid))
        return q.scalar()
    return None


@app.get("/api/admin/moderation/tickets")
async def admin_moderation_ticket_list(
    status: str | None = None,
    content_type: str | None = None,
    page: int = 1,
    page_size: int = 20,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    safe_page, safe_page_size, offset = _normalize_pagination(page, page_size, max_page_size=100)
    stmt = select(ModerationTicket)
    if (status or "").strip():
        stmt = stmt.where(ModerationTicket.status == status.strip())
    if (content_type or "").strip():
        stmt = stmt.where(ModerationTicket.content_type == content_type.strip())
    count_q = await session.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))
    total = int(count_q.scalar() or 0)
    q = await session.execute(stmt.order_by(desc(ModerationTicket.created_at)).offset(offset).limit(safe_page_size))
    rows = q.scalars().all()
    items: list[dict[str, Any]] = []
    for row in rows:
        content_meta = await _ticket_content_meta(session, row)
        items.append(_serialize_moderation_ticket(row, content_meta=content_meta, logs=[]))
    return {"items": items, "page": safe_page, "page_size": safe_page_size, "total": total}


@app.get("/api/admin/moderation/tickets/{ticket_id}")
async def admin_moderation_ticket_detail(
    ticket_id: str,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    q = await session.execute(select(ModerationTicket).where(ModerationTicket.id == ticket_id.strip()))
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Moderation ticket not found")
    logs_q = await session.execute(
        select(ModerationTicketLog)
        .where(ModerationTicketLog.ticket_id == row.id)
        .order_by(desc(ModerationTicketLog.created_at))
        .limit(100)
    )
    logs = logs_q.scalars().all()
    content_meta = await _ticket_content_meta(session, row)
    return {"item": _serialize_moderation_ticket(row, content_meta=content_meta, logs=logs)}


@app.post("/api/admin/moderation/tickets/{ticket_id}/claim")
async def admin_moderation_ticket_claim(
    ticket_id: str,
    force: bool = False,
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(require_root_user),
) -> dict[str, Any]:
    q = await session.execute(select(ModerationTicket).where(ModerationTicket.id == ticket_id.strip()))
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Moderation ticket not found")
    if row.assigned_admin_user_id and row.assigned_admin_user_id != admin_user.id and not force:
        raise HTTPException(status_code=409, detail="Ticket already claimed by another admin")
    from_status = row.status
    row.assigned_admin_user_id = admin_user.id
    row.assigned_admin_user_name = (admin_user.display_name or admin_user.username or "")[:64]
    row.claimed_at = utcnow()
    row.updated_at = utcnow()
    await _append_moderation_ticket_log(
        session,
        row,
        action="claim",
        actor_user=admin_user,
        from_status=from_status,
        to_status=row.status,
        note="工单已认领",
        meta={"force": bool(force)},
    )
    await session.commit()
    _notify_moderation_ticket_assigned(row)
    content_meta = await _ticket_content_meta(session, row)
    return {"item": _serialize_moderation_ticket(row, content_meta=content_meta)}


@app.post("/api/admin/moderation/tickets/{ticket_id}/decision")
async def admin_moderation_ticket_decision(
    ticket_id: str,
    req: ModerationTicketDecisionRequest,
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(require_root_user),
) -> dict[str, Any]:
    q = await session.execute(select(ModerationTicket).where(ModerationTicket.id == ticket_id.strip()))
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Moderation ticket not found")
    if not _is_ticket_transition_valid(row.status, req.action):
        raise HTTPException(status_code=400, detail=f"Invalid transition: {row.status} -> {req.action}")

    from_status = row.status
    row.status = req.action
    row.assigned_admin_user_id = row.assigned_admin_user_id or admin_user.id
    row.assigned_admin_user_name = row.assigned_admin_user_name or (admin_user.display_name or admin_user.username or "")
    row.decision_reason = (req.note or "").strip()[:4000]
    row.decided_at = utcnow()
    row.updated_at = utcnow()
    await _apply_moderation_ticket_decision_to_content(
        session,
        row,
        approved=(req.action == "approved"),
        reason=row.decision_reason or ("人工审核通过" if req.action == "approved" else "人工审核驳回"),
    )
    await _append_moderation_ticket_log(
        session,
        row,
        action="decision",
        actor_user=admin_user,
        from_status=from_status,
        to_status=row.status,
        note=row.decision_reason or f"decision:{req.action}",
        meta={"action": req.action},
    )
    await session.commit()
    await _invalidate_hot_caches()
    content_meta = await _ticket_content_meta(session, row)
    return {"item": _serialize_moderation_ticket(row, content_meta=content_meta)}


@app.post("/api/moderation/tickets/{ticket_id}/appeal")
async def api_moderation_ticket_appeal(
    ticket_id: str,
    req: ModerationTicketAppealRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    q = await session.execute(select(ModerationTicket).where(ModerationTicket.id == ticket_id.strip()))
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Moderation ticket not found")
    owner_user_id = await _ticket_owner_user_id(session, row)
    if owner_user_id != user.id and not _is_root_user(user):
        raise HTTPException(status_code=403, detail="Only content owner can appeal this ticket")
    if not _is_ticket_transition_valid(row.status, "appealed"):
        raise HTTPException(status_code=400, detail=f"Invalid transition: {row.status} -> appealed")

    from_status = row.status
    row.status = "appealed"
    row.appeal_reason = req.reason.strip()[:4000]
    row.appealed_at = utcnow()
    row.updated_at = utcnow()
    await _append_moderation_ticket_log(
        session,
        row,
        action="appeal",
        actor_user=user,
        from_status=from_status,
        to_status=row.status,
        note=row.appeal_reason,
        meta={},
    )
    await session.commit()
    _notify_moderation_appeal_submitted(row)
    content_meta = await _ticket_content_meta(session, row)
    return {"item": _serialize_moderation_ticket(row, content_meta=content_meta)}


@app.post("/api/admin/moderation/tickets/{ticket_id}/final-judgment")
async def admin_moderation_ticket_final_judgment(
    ticket_id: str,
    req: ModerationTicketFinalJudgmentRequest,
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(require_root_user),
) -> dict[str, Any]:
    q = await session.execute(select(ModerationTicket).where(ModerationTicket.id == ticket_id.strip()))
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Moderation ticket not found")
    if not _is_ticket_transition_valid(row.status, "final_judgment"):
        raise HTTPException(status_code=400, detail=f"Invalid transition: {row.status} -> final_judgment")

    from_status = row.status
    row.status = "final_judgment"
    row.final_result = req.final_result
    row.decision_reason = (req.note or row.decision_reason or "").strip()[:4000]
    row.final_judged_at = utcnow()
    row.updated_at = utcnow()
    await _apply_moderation_ticket_decision_to_content(
        session,
        row,
        approved=(req.final_result == "approved"),
        reason=row.decision_reason or ("复核通过" if req.final_result == "approved" else "复核驳回"),
    )
    await _append_moderation_ticket_log(
        session,
        row,
        action="final_judgment",
        actor_user=admin_user,
        from_status=from_status,
        to_status=row.status,
        note=row.decision_reason or f"final:{req.final_result}",
        meta={"final_result": req.final_result},
    )
    await session.commit()
    await _invalidate_hot_caches()
    content_meta = await _ticket_content_meta(session, row)
    return {"item": _serialize_moderation_ticket(row, content_meta=content_meta)}


@app.post("/api/admin/export/tasks")
async def admin_create_export_task(
    req: AdminExportCreateRequest,
    session: AsyncSession = Depends(get_session),
    admin_user: User = Depends(require_root_user),
) -> dict[str, Any]:
    if not settings.export_queue_enabled:
        raise HTTPException(status_code=400, detail="Export queue is disabled")

    row = AdminExportTask(
        id=uuid.uuid4().hex,
        request_user_id=admin_user.id,
        scope=req.scope,
        file_format=req.file_format,
        status="pending",
        progress=1,
        storage_path="",
        download_token=uuid.uuid4().hex,
        error="",
        file_size=0,
        params_json=_json_dump_safe(req.filters),
        created_at=utcnow(),
        started_at=None,
        finished_at=None,
    )
    session.add(row)
    await session.commit()
    await _write_export_status_cache(row)

    dispatch_mode = "redis"
    try:
        if REDIS_AVAILABLE and REDIS_CLIENT is not None:
            await _enqueue_export_task(row)
        else:
            dispatch_mode = "local"
            _schedule_local_export_task(row)
    except Exception as exc:
        logger.warning("Failed to enqueue export task via Redis, fallback to local worker: %s", exc)
        try:
            dispatch_mode = "local"
            _schedule_local_export_task(row)
        except Exception as fallback_exc:
            row.status = "failed"
            row.progress = 100
            row.error = str(fallback_exc)[:800]
            row.finished_at = utcnow()
            await session.commit()
            await _write_export_status_cache(row)
            raise HTTPException(status_code=500, detail=f"Failed to dispatch export task: {fallback_exc}")
    return {
        "task_id": row.id,
        "status": row.status,
        "progress": int(row.progress),
        "scope": row.scope,
        "file_format": row.file_format,
        "created_at": _iso_ts(row.created_at),
        "dispatch": dispatch_mode,
    }


@app.get("/api/admin/export/tasks")
async def admin_list_export_tasks(
    limit: int = 20,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    cap = max(1, min(int(limit), 100))
    q = await session.execute(select(AdminExportTask).order_by(desc(AdminExportTask.created_at)).limit(cap))
    rows = q.scalars().all()
    return {"items": [_serialize_export_task_item(x) for x in rows]}


@app.get("/api/admin/export/status/{task_id}")
async def admin_export_status(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    cached = await redis_get_json(_export_status_cache_key(task_id.strip()))
    if isinstance(cached, dict):
        cached["download_url"] = (
            f"/api/admin/export/download/{task_id.strip()}?token={cached.get('download_token', '')}"
            if cached.get("status") == "completed"
            else None
        )
        return {"item": cached}

    q = await session.execute(select(AdminExportTask).where(AdminExportTask.id == task_id.strip()))
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Export task not found")
    await _write_export_status_cache(row)
    return {"item": _serialize_export_task_item(row)}


@app.get("/api/admin/export/tasks/{task_id}")
async def admin_export_task_detail(
    task_id: str,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    cached = await redis_get_json(_export_status_cache_key(task_id.strip()))
    if isinstance(cached, dict):
        return {"item": cached}

    q = await session.execute(select(AdminExportTask).where(AdminExportTask.id == task_id.strip()))
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Export task not found")
    await _write_export_status_cache(row)
    return {"item": _serialize_export_task_item(row)}


@app.get("/api/admin/export/download/{task_id}")
async def admin_export_download(
    task_id: str,
    token: str | None = None,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
):
    q = await session.execute(select(AdminExportTask).where(AdminExportTask.id == task_id.strip()))
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Export task not found")
    if row.status != "completed":
        raise HTTPException(status_code=409, detail="Export task not completed")
    if token and (row.download_token or "") and token.strip() != (row.download_token or ""):
        raise HTTPException(status_code=403, detail="Invalid download token")
    path = Path((row.storage_path or "").strip())
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Export file missing")
    file_name = path.name or f"inkai-export-{row.id}.xlsx"
    content = path.read_bytes()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )


@app.get("/api/notifications")
async def api_notifications_list(
    page: int = 1,
    page_size: int = 20,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    safe_page, safe_page_size, offset = _normalize_pagination(page, page_size, max_page_size=100)
    base_stmt = select(Notification).where(Notification.user_id == user.id)
    total_q = await session.execute(select(func.count()).select_from(base_stmt.order_by(None).subquery()))
    total = int(total_q.scalar() or 0)
    q = await session.execute(
        base_stmt.order_by(desc(Notification.created_at), desc(Notification.id)).offset(offset).limit(safe_page_size)
    )
    rows = q.scalars().all()
    return {
        "items": [_serialize_notification(x) for x in rows],
        "page": safe_page,
        "page_size": safe_page_size,
        "total": total,
    }


@app.get("/api/notifications/unread-count")
async def api_notifications_unread_count(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    q = await session.execute(
        select(func.count()).select_from(
            select(Notification.id)
            .where(
                Notification.user_id == user.id,
                Notification.is_read.is_(False),
            )
            .subquery()
        )
    )
    return {"unread_count": int(q.scalar() or 0)}


@app.put("/api/notifications/read-all")
async def api_notifications_read_all(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    q = await session.execute(
        select(Notification).where(
            Notification.user_id == user.id,
            Notification.is_read.is_(False),
        )
    )
    rows = q.scalars().all()
    now = utcnow()
    for row in rows:
        row.is_read = True
        if not row.created_at:
            row.created_at = now
    if rows:
        await session.commit()
    return {"updated": len(rows)}


@app.put("/api/notifications/{notification_id}/read")
async def api_notifications_mark_read(
    notification_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    q = await session.execute(
        select(Notification).where(
            Notification.id == int(notification_id),
            Notification.user_id == user.id,
        )
    )
    row = q.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    if not row.is_read:
        row.is_read = True
        await session.commit()
    return {"item": _serialize_notification(row)}


@app.get("/api/admin/api-permissions")
async def admin_get_api_permissions(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    q = await session.execute(select(ApiPermissionRule).order_by(ApiPermissionRule.path.asc()))
    rows = q.scalars().all()
    return {
        "items": [
            {
                "id": x.id,
                "path": x.path,
                "enabled": bool(x.enabled),
                "note": x.note or "",
                "updated_at": _iso_ts(x.updated_at),
            }
            for x in rows
        ]
    }


@app.put("/api/admin/api-permissions")
async def admin_put_api_permission(
    req: ApiPermissionPatchRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    path = req.path.strip()
    if not path.startswith("/api/"):
        raise HTTPException(status_code=400, detail="Permission path must start with /api/")
    q = await session.execute(select(ApiPermissionRule).where(ApiPermissionRule.path == path))
    row = q.scalars().first()
    if not row:
        row = ApiPermissionRule(path=path, enabled=req.enabled, note=(req.note or "").strip()[:255], updated_at=utcnow())
        session.add(row)
    else:
        row.enabled = req.enabled
        row.note = (req.note or row.note or "")[:255]
        row.updated_at = utcnow()
    await session.commit()
    await _reload_api_permission_cache(session)
    return {
        "item": {
            "id": row.id,
            "path": row.path,
            "enabled": bool(row.enabled),
            "note": row.note or "",
            "updated_at": _iso_ts(row.updated_at),
        }
    }


@app.patch("/api/admin/thresholds")
async def admin_patch_thresholds(
    req: ThresholdPatchRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    cfg = await _get_or_create_threshold_config(session)
    if req.api_fail_rate_threshold is not None:
        cfg.api_fail_rate_threshold = float(req.api_fail_rate_threshold)
    if req.online_surge_threshold is not None:
        cfg.online_surge_threshold = float(req.online_surge_threshold)
    if req.online_drop_threshold is not None:
        cfg.online_drop_threshold = float(req.online_drop_threshold)
    if req.refresh_interval_sec is not None:
        cfg.refresh_interval_sec = int(req.refresh_interval_sec)
    cfg.updated_at = utcnow()
    await session.commit()
    await redis_set_json(
        cache_key("sys_threshold", "singleton"),
        {
            "api_fail_rate_threshold": float(cfg.api_fail_rate_threshold),
            "online_surge_threshold": float(cfg.online_surge_threshold),
            "online_drop_threshold": float(cfg.online_drop_threshold),
            "refresh_interval_sec": int(cfg.refresh_interval_sec),
            "updated_at": _iso_ts(cfg.updated_at),
        },
        ttl_sec=300,
    )
    return {
        "thresholds": {
            "api_fail_rate_threshold": float(cfg.api_fail_rate_threshold),
            "online_surge_threshold": float(cfg.online_surge_threshold),
            "online_drop_threshold": float(cfg.online_drop_threshold),
            "refresh_interval_sec": int(cfg.refresh_interval_sec),
            "updated_at": _iso_ts(cfg.updated_at),
        }
    }


@app.get("/api/admin/operation-costs")
async def admin_get_operation_costs(_: User = Depends(require_root_user)) -> dict[str, Any]:
    return {"items": _billing_rules_snapshot()}


@app.patch("/api/admin/operation-costs")
async def admin_patch_operation_costs(
    req: BillingRulePatchRequest,
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    if req.prompt_optimize is not None:
        RUNTIME_BILLING_RULES["prompt_optimize"] = int(max(0, req.prompt_optimize))
    if req.liblibai_gen_img is not None:
        RUNTIME_BILLING_RULES["liblibai_gen_img"] = int(max(0, req.liblibai_gen_img))
    if req.deepseek_chat is not None:
        RUNTIME_BILLING_RULES["deepseek_chat"] = int(max(0, req.deepseek_chat))
    return {"items": _billing_rules_snapshot()}


@app.get("/api/admin/prompt-guard")
async def admin_get_prompt_guard(_: User = Depends(require_root_user)) -> dict[str, Any]:
    return {
        "enabled": bool(settings.prompt_guard_enabled),
        "blocked_terms": sorted(PROMPT_BLOCK_TERMS),
    }


@app.patch("/api/admin/prompt-guard")
async def admin_patch_prompt_guard(
    req: PromptGuardPatchRequest,
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    global PROMPT_BLOCK_TERMS
    if req.enabled is not None:
        settings.prompt_guard_enabled = bool(req.enabled)
    if req.blocked_terms is not None:
        terms = {x.strip().lower() for x in req.blocked_terms if (x or "").strip()}
        PROMPT_BLOCK_TERMS = terms or set(DEFAULT_PROMPT_BLOCK_TERMS)
    return {
        "enabled": bool(settings.prompt_guard_enabled),
        "blocked_terms": sorted(PROMPT_BLOCK_TERMS),
    }


@app.post("/api/admin/alerts/{alert_id}/resolve")
async def admin_resolve_alert(
    alert_id: int,
    req: AlertResolveRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    q = await session.execute(select(AlertEvent).where(AlertEvent.id == alert_id))
    alert = q.scalars().first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.status = "resolved"
    alert.resolved_at = utcnow()
    alert.resolved_note = (req.note or "").strip()[:255]
    await session.commit()
    return {"item": _serialize_alert_event(alert)}


@app.get("/api/admin/export.xlsx")
async def admin_export_xlsx(
    scope: str = "all",
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
):
    content = await _build_export_workbook(session, scope=scope)
    filename = f"inkai-super-dashboard-{scope}-{utcnow().strftime('%Y%m%d-%H%M%S')}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/auth/send-code", response_model=SendCodeResponse)
async def api_auth_send_code(
    req: SendCodeRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> SendCodeResponse:
    email = req.email.strip().lower()
    if not re.fullmatch(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", email):
        raise HTTPException(status_code=400, detail="邮箱格式错误")

    if settings.turnstile_enabled:
        client_ip = _client_ip_from_request(request)
        if not await verify_turnstile(req.captcha_token or "", client_ip):
            raise HTTPException(status_code=400, detail="人机验证失败，请重试")

    code = generate_email_code(6)
    session.add(
        EmailCode(
            email=email,
            purpose=req.purpose,
            code=code,
            expires_at=utcnow() + timedelta(minutes=5),
            consumed=False,
        )
    )
    await session.commit()

    email_sent = send_email_code(email, code)
    if not email_sent and not settings.auth_debug_return_sms_code:
        raise HTTPException(status_code=500, detail="验证码发送失败")

    return SendCodeResponse(
        ok=True,
        message="验证码已发送到您的邮箱",
        dev_code=code if settings.auth_debug_return_sms_code else None,
    )


@app.post("/api/auth/register", response_model=TokenPairResponse)
async def api_auth_register(
    req: RegisterRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenPairResponse:
    username = req.username.strip()
    email = req.email.strip().lower()
    password = req.password.strip()
    display_name = (req.display_name or "").strip() or username
    if not username:
        raise HTTPException(status_code=400, detail="账户名不能为空")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    if not re.fullmatch(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", email):
        raise HTTPException(status_code=400, detail="邮箱格式错误")
    if settings.turnstile_enabled:
        client_ip = _client_ip_from_request(request)
        if not await verify_turnstile(req.captcha_token or "", client_ip):
            raise HTTPException(status_code=400, detail="人机验证失败，请重试")

    q = await session.execute(select(User).where(or_(User.username == username, User.email == email)))
    if q.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="账户名或邮箱已存在")

    await consume_email_code(session, email, "register", req.code.strip())

    user = User(
        id=uuid.uuid4().hex,
        username=username,
        email=email,
        display_name=display_name,
        password_hash=hash_password(password),
        is_active=True,
        credits_balance=INITIAL_USER_CREDITS,
    )

    if supertokens_enabled():
        await create_supertokens_credentials(user, password)

    session.add(user)
    await session.commit()
    await session.refresh(user)

    access_token, refresh_token, refresh_jti, refresh_exp = _issue_token_pair(user.id)
    await persist_refresh_session(session, user.id, refresh_jti, refresh_exp)
    return TokenPairResponse(access_token=access_token, refresh_token=refresh_token, user=user_view(user))


@app.post("/api/auth/login/password", response_model=TokenPairResponse)
async def api_auth_login_password(
    req: LoginPasswordRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenPairResponse:
    account = req.account.strip()
    password = req.password.strip()

    if settings.turnstile_enabled:
        client_ip = _client_ip_from_request(request)
        if not await verify_turnstile(req.captcha_token or "", client_ip):
            raise HTTPException(status_code=400, detail="人机验证失败，请重试")

    if not account or not password:
        raise HTTPException(status_code=400, detail="账号和密码不能为空")

    account_lc = account.lower()
    filters = [User.username == account]
    if "@" in account:
        filters.append(User.email == account_lc)
    if account == settings.root_username:
        filters.append(User.id == ROOT_USER_ID)

    q = await session.execute(select(User).where(or_(*filters)))
    user = q.scalar_one_or_none()

    # Root fallback for legacy databases / out-of-sync password hash.
    if account == settings.root_username and password == settings.root_password:
        if not user:
            user = User(
                id=ROOT_USER_ID,
                username=settings.root_username,
                email=None,
                display_name=settings.root_username,
                password_hash=hash_password(settings.root_password),
                is_active=True,
                credits_balance=INITIAL_USER_CREDITS,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
        else:
            user.username = settings.root_username
            user.display_name = settings.root_username
            user.password_hash = hash_password(settings.root_password)
            user.is_active = True
            if user.credits_balance is None:
                user.credits_balance = INITIAL_USER_CREDITS
            await session.commit()
            await session.refresh(user)

        access_token, refresh_token, refresh_jti, refresh_exp = _issue_token_pair(user.id)
        await persist_refresh_session(session, user.id, refresh_jti, refresh_exp)
        return TokenPairResponse(access_token=access_token, refresh_token=refresh_token, user=user_view(user))

    if not user:
        raise HTTPException(status_code=401, detail="账号或密码错误")

    if supertokens_enabled() and (user.supertokens_email or "").strip():
        password_ok = await verify_password_with_supertokens(user, password)
    else:
        password_ok = verify_password(password, user.password_hash)
        if password_ok and supertokens_enabled():
            await ensure_supertokens_credentials(session, user, password)

    if not password_ok:
        raise HTTPException(status_code=401, detail="账号或密码错误")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="账号已停用")

    access_token, refresh_token, refresh_jti, refresh_exp = _issue_token_pair(user.id)
    await persist_refresh_session(session, user.id, refresh_jti, refresh_exp)
    return TokenPairResponse(access_token=access_token, refresh_token=refresh_token, user=user_view(user))


@app.post("/api/auth/login/email", response_model=TokenPairResponse)
async def api_auth_login_email(
    req: LoginEmailRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenPairResponse:
    email = req.email.strip().lower()
    if settings.turnstile_enabled:
        client_ip = _client_ip_from_request(request)
        if not await verify_turnstile(req.captcha_token or "", client_ip):
            raise HTTPException(status_code=400, detail="人机验证失败，请重试")
    await consume_email_code(session, email, "login", req.code.strip())
    q = await session.execute(select(User).where(User.email == email))
    user = q.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="邮箱未注册")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="账号已停用")

    access_token, refresh_token, refresh_jti, refresh_exp = _issue_token_pair(user.id)
    await persist_refresh_session(session, user.id, refresh_jti, refresh_exp)
    return TokenPairResponse(access_token=access_token, refresh_token=refresh_token, user=user_view(user))


@app.post("/api/auth/login/oauth-mock", response_model=TokenPairResponse)
async def api_auth_login_oauth_mock(
    req: LoginOAuthMockRequest,
    session: AsyncSession = Depends(get_session),
    _: None = Depends(require_admin),
) -> TokenPairResponse:
    open_id = (req.open_id or f"{req.provider}_{uuid.uuid4().hex[:10]}").strip()
    username = f"{req.provider}_{open_id}"

    q = await session.execute(select(User).where(User.username == username))
    user = q.scalar_one_or_none()
    if not user:
        user = User(
            id=uuid.uuid4().hex,
            username=username,
            email=None,
            display_name="QQ用户" if req.provider == "qq" else "微信用户",
            password_hash=hash_password(uuid.uuid4().hex),
            is_active=True,
            credits_balance=INITIAL_USER_CREDITS,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

    access_token, refresh_token, refresh_jti, refresh_exp = _issue_token_pair(user.id)
    await persist_refresh_session(session, user.id, refresh_jti, refresh_exp)
    return TokenPairResponse(access_token=access_token, refresh_token=refresh_token, user=user_view(user))


@app.post("/api/auth/refresh", response_model=TokenPairResponse)
async def api_auth_refresh(req: RefreshRequest, session: AsyncSession = Depends(get_session)) -> TokenPairResponse:
    data = _decode_token(req.refresh_token, "refresh")
    user_id = str(data.get("sub", "")).strip()
    token_jti = str(data.get("jti", "")).strip()
    if not user_id or not token_jti:
        raise HTTPException(status_code=401, detail="Invalid refresh token payload")

    q = await session.execute(
        select(RefreshSession).where(
            RefreshSession.user_id == user_id,
            RefreshSession.token_jti == token_jti,
            RefreshSession.revoked.is_(False),
            RefreshSession.expires_at > utcnow(),
        )
    )
    sess = q.scalar_one_or_none()
    if not sess:
        raise HTTPException(status_code=401, detail="Refresh session expired or revoked")

    uq = await session.execute(select(User).where(User.id == user_id))
    user = uq.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User unavailable")

    sess.revoked = True
    access_token, refresh_token, refresh_jti, refresh_exp = _issue_token_pair(user.id)
    session.add(RefreshSession(user_id=user.id, token_jti=refresh_jti, expires_at=refresh_exp, revoked=False))
    await session.commit()
    await redis_delete(cache_key("session_refresh", token_jti))
    await redis_set_json(
        cache_key("session_refresh", refresh_jti),
        {"user_id": user.id, "expires_at": _iso_ts(refresh_exp)},
        ttl_sec=max(60, int((refresh_exp - utcnow()).total_seconds())),
    )
    return TokenPairResponse(access_token=access_token, refresh_token=refresh_token, user=user_view(user))


@app.post("/api/auth/logout")
async def api_auth_logout(req: LogoutRequest, session: AsyncSession = Depends(get_session)) -> dict[str, bool]:
    if req.refresh_token:
        try:
            data = _decode_token(req.refresh_token, "refresh")
            token_jti = str(data.get("jti", "")).strip()
            if token_jti:
                q = await session.execute(select(RefreshSession).where(RefreshSession.token_jti == token_jti))
                sess = q.scalar_one_or_none()
                if sess:
                    sess.revoked = True
                    await session.commit()
                await redis_delete(cache_key("session_refresh", token_jti))
        except HTTPException:
            pass
    return {"ok": True}


@app.get("/api/auth/me", response_model=AuthUserView)
async def api_auth_me(user: User = Depends(get_current_user)) -> AuthUserView:
    return user_view(user)


@app.patch("/api/auth/me", response_model=AuthUserView)
async def api_auth_update_me(
    req: UpdateProfileRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> AuthUserView:
    display_name = req.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="昵称不能为空")
    user.display_name = display_name
    await session.commit()
    await session.refresh(user)
    return user_view(user)


@app.post("/api/auth/me/password")
async def api_auth_change_password(
    req: ChangePasswordRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    if not verify_password(req.old_password.strip(), user.password_hash):
        raise HTTPException(status_code=400, detail="旧密码不正确")
    new_pw = req.new_password.strip()
    if len(new_pw) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")

    if supertokens_enabled():
        old_pw = req.old_password.strip()
        if (user.supertokens_email or "").strip():
            password_ok = await verify_password_with_supertokens(user, old_pw)
            if not password_ok:
                raise HTTPException(status_code=400, detail="旧密码不正确")
        else:
            await ensure_supertokens_credentials(session, user, old_pw)
        await update_password_with_supertokens(user, new_pw)

    user.password_hash = hash_password(new_pw)
    q = await session.execute(select(RefreshSession).where(RefreshSession.user_id == user.id))
    for s in q.scalars().all():
        s.revoked = True
    await session.commit()
    return {"ok": True}


async def deepseek_chat(req: DeepSeekChatRequest) -> str:
    if not settings.deepseek_api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is empty")
    url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.deepseek_model,
        "messages": [m.model_dump() for m in req.messages],
        "temperature": 0.7,
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, json=payload)
    if resp.status_code >= 400:
        raise RuntimeError(f"DeepSeek API {resp.status_code}: {resp.text}")
    data = resp.json()
    return (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""


def _pick_images(data: Any) -> list[str]:
    candidates: list[Any] = []
    if isinstance(data, dict):
        candidates.extend(
            [
                data.get("images"),
                data.get("data", {}).get("images") if isinstance(data.get("data"), dict) else None,
                data.get("result", {}).get("images") if isinstance(data.get("result"), dict) else None,
            ]
        )
    for item in candidates:
        if isinstance(item, list):
            out: list[str] = []
            for x in item:
                if isinstance(x, str):
                    v = x.strip()
                    if v:
                        out.append(v)
                elif isinstance(x, dict):
                    for key in ("imageUrl", "imageBase64", "url", "base64"):
                        v = x.get(key)
                        if isinstance(v, str) and v.strip():
                            out.append(v.strip())
                            break
            if out:
                return out
    return []


def _liblibai_sign_params(endpoint: str) -> dict[str, str]:
    ts = str(int(time.time() * 1000))
    nonce = "".join(random.choices(string.ascii_letters + string.digits, k=16))
    sign_src = f"{endpoint}&{ts}&{nonce}"
    sign = base64.urlsafe_b64encode(
        hmac.new(settings.liblibai_secret_key.encode("utf-8"), sign_src.encode("utf-8"), hashlib.sha1).digest()
    ).decode("utf-8").rstrip("=")
    return {
        "AccessKey": settings.liblibai_access_key,
        "Signature": sign,
        "Timestamp": ts,
        "SignatureNonce": nonce,
    }


async def liblibai_gen_images(payload: dict[str, Any]) -> list[str]:
    if not settings.liblibai_base_url or not settings.liblibai_access_key or not settings.liblibai_secret_key:
        raise RuntimeError("LIBLIBAI_BASE_URL / LIBLIBAI_ACCESS_KEY / LIBLIBAI_SECRET_KEY must be set")

    endpoint = f"/{settings.liblibai_uri.lstrip('/')}"
    url = f"{settings.liblibai_base_url.rstrip('/')}{endpoint}"
    headers = {"Content-Type": "application/json"}
    params = _liblibai_sign_params(endpoint)

    prompt = str(payload.get("prompt", "")).strip()
    img_count = max(1, min(int(payload.get("n", 1)), 4))
    req_body = {
        "templateUuid": settings.liblibai_template_uuid,
        "generateParams": {
            "prompt": prompt,
            "steps": settings.liblibai_steps,
            "width": settings.liblibai_width,
            "height": settings.liblibai_height,
            "imgCount": img_count,
            "seed": -1,
            "restoreFaces": 0,
        },
    }
    async with httpx.AsyncClient(timeout=settings.liblibai_timeout_sec) as client:
        resp = await client.post(url, headers=headers, params=params, json=req_body)
    if resp.status_code >= 400:
        raise RuntimeError(f"liblibai API {resp.status_code}: {resp.text}")

    data = resp.json()
    images = _pick_images(data)
    if images:
        return images

    if not (isinstance(data, dict) and data.get("code") == 0 and isinstance(data.get("data"), dict)):
        raise RuntimeError(f"liblibai unexpected response: {data}")
    generate_uuid = str(data["data"].get("generateUuid", "")).strip()
    if not generate_uuid:
        raise RuntimeError(f"liblibai generateUuid missing: {data}")

    status_endpoint = f"/{settings.liblibai_status_uri.lstrip('/')}"
    status_url = f"{settings.liblibai_base_url.rstrip('/')}{status_endpoint}"
    deadline = time.time() + settings.liblibai_timeout_sec
    async with httpx.AsyncClient(timeout=30) as client:
        while time.time() < deadline:
            status_resp = await client.post(
                status_url,
                headers=headers,
                params=_liblibai_sign_params(status_endpoint),
                json={"generateUuid": generate_uuid},
            )
            if status_resp.status_code >= 400:
                raise RuntimeError(f"liblibai status API {status_resp.status_code}: {status_resp.text}")
            status_data = status_resp.json()
            status_images = _pick_images(status_data)
            if status_images:
                return status_images
            percent = 0.0
            if isinstance(status_data, dict) and isinstance(status_data.get("data"), dict):
                percent = float(status_data["data"].get("percentCompleted", 0) or 0)
            if percent >= 1.0:
                break
            await asyncio.sleep(3)
    raise RuntimeError("liblibai generation timeout or no images returned")


async def _optimize_prompt_text(raw_prompt: str) -> str:
    _ensure_prompt_allowed(raw_prompt)
    sys = (
        "你是提示词工程师，专门为中国水墨+可计算数字绘画生成专业 Artistic Prompt。"
        "输出为中文为主，夹带必要英文关键词。"
        "请给：\n1) 一段精炼主提示词（含风格/构图/技法/光影/材质）"
        "\n2) 关键词列表（逗号分隔）\n3) 建议负面词（逗号分隔）"
    )
    chat_req = DeepSeekChatRequest(
        messages=[
            DeepSeekChatMessage(role="system", content=sys),
            DeepSeekChatMessage(role="user", content=f"用户原始描述：\n{raw_prompt}"),
        ]
    )
    return await deepseek_chat(chat_req)


@app.post("/api/deepseek/chat")
async def api_deepseek_chat(
    req: DeepSeekChatRequest,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_optional_user),
) -> dict[str, str]:
    try:
        content = await deepseek_chat(req)
        if user is not None:
            await _charge_operation_credits(
                session=session,
                user=user,
                operation="deepseek_chat",
                note="deepseek_chat",
            )
            await session.commit()
        return {"content": content}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/prompt/optimize")
async def api_prompt_optimize(
    req: PromptOptimizeRequest,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_optional_user),
) -> dict[str, str]:
    try:
        content = await _optimize_prompt_text(req.raw_prompt)
        if user is not None:
            await _charge_operation_credits(
                session=session,
                user=user,
                operation="prompt_optimize",
                note="prompt_optimize",
            )
            await session.commit()
        return {"artistic_prompt": content}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/public/deepseek/chat")
async def api_public_deepseek_chat(req: DeepSeekChatRequest) -> dict[str, str]:
    try:
        content = await deepseek_chat(req)
        return {"content": content}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/public/prompt/optimize")
async def api_public_prompt_optimize(req: PromptOptimizeRequest) -> dict[str, str]:
    try:
        content = await _optimize_prompt_text(req.raw_prompt)
        return {"artistic_prompt": content}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/liblibai/ping")
async def api_liblibai_ping(_: User = Depends(get_current_user)) -> dict[str, Any]:
    return {
        "ok": True,
        "liblibai_base_url": settings.liblibai_base_url,
        "liblibai_uri": settings.liblibai_uri,
        "access_configured": bool(settings.liblibai_access_key),
        "secret_configured": bool(settings.liblibai_secret_key),
    }


@app.get("/api/billing/me", response_model=BillingMeResponse)
async def billing_me(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> BillingMeResponse:
    q = await session.execute(select(Subscription).where(Subscription.user_id == user.id))
    sub = q.scalar_one_or_none()
    return BillingMeResponse(
        user_id=user.id,
        credits_balance=user.credits_balance,
        subscription_mode=sub.mode if sub else None,
        subscription_plan_key=sub.plan_key if sub else None,
    )


@app.post("/api/billing/subscribe")
async def billing_subscribe(
    req: SubscribeRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    qs = await session.execute(select(Subscription).where(Subscription.user_id == user.id))
    sub = qs.scalar_one_or_none()
    if not sub:
        sub = Subscription(user_id=user.id, mode=req.mode, plan_key=req.plan_key, active=True)
        session.add(sub)
    else:
        sub.mode = req.mode
        sub.plan_key = req.plan_key
        sub.active = True
    await session.commit()
    return {"ok": True}


@app.post("/api/billing/topup")
async def billing_topup(
    req: TopUpRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    user.credits_balance += req.amount
    session.add(CreditLedger(user_id=user.id, type="topup", amount=req.amount, note=req.note or ""))
    await session.commit()
    await redis_set_json(cache_key("user_credit", user.id), {"credits_balance": int(user.credits_balance or 0)}, ttl_sec=120)
    return {"ok": True, "credits_balance": user.credits_balance}


@app.post("/api/liblibai/gen-img", response_model=LiblibaiGenResponse)
async def api_liblibai_gen(
    req: LiblibaiGenRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LiblibaiGenResponse:
    unit_cost = int(RUNTIME_BILLING_RULES.get("liblibai_gen_img", 0))
    if unit_cost > 0 and int(user.credits_balance or 0) < unit_cost:
        raise HTTPException(
            status_code=402,
            detail=f"Insufficient credits. Needed {unit_cost}, current {int(user.credits_balance or 0)}.",
        )

    _ensure_prompt_allowed(req.raw_prompt)
    image_count = max(1, min(int(req.n), 4))

    if settings.generation_queue_enabled and REDIS_AVAILABLE:
        generation_task_id = uuid.uuid4().hex
        now = utcnow()
        task_row = ImageGenerationTask(
            id=generation_task_id,
            user_id=user.id,
            raw_prompt=req.raw_prompt,
            artistic_prompt="",
            created_at=now,
            selected_candidate_id=None,
            status="queued",
            progress=1,
            failure_reason="",
            retry_count=0,
            max_retries=settings.generation_queue_max_retry,
            queue_message_id=None,
            queued_at=now,
            started_at=None,
            finished_at=None,
            updated_at=now,
            paused=False,
            cancelled=False,
        )
        session.add(task_row)
        await session.commit()
        try:
            msg_id = await _enqueue_generation_task(task_row, image_count)
            task_row.queue_message_id = msg_id
            task_row.updated_at = utcnow()
            await session.commit()
            await _set_generation_progress(task_row.id, "queued", 1, message="queued")
            result_payload = await _wait_for_generation_result(task_row.id, user.id)
            return LiblibaiGenResponse(**result_payload)
        except HTTPException:
            raise
        except Exception as exc:
            task_row.status = "failed"
            task_row.progress = 100
            task_row.failure_reason = str(exc)[:800]
            task_row.finished_at = utcnow()
            task_row.updated_at = utcnow()
            await session.commit()
            await _set_generation_progress(task_row.id, "failed", 100, failure_reason=str(exc)[:500])
            raise HTTPException(status_code=500, detail=f"generation queue failed: {exc}")

    try:
        artistic = await _optimize_prompt_text(req.raw_prompt)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    used_prompt = artistic

    payload = {"prompt": used_prompt, "n": image_count}
    monitor_task_id, monitor_started = _track_task_start("liblibai_gen", context=f"user={user.id}")
    try:
        images = await liblibai_gen_images(payload)
        _track_task_end("liblibai_gen", monitor_task_id, monitor_started, ok=True)
    except Exception as exc:
        _track_task_end("liblibai_gen", monitor_task_id, monitor_started, ok=False, error=str(exc))
        raise HTTPException(status_code=500, detail=f"liblibai generation failed: {exc}")

    await _charge_operation_credits(
        session=session,
        user=user,
        operation="liblibai_gen_img",
        note=f"liblibai_gen:{len(images)}",
    )

    generation_task_id = uuid.uuid4().hex
    now = utcnow()
    task_row = ImageGenerationTask(
        id=generation_task_id,
        user_id=user.id,
        raw_prompt=req.raw_prompt,
        artistic_prompt=artistic,
        created_at=now,
        selected_candidate_id=None,
        status="completed",
        progress=100,
        failure_reason="",
        retry_count=0,
        max_retries=settings.generation_queue_max_retry,
        queue_message_id=None,
        queued_at=now,
        started_at=now,
        finished_at=now,
        updated_at=now,
        paused=False,
        cancelled=False,
    )
    session.add(task_row)

    candidate_ids: list[str] = []
    candidate_indexes: list[int] = []
    for idx, image_value in enumerate(images, start=1):
        candidate_id = uuid.uuid4().hex
        candidate_ids.append(candidate_id)
        candidate_indexes.append(idx)
        session.add(
            ImageGenerationCandidate(
                id=candidate_id,
                task_id=generation_task_id,
                user_id=user.id,
                candidate_index=idx,
                data_url=(image_value or "").strip(),
                created_at=utcnow(),
                image_code=None,
                image_bucket=None,
                assigned_seq=None,
                assigned_at=None,
            )
        )

    session.add(
        GenerationRecord(
            user_id=user.id,
            raw_prompt=req.raw_prompt,
            artistic_prompt=artistic,
            provider="liblibai",
        )
    )
    await session.commit()
    day_key = utcnow().strftime("%Y%m%d")
    hour_key = utcnow().strftime("%Y%m%d%H")
    await redis_incr(_counter_key("generation_images_day", day_key), amount=len(images), ttl_sec=90 * 24 * 3600)
    await redis_incr(_counter_key("generation_images_hour", hour_key), amount=len(images), ttl_sec=14 * 24 * 3600)
    await redis_incr(_counter_key("generation_task_day", day_key), amount=1, ttl_sec=90 * 24 * 3600)

    result_payload = {
        "images": images,
        "artistic_prompt": artistic,
        "used_prompt": used_prompt,
        "generation_task_id": generation_task_id,
        "candidate_ids": candidate_ids,
        "candidate_indexes": candidate_indexes,
        "meta": {"liblibai_base_url": settings.liblibai_base_url, "liblibai_uri": settings.liblibai_uri},
    }
    await redis_set_json(_task_result_cache_key(generation_task_id), result_payload, ttl_sec=3600)
    await _set_generation_progress(generation_task_id, "completed", 100, message="completed")
    return LiblibaiGenResponse(**result_payload)
