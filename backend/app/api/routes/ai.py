from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.maintenance import Maintenance
from app.models.train import Train
from app.services.ai.maintenance_risk import calculate_maintenance_risk
from app.services.ai.train_risk import calculate_train_operational_risk
from app.services.ai.conflict_detection import detect_train_block_conflicts
from app.services.ai.block_planner import generate_block_plan
from app.services.ai.decision_explainer import explain_block_decision
from app.schemas.what_if import WhatIfScenarioRequest, WhatIfApplyRequest


router = APIRouter(
    prefix="/ai",
    tags=["AI Insights"],
)


@router.get(
    "/maintenance-risk",
)
def get_maintenance_risk(
    db: Session = Depends(get_db),
):
    records = db.scalars(
        select(Maintenance).order_by(Maintenance.id)
    ).all()

    results = []

    for maintenance in records:
        risk = calculate_maintenance_risk(
            priority=maintenance.priority,
            status=maintenance.status,
            estimated_duration_minutes=(
                maintenance.estimated_duration_minutes
            ),
            scheduled_start=maintenance.scheduled_start,
            scheduled_end=maintenance.scheduled_end,
        )

        results.append(
            {
                "maintenance_id": maintenance.id,
                "block_code": maintenance.block_code,
                "station_code": maintenance.station_code,
                "location_type": maintenance.location_type,
                "maintenance_type": maintenance.maintenance_type,
                "priority": maintenance.priority,
                "status": maintenance.status,
                "estimated_duration_minutes": (
                    maintenance.estimated_duration_minutes
                ),
                "risk_score": risk["risk_score"],
                "risk_level": risk["risk_level"],
                "reasons": risk["reasons"],
            }
        )

    return {
        "total_records": len(results),
        "results": results,
    }


@router.get(
    "/train-risk",
)
def get_train_operational_risk(
    db: Session = Depends(get_db),
):
    trains = db.scalars(
        select(Train).order_by(Train.id)
    ).all()

    results = []

    for train in trains:
        risk = calculate_train_operational_risk(
            delay_minutes=train.delay_minutes,
            speed_kmph=train.speed_kmph,
            status=train.status,
            priority=train.priority,
            direction=train.direction,
            current_station_code=train.current_station_code,
        )

        results.append(
            {
                "train_id": train.id,
                "train_number": train.train_number,
                "name": train.name,
                "train_type": train.train_type,
                "source_station_code": (
                    train.source_station_code
                ),
                "destination_station_code": (
                    train.destination_station_code
                ),
                "current_station_code": (
                    train.current_station_code
                ),
                "status": train.status,
                "delay_minutes": train.delay_minutes,
                "speed_kmph": train.speed_kmph,
                "direction": train.direction,
                "priority": train.priority,
                "risk_score": risk["risk_score"],
                "risk_level": risk["risk_level"],
                "reasons": risk["reasons"],
            }
        )

    return {
        "total_trains": len(results),
        "results": results,
    }


@router.get(
    "/train-block-conflicts",
)
def get_train_block_conflicts(
    db: Session = Depends(get_db),
):
    conflicts = detect_train_block_conflicts(db)

    critical_count = sum(
        1
        for conflict in conflicts
        if conflict["severity"] == "Critical"
    )

    high_count = sum(
        1
        for conflict in conflicts
        if conflict["severity"] == "High"
    )

    medium_count = sum(
        1
        for conflict in conflicts
        if conflict["severity"] == "Medium"
    )

    return {
        "total_conflicts": len(conflicts),
        "critical_conflicts": critical_count,
        "high_conflicts": high_count,
        "medium_conflicts": medium_count,
        "conflicts": conflicts,
    }


@router.get(
    "/block-plan",
)
def get_block_plan(
    db: Session = Depends(get_db),
):
    return generate_block_plan(db)


