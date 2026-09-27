from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.block import Block
from app.models.maintenance import Maintenance
from app.models.station import Station


router = APIRouter(
    prefix="/maintenance",
    tags=["Maintenance"],
)


class MaintenanceCreate(BaseModel):
    # ------------------------------------------------------------
    # Location
    # ------------------------------------------------------------

    location_type: str = "block"
    block_code: str | None = None
    station_code: str | None = None

    # ------------------------------------------------------------
    # Maintenance information
    # ------------------------------------------------------------

    maintenance_type: str
    description: str | None = None
    priority: str = "Medium"
    status: str = "Planned"
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    estimated_duration_minutes: float | None = None

    # ------------------------------------------------------------
    # Smart scheduling metadata
    # ------------------------------------------------------------

    department: str = "Engineering"
    crew_type: str = "Track Team"
    crew_size: int = Field(default=2, ge=1)

    depends_on_maintenance_id: int | None = None

    execution_mode: str = "sequential"
    sequence_order: int = Field(default=1, ge=1)

    dependency_note: str | None = None

    # Multi-Department Maintenance Bundling
    bundle_id: str | None = None
    bundled: bool = False
    bundle_role: str | None = None
    planned_start: datetime | None = None
    planned_end: datetime | None = None

    # Crew Assignment, Urgency & Safety Constraints
    assigned_crew_id: int | None = None
    urgency_score: float | None = None
    due_by: datetime | None = None
    maximum_delay_minutes: int | None = None
    requires_exclusive_block: bool = False
    queue_position: int | None = None

    @model_validator(mode="after")
    def validate_payload(self):
        # --------------------------------------------------------
        # Location validation
        # --------------------------------------------------------

        location_type = self.location_type.strip().lower()

        if location_type not in {"block", "station"}:
            raise ValueError(
                "location_type must be either 'block' or 'station'."
            )

        if location_type == "block":
            if not self.block_code:
                raise ValueError(
                    "block_code is required for block maintenance."
                )

            if self.station_code:
                raise ValueError(
                    "station_code must be empty for block maintenance."
                )

        if location_type == "station":
            if not self.station_code:
                raise ValueError(
                    "station_code is required for station maintenance."
                )

            if self.block_code:
                raise ValueError(
                    "block_code must be empty for station maintenance."
                )

        self.location_type = location_type

        # --------------------------------------------------------
        # Normalize codes
        # --------------------------------------------------------

        if self.block_code:
            self.block_code = self.block_code.strip().upper()

        if self.station_code:
            self.station_code = self.station_code.strip().upper()

        # --------------------------------------------------------
        # Scheduling metadata validation
        # --------------------------------------------------------

        self.department = self.department.strip()

        if not self.department:
            raise ValueError(
                "department cannot be empty."
            )

        self.crew_type = self.crew_type.strip()

        if not self.crew_type:
            raise ValueError(
                "crew_type cannot be empty."
            )

        execution_mode = (
            self.execution_mode.strip().lower()
        )

        if execution_mode not in {
            "sequential",
            "parallel",
        }:
            raise ValueError(
                "execution_mode must be 'sequential' or 'parallel'."
            )

        self.execution_mode = execution_mode

        # --------------------------------------------------------
        # Sequence validation
        # --------------------------------------------------------

        if self.sequence_order < 1:
            raise ValueError(
                "sequence_order must be at least 1."
            )

        # --------------------------------------------------------
        # Date validation
        # --------------------------------------------------------

        if (
            self.scheduled_start is not None
            and self.scheduled_end is not None
            and self.scheduled_end <= self.scheduled_start
        ):
            raise ValueError(
                "scheduled_end must be later than scheduled_start."
            )

        # --------------------------------------------------------
        # Duration validation
        # --------------------------------------------------------

        if (
            self.estimated_duration_minutes is not None
            and self.estimated_duration_minutes <= 0
        ):
            raise ValueError(
                "estimated_duration_minutes must be greater than 0."
            )

        return self


class MaintenanceResponse(BaseModel):
    id: int

    # Location
    location_type: str
    block_code: str | None
    station_code: str | None

    # Maintenance
    maintenance_type: str
    description: str | None
    priority: str
    status: str
    scheduled_start: datetime | None
    scheduled_end: datetime | None
    estimated_duration_minutes: float | None

    # Smart scheduling
    department: str
    crew_type: str
    crew_size: int
    depends_on_maintenance_id: int | None
    execution_mode: str
    sequence_order: int
    dependency_note: str | None

    # Multi-Department Maintenance Bundling
    bundle_id: str | None = None
    bundled: bool = False
    bundle_role: str | None = None
    planned_start: datetime | None = None
    planned_end: datetime | None = None

    # Crew Assignment, Urgency & Safety Constraints
    assigned_crew_id: int | None = None
    assigned_crew_name: str | None = None
    required_crew_size: int | None = None
    available_capacity: int | None = None
    urgency_score: float | None = None
    due_by: datetime | None = None
    maximum_delay_minutes: int | None = None
    requires_exclusive_block: bool = False
    queue_position: int | None = None

    model_config = {
        "from_attributes": True
    }


