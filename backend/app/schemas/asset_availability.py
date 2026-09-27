from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class RestrictedBlockInfo(BaseModel):
    block_code: str
    block_name: str
    start_time: str | None = None
    end_time: str | None = None
    start_minute: int = 0
    end_minute: int = 0
    duration_minutes: int = 0
    maintenance_tasks_count: int = 0
    departments: list[str] = Field(default_factory=list)
    crews: list[str] = Field(default_factory=list)
    route_criticality: int = 0
    train_conflicts: int = 0
    tasks: list[dict[str, Any]] = Field(default_factory=list)


class TimeSlotAvailability(BaseModel):
    slot_index: int
    time_label: str
    start_minute: int
    end_minute: int
    total_assets: int
    available_assets: int
    restricted_assets: int
    availability_percentage: float
    restricted_blocks: list[str] = Field(default_factory=list)
    is_peak: bool = False
    is_bottleneck: bool = False


class AvailabilityMetrics(BaseModel):
    total_assets: int
    available_assets: int
    restricted_assets: int
    availability_percentage: float
    peak_available_assets: int
    minimum_available_assets: int
    maintenance_tasks_completed: int
    maintenance_window_minutes: int
    train_conflicts: int
    block_closures: int
    restricted_blocks: list[RestrictedBlockInfo] = Field(default_factory=list)


class AvailabilityImpact(BaseModel):
    availability_change_percentage_points: float
    restricted_asset_change: int
    train_conflict_change: int
    block_closure_change: int
    time_saved_minutes: int


class AssetAvailabilityResponse(BaseModel):
    total_assets: int
    planning_window: str = "night"
    horizon_minutes: int = 540
    baseline: AvailabilityMetrics
    optimized: AvailabilityMetrics
    impact: AvailabilityImpact
    timeline: list[TimeSlotAvailability] = Field(default_factory=list)
    optimization_status: str = "OPTIMAL"
    explanation: str
    human_approval_required: bool = True
    decision_support_note: str = (
        "Decision-Support Prototype: Modeled asset availability reflects simulated "
        "operational conditions. Authorized railway section controllers must review and "
        "approve maintenance schedules before execution."
    )


class AssetAvailabilityOptimizeRequest(BaseModel):
    planning_window: str = "night"
    target_block_codes: list[str] | None = None
    start_time: str | None = None
    stagger_multi_blocks: bool = True
