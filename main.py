import asyncio
import base64
import hashlib
import hmac
import json
import os
import random
import re
import string
import time
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from html import escape as xml_escape
from io import BytesIO
from pathlib import Path
from typing import Any, Literal
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import desc, func, inspect, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db import init_db, make_engine, make_session
from models import (
    AlertEvent,
    AlertThresholdConfig,
    ApiCallLog,
    ApiPermissionRule,
    CreditLedger,
    GenerationRecord,
    OnlineSnapshot,
    RefreshSession,
    SmsCode,
    Subscription,
    User,
    UserOnlineSession,
    VisitorProfile,
    WebsiteVisitLog,
)

try:
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env", override=False)
except Exception:
    pass


def utcnow() -> datetime:
    return datetime.utcnow()


EPOCH_UTC_NAIVE = datetime(1970, 1, 1)


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


class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    database_url: str = Field(default_factory=lambda: os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./inkai.db"))
    cors_allow_origins: list[str] = Field(
        default_factory=lambda: [
            x.strip()
            for x in os.getenv("CORS_ALLOW_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",")
            if x.strip()
        ]
    )

    backend_admin_token: str = Field(default_factory=lambda: os.getenv("BACKEND_ADMIN_TOKEN", "").strip())
    demo_user_id: str = Field(default_factory=lambda: os.getenv("DEMO_USER_ID", "demo-user"))

    jwt_secret_key: str = Field(default_factory=lambda: os.getenv("JWT_SECRET_KEY", "change-this-in-production"))
    jwt_algorithm: str = Field(default_factory=lambda: os.getenv("JWT_ALGORITHM", "HS256"))
    jwt_access_exp_minutes: int = Field(default_factory=lambda: int(os.getenv("JWT_ACCESS_EXP_MINUTES", "15")))
    jwt_refresh_exp_days: int = Field(default_factory=lambda: int(os.getenv("JWT_REFRESH_EXP_DAYS", "14")))

    auth_debug_return_sms_code: bool = Field(
        default_factory=lambda: os.getenv("AUTH_DEBUG_RETURN_SMS_CODE", "true").lower() == "true"
    )
    root_username: str = Field(default_factory=lambda: os.getenv("ROOT_USERNAME", "root"))
    root_password: str = Field(default_factory=lambda: os.getenv("ROOT_PASSWORD", "Yangfan724@"))

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


settings = Settings()
engine = make_engine(settings.database_url)
SessionLocal = make_session(engine)

ROOT_USER_ID = "root"
ONLINE_ACTIVE_SECONDS = 90
ALERT_DEDUPE_SECONDS = 120
API_BREAKER_FAILURE_STREAK = 5
API_BREAKER_OPEN_SECONDS = 30

API_PERMISSION_CACHE: dict[str, bool] = {}
API_BREAKER_STATE: dict[str, dict[str, Any]] = {}


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
    phone: str | None = None
    created_at: datetime


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: AuthUserView


class SendCodeRequest(BaseModel):
    phone: str
    purpose: Literal["register", "login"]


class SendCodeResponse(BaseModel):
    ok: bool
    message: str
    dev_code: str | None = None


class RegisterRequest(BaseModel):
    username: str
    phone: str
    code: str
    password: str
    display_name: str | None = None


class LoginPasswordRequest(BaseModel):
    account: str
    password: str


class LoginSmsRequest(BaseModel):
    phone: str
    code: str


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
    meta: dict[str, Any]


class BillingMeResponse(BaseModel):
    user_id: str
    credits_balance: int
    subscription_mode: str | None = None
    subscription_plan_key: str | None = None


class SubscribeRequest(BaseModel):
    mode: Literal["usage", "bundle"]
    plan_key: str


class TopUpRequest(BaseModel):
    amount: int = Field(gt=0)
    note: str | None = None


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
        try:
            response = await call_next(request)
        except Exception as exc:  # pragma: no cover - still logged at runtime
            captured_exception = exc
            captured_error = str(exc)

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
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    q = await session.execute(select(User).where(User.id == user_id))
    user = q.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


async def require_root_user(user: User = Depends(get_current_user)) -> User:
    if not _is_root_user(user):
        raise HTTPException(status_code=403, detail="Only root can access this resource")
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
            add_col("display_name", _dialect_type_varchar(dialect, 64), "DEFAULT ''", False)
            add_col("password_hash", "TEXT", "DEFAULT ''", False)
            add_col("is_active", "BOOLEAN", "DEFAULT 1", False)

            for idx_name, idx_sql in [
                ("ix_users_username", "CREATE INDEX ix_users_username ON users (username)"),
                ("ix_users_phone", "CREATE INDEX ix_users_phone ON users (phone)"),
            ]:
                idxs = {i["name"] for i in insp.get_indexes("users")}
                if idx_name not in idxs:
                    sync_conn.execute(text(idx_sql))

        await conn.run_sync(_sync_migrate)


def user_view(user: User) -> AuthUserView:
    return AuthUserView(
        id=user.id,
        username=user.username,
        display_name=user.display_name or user.username,
        phone=user.phone,
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


async def consume_sms_code(session: AsyncSession, phone: str, purpose: str, code: str) -> None:
    q = await session.execute(
        select(SmsCode)
        .where(
            SmsCode.phone == phone,
            SmsCode.purpose == purpose,
            SmsCode.consumed.is_(False),
            SmsCode.expires_at > utcnow(),
        )
        .order_by(desc(SmsCode.created_at))
    )
    rec = q.scalar_one_or_none()
    if not rec or rec.code != code:
        raise HTTPException(status_code=400, detail="验证码无效或已过期")
    rec.consumed = True
    await session.commit()


DEFAULT_PERMISSION_RULES: list[tuple[str, str]] = [
    ("/api/deepseek/chat", "DeepSeek chat"),
    ("/api/prompt/optimize", "Prompt optimizer"),
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
    q_details = await session.execute(select(ApiCallLog).order_by(desc(ApiCallLog.created_at)).limit(detail_limit))
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
    await session.commit()

    alerts = await _collect_alerts(session, cfg)
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
        },
        "api": api_data,
        "online": online_data,
        "traffic": traffic_data,
        "alerts": alerts,
    }


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
                        u.phone or "",
                        1 if u.is_active else 0,
                        int(u.credits_balance or 0),
                        _iso_ts(u.created_at),
                    ]
                    for u in users
                ],
            )
        )

    if not sheets:
        raise HTTPException(status_code=400, detail="Invalid export scope")
    return _build_xlsx_bytes(sheets)


@app.on_event("startup")
async def _startup() -> None:
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
                        display_name=display_name,
                        phone=None,
                        password_hash=password_hash,
                        is_active=True,
                        credits_balance=1200,
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
                    u.credits_balance = 1200
        await s.commit()
        await _ensure_monitoring_seed_data(s)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "deepseek_configured": bool(settings.deepseek_api_key),
        "liblibai_configured": bool(settings.liblibai_base_url),
        "database_url": settings.database_url,
        "demo_user_id": settings.demo_user_id,
        "liblibai_base_url": settings.liblibai_base_url,
        "liblibai_uri": settings.liblibai_uri,
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
    return {"ok": True, "session_id": session_id, "server_time": _iso_ts(now)}


@app.get("/api/admin/super-dashboard")
async def admin_super_dashboard(
    range_key: Literal["hour", "day", "week", "month"] = "hour",
    detail_limit: int = 200,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_root_user),
) -> dict[str, Any]:
    return await _build_super_dashboard(session=session, range_key=range_key, detail_limit=detail_limit)


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
    return {
        "thresholds": {
            "api_fail_rate_threshold": float(cfg.api_fail_rate_threshold),
            "online_surge_threshold": float(cfg.online_surge_threshold),
            "online_drop_threshold": float(cfg.online_drop_threshold),
            "refresh_interval_sec": int(cfg.refresh_interval_sec),
            "updated_at": _iso_ts(cfg.updated_at),
        }
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
async def api_auth_send_code(req: SendCodeRequest, session: AsyncSession = Depends(get_session)) -> SendCodeResponse:
    phone = normalize_phone(req.phone)
    if not re.fullmatch(r"1\d{10}", phone):
        raise HTTPException(status_code=400, detail="手机号格式错误")
    code = str(random.randint(100000, 999999))
    session.add(
        SmsCode(
            phone=phone,
            purpose=req.purpose,
            code=code,
            expires_at=utcnow() + timedelta(minutes=5),
            consumed=False,
        )
    )
    await session.commit()
    return SendCodeResponse(
        ok=True,
        message="验证码已发送",
        dev_code=code if settings.auth_debug_return_sms_code else None,
    )


@app.post("/api/auth/register", response_model=TokenPairResponse)
async def api_auth_register(req: RegisterRequest, session: AsyncSession = Depends(get_session)) -> TokenPairResponse:
    username = req.username.strip()
    phone = normalize_phone(req.phone)
    password = req.password.strip()
    display_name = (req.display_name or "").strip() or username
    if not username:
        raise HTTPException(status_code=400, detail="账户名不能为空")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    if not re.fullmatch(r"1\d{10}", phone):
        raise HTTPException(status_code=400, detail="手机号格式错误")

    q = await session.execute(select(User).where(or_(User.username == username, User.phone == phone)))
    if q.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="账户名或手机号已存在")

    await consume_sms_code(session, phone, "register", req.code.strip())

    user = User(
        id=uuid.uuid4().hex,
        username=username,
        phone=phone,
        display_name=display_name,
        password_hash=hash_password(password),
        is_active=True,
        credits_balance=1200,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    access_token, refresh_token, refresh_jti, refresh_exp = _issue_token_pair(user.id)
    await persist_refresh_session(session, user.id, refresh_jti, refresh_exp)
    return TokenPairResponse(access_token=access_token, refresh_token=refresh_token, user=user_view(user))


@app.post("/api/auth/login/password", response_model=TokenPairResponse)
async def api_auth_login_password(req: LoginPasswordRequest, session: AsyncSession = Depends(get_session)) -> TokenPairResponse:
    account = req.account.strip()
    password = req.password.strip()
    q = await session.execute(select(User).where(or_(User.username == account, User.phone == normalize_phone(account))))
    user = q.scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="账号已停用")

    access_token, refresh_token, refresh_jti, refresh_exp = _issue_token_pair(user.id)
    await persist_refresh_session(session, user.id, refresh_jti, refresh_exp)
    return TokenPairResponse(access_token=access_token, refresh_token=refresh_token, user=user_view(user))