@router.post(
    "/",
    response_model=MaintenanceResponse,
    status_code=201,
)
def create_maintenance(
    maintenance_data: MaintenanceCreate,
    db: Session = Depends(get_db),
):
    # ------------------------------------------------------------
    # Validate block/station location
    # ------------------------------------------------------------

    if maintenance_data.location_type == "block":
        block = db.scalar(
            select(Block).where(
                Block.code == maintenance_data.block_code
            )
        )

        if block is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Block '{maintenance_data.block_code}' "
                    "not found."
                ),
            )

    elif maintenance_data.location_type == "station":
        station = db.scalar(
            select(Station).where(
                Station.code == maintenance_data.station_code
            )
        )

        if station is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Station '{maintenance_data.station_code}' "
                    "not found."
                ),
            )

    # ------------------------------------------------------------
    # Validate dependency
    # ------------------------------------------------------------

    if maintenance_data.depends_on_maintenance_id is not None:
        dependency = db.get(
            Maintenance,
            maintenance_data.depends_on_maintenance_id,
        )

        if dependency is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Dependency maintenance task "
                    f"{maintenance_data.depends_on_maintenance_id} "
                    "not found."
                ),
            )

        # A task cannot depend on itself.
        if (
            dependency.id
            == maintenance_data.depends_on_maintenance_id
        ):
            raise HTTPException(
                status_code=400,
                detail="A maintenance task cannot depend on itself.",
            )

    # ------------------------------------------------------------
    # Create maintenance record
    # ------------------------------------------------------------

    maintenance = Maintenance(
        location_type=maintenance_data.location_type,
        block_code=maintenance_data.block_code,
        station_code=maintenance_data.station_code,
        maintenance_type=maintenance_data.maintenance_type,
        description=maintenance_data.description,
        priority=maintenance_data.priority,
        status=maintenance_data.status,
        scheduled_start=maintenance_data.scheduled_start,
        scheduled_end=maintenance_data.scheduled_end,
        estimated_duration_minutes=(
            maintenance_data.estimated_duration_minutes
        ),
        department=maintenance_data.department,
        crew_type=maintenance_data.crew_type,
        crew_size=maintenance_data.crew_size,
        depends_on_maintenance_id=(
            maintenance_data.depends_on_maintenance_id
        ),
        execution_mode=maintenance_data.execution_mode,
        sequence_order=maintenance_data.sequence_order,
        dependency_note=maintenance_data.dependency_note,
        bundle_id=maintenance_data.bundle_id,
        bundled=maintenance_data.bundled,
        bundle_role=maintenance_data.bundle_role,
        planned_start=maintenance_data.planned_start,
        planned_end=maintenance_data.planned_end,
        assigned_crew_id=maintenance_data.assigned_crew_id,
        urgency_score=maintenance_data.urgency_score,
        due_by=maintenance_data.due_by,
        maximum_delay_minutes=maintenance_data.maximum_delay_minutes,
        requires_exclusive_block=maintenance_data.requires_exclusive_block,
        queue_position=maintenance_data.queue_position,
    )

    db.add(maintenance)
    db.commit()
    db.refresh(maintenance)

    return maintenance


@router.get(
    "/",
    response_model=list[MaintenanceResponse],
)
def get_maintenance_records(
    db: Session = Depends(get_db),
):
    records = db.scalars(
        select(Maintenance).order_by(Maintenance.id)
    ).all()

    return records


@router.get(
    "/bundles",
)
def get_maintenance_bundles(
    block_code: str | None = None,
    window_preference: str | None = "night",
    persist: bool = False,
    db: Session = Depends(get_db),
):
    """
    Returns coordinated multi-department maintenance bundles.
    Bundles compatible tasks on the same block into a unified block window.
    """
    from app.services.ai.maintenance_bundler import bundle_compatible_maintenance

    bundles = bundle_compatible_maintenance(
        db,
        target_block_code=block_code,
        persist=persist,
        window_preference=window_preference,
    )
    return {
        "total_bundles": len(bundles),
        "bundles": bundles,
    }


@router.post(
    "/bundles/optimize",
)
def optimize_maintenance_bundles(
    block_code: str | None = None,
    window_preference: str | None = "night",
    db: Session = Depends(get_db),
):
    """
    Triggers OR-Tools CP-SAT bundle optimization and persists planned bundle metadata to the database.
    """
    from app.services.ai.maintenance_bundler import bundle_compatible_maintenance

    bundles = bundle_compatible_maintenance(
        db,
        target_block_code=block_code,
        persist=True,
        window_preference=window_preference,
    )
    return {
        "message": "Maintenance bundles optimized and persisted successfully.",
        "total_bundles": len(bundles),
        "bundles": bundles,
    }


@router.get(
    "/{maintenance_id}",
    response_model=MaintenanceResponse,
)
def get_maintenance(
    maintenance_id: int,
    db: Session = Depends(get_db),
):
    maintenance = db.get(
        Maintenance,
        maintenance_id,
    )

    if maintenance is None:
        raise HTTPException(
            status_code=404,
            detail="Maintenance record not found.",
        )

    return maintenance