"""
Database models for Users, Authentication, Roles, Messaging, Email Outbox, Audit Logs, and Owner Sync.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional, List

from sqlalchemy import (
    String, Integer, Boolean, DateTime, Text, ForeignKey,
    Index, UniqueConstraint, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, synonym

from backend.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="kam")  # 'admin', 'management', 'kam'
    owner_name: Mapped[Optional[str]] = mapped_column(String(256), index=True, nullable=True)  # exact Excel opportunity_owner
    kam_portfolio_name = synonym("owner_name")
    mobileum_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="invited")  # 'invited', 'active', 'disabled', 'pending_email'
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_sso_login: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    sso_provider: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # 'entra_id'
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lockout_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # System owner cannot be deleted/demoted/disabled
    email_notifications: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    token_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # Incremented on password change to invalidate sessions
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    aliases: Mapped[List[UserAlias]] = relationship("UserAlias", back_populates="user", cascade="all, delete-orphan")
    tokens: Mapped[List[UserToken]] = relationship("UserToken", back_populates="user", cascade="all, delete-orphan")
    notifications: Mapped[List[Notification]] = relationship("Notification", back_populates="user", cascade="all, delete-orphan")


class UserAlias(Base):
    __tablename__ = "user_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    alias: Mapped[str] = mapped_column(String(256), index=True, nullable=False)
    alias_name = synonym("alias")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    user: Mapped[User] = relationship("User", back_populates="aliases")

    def __init__(self, *args, **kwargs):
        if "alias_name" in kwargs and "alias" not in kwargs:
            kwargs["alias"] = kwargs.pop("alias_name")
        super().__init__(*args, **kwargs)

    __table_args__ = (
        UniqueConstraint("user_id", "alias", name="uq_user_alias"),
    )


class UserToken(Base):
    __tablename__ = "user_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), index=True, nullable=False)  # sha256 hex digest of raw token
    token_type: Mapped[str] = mapped_column(String(50), nullable=False)  # 'invite', 'reset'
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    user: Mapped[User] = relationship("User", back_populates="tokens")

    __table_args__ = (
        Index("ix_user_tokens_lookup", "user_id", "token_type", "used_at"),
    )


class DealMessage(Base):
    __tablename__ = "deal_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    deal_id: Mapped[str] = mapped_column(String(100), index=True, nullable=False)  # opportunity_id_18
    thread_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    sender_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    recipient_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    sender_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sender_role: Mapped[str] = mapped_column(String(50), nullable=False)
    recipient_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    subject: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="normal", nullable=False)  # 'low', 'normal', 'high', 'urgent'
    recipient_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON-encoded array of recipient user IDs
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    thread_status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)  # 'open', 'resolved'
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class EmailOutbox(Base):
    __tablename__ = "email_outbox"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    recipient_email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    recipient_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body_html: Mapped[str] = mapped_column(Text, nullable=False)
    body_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    template_type: Mapped[str] = mapped_column(String(50), nullable=False)  # 'invite', 'reset', 'new_message', 'reply', etc.
    deal_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    deal_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    sender_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    sender_role: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    recipient_role: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending – email not configured", index=True, nullable=False)  # 'sent', 'failed', 'pending – email not configured'
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    attempts = synonym("retry_count")
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    user_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class OwnerSyncAlert(Base):
    __tablename__ = "owner_sync_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    alert_type: Mapped[str] = mapped_column(String(50), index=True, nullable=False)  # 'pending_email', 'missing_from_upload', 'near_match', 'duplicate_email', 'duplicate_name'
    owner_name: Mapped[str] = mapped_column(String(256), nullable=False)
    deal_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    suggested_match: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(50), index=True, nullable=False)  # 'message', 'reply', 'comment', 'alert', 'email_failure'
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    deal_id: Mapped[Optional[str]] = mapped_column(String(100), index=True, nullable=True)
    deal_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)  # 'deal_message', 'deal_comment', 'alert'
    target_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # thread_id or comment_id
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship("User", back_populates="notifications")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "category": self.category,
            "title": self.title,
            "message": self.message,
            "deal_id": self.deal_id,
            "deal_name": self.deal_name,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "is_read": self.is_read,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "read_at": self.read_at.isoformat() if self.read_at else None,
        }


class SSOAccessRequest(Base):
    __tablename__ = "sso_access_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tenant_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending", nullable=False)  # 'pending', 'approved', 'dismissed'
    attempt_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    count = synonym("attempt_count")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    first_seen = synonym("created_at")
    last_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    last_seen = synonym("last_attempt_at")
    reviewed_by: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "tenant_id": self.tenant_id,
            "status": self.status,
            "attempt_count": self.attempt_count,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_attempt_at": self.last_attempt_at.isoformat() if self.last_attempt_at else None,
            "reviewed_by": self.reviewed_by,
            "reviewed_at": self.reviewed_at.isoformat() if self.reviewed_at else None,
        }



