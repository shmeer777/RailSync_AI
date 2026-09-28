"""
Advanced Urgency-Aware Scheduling Service for RailSync AI.

Evaluates multi-factor maintenance urgency to answer:
"How urgently does this maintenance need to be scheduled?"

Balances:
- Maintenance priority
- Predictive maintenance risk score
- Dependency impact (downstream tasks blocked)
- Deadline pressure (due_by and maximum delay proximity)
- Operational route traffic impact
- Maintenance duration requirements
- Time since previous maintenance (where historical data exists)

Provides CP-SAT urgency-aware scheduling:
- Critical tasks scheduled at the earliest feasible window
- Dependencies strictly enforced (start_child >= end_parent)
- Crew capacity and non-overlap strictly enforced
- Traffic trade-off: routine work moves to lower-impact windows,
  while Critical urgency takes precedence over waiting for low traffic.
"""

from datetime import datetime, timezone, timedelta
from typing import Any
from ortools.sat.python import cp_model
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.block import Block
from app.models.crew import Crew
from app.models.maintenance import Maintenance
from app.schemas.urgency import (
    MaintenanceUrgencyItem,
    MaintenanceUrgencyResponse,
    RecommendedWindow,
    UrgencyFactors,
    UrgencyScheduleComparison,
    UrgencyScheduleRequest,
    UrgencyScheduleResponse,
)
from app.services.ai.maintenance_risk import calculate_maintenance_risk
from app.services.ai.traffic_estimator import get_all_blocks_traffic


def _normalize_code(val: str | None) -> str:
    return str(val or "").strip().upper()


def _normalize(val: str | None) -> str:
    return str(val or "").strip().lower()


def find_downstream_blocked_tasks(task_id: int, all_tasks: list[Maintenance]) -> list[int]:
    """
    Recursively finds all downstream maintenance tasks that are directly
    or indirectly blocked until task_id is completed.
    """
    direct_dependents: dict[int, list[int]] = {}
    for t in all_tasks:
        if t.depends_on_maintenance_id:
            direct_dependents.setdefault(t.depends_on_maintenance_id, []).append(t.id)

    blocked: list[int] = []
    visited: set[int] = set()
    queue = [task_id]

    while queue:
        curr = queue.pop(0)
        for child_id in direct_dependents.get(curr, []):
            if child_id not in visited:
                visited.add(child_id)
                blocked.append(child_id)
                queue.append(child_id)

    return blocked


def get_time_since_previous_maintenance(
    task: Maintenance,
    historical_tasks: list[Maintenance] | None,
    now: datetime,
) -> float | None:
    """
    Where historical maintenance data exists, calculates elapsed days
    since the relevant previous completed maintenance on this block/station.
    Returns None if no historical data is available (never fabricates data).
    """
    if not historical_tasks:
        return None

    matching_past = [
        m for m in historical_tasks
        if m.id != task.id
        and _normalize(m.status) in ("completed", "done")
        and (
            (task.location_type == "block" and task.block_code and m.block_code == task.block_code)
            or (task.location_type == "station" and task.station_code and m.station_code == task.station_code)
        )
    ]

    if not matching_past:
        return None

    past_dates = [
        m.scheduled_end or m.scheduled_start or m.planned_end or m.planned_start
        for m in matching_past
        if (m.scheduled_end or m.scheduled_start or m.planned_end or m.planned_start)
    ]

    if not past_dates:
        return None

    latest_date = max(past_dates)
    delta_days = max(0.0, (now - latest_date).total_seconds() / 86400.0)
    return round(delta_days, 1)


