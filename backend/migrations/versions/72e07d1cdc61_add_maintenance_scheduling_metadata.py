"""add maintenance scheduling metadata

Revision ID: 72e07d1cdc61
Revises: 00f9d4248ee4
Create Date: 2026-09-18 14:03:42.993636

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "72e07d1cdc61"
down_revision: Union[str, Sequence[str], None] = "00f9d4248ee4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add scheduling, crew and dependency metadata."""

    # Department responsible for the maintenance task.
    op.add_column(
        "maintenance",
        sa.Column(
            "department",
            sa.String(length=50),
            nullable=True,
        ),
    )

    # Type of crew required to execute the task.
    op.add_column(
        "maintenance",
        sa.Column(
            "crew_type",
            sa.String(length=50),
            nullable=True,
        ),
    )

    # Number of workers required from the crew.
    op.add_column(
        "maintenance",
        sa.Column(
            "crew_size",
            sa.Integer(),
            nullable=True,
        ),
    )

    # Optional predecessor task.
    #
    # Example:
    # Electrical inspection (task 10)
    #          ↓
    # Signal work (task 11)
    op.add_column(
        "maintenance",
        sa.Column(
            "depends_on_maintenance_id",
            sa.Integer(),
            nullable=True,
        ),
    )

    # Scheduling mode:
    # "sequential" = wait for predecessor / previous sequence
    # "parallel"   = may overlap when other constraints permit
    op.add_column(
        "maintenance",
        sa.Column(
            "execution_mode",
            sa.String(length=20),
            nullable=True,
        ),
    )

    # Relative order used when several tasks are coordinated.
    op.add_column(
        "maintenance",
        sa.Column(
            "sequence_order",
            sa.Integer(),
            nullable=True,
        ),
    )

    # Human-readable dependency explanation.
    op.add_column(
        "maintenance",
        sa.Column(
            "dependency_note",
            sa.Text(),
            nullable=True,
        ),
    )

    # ------------------------------------------------------------
    # Populate sensible defaults for existing maintenance rows.
    # ------------------------------------------------------------

    op.execute(
        """
        UPDATE maintenance
        SET
            department = CASE
                WHEN LOWER(maintenance_type) LIKE '%electrical%'
                    THEN 'Electrical'
                WHEN LOWER(maintenance_type) LIKE '%signal%'
                    OR LOWER(maintenance_type) LIKE '%signalling%'
                    OR LOWER(maintenance_type) LIKE '%s&t%'
                    THEN 'S&T'
                ELSE 'Engineering'
            END,
            crew_type = CASE
                WHEN LOWER(maintenance_type) LIKE '%electrical%'
                    THEN 'Electrical Team'
                WHEN LOWER(maintenance_type) LIKE '%signal%'
                    OR LOWER(maintenance_type) LIKE '%signalling%'
                    OR LOWER(maintenance_type) LIKE '%s&t%'
                    THEN 'S&T Team'
                ELSE 'Track Team'
            END,
            crew_size = 2,
            execution_mode = 'sequential',
            sequence_order = 1
        WHERE department IS NULL
        """
    )

    # Existing rows have now been populated.
    op.alter_column(
        "maintenance",
        "department",
        existing_type=sa.VARCHAR(length=50),
        nullable=False,
    )

    op.alter_column(
        "maintenance",
        "crew_type",
        existing_type=sa.VARCHAR(length=50),
        nullable=False,
    )

    op.alter_column(
        "maintenance",
        "crew_size",
        existing_type=sa.Integer(),
        nullable=False,
    )

    op.alter_column(
        "maintenance",
        "execution_mode",
        existing_type=sa.VARCHAR(length=20),
        nullable=False,
    )

    op.alter_column(
        "maintenance",
        "sequence_order",
        existing_type=sa.Integer(),
        nullable=False,
    )

    # Self-reference so a task can explicitly depend on another
    # maintenance task.
    op.create_foreign_key(
        "fk_maintenance_dependency",
        "maintenance",
        "maintenance",
        ["depends_on_maintenance_id"],
        ["id"],
    )

    op.create_index(
        op.f("ix_maintenance_department"),
        "maintenance",
        ["department"],
        unique=False,
    )

    op.create_index(
        op.f("ix_maintenance_crew_type"),
        "maintenance",
        ["crew_type"],
        unique=False,
    )

    op.create_index(
        op.f("ix_maintenance_dependency_id"),
        "maintenance",
        ["depends_on_maintenance_id"],
        unique=False,
    )


def downgrade() -> None:
    """Remove scheduling, crew and dependency metadata."""

    op.drop_index(
        op.f("ix_maintenance_dependency_id"),
        table_name="maintenance",
    )

    op.drop_index(
        op.f("ix_maintenance_crew_type"),
        table_name="maintenance",
    )

    op.drop_index(
        op.f("ix_maintenance_department"),
        table_name="maintenance",
    )

    op.drop_constraint(
        "fk_maintenance_dependency",
        "maintenance",
        type_="foreignkey",
    )

    op.drop_column(
        "maintenance",
        "dependency_note",
    )

    op.drop_column(
        "maintenance",
        "sequence_order",
    )

    op.drop_column(
        "maintenance",
        "execution_mode",
    )

    op.drop_column(
        "maintenance",
        "depends_on_maintenance_id",
    )

    op.drop_column(
        "maintenance",
        "crew_size",
    )

    op.drop_column(
        "maintenance",
        "crew_type",
    )

    op.drop_column(
        "maintenance",
        "department",
    )