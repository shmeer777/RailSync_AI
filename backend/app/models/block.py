from sqlalchemy import Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Block(Base):
    __tablename__ = "blocks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    code: Mapped[str] = mapped_column(
        String(30),
        unique=True,
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )

    start_station_code: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        index=True,
    )

    end_station_code: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        index=True,
    )

    distance_km: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )