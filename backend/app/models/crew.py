from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.maintenance import Maintenance


class Crew(Base):
    __tablename__ = "crews"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    crew_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )

    department: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )

    capacity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=4,
    )

    availability_start: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    availability_end: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="Available",
        index=True,
    )

    current_workload: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    assigned_tasks: Mapped[list["Maintenance"]] = relationship(
        "Maintenance",
        back_populates="assigned_crew",
        foreign_keys="Maintenance.assigned_crew_id",
        lazy="selectin",
    )

