"""add crews and maintenance resource fields

Revision ID: d2e3f4a5b6c7
Revises: c1a2b3c4d5e6
Create Date: 2026-09-19 20:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d2e3f4a5b6c7"
down_revision: Union[str, Sequence[str], None] = "c1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create crews table
    crew_table = op.create_table(
        "crews",
        sa.Column("id", sa.Integer(), nullable=False, primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("crew_type", sa.String(length=50), nullable=False),
        sa.Column("department", sa.String(length=50), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("availability_start", sa.DateTime(), nullable=True),
        sa.Column("availability_end", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="Available"),
        sa.Column("current_workload", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(op.f("ix_crews_id"), "crews", ["id"], unique=False)
    op.create_index(op.f("ix_crews_name"), "crews", ["name"], unique=False)
    op.create_index(op.f("ix_crews_crew_type"), "crews", ["crew_type"], unique=False)
    op.create_index(op.f("ix_crews_department"), "crews", ["department"], unique=False)
    op.create_index(op.f("ix_crews_status"), "crews", ["status"], unique=False)

    # 2. Add columns to maintenance table
    op.add_column(
        "maintenance",
        sa.Column(
            "assigned_crew_id",
            sa.Integer(),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_maintenance_assigned_crew_id",
        "maintenance",
        "crews",
        ["assigned_crew_id"],
        ["id"],
    )
    op.create_index(
        op.f("ix_maintenance_assigned_crew_id"),
        "maintenance",
        ["assigned_crew_id"],
        unique=False,
    )

    op.add_column(
        "maintenance",
        sa.Column(
            "urgency_score",
            sa.Float(),
            nullable=True,
        ),
    )

    op.add_column(
        "maintenance",
        sa.Column(
            "due_by",
            sa.DateTime(),
            nullable=True,
        ),
    )

    op.add_column(
        "maintenance",
        sa.Column(
            "maximum_delay_minutes",
            sa.Integer(),
            nullable=True,
        ),
    )

    op.add_column(
        "maintenance",
        sa.Column(
            "requires_exclusive_block",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # 3. Seed initial crews
    op.bulk_insert(
        crew_table,
        [
            {
                "name": "Electrical Team A",
                "department": "Electrical",
                "crew_type": "Electrical Team",
                "capacity": 4,
                "status": "Available",
                "current_workload": 0,
            },
            {
                "name": "S&T Team A",
                "department": "S&T",
                "crew_type": "S&T Team",
                "capacity": 3,
                "status": "Available",
                "current_workload": 0,
            },
            {
                "name": "Track Team A",
                "department": "Engineering",
                "crew_type": "Track Team",
                "capacity": 6,
                "status": "Available",
                "current_workload": 0,
            },
            {
                "name": "Electrical Team B",
                "department": "Electrical",
                "crew_type": "Electrical Team",
                "capacity": 4,
                "status": "Available",
                "current_workload": 0,
            },
            {
                "name": "S&T Team B",
                "department": "S&T",
                "crew_type": "S&T Team",
                "capacity": 3,
                "status": "Available",
                "current_workload": 0,
            },
            {
                "name": "Track Team B",
                "department": "Engineering",
                "crew_type": "Track Team",
                "capacity": 6,
                "status": "Available",
                "current_workload": 0,
            },
        ],
    )


def downgrade() -> None:
    op.drop_column("maintenance", "requires_exclusive_block")
    op.drop_column("maintenance", "maximum_delay_minutes")
    op.drop_column("maintenance", "due_by")
    op.drop_column("maintenance", "urgency_score")
    op.drop_constraint("fk_maintenance_assigned_crew_id", "maintenance", type_="foreignkey")
    op.drop_index(op.f("ix_maintenance_assigned_crew_id"), table_name="maintenance")
    op.drop_column("maintenance", "assigned_crew_id")

    op.drop_index(op.f("ix_crews_status"), table_name="crews")
    op.drop_index(op.f("ix_crews_department"), table_name="crews")
    op.drop_index(op.f("ix_crews_crew_type"), table_name="crews")
    op.drop_index(op.f("ix_crews_name"), table_name="crews")
    op.drop_index(op.f("ix_crews_id"), table_name="crews")
    op.drop_table("crews")
