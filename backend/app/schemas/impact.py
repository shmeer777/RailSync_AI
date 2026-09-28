"""
Schemas for Maintenance Impact Analysis in RailSync AI.

Comprehensive models answering: "WHAT WILL THIS MAINTENANCE AFFECT?"
Across 6 structured categories:
1. Block Impact & Station Impact
2. Train Impact & Train Conflict Analysis
3. Crew Impact & Department Impact
4. Dependency Impact
5. Asset Availability Impact
6. Traffic Impact & Maintenance Window
"""

from typing import Any
from pydantic import BaseModel, Field


class AffectedBlockItem(BaseModel):
    block_code: str
    block_name: str
    distance_km: float = 0.0
    start_station_code: str
    end_station_code: str
    restriction_start: str | None = None
    restriction_end: str | None = None
    duration_minutes: int = 0
    maintenance_task_ids: list[int] = Field(default_factory=list)


class AffectedStationItem(BaseModel):
    station_code: str
    station_name: str | None = None
    connected_blocks: list[str] = Field(default_factory=list)


class BlockImpact(BaseModel):
    block_code: str
    block_name: str
    distance_km: float = 0.0
    start_station_code: str
    end_station_code: str
    restriction_start: str | None = None
    restriction_end: str | None = None
    duration_minutes: int = 0
    maintenance_task_ids: list[int] = Field(default_factory=list)
    affected_blocks: list[AffectedBlockItem] = Field(default_factory=list)
    affected_blocks_count: int = 1
    affected_stations: list[AffectedStationItem] = Field(default_factory=list)
    affected_stations_count: int = 0


class TrainConflictItem(BaseModel):
    train_id: int | None = None
    train_number: str
    train_name: str
    train_type: str | None = None
    source_station: str | None = None
    destination_station: str | None = None
    current_station: str | None = None
    direction: str | None = None
    affected_block: str
    conflict_type: str = "Schedule Overlap"
    priority: str | None = None
    status: str | None = None
    eta_minute: int = 0
    depart_minute: int = 0
    delay_minutes: int | None = None  # None if not calculated, never fabricated
    conflict_severity: str = "Medium"
    recommendation: str | None = None


class TrainImpact(BaseModel):
    total_conflicts: int = 0
    affected_trains_count: int = 0
    train_conflicts_before: int | None = None
    train_conflicts_after: int | None = None
    trains: list[dict[str, Any]] = Field(default_factory=list)


class CrewMemberImpact(BaseModel):
    crew_id: int | None = None
    name: str
    department: str
    crew_type: str
    assigned_task_ids: list[int] = Field(default_factory=list)
    required_crew_size: int = 0
    available_capacity: int = 0
    tasks_assigned_count: int = 0
    workload_notes: str | None = None


class CrewImpact(BaseModel):
    total_crews_involved: int = 0
    crews: list[dict[str, Any]] = Field(default_factory=list)
    departments: list[str] = Field(default_factory=list)
    department_count: int = 0


class DependencyRelation(BaseModel):
    prerequisite_id: int
    prerequisite_title: str | None = None
    dependent_id: int
    dependent_title: str | None = None
    relation_type: str = "finish-to-start"


class DependencyImpact(BaseModel):
    has_prerequisites: bool = False
    prerequisite_tasks_count: int = 0
    prerequisite_task_ids: list[int] = Field(default_factory=list)
    blocks_downstream: bool = False
    downstream_tasks_count: int = 0
    downstream_task_ids: list[int] = Field(default_factory=list)
    blocked_task_count: int = 0
    dependency_notes: list[str] = Field(default_factory=list)
    dependency_chain: list[dict[str, Any]] = Field(default_factory=list)


class AssetAvailabilityImpact(BaseModel):
    total_network_assets: int = 0
    restricted_assets: int = 0
    available_assets: int = 0
    availability_percentage: float = 100.0
    baseline_availability_percentage: float = 100.0
    availability_delta: float = 0.0
    note: str | None = None


class TrafficImpact(BaseModel):
    overall_traffic_level: str = "Low"
    total_traffic_score: int = 0
    slot_traffic: list[int] = Field(default_factory=list)
    peak_slot_index: int = 0
    planning_window: str | None = None
    operational_impact_indicators: list[str] = Field(default_factory=list)