@router.get(
    "/explain-block-plan/{train_id}",
)
def explain_train_block_plan(
    train_id: int,
    db: Session = Depends(get_db),
):
    train = db.get(Train, train_id)

    if train is None:
        raise HTTPException(
            status_code=404,
            detail="Train not found.",
        )

    block_plan = generate_block_plan(db)

    train_plan = next(
        (
            plan
            for plan in block_plan.get("plans", [])
            if plan["train_id"] == train_id
        ),
        None,
    )

    if train_plan is None:
        raise HTTPException(
            status_code=404,
            detail="No block plan found for this train.",
        )

    conflicts = detect_train_block_conflicts(db)

    # Select the most severe conflict for this train.
    # This ensures a Critical station conflict is preferred
    # over a High or Medium block conflict.
    severity_rank = {
        "Critical": 3,
        "High": 2,
        "Medium": 1,
        "Low": 0,
    }

    train_conflicts = [
        conflict
        for conflict in conflicts
        if conflict["train_id"] == train_id
    ]

    train_conflict = max(
        train_conflicts,
        key=lambda conflict: severity_rank.get(
            conflict["severity"],
            0,
        ),
        default=None,
    )

    explanation = explain_block_decision(
        train_number=train.train_number,
        train_name=train.name,
        train_status=train.status,
        train_priority=train.priority,
        delay_minutes=train.delay_minutes,
        speed_kmph=train.speed_kmph,
        current_station_code=train.current_station_code,
        block_code=train_plan.get("block_code"),
        block_name=train_plan.get("block_name"),
        plan_status=train_plan.get("status", "Unknown"),
        plan_reason=train_plan.get(
            "reason",
            "No planning reason available.",
        ),
        conflict_severity=(
            train_conflict["severity"]
            if train_conflict
            else None
        ),
        conflict_reasons=(
            train_conflict["reasons"]
            if train_conflict
            else None
        ),
        recommendation=(
            train_conflict["recommendation"]
            if train_conflict
            else None
        ),
    )

    return {
        "train_id": train.id,
        "train_number": train.train_number,
        "train_name": train.name,
        "plan": train_plan,
        "conflict": train_conflict,
        "explanation": explanation,
    }


@router.get(
    "/maintenance-bundles",
)
def get_ai_maintenance_bundles(
    block_code: str | None = None,
    window_preference: str | None = "night",
    db: Session = Depends(get_db),
):
    """
    Returns coordinated multi-department maintenance bundles
    with deterministic explanations and resource-aware scheduling.
    """
    from app.services.ai.maintenance_bundler import bundle_compatible_maintenance

    bundles = bundle_compatible_maintenance(
        db, target_block_code=block_code, window_preference=window_preference
    )
    return {
        "total_bundles": len(bundles),
        "bundles": bundles,
    }


# ------------------------------------------------------------
# Predictive Maintenance Endpoints
# ------------------------------------------------------------

from pydantic import BaseModel, Field


class PlanPredictionRequest(BaseModel):
    block_code: str
    maintenance_type: str
    department: str = "Engineering"
    crew_type: str = "Track Team"
    priority: str = "High"
    estimated_duration_minutes: float = 60.0
    window_preference: str = "night"
    human_approved: bool = True


@router.get(
    "/maintenance-predictions/model-metrics",
)
def get_predictive_model_metrics():
    """
    Returns model evaluation metrics (accuracy, precision, recall, F1 score, confusion matrix).
    """
    from app.ml.trainer import get_model_metrics

    return get_model_metrics()


@router.get(
    "/maintenance-predictions",
)
def get_maintenance_predictions(
    block_code: str | None = None,
    db: Session = Depends(get_db),
):
    """
    Predicts the maintenance type most likely needed for blocks across the network.
    Answers: 'WHAT maintenance is likely to be needed?'
    """
    from app.ml.predictor import (
        predict_maintenance_for_block,
        predict_maintenance_for_all_blocks,
    )

    if block_code:
        try:
            pred = predict_maintenance_for_block(db, block_code.strip())
            return {
                "total_predictions": 1,
                "predictions": [pred],
            }
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    predictions = predict_maintenance_for_all_blocks(db)
    return {
        "total_predictions": len(predictions),
        "predictions": predictions,
    }


@router.get(
    "/maintenance-predictions/{block_code}",
)
def get_block_maintenance_prediction(
    block_code: str,
    db: Session = Depends(get_db),
):
    """
    Predicts maintenance needed for a specific block code.
    """
    from app.ml.predictor import predict_maintenance_for_block

    try:
        return predict_maintenance_for_block(db, block_code.strip())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post(
    "/maintenance-predictions/plan",
)
def plan_from_prediction(
    payload: PlanPredictionRequest,
    db: Session = Depends(get_db),
):
    """
    Bridges an AI predictive maintenance recommendation into the
    Multi-Department Maintenance Bundling optimizer with human review.
    """
    from app.models.block import Block
    from app.models.maintenance import Maintenance
    from app.services.ai.maintenance_bundler import bundle_compatible_maintenance

    block = db.scalar(select(Block).where(Block.code == payload.block_code.strip().upper()))
    if not block:
        raise HTTPException(status_code=404, detail=f"Block '{payload.block_code}' not found.")

    existing_task = db.scalar(
        select(Maintenance).where(
            Maintenance.location_type == "block",
            Maintenance.block_code == block.code,
            Maintenance.maintenance_type == payload.maintenance_type,
            Maintenance.status.in_(["Planned", "Scheduled"]),
        )
    )

    if not existing_task:
        new_task = Maintenance(
            location_type="block",
            block_code=block.code,
            maintenance_type=payload.maintenance_type,
            department=payload.department,
            crew_type=payload.crew_type,
            priority=payload.priority,
            estimated_duration_minutes=payload.estimated_duration_minutes,
            status="Planned",
            description=f"AI Predictive Maintenance Recommendation (Urgency: {payload.priority})",
        )
        db.add(new_task)
        db.commit()
        db.refresh(new_task)

    bundles = bundle_compatible_maintenance(
        db,
        target_block_code=block.code,
        window_preference=payload.window_preference,
    )

    return {
        "message": f"Predictive recommendation for block {block.code} planned successfully.",
        "block_code": block.code,
        "recommended_maintenance": payload.maintenance_type,
        "human_approved": payload.human_approved,
        "bundles": bundles,
    }


@router.post(
    "/maintenance-what-if",
    response_model=None,
    summary="Simulate What-If Maintenance Scenario",
    description=(
        "Simulates an alternative maintenance plan using the OR-Tools CP-SAT optimizer "
        "with temporary user overrides (start time, task delay, crew assignment, duration, "
        "priority, and bundling/separation). Does NOT alter live database records."
    ),
)
def simulate_maintenance_what_if(
    payload: WhatIfScenarioRequest,
    db: Session = Depends(get_db),
):
    from app.services.ai.what_if_simulator import run_what_if_simulation
    return run_what_if_simulation(db=db, request=payload)


@router.post(
    "/maintenance-what-if/apply",
    summary="Apply Simulated Maintenance Plan with Human Approval",
    description=(
        "Applies a simulated maintenance plan to the database records. Requires explicit "
        "human approval from an authorized railway section controller."
    ),
)
def apply_maintenance_what_if(
    payload: WhatIfApplyRequest,
    db: Session = Depends(get_db),
):
    from app.services.ai.what_if_simulator import apply_simulated_plan
    return apply_simulated_plan(db=db, request=payload)


# ------------------------------------------------------------
# Dynamic Crew Priority & Work Queue Endpoints
# ------------------------------------------------------------

from app.schemas.crew_queue import (
    CrewQueueApplyRequest,
    CrewQueueApplyResponse,
    CrewQueueResponse,
)


@router.get(
    "/crew-queues",
    response_model=list[CrewQueueResponse],
    summary="Get Dynamic Work Queues for All Crews",
    description=(
        "Returns CP-SAT optimized maintenance work queues for all active railway crews, "
        "highlighting dynamic priority overrides, prerequisite unblocking, and workload."
    ),
)
def get_all_crews_work_queues(
    db: Session = Depends(get_db),
):
    from app.services.ai.crew_queue_optimizer import get_all_crew_queues

    return get_all_crew_queues(db=db)


