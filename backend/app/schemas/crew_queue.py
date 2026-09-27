from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class CrewQueueTask(BaseModel):
    task_id: int
    maintenance_type: str
    location_type: str = "block"
    location_code: str | None = None
    block_code: str | None = None
    station_code: str | None = None
    department: str = "Engineering"
    crew_type: str = "Track Team"
    crew_size: int = 2
    required_crew_size: int = 2
    assigned_crew_id: int | None = None
    assigned_crew_name: str | None = None
    available_capacity: int | None = None
    priority: str = "Medium"
    status: str = "Planned"
    queue_state: str = "Queued"  # Normal, Reprioritized, In Progress, Waiting for Dependency, Waiting for Crew, Completed, Blocked, Queued
    position: int = 1
    original_position: int = 1
    optimized_position: int = 1
    priority_override: bool = False
    override_reason: str | None = None
    duration_minutes: int = 60
    start_minute: int = 0
    end_minute: int = 60
    planned_start: str | None = None
    planned_end: str | None = None
    depends_on_maintenance_id: int | None = None
    depends_on: list[int] = Field(default_factory=list)
    blocked_tasks_unlocked: list[int] = Field(default_factory=list)
    dependent_task_count: int = 0
    dependency_impact_score: float = 0.0
    bundle_id: str | None = None
    bundle_role: str | None = None
    is_prerequisite: bool = False


class QueueChange(BaseModel):
    task_id: int
    task_name: str
    original_position: int
    optimized_position: int
    priority: str
    priority_override: bool = False
    override_reason: str
    blocked_tasks_unlocked: list[int] = Field(default_factory=list)


class DependencyEffect(BaseModel):
    task_id: int
    task_name: str
    unlocks_task_ids: list[int] = Field(default_factory=list)
    bundle_id: str | None = None
    impact_description: str


class CrewWorkloadSummary(BaseModel):
    total_assigned_tasks: int = 0
    total_duration_minutes: int = 0
    active_tasks: int = 0
    queued_tasks: int = 0
    critical_tasks: int = 0
    reprioritized_tasks: int = 0


class CrewQueueResponse(BaseModel):
    crew_id: int
    crew_name: str
    crew_type: str
    department: str
    capacity: int = 4
    current_status: str = "Available"
    current_workload: int = 0
    workload: CrewWorkloadSummary

    original_queue: list[CrewQueueTask] = Field(default_factory=list)
    optimized_queue: list[CrewQueueTask] = Field(default_factory=list)
    changes: list[QueueChange] = Field(default_factory=list)
    dependency_effects: list[DependencyEffect] = Field(default_factory=list)

    optimization_status: str = "OPTIMAL"
    explanation: str
    human_approval_required: bool = True
    decision_support_note: str = (
        "Decision-Support Prototype: AI-generated queue recommendations must be "
        "reviewed and approved by authorized railway section controllers."
    )


class TaskPositionAssignment(BaseModel):
    task_id: int
    queue_position: int
    planned_start: str | None = None
    planned_end: str | None = None


class CrewQueueApplyRequest(BaseModel):
    crew_id: int
    task_positions: list[TaskPositionAssignment]
    approved_by: str = Field(..., min_length=2, description="Name or ID of approving controller")
    notes: str | None = None


class CrewQueueApplyResponse(BaseModel):
    success: bool
    message: str
    crew_id: int
    applied_tasks_count: int
    approved_by: str
    applied_at: str
