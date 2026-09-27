"""add maintenance queue position

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-09-21 20:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e3f4a5b6c7d8"
down_revision: Union[str, Sequence[str], None] = "d2e3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "maintenance",
        sa.Column(
            "queue_position",
            sa.Integer(),
            nullable=True,
        ),
    )
    op.create_index(
        op.f("ix_maintenance_queue_position"),
        "maintenance",
        ["queue_position"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_maintenance_queue_position"), table_name="maintenance")
    op.drop_column("maintenance", "queue_position")
