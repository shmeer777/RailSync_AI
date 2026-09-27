"""
Schemas for Advanced Urgency-Aware Scheduling in RailSync AI.
"""

from typing import Any
from pydantic import BaseModel, Field


class UrgencyFactors(BaseModel):
    priority_weight: float = Field(..., description="Weight from nominal priority: Critical=40, High=25, Medium=15, Low=5")
    risk_factor: float = Field(..., description="Normalized predictive maintenance risk factor (0-25)")
    dependency_impact: float = Field(..., description="Impact based on downstream tasks blocked (0-20)")
    deadline_pressure: float = Field(..., description="Urgency derived from due_by / deadline proximity (0-25)")
    operational_impact: float = Field(..., description="Impact based on route traffic & section importance (0-15)")
    duration_penalty: float = Field(..., description="Additional factor for extended durations requiring early coordination")


class RecommendedWindow(BaseModel):
    start: str
    end: str
    window_type: str = "Earliest Feasible Safe Window"
    notes: str | None = None


class MaintenanceUrgencyItem(BaseModel):
    maintenance_id: int
    location_type: str
    block_code: str | None = None
    station_code: str | None = None
    maintenance_type: str
    department: str
    crew_type: str
    priority: str
    risk_score: float = Field(..., description="Predictive maintenance risk score (0-100)")
    model_confidence: float | None = Field(default=None, description="ML prediction confidence percentage (0-100) if available")
    urgency_score: float = Field(..., description="RailSync prototype urgency score (0-100)")
    urgency_level: str = Field(..., description="Critical, High, Medium, or Low")
    dependent_task_count: int = Field(default=0, description="Count of downstream tasks blocked until this completes")
    blocked_task_ids: list[int] = Field(default_factory=list, description="IDs of downstream blocked tasks")
    deadline: str | None = Field(default=None, description="ISO timestamp of deadline/due_by if present")
    deadline_status: str = Field(default="No Deadline")
    deadline_pressure: str = Field(default="None", description="Qualitative pressure: Overdue, Urgent (<24h), Approaching (<72h), Flexible, None")
    operational_impact: str = Field(default="Normal", description="Traffic/operational constraint level: High Traffic Corridor, Moderate, Normal")
    recommended_window: RecommendedWindow | None = None
    recommended_scheduling_window: str = Field(..., description="Summary string for recommended window")
    contributing_factors: list[str] = Field(default_factory=list, description="Transparent list of factors that drove the urgency evaluation")
    factors: UrgencyFactors
    explanation: str
    human_approval_required: bool = True
    earliest_feasible_window_reason: str | None = None


class MaintenanceUrgencyResponse(BaseModel):
    total_tasks: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    average_urgency_score: float = 0.0
    items: list[MaintenanceUrgencyItem] = Field(default_factory=list)
    decision_support_note: str = (
        "Decision-Support Prototype: RailSync prototype urgency scores are calculated deterministically "
        "from operational parameters to assist section controllers in prioritizing maintenance. "
        "Human review and approval is required before work dispatch."
    )


class UrgencyScheduleRequest(BaseModel):
    target_block_codes: list[str] | None = None
    human_approved: bool = Field(default=True, description="Human confirmation to simulate/apply schedule")


class UrgencyScheduleComparison(BaseModel):
    critical_tasks_scheduled_earlier: int = 0
    average_urgency_wait_reduction_minutes: float = 0.0
    dependency_delays_prevented: int = 0
    deadline_violations_prevented: int = 0


class UrgencyScheduleResponse(BaseModel):
    optimization_status: str = "OPTIMAL"
    scheduled_tasks_count: int
    comparison: UrgencyScheduleComparison
    schedule_items: list[dict[str, Any]] = Field(default_factory=list)
    explanation: str
    human_approval_required: bool = True