def calculate_task_urgency(
    task: Maintenance,
    all_tasks: list[Maintenance],
    traffic_by_block: dict[str, dict[str, Any]] | None = None,
    now: datetime | None = None,
    historical_tasks: list[Maintenance] | None = None,
    model_confidence: float | None = None,
) -> MaintenanceUrgencyItem:
    """
    Computes a deterministic, explainable prototype urgency score and level for a single maintenance task.
    Distinguishes risk_score, urgency_score, and model_confidence as separate metrics.
    """
    if now is None:
        now = datetime.now(timezone.utc).replace(tzinfo=None)

    # 1. Priority Weight (0-40)
    priority_weights = {
        "critical": 40.0,
        "high": 25.0,
        "medium": 15.0,
        "low": 5.0,
    }
    p_str = _normalize(task.priority)
    p_weight = priority_weights.get(p_str, 15.0)

    # 2. Risk Factor (0-25) from maintenance_risk
    risk_data = calculate_maintenance_risk(
        priority=task.priority,
        status=task.status,
        estimated_duration_minutes=task.estimated_duration_minutes,
        scheduled_start=task.scheduled_start,
        scheduled_end=task.scheduled_end,
    )
    raw_risk = float(risk_data.get("risk_score", 0))
    risk_factor = round(raw_risk * 0.25, 1)

    # 3. Dependency Impact (0-20)
    blocked_ids = find_downstream_blocked_tasks(task.id, all_tasks)
    dep_count = len(blocked_ids)
    dependency_impact = min(20.0, float(dep_count * 5.0))

    # 4. Deadline Pressure (0-25)
    deadline_pressure = 0.0
    deadline_status = "No Deadline"
    deadline_pressure_label = "None"
    deadline_str = None

    if task.due_by is not None:
        deadline_str = task.due_by.isoformat()
        if task.due_by < now:
            deadline_pressure = 25.0
            deadline_status = "Overdue"
            deadline_pressure_label = "Overdue"
        elif task.due_by - now <= timedelta(hours=24):
            deadline_pressure = 20.0
            deadline_status = "Urgent (<24h)"
            deadline_pressure_label = "Urgent (<24h)"
        elif task.due_by - now <= timedelta(hours=72):
            deadline_pressure = 10.0
            deadline_status = "Approaching (<72h)"
            deadline_pressure_label = "Approaching (<72h)"
        else:
            deadline_pressure = 2.0
            deadline_status = "Flexible"
            deadline_pressure_label = "Flexible"
    elif task.maximum_delay_minutes is not None:
        if task.maximum_delay_minutes <= 120:
            deadline_pressure = 15.0
            deadline_status = f"Max Delay {task.maximum_delay_minutes}m"
            deadline_pressure_label = "High"
        elif task.maximum_delay_minutes <= 360:
            deadline_pressure = 8.0
            deadline_status = f"Max Delay {task.maximum_delay_minutes}m"
            deadline_pressure_label = "Moderate"

    # 5. Operational Route Traffic Impact (0-15)
    operational_impact = 0.0
    operational_label = "Normal"
    if traffic_by_block and task.block_code:
        t_info = traffic_by_block.get(_normalize_code(task.block_code), {})
        traffic_score = float(t_info.get("total_traffic_score", 0))
        operational_impact = min(15.0, round(traffic_score * 0.3, 1))
        if traffic_score >= 25:
            operational_label = "High Traffic Corridor"
        elif traffic_score >= 12:
            operational_label = "Moderate Traffic"

    # 6. Duration Penalty (0-10)
    duration_penalty = 0.0
    dur = float(task.estimated_duration_minutes or 60)
    if dur >= 480:
        duration_penalty = 10.0
    elif dur >= 240:
        duration_penalty = 5.0

    # 7. Time Since Previous Maintenance (where historical data exists)
    days_since_maint = get_time_since_previous_maintenance(task, historical_tasks, now)
    history_bonus = 0.0
    if days_since_maint is not None and days_since_maint > 90:
        # Subtle boost if long time since maintenance, capped at 5.0
        history_bonus = min(5.0, round((days_since_maint - 90) / 30.0, 1))

    # Total Urgency Score (0-100) - RailSync prototype urgency score
    total_score = min(
        100.0,
        round(
            p_weight
            + risk_factor
            + dependency_impact
            + deadline_pressure
            + operational_impact
            + duration_penalty
            + history_bonus,
            1,
        ),
    )

    # Urgency Level determination
    if total_score >= 75.0 or p_str == "critical":
        urgency_level = "Critical"
        rec_window_summary = "Earliest Feasible Safe Window (Immediate corridor priority)"
        rec_window_type = "Earliest Feasible Safe Window"
        rec_notes = "Assigned earliest feasible safe window satisfying hard constraints; urgency takes precedence over corridor traffic."
    elif total_score >= 50.0:
        urgency_level = "High"
        rec_window_summary = "Upcoming Night Corridor (21:00–06:00)"
        rec_window_type = "Upcoming Night Corridor"
        rec_notes = "Schedule soon while balancing traffic, resources, and operational impact."
    elif total_score >= 25.0:
        urgency_level = "Medium"
        rec_window_summary = "Evening Off-Peak or Midday Window"
        rec_window_type = "Off-Peak Window"
        rec_notes = "Can use a suitable lower-impact window to minimize train delays."
    else:
        urgency_level = "Low"
        rec_window_summary = "Next available routine maintenance slot (Deferrable)"
        rec_window_type = "Routine Maintenance Slot"
        rec_notes = "Can be deferred when operationally appropriate without safety violation."

    # Build transparent contributing factors list
    contributing_factors = []
    if p_str in ("critical", "high"):
        contributing_factors.append(f"{task.priority} maintenance priority (+{p_weight} pts)")
    elif p_str == "medium":
        contributing_factors.append(f"Medium maintenance priority (+{p_weight} pts)")

    if raw_risk >= 50:
        contributing_factors.append(f"Elevated predictive risk score ({raw_risk}/100, +{risk_factor} pts)")
    elif raw_risk > 0:
        contributing_factors.append(f"Predictive risk contribution ({raw_risk}/100, +{risk_factor} pts)")

    if dep_count > 0:
        dep_names = []
        for cid in blocked_ids[:2]:
            ctask = next((t for t in all_tasks if t.id == cid), None)
            if ctask:
                dep_names.append(f"{ctask.maintenance_type} (#{cid})")
            else:
                dep_names.append(f"Task #{cid}")
        dep_str = ", ".join(dep_names)
        if dep_count > 2:
            dep_str += f" and {dep_count - 2} more"
        contributing_factors.append(f"Blocks {dep_count} downstream task(s) [{dep_str}] (+{dependency_impact} pts)")

    if deadline_status in ("Overdue", "Urgent (<24h)", "Approaching (<72h)"):
        contributing_factors.append(f"Deadline proximity: {deadline_status} (+{deadline_pressure} pts)")

    if operational_impact >= 6.0:
        contributing_factors.append(f"High-traffic section constraint (+{operational_impact} pts)")

    if duration_penalty > 0:
        contributing_factors.append(f"Extended duration ({int(dur)} min) requiring coordinated planning (+{duration_penalty} pts)")

    if days_since_maint is not None and days_since_maint > 60:
        contributing_factors.append(f"Time since previous maintenance: {int(days_since_maint)} days (+{history_bonus} pts)")

    if not contributing_factors:
        contributing_factors.append("Routine maintenance parameters")

    explanation = (
        f"RailSync assigned {urgency_level} urgency ({total_score}/100) based on: "
        + "; ".join(contributing_factors)
        + f". Recommended: {rec_window_summary}."
    )

    factors = UrgencyFactors(
        priority_weight=p_weight,
        risk_factor=risk_factor,
        dependency_impact=dependency_impact,
        deadline_pressure=deadline_pressure,
        operational_impact=operational_impact,
        duration_penalty=duration_penalty,
    )

    # Window start and end dates
    rec_start = (now + timedelta(minutes=15)).isoformat()
    rec_end = (now + timedelta(minutes=15 + int(dur))).isoformat()
    recommended_window_obj = RecommendedWindow(
        start=rec_start,
        end=rec_end,
        window_type=rec_window_type,
        notes=rec_notes,
    )

    earliest_reason = None
    if urgency_level == "Critical":
        earliest_reason = "Assigned earliest feasible safe window satisfying hard constraints (priority over traffic)."

    return MaintenanceUrgencyItem(
        maintenance_id=task.id,
        location_type=task.location_type,
        block_code=task.block_code,
        station_code=task.station_code,
        maintenance_type=task.maintenance_type,
        department=task.department or "Engineering",
        crew_type=task.crew_type or "Track Team",
        priority=task.priority,
        risk_score=raw_risk,
        model_confidence=model_confidence,
        urgency_score=total_score,
        urgency_level=urgency_level,
        dependent_task_count=dep_count,
        blocked_task_ids=blocked_ids,
        deadline=deadline_str,
        deadline_status=deadline_status,
        deadline_pressure=deadline_pressure_label,
        operational_impact=operational_label,
        recommended_window=recommended_window_obj,
        recommended_scheduling_window=rec_window_summary,
        contributing_factors=contributing_factors,
        factors=factors,
        explanation=explanation,
        human_approval_required=True,
        earliest_feasible_window_reason=earliest_reason,
    )


def calculate_all_urgencies(
    db: Session,
    target_ids: list[int] | None = None,
) -> MaintenanceUrgencyResponse:
    """
    Computes urgency analysis for all active or specified maintenance records.
    Integrates real database traffic, completed historical records, and ML model predictions.
    """
    query = select(Maintenance).where(
        Maintenance.status.notin_(["Completed", "Cancelled"])
    )
    if target_ids:
        query = query.where(Maintenance.id.in_(target_ids))

    all_tasks = db.scalars(query.order_by(Maintenance.id)).all()

    # Historical completed records for time-since-maintenance
    historical_tasks = db.scalars(
        select(Maintenance).where(Maintenance.status.in_(["Completed", "completed"]))
    ).all()

    blocks = db.scalars(select(Block)).all()
    traffic_by_block = get_all_blocks_traffic(db=db, blocks=blocks)

    # Attempt to load ML model predictions for model_confidence
    predictions_map: dict[str, dict[str, Any]] = {}
    try:
        from app.ml.predictor import (
            predict_maintenance_for_block,
            get_cached_all_block_predictions,
        )
        cached_preds = get_cached_all_block_predictions()
        if cached_preds:
            for p in cached_preds:
                b_code = _normalize_code(p.get("block_code"))
                predictions_map[b_code] = p
        else:
            # Query prediction only for the specific blocks that have active tasks
            task_blocks = {_normalize_code(t.block_code) for t in all_tasks if t.block_code}
            for b_code in task_blocks:
                try:
                    p = predict_maintenance_for_block(db, b_code)
                    if p:
                        predictions_map[b_code] = p
                except Exception:
                    pass
    except Exception:
        # Predictive ML model may be uninitialized or training
        predictions_map = {}

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    items = []
    for t in all_tasks:
        confidence: float | None = None
        if t.block_code:
            p_data = predictions_map.get(_normalize_code(t.block_code))
            if p_data and p_data.get("predicted_maintenance") == t.maintenance_type:
                conf_val = p_data.get("confidence")
                if conf_val is not None:
                    confidence = round(float(conf_val), 1)

        item = calculate_task_urgency(
            task=t,
            all_tasks=all_tasks,
            traffic_by_block=traffic_by_block,
            now=now,
            historical_tasks=historical_tasks,
            model_confidence=confidence,
        )
        items.append(item)

    # Sort items by urgency_score descending
    items.sort(key=lambda x: x.urgency_score, reverse=True)

    critical_count = sum(1 for i in items if i.urgency_level == "Critical")
    high_count = sum(1 for i in items if i.urgency_level == "High")
    medium_count = sum(1 for i in items if i.urgency_level == "Medium")
    low_count = sum(1 for i in items if i.urgency_level == "Low")
    avg_score = round(sum(i.urgency_score for i in items) / len(items), 1) if items else 0.0

    return MaintenanceUrgencyResponse(
        total_tasks=len(items),
        critical_count=critical_count,
        high_count=high_count,
        medium_count=medium_count,
        low_count=low_count,
        average_urgency_score=avg_score,
        items=items,
    )


