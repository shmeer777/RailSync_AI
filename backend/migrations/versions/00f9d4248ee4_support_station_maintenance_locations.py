"""support station maintenance locations

Revision ID: 00f9d4248ee4
Revises: 367e6abb9624
Create Date: 2026-09-11 11:57:01.215817

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "00f9d4248ee4"
down_revision: Union[str, Sequence[str], None] = "367e6abb9624"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # Add the new location type temporarily as nullable so
    # existing maintenance records can be migrated safely.
    op.add_column(
        "maintenance",
        sa.Column(
            "location_type",
            sa.String(length=20),
            nullable=True,
        ),
    )

    # Add station location support.
    op.add_column(
        "maintenance",
        sa.Column(
            "station_code",
            sa.String(length=20),
            nullable=True,
        ),
    )

    # Existing maintenance records already use block_code,
    # so classify them as block-based maintenance.
    op.execute(
        "UPDATE maintenance "
        "SET location_type = 'block' "
        "WHERE location_type IS NULL"
    )

    # Make location_type required after existing rows are populated.
    op.alter_column(
        "maintenance",
        "location_type",
        existing_type=sa.VARCHAR(length=20),
        nullable=False,
    )

    # block_code becomes optional because station maintenance
    # does not require a block.
    op.alter_column(
        "maintenance",
        "block_code",
        existing_type=sa.VARCHAR(length=30),
        nullable=True,
    )

    op.create_index(
        op.f("ix_maintenance_location_type"),
        "maintenance",
        ["location_type"],
        unique=False,
    )

    op.create_index(
        op.f("ix_maintenance_station_code"),
        "maintenance",
        ["station_code"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index(
        op.f("ix_maintenance_station_code"),
        table_name="maintenance",
    )

    op.drop_index(
        op.f("ix_maintenance_location_type"),
        table_name="maintenance",
    )

    op.alter_column(
        "maintenance",
        "block_code",
        existing_type=sa.VARCHAR(length=30),
        nullable=False,
    )

    op.drop_column(
        "maintenance",
        "station_code",
    )

    op.drop_column(
        "maintenance",
        "location_type",
    )