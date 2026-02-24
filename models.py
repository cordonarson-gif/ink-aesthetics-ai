from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Text, Boolean, ForeignKey, Float, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    display_name: Mapped[str] = mapped_column(String(64), default="")
    password_hash: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    supertokens_user_id: Mapped[str | None] = mapped_column(String(128), unique=True, index=True, nullable=True)
    supertokens_email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    credits_balance: Mapped[int] = mapped_column(Integer, default=0)

    subscription: Mapped["Subscription"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    refresh_sessions: Mapped[list["RefreshSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True)

    # 'usage' or 'bundle'
    mode: Mapped[str] = mapped_column(String(16))
    plan_key: Mapped[str] = mapped_column(String(64))
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped[User] = relationship(back_populates="subscription")


class CreditLedger(Base):
    __tablename__ = "credit_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))

    # 'topup' | 'spend' | 'monthly_grant'
    type: Mapped[str] = mapped_column(String(32))
    amount: Mapped[int] = mapped_column(Integer)  # positive or negative
    note: Mapped[str] = mapped_column(String(255), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class GenerationRecord(Base):
    __tablename__ = "generation_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))

    raw_prompt: Mapped[str] = mapped_column(Text)
    artistic_prompt: Mapped[str] = mapped_column(Text)

    provider: Mapped[str] = mapped_column(String(32), default="liblibai")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    token_jti: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped[User] = relationship(back_populates="refresh_sessions")


class EmailCode(Base):
    __tablename__ = "email_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    purpose: Mapped[str] = mapped_column(String(32), index=True)
    code: Mapped[str] = mapped_column(String(8))
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ApiCallLog(Base):
    __tablename__ = "api_call_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    method: Mapped[str] = mapped_column(String(16), index=True)
    path: Mapped[str] = mapped_column(String(255), index=True)
    status_code: Mapped[int] = mapped_column(Integer, index=True)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    success: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    client_ip: Mapped[str] = mapped_column(String(64), default="")
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    error_detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class UserOnlineSession(Base):
    __tablename__ = "user_online_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    terminal_type: Mapped[str] = mapped_column(String(32), default="unknown")
    region: Mapped[str] = mapped_column(String(64), default="Unknown")
    timezone: Mapped[str] = mapped_column(String(64), default="")
    client_ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(Text, default="")
    last_path: Mapped[str] = mapped_column(String(255), default="/")
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    total_heartbeats: Mapped[int] = mapped_column(Integer, default=1)


class WebsiteVisitLog(Base):
    __tablename__ = "website_visit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    visitor_id: Mapped[str] = mapped_column(String(64), index=True)
    session_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    page_path: Mapped[str] = mapped_column(String(255), index=True)
    source_channel: Mapped[str] = mapped_column(String(64), default="direct", index=True)
    referrer: Mapped[str] = mapped_column(Text, default="")
    terminal_type: Mapped[str] = mapped_column(String(32), default="unknown")
    region: Mapped[str] = mapped_column(String(64), default="Unknown")
    client_ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class VisitorProfile(Base):
    __tablename__ = "visitor_profiles"

    visitor_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    visit_count: Mapped[int] = mapped_column(Integer, default=0)
    last_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)


class AlertThresholdConfig(Base):
    __tablename__ = "alert_threshold_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    api_fail_rate_threshold: Mapped[float] = mapped_column(Float, default=0.15)
    online_surge_threshold: Mapped[float] = mapped_column(Float, default=0.5)
    online_drop_threshold: Mapped[float] = mapped_column(Float, default=0.4)
    refresh_interval_sec: Mapped[int] = mapped_column(Integer, default=5)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AlertEvent(Base):
    __tablename__ = "alert_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(64), index=True)
    severity: Mapped[str] = mapped_column(String(16), default="warning")
    message: Mapped[str] = mapped_column(String(255))
    current_value: Mapped[float] = mapped_column(Float, default=0.0)
    threshold_value: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    meta_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    resolved_note: Mapped[str] = mapped_column(String(255), default="")


class ApiPermissionRule(Base):
    __tablename__ = "api_permission_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    path: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str] = mapped_column(String(255), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class OnlineSnapshot(Base):
    __tablename__ = "online_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    online_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class UserFeedback(Base):
    __tablename__ = "user_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    user_name: Mapped[str] = mapped_column(String(64), default="")
    category: Mapped[str] = mapped_column(String(32), default="general", index=True)
    title: Mapped[str] = mapped_column(String(120))
    content: Mapped[str] = mapped_column(Text)
    contact: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    admin_note: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    replied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    user_read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class CommunityPost(Base):
    __tablename__ = "community_posts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    archive_id: Mapped[str] = mapped_column(String(80), default="", index=True)
    publish_source: Mapped[str] = mapped_column(String(16), default="generated")
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    owner_user_name: Mapped[str] = mapped_column(String(64), default="")
    title: Mapped[str] = mapped_column(String(160))
    data_url: Mapped[str] = mapped_column(Text)
    prompt_artistic: Mapped[str] = mapped_column(Text, default="")
    params_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    published_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=True)
    ai_label: Mapped[str] = mapped_column(String(32), default="AI生成")
    moderation_status: Mapped[str] = mapped_column(String(16), default="approved", index=True)
    moderation_reason: Mapped[str] = mapped_column(Text, default="")
    minted: Mapped[bool] = mapped_column(Boolean, default=False)


class CommunityPostLike(Base):
    __tablename__ = "community_post_likes"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_community_post_likes_post_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[str] = mapped_column(ForeignKey("community_posts.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class CommunityPostComment(Base):
    __tablename__ = "community_post_comments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    post_id: Mapped[str] = mapped_column(ForeignKey("community_posts.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    user_name: Mapped[str] = mapped_column(String(64), default="")
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    moderation_status: Mapped[str] = mapped_column(String(16), default="approved", index=True)
    moderation_reason: Mapped[str] = mapped_column(Text, default="")


class CommunityPostReport(Base):
    __tablename__ = "community_post_reports"
    __table_args__ = (UniqueConstraint("post_id", "reporter_user_id", name="uq_community_post_reports_post_user"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    post_id: Mapped[str] = mapped_column(ForeignKey("community_posts.id"), index=True)
    reporter_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    reporter_user_name: Mapped[str] = mapped_column(String(64), default="")
    reason: Mapped[str] = mapped_column(String(240), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ForumQuestion(Base):
    __tablename__ = "forum_questions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    user_name: Mapped[str] = mapped_column(String(64), default="")
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    tags_json: Mapped[str] = mapped_column(Text, default="[]")
    invited_user_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    solved: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    moderation_status: Mapped[str] = mapped_column(String(16), default="approved", index=True)
    moderation_reason: Mapped[str] = mapped_column(Text, default="")


class ForumQuestionLike(Base):
    __tablename__ = "forum_question_likes"
    __table_args__ = (UniqueConstraint("question_id", "user_id", name="uq_forum_question_likes_question_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(ForeignKey("forum_questions.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ForumAnswer(Base):
    __tablename__ = "forum_answers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    question_id: Mapped[str] = mapped_column(ForeignKey("forum_questions.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    user_name: Mapped[str] = mapped_column(String(64), default="")
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    moderation_status: Mapped[str] = mapped_column(String(16), default="approved", index=True)
    moderation_reason: Mapped[str] = mapped_column(Text, default="")


class ImageGenerationTask(Base):
    __tablename__ = "image_generation_tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    raw_prompt: Mapped[str] = mapped_column(Text)
    artistic_prompt: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    selected_candidate_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(24), default="completed", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    failure_reason: Mapped[str] = mapped_column(Text, default="")
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    max_retries: Mapped[int] = mapped_column(Integer, default=3)
    queue_message_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    paused: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


class ImageGenerationCandidate(Base):
    __tablename__ = "image_generation_candidates"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("image_generation_tasks.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    candidate_index: Mapped[int] = mapped_column(Integer, index=True)
    data_url: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    image_code: Mapped[str | None] = mapped_column(String(16), unique=True, nullable=True, index=True)
    image_bucket: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    assigned_seq: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class ImageSelectionSequence(Base):
    __tablename__ = "image_selection_sequences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("image_generation_tasks.id"), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class CounterSyncSnapshot(Base):
    __tablename__ = "counter_sync_snapshots"
    __table_args__ = (
        UniqueConstraint("counter_type", "entity_id", "window_start", "window_end", name="uq_counter_sync_window"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    counter_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    value: Mapped[int] = mapped_column(Integer, default=0)
    window_start: Mapped[datetime] = mapped_column(DateTime, index=True)
    window_end: Mapped[datetime] = mapped_column(DateTime, index=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class SecurityAuditLog(Base):
    __tablename__ = "security_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    actor_ip: Mapped[str] = mapped_column(String(64), default="", index=True)
    action: Mapped[str] = mapped_column(String(128), index=True)
    target_type: Mapped[str] = mapped_column(String(64), default="", index=True)
    target_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class UserFollow(Base):
    __tablename__ = "user_follows"
    __table_args__ = (UniqueConstraint("follower_user_id", "followed_user_id", name="uq_user_follows_pair"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    follower_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    followed_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class PromptVersionRecord(Base):
    __tablename__ = "prompt_version_records"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    raw_prompt: Mapped[str] = mapped_column(Text)
    artistic_prompt: Mapped[str] = mapped_column(Text, default="")
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class PromptPreset(Base):
    __tablename__ = "prompt_presets"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_prompt_presets_user_name"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(64), default="general", index=True)
    prompt_hint: Mapped[str] = mapped_column(Text, default="")
    params_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ModerationTicket(Base):
    __tablename__ = "moderation_tickets"
    __table_args__ = (
        UniqueConstraint("content_type", "content_id", "status", name="uq_moderation_tickets_content_status"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source: Mapped[str] = mapped_column(String(24), default="report", index=True)
    content_type: Mapped[str] = mapped_column(String(32), index=True)
    content_id: Mapped[str] = mapped_column(String(64), index=True)
    report_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    machine_result: Mapped[str] = mapped_column(String(24), default="review", index=True)
    machine_reason: Mapped[str] = mapped_column(Text, default="")
    assigned_admin_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    assigned_admin_user_name: Mapped[str] = mapped_column(String(64), default="")
    decision_reason: Mapped[str] = mapped_column(Text, default="")
    appeal_reason: Mapped[str] = mapped_column(Text, default="")
    final_result: Mapped[str | None] = mapped_column(String(24), nullable=True, index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    appealed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    final_judged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ModerationTicketLog(Base):
    __tablename__ = "moderation_ticket_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("moderation_tickets.id"), index=True)
    action: Mapped[str] = mapped_column(String(32), index=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    actor_user_name: Mapped[str] = mapped_column(String(64), default="")
    from_status: Mapped[str] = mapped_column(String(24), default="")
    to_status: Mapped[str] = mapped_column(String(24), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    meta_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class AdminExportTask(Base):
    __tablename__ = "admin_export_tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_user_id: Mapped[str] = mapped_column(String(64), index=True)
    scope: Mapped[str] = mapped_column(String(24), default="all", index=True)
    file_format: Mapped[str] = mapped_column(String(16), default="xlsx")
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    storage_path: Mapped[str] = mapped_column(Text, default="")
    download_token: Mapped[str] = mapped_column(String(64), default="", index=True)
    error: Mapped[str] = mapped_column(Text, default="")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    params_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, default="")
    related_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