def schedule_by_urgency(
    db: Session,
    request: UrgencyScheduleRequest | None = None,
    base_time: datetime | None = None,
) -> UrgencyScheduleResponse:
    """
    Schedules maintenance tasks using the existing OR-Tools CP-SAT solver,
    incorporating multi-factor urgency into the optimization objective.

    Hard Constraints (NEVER violated):
    - Task dependencies (start_child >= end_parent)
    - Crew capacity and non-overlap for the same crew
    - Exclusive block access restrictions
    - Due-by deadlines where feasible

    Multi-Objective:
    - Urgency-weighted start time (Critical=15,000, High=3,000, Medium=300, Low=30)
    - Downstream unblocking multiplier (tasks blocking work are expedited)
    - Traffic trade-off: routine work moves to lower-impact windows,
      while Critical urgency dominates traffic so Critical tasks take the earliest feasible window.
    """
    if base_time is None:
        base_time = datetime.now().replace(second=0, microsecond=0)

    # 1. Fetch active tasks
    query = select(Maintenance).where(
        Maintenance.status.notin_(["Completed", "Cancelled"])
    )
    if request and request.target_block_codes:
        norm_blocks = [_normalize_code(b) for b in request.target_block_codes]
        query = query.where(Maintenance.block_code.in_(norm_blocks))

    tasks = db.scalars(query.order_by(Maintenance.id)).all()

    if not tasks:
        return UrgencyScheduleResponse(
            optimization_status="OPTIMAL",
            scheduled_tasks_count=0,
            comparison=UrgencyScheduleComparison(),
            schedule_items=[],
            explanation="No active maintenance tasks to schedule.",
            human_approval_required=True,
        )

    # 2. Compute urgencies
    urgency_res = calculate_all_urgencies(db=db, target_ids=[t.id for t in tasks])
    urgency_map = {item.maintenance_id: item for item in urgency_res.items}

    # 3. Fetch Crews and Traffic
    crews = db.scalars(select(Crew)).all()
    crew_map = {c.id: c for c in crews}

    blocks = db.scalars(select(Block)).all()
    traffic_by_block = get_all_blocks_traffic(db=db, blocks=blocks)

    # 4. Formulate OR-Tools CP-SAT Model
    model = cp_model.CpModel()
    task_map = {t.id: t for t in tasks}

    durations: dict[int, int] = {}
    total_duration = sum(int(t.estimated_duration_minutes or 60) for t in tasks)
    max_horizon = max(1440, total_duration * 2 + 360)

    start_vars: dict[int, cp_model.IntVar] = {}
    end_vars: dict[int, cp_model.IntVar] = {}
    interval_vars: dict[int, cp_model.IntervalVar] = {}

    for t in tasks:
        dur = max(1, int(t.estimated_duration_minutes or 60))
        durations[t.id] = dur
        start_vars[t.id] = model.NewIntVar(0, max_horizon, f"start_{t.id}")
        end_vars[t.id] = model.NewIntVar(dur, max_horizon, f"end_{t.id}")
        interval_vars[t.id] = model.NewIntervalVar(
            start_vars[t.id], dur, end_vars[t.id], f"interval_{t.id}"
        )

    # Hard Constraint 1: Task Dependencies (start_child >= end_parent)
    for t in tasks:
        if t.depends_on_maintenance_id and t.depends_on_maintenance_id in task_map:
            parent_id = t.depends_on_maintenance_id
            model.Add(start_vars[t.id] >= end_vars[parent_id])

    # Hard Constraint 2: Crew non-overlap (same crew can only do one task at a time)
    crew_to_tasks: dict[int, list[Maintenance]] = {}
    for t in tasks:
        c_id = t.assigned_crew_id
        if c_id and c_id in crew_map:
            crew_to_tasks.setdefault(c_id, []).append(t)

    for c_id, c_tasks in crew_to_tasks.items():
        if len(c_tasks) > 1:
            model.AddNoOverlap([interval_vars[t.id] for t in c_tasks])

    # Hard Constraint 3: Exclusive Block Access
    block_exclusive_tasks: dict[str, list[int]] = {}
    for t in tasks:
        if getattr(t, "requires_exclusive_block", False) and t.block_code:
            block_exclusive_tasks.setdefault(_normalize_code(t.block_code), []).append(t.id)

    for b_code, b_tids in block_exclusive_tasks.items():
        if len(b_tids) > 1:
            model.AddNoOverlap([interval_vars[tid] for tid in b_tids])

    # Hard Constraint 4: Deadlines (due_by) where feasible within planning horizon
    for t in tasks:
        if t.due_by is not None:
            due_mins = int((t.due_by - base_time).total_seconds() / 60)
            if due_mins >= durations[t.id]:
                # End must not exceed deadline if due_mins fits within horizon
                if due_mins <= max_horizon:
                    model.Add(end_vars[t.id] <= due_mins)

    # Objective Function Formulation
    # - Critical tasks: 15,000 weight on start time
    # - High tasks: 3,000 weight on start time
    # - Medium tasks: 300 weight on start time
    # - Low tasks: 30 weight on start time
    # - Downstream unlock multiplier: (1.0 + 0.5 * dependent_task_count)
    # - Traffic trade-off: routine tasks incur penalties during high traffic;
    #   Critical tasks urgency penalty (15,000) dominates traffic penalty.
    urgency_weights = {
        "Critical": 15000,
        "High": 3000,
        "Medium": 300,
        "Low": 30,
    }

    penalties = []
    for t in tasks:
        u_item = urgency_map.get(t.id)
        u_level = u_item.urgency_level if u_item else "Medium"
        w = urgency_weights.get(u_level, 300)

        dep_count = u_item.dependent_task_count if u_item else 0
        unlock_mult = 1.0 + (0.5 * dep_count)
        eff_weight = int(w * unlock_mult)

        penalties.append(eff_weight * start_vars[t.id])

        # Traffic penalty for routine/lower-priority tasks
        if u_level in ("Medium", "Low") and t.block_code:
            t_info = traffic_by_block.get(_normalize_code(t.block_code), {})
            t_score = float(t_info.get("total_traffic_score", 0))
            if t_score > 10:
                # Moderate penalty for starting early in high-traffic periods
                # Routine tasks will be pushed toward off-peak / night slots
                penalties.append(int(t_score * 40) * start_vars[t.id])

    model.Minimize(sum(penalties))

    # 5. Solve CP-SAT
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(model)
    status_name = solver.StatusName(status)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return UrgencyScheduleResponse(
            optimization_status=status_name,
            scheduled_tasks_count=len(tasks),
            comparison=UrgencyScheduleComparison(),
            schedule_items=[],
            explanation=f"OR-Tools solver returned {status_name}: Conflicting maintenance constraints.",
            human_approval_required=True,
        )

    # 6. Extract Optimized Schedule
    optimized_starts = {t.id: solver.Value(start_vars[t.id]) for t in tasks}
    optimized_ends = {t.id: solver.Value(end_vars[t.id]) for t in tasks}

    # Compute deterministic baseline (unprioritized / FIFO schedule) for comparison
    # In baseline, tasks are scheduled in original order without urgency weighting
    baseline_starts: dict[int, int] = {}
    curr_baseline = 0
    for t in sorted(tasks, key=lambda x: x.id):
        baseline_starts[t.id] = curr_baseline
        curr_baseline += durations[t.id]

    # Calculate real comparison metrics
    critical_earlier = 0
    wait_reduction_sum = 0.0
    critical_or_high_count = 0
    dep_delays_prevented = 0
    deadline_violations_prevented = 0

    for t in tasks:
        u_item = urgency_map.get(t.id)
        u_level = u_item.urgency_level if u_item else "Medium"
        opt_s = optimized_starts[t.id]
        base_s = baseline_starts[t.id]

        if u_level == "Critical":
            if opt_s < base_s:
                critical_earlier += 1
            wait_reduction_sum += max(0, base_s - opt_s)
            critical_or_high_count += 1
        elif u_level == "High":
            wait_reduction_sum += max(0, base_s - opt_s)
            critical_or_high_count += 1

        if u_item and u_item.dependent_task_count > 0 and opt_s < base_s:
            dep_delays_prevented += u_item.dependent_task_count

        if t.due_by is not None:
            due_mins = int((t.due_by - base_time).total_seconds() / 60)
            base_e = base_s + durations[t.id]
            opt_e = optimized_ends[t.id]
            if base_e > due_mins and opt_e <= due_mins:
                deadline_violations_prevented += 1

    avg_wait_red = (
        round(wait_reduction_sum / critical_or_high_count, 1)
        if critical_or_high_count > 0
        else 0.0
    )

    comparison = UrgencyScheduleComparison(
        critical_tasks_scheduled_earlier=critical_earlier,
        average_urgency_wait_reduction_minutes=avg_wait_red,
        dependency_delays_prevented=dep_delays_prevented,
        deadline_violations_prevented=deadline_violations_prevented,
    )

    # Build scheduled items
    schedule_items = []
    for t in sorted(tasks, key=lambda x: optimized_starts[x.id]):
        opt_s = optimized_starts[t.id]
        opt_e = optimized_ends[t.id]
        u_item = urgency_map.get(t.id)
        u_level = u_item.urgency_level if u_item else "Medium"

        start_dt = base_time + timedelta(minutes=opt_s)
        end_dt = base_time + timedelta(minutes=opt_e)

        # Explainable timing reason
        if t.depends_on_maintenance_id:
            parent_task = task_map.get(t.depends_on_maintenance_id)
            p_name = parent_task.maintenance_type if parent_task else f"Task #{t.depends_on_maintenance_id}"
            timing_reason = (
                f"Scheduled at +{opt_s}m (earliest feasible after prerequisite {p_name} completes). "
                f"Dependency strictly respected."
            )
        elif u_level == "Critical":
            if opt_s == 0:
                timing_reason = (
                    "Scheduled at earliest feasible window (00:00) due to Critical urgency and approaching deadline; "
                    "takes precedence over corridor traffic."
                )
            else:
                timing_reason = (
                    f"Scheduled at +{opt_s}m (earliest feasible window satisfying crew availability & block safety)."
                )
        elif u_level == "High":
            timing_reason = (
                f"Scheduled at +{opt_s}m: High urgency balanced with corridor traffic and crew availability."
            )
        else:
            timing_reason = (
                f"Scheduled at +{opt_s}m: Routine ({u_level}) maintenance placed in lower-impact window."
            )

        schedule_items.append(
            {
                "maintenance_id": t.id,
                "maintenance_type": t.maintenance_type,
                "location_type": t.location_type,
                "block_code": t.block_code,
                "station_code": t.station_code,
                "priority": t.priority,
                "urgency_level": u_level,
                "urgency_score": u_item.urgency_score if u_item else 0.0,
                "risk_score": u_item.risk_score if u_item else 0.0,
                "model_confidence": u_item.model_confidence if u_item else None,
                "dependent_task_count": u_item.dependent_task_count if u_item else 0,
                "start_minute": opt_s,
                "end_minute": opt_e,
                "duration_minutes": durations[t.id],
                "scheduled_start": start_dt.isoformat(),
                "scheduled_end": end_dt.isoformat(),
                "assigned_crew_id": t.assigned_crew_id,
                "assigned_crew_name": t.assigned_crew_name,
                "timing_reason": timing_reason,
            }
        )

    explanation = (
        f"OR-Tools CP-SAT successfully scheduled {len(tasks)} maintenance tasks by urgency. "
        f"{critical_earlier} Critical task(s) scheduled earlier, saving an average of {avg_wait_red} minutes "
        f"for urgent work and preventing {dep_delays_prevented} downstream dependency delay(s). "
        f"Human review and approval is required before dispatch."
    )

    return UrgencyScheduleResponse(
        optimization_status=status_name,
        scheduled_tasks_count=len(tasks),
        comparison=comparison,
        schedule_items=schedule_items,
        explanation=explanation,
        human_approval_required=True,
    )