@router.get(
    "/crew-queues/{crew_id}",
    response_model=CrewQueueResponse,
    summary="Get Dynamic Work Queue for Specific Crew",
    description=(
        "Returns CP-SAT optimized maintenance work queue for a specific crew by ID, "
        "including original queue, optimized queue, explainable reasons, and dependency effects."
    ),
)
def get_single_crew_work_queue(
    crew_id: int,
    db: Session = Depends(get_db),
):
    from app.services.ai.crew_queue_optimizer import optimize_crew_queue

    try:
        return optimize_crew_queue(db=db, crew_id=crew_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post(
    "/crew-queues/optimize",
    response_model=CrewQueueResponse,
    summary="Optimize Dynamic Crew Work Queue (In-Memory Simulation)",
    description=(
        "Simulates and optimizes a crew's work queue using OR-Tools CP-SAT. "
        "Does NOT modify live database records until explicitly applied with human approval."
    ),
)
def optimize_crew_work_queue_simulation(
    crew_id: int,
    db: Session = Depends(get_db),
):
    from app.services.ai.crew_queue_optimizer import optimize_crew_queue

    try:
        return optimize_crew_queue(db=db, crew_id=crew_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post(
    "/crew-queues/apply",
    response_model=CrewQueueApplyResponse,
    summary="Apply Optimized Crew Queue with Human Approval",
    description=(
        "Applies the human-approved queue ordering to the database for the given crew. "
        "Requires explicit reviewer name and confirmation."
    ),
)
def apply_crew_work_queue(
    payload: CrewQueueApplyRequest,
    db: Session = Depends(get_db),
):
    from app.services.ai.crew_queue_optimizer import apply_crew_queue

    try:
        return apply_crew_queue(db=db, request=payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------------------
# Asset Availability Optimization Endpoints
# ------------------------------------------------------------

from app.schemas.asset_availability import (
    AssetAvailabilityOptimizeRequest,
    AssetAvailabilityResponse,
)


@router.get(
    "/asset-availability",
    response_model=AssetAvailabilityResponse,
    summary="Get Network Asset Availability Optimization",
    description=(
        "Returns CP-SAT optimized maintenance asset availability metrics, time-aware "
        "availability timeline, and deterministic baseline comparison for operational railway blocks."
    ),
)
def get_network_asset_availability(
    planning_window: str = "night",
    stagger_multi_blocks: bool = True,
    start_time: str | None = None,
    db: Session = Depends(get_db),
):
    from app.services.ai.asset_availability import calculate_asset_availability

    req = AssetAvailabilityOptimizeRequest(
        planning_window=planning_window,
        stagger_multi_blocks=stagger_multi_blocks,
        start_time=start_time,
    )
    return calculate_asset_availability(db=db, request=req)


@router.post(
    "/asset-availability/optimize",
    response_model=AssetAvailabilityResponse,
    summary="Optimize Network Asset Availability (OR-Tools CP-SAT)",
    description=(
        "Executes CP-SAT asset availability optimization with customizable planning window, "
        "target block filtering, and multi-block staggering options."
    ),
)
def optimize_network_asset_availability(
    payload: AssetAvailabilityOptimizeRequest,
    db: Session = Depends(get_db),
):
    from app.services.ai.asset_availability import calculate_asset_availability

    return calculate_asset_availability(db=db, request=payload)


# ------------------------------------------------------------
# Advanced Urgency-Aware Scheduling Endpoints
# ------------------------------------------------------------

from app.schemas.urgency import (
    MaintenanceUrgencyItem,
    MaintenanceUrgencyResponse,
    UrgencyScheduleRequest,
    UrgencyScheduleResponse,
)


@router.get(
    "/maintenance-urgency",
    response_model=MaintenanceUrgencyResponse,
    summary="Get Multi-Factor Urgency Analysis for All Tasks",
    description=(
        "Returns explainable multi-factor urgency scores, urgency levels, dependency impact, "
        "and deadline pressure for all active maintenance tasks."
    ),
)
def get_all_maintenance_urgency(
    db: Session = Depends(get_db),
):
    from app.services.ai.urgency_analyzer import calculate_all_urgencies

    return calculate_all_urgencies(db=db)


@router.get(
    "/maintenance-urgency/{maintenance_id}",
    response_model=MaintenanceUrgencyItem,
    summary="Get Urgency Analysis for Specific Maintenance Task",
    description="Returns detailed multi-factor urgency evaluation for a single maintenance task.",
)
def get_single_maintenance_urgency(
    maintenance_id: int,
    db: Session = Depends(get_db),
):
    from app.services.ai.urgency_analyzer import calculate_task_urgency
    from app.models.block import Block
    from app.services.ai.traffic_estimator import get_all_blocks_traffic

    task = db.get(Maintenance, maintenance_id)
    if not task:
        raise HTTPException(status_code=404, detail="Maintenance task not found.")

    all_tasks = db.scalars(select(Maintenance)).all()
    historical_tasks = db.scalars(
        select(Maintenance).where(Maintenance.status.in_(["Completed", "completed"]))
    ).all()
    blocks = db.scalars(select(Block)).all()
    traffic = get_all_blocks_traffic(db=db, blocks=blocks)

    confidence: float | None = None
    if task.block_code:
        try:
            from app.ml.predictor import predict_maintenance_for_block
            p_data = predict_maintenance_for_block(db, task.block_code)
            if p_data and p_data.get("predicted_maintenance") == task.maintenance_type:
                conf_val = p_data.get("confidence")
                if conf_val is not None:
                    confidence = round(float(conf_val), 1)
        except Exception:
            confidence = None

    return calculate_task_urgency(
        task=task,
        all_tasks=all_tasks,
        traffic_by_block=traffic,
        historical_tasks=historical_tasks,
        model_confidence=confidence,
    )


@router.post(
    "/maintenance-urgency/schedule",
    response_model=UrgencyScheduleResponse,
    summary="Schedule Maintenance Tasks by Urgency (OR-Tools CP-SAT)",
    description=(
        "Schedules active maintenance tasks using OR-Tools CP-SAT with multi-factor urgency, "
        "enforcing hard dependency, crew, and block safety constraints while placing Critical "
        "tasks at their earliest feasible safe window. Requires human approval."
    ),
)
def schedule_maintenance_by_urgency(
    payload: UrgencyScheduleRequest | None = None,
    db: Session = Depends(get_db),
):
    from app.services.ai.urgency_analyzer import schedule_by_urgency

    return schedule_by_urgency(db=db, request=payload)


# ------------------------------------------------------------
# Maintenance Impact Analysis Endpoints
# ------------------------------------------------------------

from app.schemas.impact import MaintenanceImpactResponse


@router.get(
    "/maintenance-impact/{maintenance_id}",
    response_model=MaintenanceImpactResponse,
    summary="Analyze Operational Impact of Maintenance Task",
    description=(
        "Evaluates 6-category operational impact (Block, Train, Crew, Dependency, "
        "Asset Availability, and Traffic) of a maintenance task before approval."
    ),
)
def get_task_maintenance_impact(
    maintenance_id: int,
    db: Session = Depends(get_db),
):
    from app.services.ai.impact_analyzer import analyze_task_impact

    return analyze_task_impact(db=db, maintenance_id=maintenance_id)


@router.get(
    "/maintenance-impact/bundle/{bundle_id}",
    response_model=MaintenanceImpactResponse,
    summary="Analyze Operational Impact of Coordinated Bundle",
    description="Evaluates 6-category operational impact of a multi-department maintenance bundle.",
)
def get_bundle_maintenance_impact(
    bundle_id: str,
    db: Session = Depends(get_db),
):
    from app.services.ai.impact_analyzer import analyze_bundle_impact

    return analyze_bundle_impact(db=db, bundle_id=bundle_id)


@router.post(
    "/maintenance-impact/what-if",
    response_model=MaintenanceImpactResponse,
    summary="Analyze Operational Impact of What-If Maintenance Scenario",
    description="Evaluates operational impact recalculated from a simulated What-If maintenance scenario.",
)
def post_what_if_maintenance_impact(
    payload: WhatIfScenarioRequest,
    db: Session = Depends(get_db),
):
    from app.services.ai.impact_analyzer import analyze_what_if_impact

    return analyze_what_if_impact(db=db, request=payload)


# ------------------------------------------------------------
# Weekly / Monthly Maintenance Planning Endpoints
# ------------------------------------------------------------

from app.schemas.planning import (
    MaintenancePlanApplyRequest,
    MaintenancePlanApplyResponse,
    MaintenancePlanOptimizeRequest,
    MaintenancePlanResponse,
)


@router.get(
    "/maintenance-plan",
    response_model=MaintenancePlanResponse,
    summary="Get Weekly or Monthly Maintenance Plan",
    description=(
        "Generates or returns an OR-Tools CP-SAT optimized weekly (7-day) or monthly (30-day) "
        "maintenance plan grouped by day with crew workload and asset availability."
    ),
)
def get_weekly_or_monthly_plan(
    horizon: str = "week",
    start_date: str | None = None,
    db: Session = Depends(get_db),
):
    from app.services.ai.maintenance_planner import generate_maintenance_plan

    req = MaintenancePlanOptimizeRequest(horizon=horizon, start_date=start_date)
    return generate_maintenance_plan(db=db, request=req)


@router.post(
    "/maintenance-plan/optimize",
    response_model=MaintenancePlanResponse,
    summary="Optimize Multi-Day Maintenance Plan (CP-SAT)",
    description="Optimizes a weekly or monthly maintenance plan with custom targets and horizon.",
)
def optimize_multi_day_plan(
    payload: MaintenancePlanOptimizeRequest,
    db: Session = Depends(get_db),
):
    from app.services.ai.maintenance_planner import generate_maintenance_plan

    return generate_maintenance_plan(db=db, request=payload)


@router.post(
    "/maintenance-plan/apply",
    response_model=MaintenancePlanApplyResponse,
    summary="Apply Approved Maintenance Plan with Human Confirmation",
    description=(
        "Applies a human-approved weekly or monthly plan to live database maintenance records. "
        "Requires explicit controller approval."
    ),
)
def apply_approved_plan(
    payload: MaintenancePlanApplyRequest,
    db: Session = Depends(get_db),
):
    from app.services.ai.maintenance_planner import apply_maintenance_plan

    try:
        return apply_maintenance_plan(db=db, request=payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))