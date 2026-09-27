from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Train(Base):
    __tablename__ = "trains"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    train_number: Mapped[str] = mapped_column(
        String(20),
        unique=True,
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )

    train_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    source_station_code: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        index=True,
    )

    destination_station_code: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        index=True,
    )

    current_station_code: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="Running",
    )

    delay_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    speed_kmph: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0,
    )

    direction: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="Forward",
    )

    priority: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="Normal",
    )
