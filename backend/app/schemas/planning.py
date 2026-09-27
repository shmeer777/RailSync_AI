"""
Schemas for Weekly / Monthly Maintenance Planning in RailSync AI.
"""

from typing import Any
from pydantic import BaseModel, Field


class PlannedMaintenanceItem(BaseModel):
    task_id: int
    block_code: str
    block_name: str
    maintenance_type: str
    department: str
    crew_id: int | None = None
    crew_name: str = "Unassigned"
    priority: str
    urgency_score: float = 0.0
    urgency_level: str = "Medium"
    duration_minutes: int = 60
    planned_start: str
    planned_end: str
    day_index: int
    date_str: str
    bundle_id: str | None = None
    is_bundle_leader: bool = False
    train_conflicts: int = 0


class PlanDaySummary(BaseModel):
    date_str: str
    day_name: str
    day_index: int
    tasks_count: int = 0
    total_window_minutes: int = 0
    restricted_blocks: list[str] = Field(default_factory=list)
    available_assets: int = 0
    restricted_assets: int = 0
    availability_percentage: float = 100.0
    train_conflicts: int = 0
    traffic_level: str = "Low"
    tasks: list[PlannedMaintenanceItem] = Field(default_factory=list)


class CrewWorkloadItem(BaseModel):
    crew_id: int | None
    crew_name: str
    department: str
    capacity: int = 4
    total_tasks_assigned: int = 0
    total_hours_allocated: float = 0.0
    daily_allocations: dict[str, float] = Field(default_factory=dict)


class MaintenancePlanResponse(BaseModel):
    plan_id: str
    horizon: str = Field(..., description="'week' or 'month'")
    start_date: str
    end_date: str
    total_tasks_planned: int
    days: list[PlanDaySummary] = Field(default_factory=list)
    crew_workloads: list[CrewWorkloadItem] = Field(default_factory=list)
    optimization_status: str = "OPTIMAL"
    average_availability_percentage: float = 100.0
    total_train_conflicts: int = 0
    explanation: str
    human_approval_required: bool = True
    decision_support_note: str = (
        "Decision-Support Prototype: Weekly/monthly maintenance schedules are optimized "
        "recommendations. Authorized railway section controllers must review and approve "
        "before dispatching work orders."
    )


class MaintenancePlanOptimizeRequest(BaseModel):
    horizon: str = Field(default="week", description="'week' (7 days) or 'month' (30 days)")
    start_date: str | None = Field(default=None, description="Start date (YYYY-MM-DD), defaults to today")
    target_departments: list[str] | None = None
    target_blocks: list[str] | None = None


class MaintenancePlanApplyRequest(BaseModel):
    plan_id: str
    human_approved: bool = Field(..., description="Explicit human confirmation")
    approved_by: str = Field(default="Section Controller")
    notes: str | None = None


class MaintenancePlanApplyResponse(BaseModel):
    message: str
    plan_id: str
    applied_tasks_count: int
    applied_at: str
    approved_by: str
