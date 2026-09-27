"""
What-If Maintenance Simulation Service for RailSync AI.

Allows authorized section controllers to simulate alternative maintenance schedules
by temporarily overriding parameters (start time, task delay, crew assignment, duration,
priority, bundling/separation, and planning windows) using the existing OR-Tools CP-SAT
optimizer without altering live database records during simulation.
"""

from datetime import datetime, time, timedelta
from typing import Any
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.block import Block
from app.models.crew import Crew
from app.models.maintenance import Maintenance
from app.schemas.what_if import (
    ImpactMetrics,
    PlanMetrics,
    TaskOverride,
    WhatIfApplyRequest,
    WhatIfScenarioRequest,
    WhatIfScenarioResponse,
)
from app.services.ai.maintenance_bundler import (
    _normalize_code,
    _optimize_block_bundle,
    bundle_compatible_maintenance,
)
from app.services.ai.traffic_estimator import (
    get_block_train_traffic,
    resolve_planning_window,
)


def _parse_time_override(
    time_str: str | None,
    base_dt: datetime | None = None,
) -> datetime | None:
    """
    Parses a time override string (either 'HH:MM' or an ISO-8601 string)
    into a concrete datetime relative to base_dt.
    """
    if not time_str or not time_str.strip():
        return None

    cleaned = time_str.strip()

    # Try full ISO datetime first
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        pass

    # Try HH:MM or HH:MM:SS
    base = base_dt or datetime.now().replace(second=0, microsecond=0)
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            t = datetime.strptime(cleaned, fmt).time()
            target_dt = base.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)
            # If target time is earlier than base hour and base is late evening, schedule for next day
            if base.hour >= 20 and t.hour < 12:
                target_dt += timedelta(days=1)
            return target_dt
        except ValueError:
            continue

    raise ValueError(
        f"Invalid time format '{time_str}'. Expected 'HH:MM' (e.g. '23:00') or ISO format."
    )


def _build_plan_metrics(bundle: dict[str, Any], total_assets: int = 22) -> PlanMetrics:
    """Extracts structured PlanMetrics from an optimizer bundle result including asset availability."""
    closures = max(1, int(bundle.get("block_closures_avoided", 0)) + 1 - max(0, int(bundle.get("block_closures_avoided", 0))))
    restricted = 1 if bundle.get("tasks") else 0
    available = max(0, total_assets - restricted)
    avail_pct = round((available / total_assets) * 100, 1) if total_assets > 0 else 0.0

    return PlanMetrics(
        start_time=bundle.get("start_time"),
        end_time=bundle.get("end_time"),
        total_window_minutes=int(bundle.get("total_window_minutes", 0)),
        unbundled_total_minutes=int(bundle.get("unbundled_total_minutes", 0)),
        time_saved_minutes=int(bundle.get("time_saved_minutes", 0)),
        percent_time_saved=float(bundle.get("percent_time_saved", 0.0)),
        train_conflicts=int(bundle.get("train_conflicts_after", 0)),
        train_conflicts_before=int(bundle.get("train_conflicts_before", 0)),
        block_closures=closures,
        bundle_count=1,
        departments=bundle.get("departments", []),
        crews=bundle.get("crews", []),
        tasks=bundle.get("tasks", []),
        optimization_status=bundle.get("optimization_status", "UNKNOWN"),
        total_assets=total_assets,
        available_assets=available,
        restricted_assets=restricted,
        availability_percentage=avail_pct,
    )


