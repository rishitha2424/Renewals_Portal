"""
Custom Column and Deal Annotation models.
Stores admin-defined extra columns, per-deal annotation values (keyed by opportunity_id_18),
and full audit logging.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    String, Integer, Boolean, DateTime, Text, JSON,
    UniqueConstraint, Index,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.database import Base


class CustomColumn(Base):
    __tablename__ = "custom_columns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    label: Mapped[str] = mapped_column(String(256), nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    dropdown_options: Mapped[list[str] | None] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    source_header: Mapped[str | None] = mapped_column(String(256), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[str] = mapped_column(String(128), default="system", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        Index("ix_custom_columns_is_deleted_sort", "is_deleted", "sort_order"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "key": self.key,
            "label": self.label,
            "type": self.type,
            "dropdown_options": self.dropdown_options or [],
            "sort_order": self.sort_order,
            "source_header": self.source_header,
            "is_deleted": self.is_deleted,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class DealAnnotation(Base):
    __tablename__ = "deal_annotations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    opportunity_id_18: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    column_key: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="app", nullable=False)  # "excel" or "app"
    updated_by: Mapped[str] = mapped_column(String(128), default="system", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    __table_args__ = (
        UniqueConstraint("opportunity_id_18", "column_key", name="uq_deal_annotations_opp_col"),
        Index("ix_deal_annotations_opp_col", "opportunity_id_18", "column_key"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "opportunity_id_18": self.opportunity_id_18,
            "column_key": self.column_key,
            "value": self.value,
            "source": self.source,
            "updated_by": self.updated_by,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "version": self.version,
        }


class AnnotationAudit(Base):
    __tablename__ = "annotation_audit"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)  # "column" | "deal_value"
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    column_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    opportunity_id_18: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)  # "create" | "update" | "delete" | "excel_sync"
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[str] = mapped_column(String(128), default="system", nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    extra_info: Mapped[dict | None] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=True)

    __table_args__ = (
        Index("ix_annotation_audit_opp", "opportunity_id_18"),
        Index("ix_annotation_audit_col", "column_key"),
        Index("ix_annotation_audit_time", "timestamp"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "column_key": self.column_key,
            "opportunity_id_18": self.opportunity_id_18,
            "action": self.action,
            "old_value": self.old_value,
            "new_value": self.new_value,
            "user_id": self.user_id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "extra_info": self.extra_info,
        }
