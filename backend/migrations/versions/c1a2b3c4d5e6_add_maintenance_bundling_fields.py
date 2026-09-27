"""add maintenance bundling fields

Revision ID: c1a2b3c4d5e6
Revises: 72e07d1cdc61
Create Date: 2026-09-19 14:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "72e07d1cdc61"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add multi-department bundling fields to maintenance table."""

    op.add_column(
        "maintenance",
        sa.Column(
            "bundle_id",
            sa.String(length=50),
            nullable=True,
        ),
    )
    op.create_index(
        op.f("ix_maintenance_bundle_id"),
        "maintenance",
        ["bundle_id"],
        unique=False,
    )

    op.add_column(
        "maintenance",
        sa.Column(
            "bundled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        op.f("ix_maintenance_bundled"),
        "maintenance",
        ["bundled"],
        unique=False,
    )

    op.add_column(
        "maintenance",
        sa.Column(
            "bundle_role",
            sa.String(length=50),
            nullable=True,
        ),
    )

    op.add_column(
        "maintenance",
        sa.Column(
            "planned_start",
            sa.DateTime(),
            nullable=True,
        ),
    )

    op.add_column(
        "maintenance",
        sa.Column(
            "planned_end",
            sa.DateTime(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Drop multi-department bundling fields from maintenance table."""

    op.drop_column("maintenance", "planned_end")
    op.drop_column("maintenance", "planned_start")
    op.drop_column("maintenance", "bundle_role")
    op.drop_index(op.f("ix_maintenance_bundled"), table_name="maintenance")
    op.drop_column("maintenance", "bundled")
    op.drop_index(op.f("ix_maintenance_bundle_id"), table_name="maintenance")
    op.drop_column("maintenance", "bundle_id")