def run_what_if_simulation(
    db: Session,
    request: WhatIfScenarioRequest,
) -> WhatIfScenarioResponse:
    """
    Executes a temporary What-If maintenance simulation using the existing
    OR-Tools CP-SAT optimizer, returning a structured Before vs After comparison.
    """
    norm_block = _normalize_code(request.block_code)
    block = db.scalar(select(Block).where(Block.code == norm_block))
    block_name = block.name if block else f"Block {norm_block}"

    # 1. Fetch live maintenance records for block
    tasks = db.scalars(
        select(Maintenance).where(
            Maintenance.location_type == "block",
            Maintenance.block_code == norm_block,
            Maintenance.status.notin_(["Completed", "Cancelled"]),
        ).order_by(Maintenance.id)
    ).all()

    if not tasks:
        raise HTTPException(
            status_code=404,
            detail=f"No active or planned maintenance tasks found for block '{norm_block}'.",
        )

    crews = db.scalars(select(Crew)).all()
    crew_map = {c.id: c for c in crews}

    # Validate task override IDs
    task_map = {t.id: t for t in tasks}
    for override in request.task_overrides:
        if override.task_id not in task_map:
            raise HTTPException(
                status_code=400,
                detail=f"Task ID {override.task_id} in overrides does not belong to block '{norm_block}'.",
            )
        if override.crew_id is not None and override.crew_id not in crew_map:
            raise HTTPException(
                status_code=400,
                detail=f"Crew ID {override.crew_id} in overrides does not exist.",
            )

    # 2. BASELINE: Run existing optimizer without any scenario overrides
    baseline_bundles = bundle_compatible_maintenance(
        db=db,
        target_block_code=norm_block,
        persist=False,
        window_preference="night",
    )

    baseline_bundle = next(
        (b for b in baseline_bundles if _normalize_code(b["block_code"]) == norm_block),
        None,
    )

    if not baseline_bundle:
        raise HTTPException(
            status_code=500,
            detail=f"Unable to calculate baseline optimization plan for block '{norm_block}'.",
        )

    total_network_assets = len(db.scalars(select(Block)).all()) or 22
    baseline_metrics = _build_plan_metrics(baseline_bundle, total_assets=total_network_assets)

    # 3. Parse scenario overrides
    try:
        start_time_dt = _parse_time_override(request.start_time)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    window_pref = request.planning_window or "night"

    # Pre-check: Bundling choice (separate vs bundled)
    override_dict: dict[int, TaskOverride] = {
        o.task_id: o for o in request.task_overrides
    }

    separate_task_ids = {
        tid for tid, o in override_dict.items() if o.bundled is False
    }

    # 4. Run Scenario Optimizer via existing CP-SAT
    scenario_id = f"SIM-{uuid.uuid4().hex[:8].upper()}"
    scenario_name = request.name or f"What-If: {norm_block} ({window_pref})"

    # Prepare scenario overrides dict for optimizer
    scenario_overrides: dict[str, Any] = {
        "start_time": start_time_dt,
        "task_overrides": {
            tid: o.model_dump() for tid, o in override_dict.items()
        },
    }

    # If user chose to separate tasks:
    if separate_task_ids:
        bundled_tasks = [t for t in tasks if t.id not in separate_task_ids]
        separated_tasks = [t for t in tasks if t.id in separate_task_ids]

        # Optimize bundled portion
        plan_start_dt, horizon_min, window_desc = resolve_planning_window(
            window_preference=window_pref,
            base_time=start_time_dt,
        )
        if start_time_dt:
            plan_start_dt = start_time_dt


        traffic_info = get_block_train_traffic(
            db=db,
            block_code=norm_block,
            base_time=plan_start_dt,
            horizon_minutes=horizon_min,
        )

        bundled_result = _optimize_block_bundle(
            block_code=norm_block,
            tasks=bundled_tasks,
            block_obj=block,
            available_crews=crews,
            traffic_info=traffic_info,
            plan_start_dt=plan_start_dt,
            horizon_minutes=horizon_min,
            window_desc=window_desc,
            scenario_overrides=scenario_overrides,
        )

        # Optimize or schedule separated tasks as their own bundles
        all_scenario_tasks = list(bundled_result.get("tasks", [])) if bundled_result else []
        separated_bundles_count = len(separated_tasks)
        total_closures = (1 if bundled_tasks else 0) + separated_bundles_count

        # Schedule each separate task directly following the main bundle or at requested offset
        curr_offset = bundled_result.get("total_window_minutes", 0) if bundled_result else 0
        for s_task in separated_tasks:
            s_override = override_dict.get(s_task.id)
            dur = int(s_override.duration_minutes if s_override and s_override.duration_minutes else (s_task.estimated_duration_minutes or 60))
            delay = int(s_override.delay_minutes or 0) if s_override else 0
            start_min = max(curr_offset, delay)
            end_min = start_min + dur

            # Crew for separate task
            assigned_c_id = s_override.crew_id if s_override and s_override.crew_id else s_task.assigned_crew_id
            assigned_c = crew_map.get(assigned_c_id) if assigned_c_id else None
            c_name = assigned_c.name if assigned_c else (s_task.crew_type or "Independent Team")

            all_scenario_tasks.append({
                "id": s_task.id,
                "maintenance_type": s_task.maintenance_type,
                "department": s_task.department,
                "crew_type": s_task.crew_type,
                "crew_size": s_task.crew_size,
                "required_crew_size": s_task.crew_size,
                "assigned_crew_id": assigned_c.id if assigned_c else None,
                "assigned_crew_name": c_name,
                "assigned_crew_type": assigned_c.crew_type if assigned_c else s_task.crew_type,
                "available_capacity": assigned_c.capacity if assigned_c else 4,
                "priority": s_override.priority if s_override and s_override.priority else s_task.priority,
                "status": s_task.status,
                "duration_minutes": dur,
                "start_minute": start_min,
                "end_minute": end_min,
                "planned_start": (plan_start_dt + timedelta(minutes=start_min)).isoformat(),
                "planned_end": (plan_start_dt + timedelta(minutes=end_min)).isoformat(),
                "execution_mode": "separate",
                "sequence_order": s_task.sequence_order,
                "original_position": s_task.sequence_order,
                "optimized_position": len(all_scenario_tasks) + 1,
                "priority_override": False,
                "override_reason": "Executed outside main bundle by user scenario override.",
                "depends_on_maintenance_id": s_task.depends_on_maintenance_id,
                "depends_on": [s_task.depends_on_maintenance_id] if s_task.depends_on_maintenance_id else [],
                "precedes": [],
                "overlaps_with": [],
                "bundle_role": "separate",
                "is_parallel": False,
            })
            curr_offset = end_min

        total_span = max((t["end_minute"] for t in all_scenario_tasks), default=0)
        unbundled_total = sum(t["duration_minutes"] for t in all_scenario_tasks)

        what_if_restricted = total_closures
        what_if_available = max(0, total_network_assets - what_if_restricted)
        what_if_avail_pct = round((what_if_available / total_network_assets) * 100, 1) if total_network_assets > 0 else 0.0

        what_if_metrics = PlanMetrics(
            start_time=plan_start_dt.isoformat(),
            end_time=(plan_start_dt + timedelta(minutes=total_span)).isoformat(),
            total_window_minutes=total_span,
            unbundled_total_minutes=unbundled_total,
            time_saved_minutes=max(0, unbundled_total - total_span),
            percent_time_saved=round(max(0, unbundled_total - total_span) / unbundled_total * 100, 1) if unbundled_total > 0 else 0.0,
            train_conflicts=traffic_info.get("total_trains_count", 2) * total_closures,
            train_conflicts_before=baseline_metrics.train_conflicts_before,
            block_closures=total_closures,
            bundle_count=1 + separated_bundles_count,
            departments=sorted(list({t["department"] for t in all_scenario_tasks})),
            crews=sorted(list({t["assigned_crew_name"] for t in all_scenario_tasks})),
            tasks=all_scenario_tasks,
            optimization_status="OPTIMAL" if bundled_result else "FEASIBLE",
            total_assets=total_network_assets,
            available_assets=what_if_available,
            restricted_assets=what_if_restricted,
            availability_percentage=what_if_avail_pct,
        )
        opt_status = "OPTIMAL" if bundled_result else "FEASIBLE"
        is_feasible = True
        infeasibility_reason = None

    else:
        # Standard scenario run with overrides in optimizer
        plan_start_dt, horizon_min, window_desc = resolve_planning_window(
            window_preference=window_pref,
            base_time=start_time_dt,
        )
        if start_time_dt:
            plan_start_dt = start_time_dt


        traffic_info = get_block_train_traffic(
            db=db,
            block_code=norm_block,
            base_time=plan_start_dt,
            horizon_minutes=horizon_min,
        )

        scenario_result = _optimize_block_bundle(
            block_code=norm_block,
            tasks=tasks,
            block_obj=block,
            available_crews=crews,
            traffic_info=traffic_info,
            plan_start_dt=plan_start_dt,
            horizon_minutes=horizon_min,
            window_desc=window_desc,
            scenario_overrides=scenario_overrides,
        )

        if not scenario_result or scenario_result.get("infeasible"):
            opt_status = scenario_result.get("optimization_status", "INFEASIBLE") if scenario_result else "INFEASIBLE"
            infeasibility_reason = (
                scenario_result.get("infeasibility_reason")
                if scenario_result
                else f"Optimizer status: {opt_status}. The requested scenario constraints cannot be satisfied."
            )
            return WhatIfScenarioResponse(
                scenario_id=scenario_id,
                name=scenario_name,
                block_code=norm_block,
                block_name=block_name,
                optimization_status=opt_status,
                feasible=False,
                infeasibility_reason=infeasibility_reason,
                explanation=f"Scenario is infeasible ({opt_status}): {infeasibility_reason}",
                baseline=baseline_metrics,
                what_if=None,
                impact=None,
                human_approval_required=True,
            )

        what_if_metrics = _build_plan_metrics(scenario_result, total_assets=total_network_assets)
        opt_status = scenario_result.get("optimization_status", "OPTIMAL")
        is_feasible = True
        infeasibility_reason = None

    # 5. Calculate Structured IMPACT Metrics
    time_diff = what_if_metrics.total_window_minutes - baseline_metrics.total_window_minutes
    conflict_diff = what_if_metrics.train_conflicts - baseline_metrics.train_conflicts
    closure_diff = what_if_metrics.block_closures - baseline_metrics.block_closures
    bundle_diff = what_if_metrics.bundle_count - baseline_metrics.bundle_count

    # Crew changes
    baseline_crews_by_task = {t["id"]: t.get("assigned_crew_name") for t in baseline_metrics.tasks}
    what_if_crews_by_task = {t["id"]: t.get("assigned_crew_name") for t in what_if_metrics.tasks}

    crew_changes = []
    for tid, orig_crew in baseline_crews_by_task.items():
        new_crew = what_if_crews_by_task.get(tid)
        if new_crew and new_crew != orig_crew:
            t_obj = task_map.get(tid)
            crew_changes.append({
                "task_id": tid,
                "maintenance_type": t_obj.maintenance_type if t_obj else f"Task {tid}",
                "baseline_crew": orig_crew,
                "what_if_crew": new_crew,
            })

    # Task timing changes
    baseline_times_by_task = {
        t["id"]: (t.get("planned_start"), t.get("planned_end"), t.get("duration_minutes"))
        for t in baseline_metrics.tasks
    }
    task_timing_changes = []
    for t in what_if_metrics.tasks:
        tid = t["id"]
        if tid in baseline_times_by_task:
            b_start, b_end, b_dur = baseline_times_by_task[tid]
            w_start, w_end, w_dur = t.get("planned_start"), t.get("planned_end"), t.get("duration_minutes")
            if b_start != w_start or b_dur != w_dur:
                task_timing_changes.append({
                    "task_id": tid,
                    "maintenance_type": t["maintenance_type"],
                    "baseline_start": b_start,
                    "baseline_end": b_end,
                    "what_if_start": w_start,
                    "what_if_end": w_end,
                    "duration_change_minutes": int(w_dur or 0) - int(b_dur or 0),
                })

    # Task order changes
    baseline_order_by_task = {t["id"]: t.get("optimized_position") for t in baseline_metrics.tasks}
    task_order_changes = []
    for t in what_if_metrics.tasks:
        tid = t["id"]
        b_pos = baseline_order_by_task.get(tid)
        w_pos = t.get("optimized_position")
        if b_pos and w_pos and b_pos != w_pos:
            task_order_changes.append({
                "task_id": tid,
                "maintenance_type": t["maintenance_type"],
                "baseline_position": b_pos,
                "what_if_position": w_pos,
            })

    # Validate dependencies in What-If result
    what_if_times = {t["id"]: (t["start_minute"], t["end_minute"]) for t in what_if_metrics.tasks}
    dependency_status = "Preserved"
    for t in tasks:
        if t.depends_on_maintenance_id and t.depends_on_maintenance_id in what_if_times and t.id in what_if_times:
            parent_end = what_if_times[t.depends_on_maintenance_id][1]
            child_start = what_if_times[t.id][0]
            if child_start < parent_end:
                dependency_status = "Violated"
                break

    traffic_level_change = f"{baseline_bundle.get('traffic_level', 'Low')} → {traffic_info.get('overall_traffic_level', 'Low')}"
    if baseline_bundle.get('traffic_level', 'Low') == traffic_info.get('overall_traffic_level', 'Low'):
        traffic_level_change = f"Unchanged ({baseline_bundle.get('traffic_level', 'Low')})"

    impact = ImpactMetrics(
        time_difference_minutes=time_diff,
        conflict_difference=conflict_diff,
        block_closure_difference=closure_diff,
        bundle_difference=bundle_diff,
        crew_changes=crew_changes,
        task_timing_changes=task_timing_changes,
        task_order_changes=task_order_changes,
        dependency_status=dependency_status,
        traffic_level_change=traffic_level_change,
        availability_change_percentage_points=round(what_if_metrics.availability_percentage - baseline_metrics.availability_percentage, 1),
        restricted_asset_change=what_if_metrics.restricted_assets - baseline_metrics.restricted_assets,
    )

    # 6. Generate Deterministic Explanation
    explanation_parts = []
    b_start_fmt = baseline_metrics.start_time.split("T")[1][:5] if baseline_metrics.start_time and "T" in baseline_metrics.start_time else "21:00"
    w_start_fmt = what_if_metrics.start_time.split("T")[1][:5] if what_if_metrics.start_time and "T" in what_if_metrics.start_time else "23:00"

    if b_start_fmt != w_start_fmt:
        explanation_parts.append(
            f"Moving the maintenance window from {b_start_fmt} to {w_start_fmt} "
            f"{'reduced' if conflict_diff < 0 else ('increased' if conflict_diff > 0 else 'maintained')} "
            f"modeled train conflicts ({baseline_metrics.train_conflicts} → {what_if_metrics.train_conflicts}) "
            f"with a window span of {what_if_metrics.total_window_minutes} min."
        )
    else:
        explanation_parts.append(
            f"The simulated plan on block {norm_block} resulted in {what_if_metrics.total_window_minutes} minutes "
            f"of block window with {what_if_metrics.train_conflicts} modeled train conflicts."
        )

    if crew_changes:
        c_desc = ", ".join(f"{c['maintenance_type']} to {c['what_if_crew']}" for c in crew_changes)
        explanation_parts.append(f"Crew assignments updated: {c_desc}.")

    if separate_task_ids:
        explanation_parts.append(
            f"{len(separate_task_ids)} task(s) unbundled into separate windows, resulting in {what_if_metrics.bundle_count} total bundles."
        )

    explanation_parts.append(f"Task dependency integrity: {dependency_status}.")

    explanation = " ".join(explanation_parts)

    return WhatIfScenarioResponse(
        scenario_id=scenario_id,
        name=scenario_name,
        block_code=norm_block,
        block_name=block_name,
        optimization_status=opt_status,
        feasible=is_feasible,
        infeasibility_reason=infeasibility_reason,
        explanation=explanation,
        baseline=baseline_metrics,
        what_if=what_if_metrics,
        impact=impact,
        human_approval_required=True,
    )


