from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class TaskOverride(BaseModel):
    task_id: int
    delay_minutes: int | None = Field(default=None, ge=0, description="Start time offset in minutes")
    duration_minutes: int | None = Field(default=None, ge=1, description="Duration override in minutes")
    crew_id: int | None = Field(default=None, description="Specific crew ID override")
    priority: str | None = Field(default=None, description="Priority override: Critical, High, Medium, Low")
    bundled: bool | None = Field(default=None, description="Whether to keep task in coordinated bundle or separate")


class WhatIfScenarioRequest(BaseModel):
    block_code: str = Field(..., description="Target railway block code (e.g. GNT-BZA-01)")
    name: str | None = Field(default="Custom What-If Scenario", description="User-friendly scenario label")
    start_time: str | None = Field(default=None, description="Desired start time (e.g. '23:00' or ISO datetime)")
    planning_window: str | None = Field(default="night", description="Planning window preference: night, evening, daytime, earliest")
    task_overrides: list[TaskOverride] = Field(default_factory=list, description="Task-specific scenario overrides")
    traffic_assumptions: dict[str, Any] | None = Field(default=None, description="Optional traffic assumptions")


class WhatIfApplyRequest(BaseModel):
    block_code: str = Field(..., description="Target railway block code")
    scenario_id: str = Field(..., description="ID of the simulated scenario being applied")
    human_approved: bool = Field(..., description="Explicit human controller confirmation")
    approved_by: str = Field(default="Section Controller", description="Name/role of approving operator")
    notes: str | None = Field(default=None, description="Optional approval notes")


class PlanMetrics(BaseModel):
    start_time: str | None
    end_time: str | None
    total_window_minutes: int
    unbundled_total_minutes: int
    time_saved_minutes: int
    percent_time_saved: float
    train_conflicts: int
    train_conflicts_before: int
    block_closures: int
    bundle_count: int
    departments: list[str]
    crews: list[str]
    tasks: list[dict[str, Any]]
    optimization_status: str
    total_assets: int = 0
    available_assets: int = 0
    restricted_assets: int = 0
    availability_percentage: float = 0.0


class ImpactMetrics(BaseModel):
    time_difference_minutes: int
    conflict_difference: int
    block_closure_difference: int
    bundle_difference: int
    crew_changes: list[dict[str, Any]]
    task_timing_changes: list[dict[str, Any]]
    task_order_changes: list[dict[str, Any]]
    dependency_status: str
    traffic_level_change: str
    availability_change_percentage_points: float = 0.0
    restricted_asset_change: int = 0


class WhatIfScenarioResponse(BaseModel):
    scenario_id: str
    name: str
    block_code: str
    block_name: str
    optimization_status: str
    feasible: bool
    explanation: str
    infeasibility_reason: str | None = None
    baseline: PlanMetrics
    what_if: PlanMetrics | None = None
    impact: ImpactMetrics | None = None
    human_approval_required: bool = True
    decision_support_note: str = (
        "Decision-Support Prototype: What-If simulation results are temporary models "
        "and must be explicitly approved by authorized controllers before execution."
    )