@app.post("/api/auth/login/sms", response_model=TokenPairResponse)
async def api_auth_login_sms(req: LoginSmsRequest, session: AsyncSession = Depends(get_session)) -> TokenPairResponse:
    phone = normalize_phone(req.phone)
    await consume_sms_code(session, phone, "login", req.code.strip())
    q = await session.execute(select(User).where(User.phone == phone))
    user = q.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="手机号未注册")
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
            phone=None,
            display_name="QQ用户" if req.provider == "qq" else "微信用户",
            password_hash=hash_password(uuid.uuid4().hex),
            is_active=True,
            credits_balance=1200,
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


@app.post("/api/deepseek/chat")
async def api_deepseek_chat(req: DeepSeekChatRequest, _: User = Depends(get_current_user)) -> dict[str, str]:
    try:
        content = await deepseek_chat(req)
        return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/prompt/optimize")
async def api_prompt_optimize(req: PromptOptimizeRequest, _: User = Depends(get_current_user)) -> dict[str, str]:
    sys = (
        "你是提示词工程师，专门为中国水墨+可计算数字绘画生成专业 Artistic Prompt。"
        "输出为中文为主，夹带必要英文关键词。"
        "请给：\n1) 一段精炼主提示词（含风格/构图/技法/光影/材质）"
        "\n2) 关键词列表（逗号分隔）\n3) 建议负面词（逗号分隔）"
    )
    chat_req = DeepSeekChatRequest(
        messages=[
            DeepSeekChatMessage(role="system", content=sys),
            DeepSeekChatMessage(role="user", content=f"用户原始描述：\n{req.raw_prompt}"),
        ]
    )
    try:
        content = await deepseek_chat(chat_req)
        return {"artistic_prompt": content}
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
    return {"ok": True, "credits_balance": user.credits_balance}


@app.post("/api/liblibai/gen-img", response_model=LiblibaiGenResponse)
async def api_liblibai_gen(
    req: LiblibaiGenRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> LiblibaiGenResponse:
    prompt_resp = await api_prompt_optimize(req=PromptOptimizeRequest(raw_prompt=req.raw_prompt), _=user)
    artistic = prompt_resp["artistic_prompt"]
    used_prompt = artistic

    payload = {"prompt": used_prompt, "n": max(1, min(req.n, 4))}
    try:
        images = await liblibai_gen_images(payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"liblibai 生成失败: {e}")

    session.add(
        GenerationRecord(
            user_id=user.id,
            raw_prompt=req.raw_prompt,
            artistic_prompt=artistic,
            provider="liblibai",
        )
    )
    await session.commit()
    return LiblibaiGenResponse(
        images=images,
        artistic_prompt=artistic,
        used_prompt=used_prompt,
        meta={"liblibai_base_url": settings.liblibai_base_url, "liblibai_uri": settings.liblibai_uri},
    )