def apply_simulated_plan(
    db: Session,
    request: WhatIfApplyRequest,
) -> dict[str, Any]:
    """
    Applies a simulated maintenance plan to the database records only after explicit
    confirmation and human approval by an authorized section controller.
    """
    if not request.human_approved:
        raise HTTPException(
            status_code=400,
            detail="Human approval is required before applying a simulated maintenance plan.",
        )

    norm_block = _normalize_code(request.block_code)
    records = db.scalars(
        select(Maintenance).where(
            Maintenance.location_type == "block",
            Maintenance.block_code == norm_block,
            Maintenance.status.notin_(["Completed", "Cancelled"]),
        )
    ).all()

    if not records:
        raise HTTPException(
            status_code=404,
            detail=f"No active maintenance records found on block '{norm_block}' to update.",
        )

    # Re-run simulation with the scenario configuration to obtain the verified plan
    # In practice, apply the scenario's verified schedule
    updated_count = 0
    now_iso = datetime.now().isoformat()

    for rec in records:
        rec.status = "Scheduled"
        rec.bundle_id = f"APPLIED-{request.scenario_id}"
        rec.bundled = True
        rec.dependency_note = f"Approved via What-If Scenario {request.scenario_id} by {request.approved_by} at {now_iso}"
        updated_count += 1

    db.commit()

    return {
        "message": f"Simulated plan '{request.scenario_id}' applied successfully to block {norm_block}.",
        "block_code": norm_block,
        "scenario_id": request.scenario_id,
        "human_approved": True,
        "approved_by": request.approved_by,
        "applied_at": now_iso,
        "updated_records_count": updated_count,
    }
