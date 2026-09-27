from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.crew import Crew



class Maintenance(Base):
    __tablename__ = "maintenance"

    # ------------------------------------------------------------
    # Primary key
    # ------------------------------------------------------------

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    # ------------------------------------------------------------
    # Location
    # ------------------------------------------------------------

    location_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="block",
        index=True,
    )

    block_code: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        index=True,
    )

    station_code: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        index=True,
    )

    # ------------------------------------------------------------
    # Maintenance information
    # ------------------------------------------------------------

    maintenance_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    priority: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="Medium",
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="Planned",
        index=True,
    )

    scheduled_start: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    scheduled_end: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    estimated_duration_minutes: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    # ------------------------------------------------------------
    # Smart scheduling metadata
    # ------------------------------------------------------------

    department: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="Engineering",
        index=True,
    )

    crew_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="Track Team",
        index=True,
    )

    crew_size: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=2,
    )

    # Self-referencing dependency:
    # this task must wait for another maintenance task.
    depends_on_maintenance_id: Mapped[int | None] = mapped_column(
        ForeignKey("maintenance.id"),
        nullable=True,
        index=True,
    )

    execution_mode: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="sequential",
    )

    sequence_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
    )

    dependency_note: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # ------------------------------------------------------------
    # Multi-Department Maintenance Bundling fields
    # ------------------------------------------------------------

    bundle_id: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        index=True,
    )

    bundled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        index=True,
    )

    bundle_role: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )

    planned_start: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    planned_end: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    # ------------------------------------------------------------
    # Crew Assignment, Urgency & Safety Constraints
    # ------------------------------------------------------------

    assigned_crew_id: Mapped[int | None] = mapped_column(
        ForeignKey("crews.id"),
        nullable=True,
        index=True,
    )

    urgency_score: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    due_by: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    maximum_delay_minutes: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    requires_exclusive_block: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    queue_position: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        index=True,
    )

    assigned_crew: Mapped["Crew | None"] = relationship(
        "Crew",
        back_populates="assigned_tasks",
        foreign_keys=[assigned_crew_id],
        lazy="joined",
    )

    @property
    def assigned_crew_name(self) -> str | None:
        return self.assigned_crew.name if self.assigned_crew else None

    @property
    def required_crew_size(self) -> int:
        return self.crew_size

    @property
    def available_capacity(self) -> int | None:
        return self.assigned_crew.capacity if self.assigned_crew else None