class MaintenanceWindowImpact(BaseModel):
    planned_start: str | None = None
    planned_end: str | None = None
    duration_minutes: int = 0
    restricted_period: str = ""
    is_coordinated_bundle: bool = False


class ImpactSummary(BaseModel):
    affected_blocks: int = 0
    affected_stations: int = 0
    affected_trains: int = 0
    train_conflicts: int = 0
    departments: int = 0
    crews: int = 0
    dependent_tasks: int = 0
    restricted_assets: int = 0
    maintenance_window_minutes: int = 0
    traffic_level: str = "Low"
    impact_level: str = "Low"


class BaselineVsOptimized(BaseModel):
    affected_trains_before: int | None = None
    affected_trains_after: int | None = None
    train_conflicts_before: int | None = None
    train_conflicts_after: int | None = None
    restricted_blocks_before: int | None = None
    restricted_blocks_after: int | None = None
    available_assets_before: int | None = None
    available_assets_after: int | None = None
    maintenance_duration_before: int | None = None
    maintenance_duration_after: int | None = None


class SpeedRestrictionItem(BaseModel):
    block_code: str
    section_name: str
    restriction_speed_kmph: int = 30
    normal_speed_kmph: int = 100
    restriction_window: str
    reason: str
    affected_trains_count: int = 0


class PowerBlockItem(BaseModel):
    location: str
    power_block_type: str = "OHE 25kV AC Traction Power Isolation"
    window: str
    department: str = "Electrical (TRD)"
    affected_assets: str
    operational_effect: str


class SignallingImpactItem(BaseModel):
    signalling_asset: str
    location: str
    restriction: str = "Non-Interlocked (NI) working / Point machine isolated"
    window: str
    dependent_maintenance: str
    operational_effect: str


class DepartmentImpactItem(BaseModel):
    department: str
    task_count: int = 1
    crews_involved: list[str] = Field(default_factory=list)
    affected_assets: list[str] = Field(default_factory=list)
    planned_window: str
    coordination_requirement: str


class RestrictedAssetItem(BaseModel):
    asset_code: str
    asset_name: str
    asset_type: str = "Block Section"
    restriction_type: str = "Full Corridor Possession"
    restriction_window: str
    reason: str
    status: str = "Restricted"
    affected_operations: str


class MaintenanceImpactResponse(BaseModel):
    target_type: str = Field(..., description="'task', 'bundle', or 'what-if'")
    target_id: str = Field(..., description="ID of the task or bundle")
    block_code: str
    maintenance_types: list[str] = Field(default_factory=list)
    window_start: str | None = None
    window_end: str | None = None
    duration_minutes: int = 0
    impact_level: str = Field(default="Low", description="'Low', 'Moderate', or 'High'")
    impact_level_explanation: str = Field(default="", description="Deterministic formula derivation")
    impact_summary: ImpactSummary
    block_impact: BlockImpact
    train_impact: TrainImpact
    crew_impact: CrewImpact
    dependency_impact: DependencyImpact
    asset_impact: AssetAvailabilityImpact
    traffic_impact: TrafficImpact
    maintenance_window_impact: MaintenanceWindowImpact
    speed_restrictions: list[SpeedRestrictionItem] = Field(default_factory=list)
    power_blocks: list[PowerBlockItem] = Field(default_factory=list)
    signalling_impacts: list[SignallingImpactItem] = Field(default_factory=list)
    departments_detail: list[DepartmentImpactItem] = Field(default_factory=list)
    restricted_assets_detail: list[RestrictedAssetItem] = Field(default_factory=list)
    predictive_origin: dict[str, Any] | None = None
    urgency_context: dict[str, Any] | None = None
    baseline_vs_optimized: BaselineVsOptimized | None = None
    explanation: str
    human_approval_required: bool = True
    human_approval_disclaimer: str = (
        "RailSync AI provides decision support. Authorized railway personnel must review and approve the plan."
    )
    decision_support_note: str = (
        "Decision-Support Prototype: Impact analysis evaluates modeled train conflicts, "
        "crew workload, and network asset availability to inform human section controllers."
    )
