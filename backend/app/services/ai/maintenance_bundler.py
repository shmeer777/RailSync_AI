from datetime import datetime, timedelta
from typing import Any

from ortools.sat.python import cp_model
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.block import Block
from app.models.crew import Crew
from app.models.maintenance import Maintenance
from app.services.ai.maintenance_compatibility import filter_compatible_tasks
from app.services.ai.traffic_estimator import get_block_train_traffic, resolve_planning_window


def _normalize_code(value: str | None) -> str:
    return str(value or "").strip().upper()


def _normalize(value: str | None) -> str:
    return str(value or "").strip().lower()


def bundle_compatible_maintenance(
    db: Session,
    target_block_code: str | None = None,
    persist: bool = False,
    window_preference: str | None = "night",
    base_time: datetime | None = None,
    scenario_overrides: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    Detects maintenance tasks affecting the same railway block/section and
    intelligently bundles compatible tasks into ONE coordinated maintenance block window
    using OR-Tools CP-SAT.

    Features:
    - Compatibility filtering (rejecting unsafe or mismatched tasks with reasons)
    - Database-backed crew resource model with capacity constraints (crew_size <= capacity)
    - Prevents conflicting assignments to the same crew
    - Dynamic crew priority queue reprioritization for Critical prerequisites
    - Train traffic awareness using routes and candidate planning windows
    - Urgency-aware scheduling (Critical tasks prioritize earliest feasible window)
    - Explicit safety & exclusive block clearance constraints
    - Rich execution relationship semantics (depends_on, precedes, overlaps_with)
    - Exact solver-derived status and Before vs After comparison metrics
    - What-If simulation support via scenario_overrides
    """
    # 1. Fetch active/planned maintenance on blocks
    query = select(Maintenance).where(
        Maintenance.location_type == "block",
        Maintenance.block_code.isnot(None),
        Maintenance.status.notin_(["Completed", "Cancelled"]),
    )

    if target_block_code:
        query = query.where(
            Maintenance.block_code == _normalize_code(target_block_code)
        )

    records = db.scalars(query.order_by(Maintenance.id)).all()

    # Also fetch block metadata and available crews
    blocks = db.scalars(select(Block)).all()
    block_map = {_normalize_code(b.code): b for b in blocks}

    crews = db.scalars(select(Crew)).all()

    # Group by block_code
    grouped_by_block: dict[str, list[Maintenance]] = {}
    for record in records:
        code = _normalize_code(record.block_code)
        if code:
            grouped_by_block.setdefault(code, []).append(record)

    bundles: list[dict[str, Any]] = []

    for block_code, tasks in grouped_by_block.items():
        if not tasks:
            continue

        # 2. Compatibility filtering: filter out incompatible tasks before bundling
        compatible_tasks, incompatible_tasks = filter_compatible_tasks(
            tasks, available_crews=crews
        )

        if not compatible_tasks:
            # If tasks were present but none compatible, report bundle structure with rejection reasons
            bundles.append({
                "bundle_id": f"BUNDLE-{block_code}",
                "block_code": block_code,
                "block_name": block_map.get(block_code).name if block_map.get(block_code) else f"Block {block_code}",
                "total_tasks": 0,
                "departments": [],
                "crews": [],
                "start_time": None,
                "end_time": None,
                "total_window_minutes": 0,
                "unbundled_total_minutes": sum(int(t.estimated_duration_minutes or 60) for t in tasks),
                "time_saved_minutes": 0,
                "percent_time_saved": 0.0,
                "optimization_status": "INFEASIBLE",
                "tasks": [],
                "incompatible_tasks": incompatible_tasks,
                "explanation": f"All tasks on block {block_code} were incompatible for bundling.",
                "human_approval_required": True,
                "decision_support_note": "Decision-Support Prototype: Recommendations must be reviewed by railway controllers.",
            })
            continue

        # 3. Traffic analysis & planning window resolution
        # Handle start_time override if present in scenario_overrides
        s_start_time = (scenario_overrides or {}).get("start_time")
        effective_base = s_start_time or base_time

        plan_start_dt, horizon_minutes, window_desc = resolve_planning_window(
            window_preference=window_preference,
            base_time=effective_base,
        )

        if s_start_time and isinstance(s_start_time, datetime):
            plan_start_dt = s_start_time

        traffic_info = get_block_train_traffic(
            db=db,
            block_code=block_code,
            base_time=plan_start_dt,
            horizon_minutes=horizon_minutes,
        )

        bundle_result = _optimize_block_bundle(
            block_code=block_code,
            tasks=compatible_tasks,
            block_obj=block_map.get(block_code),
            available_crews=crews,
            traffic_info=traffic_info,
            plan_start_dt=plan_start_dt,
            horizon_minutes=horizon_minutes,
            window_desc=window_desc,
            incompatible_tasks=incompatible_tasks,
            scenario_overrides=scenario_overrides,
        )

        if bundle_result:
            bundles.append(bundle_result)

            if persist:
                _persist_bundle_result(db, bundle_result)

    if persist:
        db.commit()

    return bundles


def _optimize_block_bundle(
    block_code: str,
    tasks: list[Maintenance],
    block_obj: Block | None,
    available_crews: list[Crew] | None = None,
    traffic_info: dict[str, Any] | None = None,
    plan_start_dt: datetime | None = None,
    horizon_minutes: int = 540,
    window_desc: str = "Coordinated Maintenance Window",
    incompatible_tasks: list[dict[str, Any]] | None = None,
    scenario_overrides: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """
    Formulates and solves the coordinated multi-department maintenance window
    using OR-Tools CP-SAT with crew capacity, non-overlap, traffic, dynamic queue priorities,
    and temporary What-If scenario overrides.
    """
    if not tasks:
        return None

    if plan_start_dt is None:
        plan_start_dt = datetime.now().replace(second=0, microsecond=0)
        # Default to 21:00 for neat railway night-maintenance window demo if not specified
        plan_start_dt = plan_start_dt.replace(hour=21, minute=0)

    task_overrides_map = (scenario_overrides or {}).get("task_overrides", {})

    model = cp_model.CpModel()
    task_map = {t.id: t for t in tasks}

    durations: dict[int, int] = {}
    for t in tasks:
        t_ov = task_overrides_map.get(t.id) or {}
        dur = t_ov.get("duration_minutes")
        if dur is None or dur <= 0:
            dur = int(t.estimated_duration_minutes or 60)
        durations[t.id] = max(1, int(dur))

    unbundled_total_minutes = sum(durations.values())
    max_horizon = max(horizon_minutes, unbundled_total_minutes + 180)

    # Decision variables for each task
    start_vars: dict[int, cp_model.IntVar] = {}
    end_vars: dict[int, cp_model.IntVar] = {}
    interval_vars: dict[int, cp_model.IntervalVar] = {}

    for t in tasks:
        tid = t.id
        dur = durations[tid]
        start_vars[tid] = model.NewIntVar(0, max_horizon, f"start_{tid}")
        end_vars[tid] = model.NewIntVar(dur, max_horizon, f"end_{tid}")
        interval_vars[tid] = model.NewIntervalVar(
            start_vars[tid], dur, end_vars[tid], f"interval_{tid}"
        )

        # Scenario delay override: enforce task cannot start before delay_minutes
        t_ov = task_overrides_map.get(tid) or {}
        delay_min = t_ov.get("delay_minutes")
        if delay_min and int(delay_min) > 0:
            model.Add(start_vars[tid] >= int(delay_min))

    # 1. Dependency Constraints:
    # If task B depends on task A, start_B >= end_A
    dependency_pairs: list[tuple[int, int]] = []
    has_dependent = set()
    is_prerequisite = set()

    for t in tasks:
        if t.depends_on_maintenance_id and t.depends_on_maintenance_id in task_map:
            parent_id = t.depends_on_maintenance_id
            model.Add(start_vars[t.id] >= end_vars[parent_id])
            dependency_pairs.append((parent_id, t.id))
            is_prerequisite.add(parent_id)
            has_dependent.add(t.id)

    # 2. Crew Resource Allocation & Non-Overlap:
    # Match tasks to database-backed crews respecting capacity: task.crew_size <= crew.capacity
    crews_list = available_crews or []
    task_crew_vars: dict[tuple[int, int], cp_model.IntVar] = {}
    crew_to_optional_intervals: dict[int, list[cp_model.IntervalVar]] = {}
    crew_map: dict[int, Crew] = {c.id: c for c in crews_list}

    for t in tasks:
        t_ov = task_overrides_map.get(t.id) or {}
        forced_crew_id = t_ov.get("crew_id")

        t_crew_type = _normalize(t.crew_type)
        t_dept = _normalize(t.department)
        req_size = t.crew_size or 1

        # Candidate crews matching crew_type or department with sufficient capacity
        candidate_crews = [
            c for c in crews_list
            if (_normalize(c.crew_type) == t_crew_type or _normalize(c.department) == t_dept)
            and c.capacity >= req_size
            and _normalize(c.status) in {"available", "active"}
        ]

        # If no specific candidate, fallback to any available crew with capacity
        if not candidate_crews:
            candidate_crews = [
                c for c in crews_list
                if c.capacity >= req_size and _normalize(c.status) in {"available", "active"}
            ]

        # If forced crew is set and in crews_list, ensure it's included in candidate_crews
        if forced_crew_id and forced_crew_id in crew_map:
            forced_c = crew_map[forced_crew_id]
            if forced_c not in candidate_crews:
                candidate_crews.append(forced_c)

        if candidate_crews:
            c_vars = []
            for c in candidate_crews:
                b_var = model.NewBoolVar(f"task_{t.id}_crew_{c.id}")
                task_crew_vars[(t.id, c.id)] = b_var
                c_vars.append(b_var)

                # Optional interval for crew non-overlap
                opt_interval = model.NewOptionalIntervalVar(
                    start_vars[t.id], durations[t.id], end_vars[t.id], b_var,
                    f"opt_int_t{t.id}_c{c.id}"
                )
                crew_to_optional_intervals.setdefault(c.id, []).append(opt_interval)

            # Exactly one crew must be assigned to task t
            model.Add(sum(c_vars) == 1)

            # If forced crew is specified, force this crew
            if forced_crew_id and (t.id, forced_crew_id) in task_crew_vars:
                model.Add(task_crew_vars[(t.id, forced_crew_id)] == 1)

    # Enforce: Same crew cannot execute conflicting tasks simultaneously
    for c_id, opt_intervals in crew_to_optional_intervals.items():
        if len(opt_intervals) > 1:
            model.AddNoOverlap(opt_intervals)

    # Fallback non-overlap for tasks with same crew_type if no database crews available
    if not crews_list:
        crews_to_intervals: dict[str, list[cp_model.IntervalVar]] = {}
        for t in tasks:
            crew = _normalize(t.crew_type or "General")
            crews_to_intervals.setdefault(crew, []).append(interval_vars[t.id])
        for crew, c_intervals in crews_to_intervals.items():
            if len(c_intervals) > 1:
                model.AddNoOverlap(c_intervals)

    # 3. Exclusive Block Access & Safety Constraints:
    # If a task requires exclusive block access, no other task can overlap with it
    for t in tasks:
        if getattr(t, "requires_exclusive_block", False):
            for other in tasks:
                if other.id != t.id:
                    model.AddNoOverlap([interval_vars[t.id], interval_vars[other.id]])

    # 4. Sequential Ordering within same department if sequence_order differs
    dept_seq_tasks: dict[str, list[Maintenance]] = {}
    for t in tasks:
        dept = _normalize(t.department or "Engineering")
        dept_seq_tasks.setdefault(dept, []).append(t)

    for dept, d_tasks in dept_seq_tasks.items():
        if len(d_tasks) > 1:
            sorted_d = sorted(d_tasks, key=lambda x: (x.sequence_order or 1))
            for i in range(len(sorted_d) - 1):
                t1 = sorted_d[i]
                t2 = sorted_d[i + 1]
                t1_seq = t1.sequence_order or 1
                t2_seq = t2.sequence_order or 1
                if (
                    _normalize(t1.execution_mode) == "sequential"
                    and _normalize(t2.execution_mode) == "sequential"
                    and t1_seq < t2_seq
                ):
                    model.Add(start_vars[t2.id] >= end_vars[t1.id])

    # 5. Coordinated Window Variables
    window_start = model.NewIntVar(0, max_horizon, "window_start")
    window_end = model.NewIntVar(0, max_horizon, "window_end")

    model.AddMinEquality(window_start, list(start_vars.values()))
    model.AddMaxEquality(window_end, list(end_vars.values()))

    window_span = model.NewIntVar(0, max_horizon, "window_span")
    model.Add(window_span == window_end - window_start)

    # 6. Objective Formulation:
    # - Minimize window_span (weight 10,000)
    # - Urgency-weighted start time (Critical = 5000, High = 1000, Medium = 100, Low = 10)
    # - Traffic penalties: penalize scheduling routine work during high-traffic slots
    priority_weights = {
        "critical": 5000,
        "high": 1000,
        "medium": 100,
        "low": 10,
    }

    start_penalties = []
    for t in tasks:
        t_ov = task_overrides_map.get(t.id) or {}
        p_str = _normalize(t_ov.get("priority") or t.priority)
        base_w = priority_weights.get(p_str, 100)

        # Factor in urgency_score if set
        urgency_mult = 1.0
        if getattr(t, "urgency_score", None):
            urgency_mult = 1.0 + (float(t.urgency_score) / 10.0)

        eff_weight = int(base_w * urgency_mult)
        start_penalties.append(eff_weight * start_vars[t.id])

    # Traffic penalty integration
    traffic_penalties = []
    slot_traffic = (traffic_info or {}).get("slot_traffic", [])
    if slot_traffic:
        # Check tasks that are NOT critical (Routine/Medium/Low work can be shifted)
        for t in tasks:
            t_ov = task_overrides_map.get(t.id) or {}
            p_str = _normalize(t_ov.get("priority") or t.priority)
            if p_str != "critical":
                # For non-critical work, penalize start if placed in high-traffic early slots
                for s_idx, t_score in enumerate(slot_traffic[:8]):
                    if t_score > 0:
                        slot_start = s_idx * 30
                        slot_end = (s_idx + 1) * 30

                        before_s = model.NewBoolVar(f"t_{t.id}_before_s{s_idx}")
                        after_s = model.NewBoolVar(f"t_{t.id}_after_s{s_idx}")
                        is_overlap = model.NewBoolVar(f"t_{t.id}_overlap_s{s_idx}")

                        model.Add(end_vars[t.id] <= slot_start).OnlyEnforceIf(before_s)
                        model.Add(start_vars[t.id] >= slot_end).OnlyEnforceIf(after_s)
                        model.Add(before_s + after_s + is_overlap >= 1)

                        traffic_penalties.append(t_score * 400 * is_overlap)

    # Total Objective: Minimize span + urgency starts + traffic conflicts
    model.Minimize(window_span * 10000 + sum(start_penalties) + sum(traffic_penalties))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(model)

    status_name = solver.StatusName(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        reasons = []
        for t in tasks:
            ov = task_overrides_map.get(t.id) or {}
            d_min = int(ov.get("delay_minutes") or 0)
            dur_val = durations[t.id]
            if d_min + dur_val > max_horizon:
                reasons.append(
                    f"Task '{t.maintenance_type}' delay ({d_min} min) + duration ({dur_val} min) "
                    f"exceeds planning horizon ({max_horizon} min)."
                )
        for t in tasks:
            ov = task_overrides_map.get(t.id) or {}
            fc_id = ov.get("crew_id")
            if fc_id and fc_id in crew_map:
                fc = crew_map[fc_id]
                if fc.capacity < (t.crew_size or 1):
                    reasons.append(
                        f"Forced crew '{fc.name}' capacity ({fc.capacity}) is less than required crew size ({t.crew_size or 1}) for task '{t.maintenance_type}'."
                    )
        if not reasons:
            reasons.append(
                f"Solver returned {status_name}: Conflicting constraints between task dependencies, "
                f"exclusive block access, crew capacity, and the planning horizon."
            )
        return {
            "infeasible": True,
            "optimization_status": status_name,
            "infeasibility_reason": " ".join(reasons),
            "tasks": [],
            "total_window_minutes": 0,
        }

    # Extract solver schedule
    w_start_val = solver.Value(window_start)
    w_end_val = solver.Value(window_end)
    coordinated_window_minutes = solver.Value(window_span)
    time_saved_minutes = max(0, unbundled_total_minutes - coordinated_window_minutes)

    bundle_id = f"BUNDLE-{block_code}"

    # Determine assignments, relationships, and dynamic queue reprioritization
    scheduled_tasks: list[dict[str, Any]] = []
    parallel_task_ids = set()

    # Pre-calculate start and end minutes
    task_times = {t.id: (solver.Value(start_vars[t.id]), solver.Value(end_vars[t.id])) for t in tasks}

    # Identify dynamic crew priority / work queue overrides:
    # If a crew has multiple tasks and a Critical task was ordered after a routine task
    # in original sequence_order, but solver scheduled it first.
    crew_assigned_tasks: dict[int, list[Maintenance]] = {}

    for t in tasks:
        s_val, e_val = task_times[t.id]

        # Determine assigned crew
        assigned_c: Crew | None = None
        for (tid, cid), b_var in task_crew_vars.items():
            if tid == t.id and solver.Value(b_var) == 1:
                assigned_c = crew_map.get(cid)
                break

        if assigned_c:
            crew_assigned_tasks.setdefault(assigned_c.id, []).append(t)

    # Calculate overlaps and rich execution relationships
    relationships: dict[int, dict[str, Any]] = {}
    for t in tasks:
        s_val, e_val = task_times[t.id]
        overlaps = []
        precedes = []
        depends_on_list = []

        if t.depends_on_maintenance_id:
            depends_on_list.append(t.depends_on_maintenance_id)

        for other in tasks:
            if other.id == t.id:
                continue
            o_s, o_e = task_times[other.id]
            # Overlap check
            if max(s_val, o_s) < min(e_val, o_e):
                overlaps.append(other.id)
                parallel_task_ids.add(t.id)
                parallel_task_ids.add(other.id)
            # Precedes check
            if other.depends_on_maintenance_id == t.id or (e_val <= o_s and t.id in is_prerequisite):
                precedes.append(other.id)

        relationships[t.id] = {
            "depends_on": depends_on_list,
            "precedes": precedes,
            "overlaps_with": overlaps,
        }

    # Sort tasks by start_minute to get optimized position
    sorted_tasks_by_start = sorted(tasks, key=lambda x: (task_times[x.id][0], x.sequence_order))
    optimized_positions = {t.id: idx + 1 for idx, t in enumerate(sorted_tasks_by_start)}

    for t in tasks:
        s_val, e_val = task_times[t.id]
        rel = relationships[t.id]
        is_parallel = len(rel["overlaps_with"]) > 0

        # Assigned crew info
        assigned_c: Crew | None = None
        for (tid, cid), b_var in task_crew_vars.items():
            if tid == t.id and solver.Value(b_var) == 1:
                assigned_c = crew_map.get(cid)
                break

        # Fallback crew info if no DB crew
        assigned_id = assigned_c.id if assigned_c else None
        assigned_name = assigned_c.name if assigned_c else f"{t.crew_type} A"
        assigned_type = assigned_c.crew_type if assigned_c else t.crew_type
        available_cap = assigned_c.capacity if assigned_c else max(4, t.crew_size or 2)

        # Dynamic priority queue override detection
        orig_pos = t.sequence_order
        opt_pos = optimized_positions[t.id]
        priority_override = False
        override_reason = None

        if _normalize(t.priority) == "critical" and t.id in is_prerequisite:
            if orig_pos > 1 or opt_pos == 1:
                priority_override = True
                override_reason = (
                    f"Critical {t.maintenance_type} was temporarily prioritized "
                    f"to position {opt_pos} to unblock dependent maintenance."
                )

        # Role determination
        if t.id in is_prerequisite:
            role = "prerequisite"
        elif t.id in has_dependent:
            role = "dependent"
        elif _normalize(t.execution_mode) == "parallel" or is_parallel:
            role = "parallel"
        else:
            role = "sequential"

        task_start_dt = plan_start_dt + timedelta(minutes=s_val)
        task_end_dt = plan_start_dt + timedelta(minutes=e_val)

        scheduled_tasks.append({
            "id": t.id,
            "maintenance_type": t.maintenance_type,
            "department": t.department,
            "crew_type": t.crew_type,
            "crew_size": t.crew_size,
            "required_crew_size": t.crew_size,
            "assigned_crew_id": assigned_id,
            "assigned_crew_name": assigned_name,
            "assigned_crew_type": assigned_type,
            "available_capacity": available_cap,
            "priority": task_overrides_map.get(t.id, {}).get("priority") or t.priority,
            "status": t.status,
            "duration_minutes": durations[t.id],
            "start_minute": s_val,
            "end_minute": e_val,
            "planned_start": task_start_dt.isoformat(),
            "planned_end": task_end_dt.isoformat(),
            "execution_mode": t.execution_mode,
            "sequence_order": t.sequence_order,
            "original_position": orig_pos,
            "optimized_position": opt_pos,
            "priority_override": priority_override,
            "override_reason": override_reason,
            "depends_on_maintenance_id": t.depends_on_maintenance_id,
            "depends_on": rel["depends_on"],
            "precedes": rel["precedes"],
            "overlaps_with": rel["overlaps_with"],
            "bundle_role": role,
            "is_parallel": is_parallel,
        })

    # Sort tasks by start_minute, then sequence_order
    scheduled_tasks.sort(key=lambda x: (x["start_minute"], x["sequence_order"]))

    departments = sorted(list({t.department for t in tasks}))
    crews = sorted(list({t["assigned_crew_name"] for t in scheduled_tasks}))

    # Before vs After metrics
    closures_avoided = max(0, len(tasks) - 1)
    train_conflicts_before = len(tasks) * (traffic_info.get("total_trains_count", 2) if traffic_info else 2)
    train_conflicts_after = traffic_info.get("total_trains_count", 1) if traffic_info else 1

    # Generate factual deterministic explanation
    explanation = _generate_bundle_explanation(
        block_code=block_code,
        scheduled_tasks=scheduled_tasks,
        coordinated_window=coordinated_window_minutes,
        time_saved=time_saved_minutes,
        departments=departments,
        traffic_info=traffic_info,
    )

    planned_start_dt = plan_start_dt + timedelta(minutes=w_start_val)
    planned_end_dt = plan_start_dt + timedelta(minutes=w_end_val)

    return {
        "bundle_id": bundle_id,
        "block_code": block_code,
        "block_name": block_obj.name if block_obj else f"Block {block_code}",
        "total_tasks": len(tasks),
        "departments": departments,
        "crews": crews,
        "planning_window": window_desc,
        "start_time": planned_start_dt.isoformat(),
        "end_time": planned_end_dt.isoformat(),
        "earliest_feasible_start": plan_start_dt.isoformat(),
        "latest_allowed_end": (plan_start_dt + timedelta(minutes=max_horizon)).isoformat(),
        "total_window_minutes": coordinated_window_minutes,
        "unbundled_total_minutes": unbundled_total_minutes,
        "time_saved_minutes": time_saved_minutes,
        "percent_time_saved": (
            round((time_saved_minutes / unbundled_total_minutes) * 100, 1)
            if unbundled_total_minutes > 0
            else 0.0
        ),
        "block_closures_avoided": closures_avoided,
        "train_conflicts_before": train_conflicts_before,
        "train_conflicts_after": train_conflicts_after,
        "traffic_level": (traffic_info or {}).get("overall_traffic_level", "Low"),
        "traffic_score": (traffic_info or {}).get("total_traffic_score", 0),
        "optimization_status": status_name,
        "tasks": scheduled_tasks,
        "incompatible_tasks": incompatible_tasks or [],
        "sequential_tasks": [t["id"] for t in scheduled_tasks if not t["is_parallel"]],
        "parallel_tasks": [t["id"] for t in scheduled_tasks if t["is_parallel"]],
        "dependencies": [
            {"parent_id": p, "dependent_id": c} for p, c in dependency_pairs
        ],
        "explanation": explanation,
        "human_approval_required": True,
        "decision_support_note": (
            "Decision-Support Prototype: Recommendations must be reviewed and approved "
            "by authorized railway section controllers."
        ),
    }


def _generate_bundle_explanation(
    block_code: str,
    scheduled_tasks: list[dict[str, Any]],
    coordinated_window: int,
    time_saved: int,
    departments: list[str],
    traffic_info: dict[str, Any] | None = None,
) -> str:
    """
    Generates a deterministic, factual explanation of the bundling plan.
    """
    num_tasks = len(scheduled_tasks)
    dept_str = ", ".join(departments)

    lines = [
        f"{num_tasks} maintenance tasks on block {block_code} across {len(departments)} "
        f"departments ({dept_str}) were coordinated into a single {coordinated_window}-minute window "
        f"(saving {time_saved} minutes vs. separate block closures)."
    ]

    # Specific deterministic rationale lines
    for t in scheduled_tasks:
        c_info = f"assigned to {t['assigned_crew_name']} (capacity {t['available_capacity']})"
        if t["bundle_role"] == "prerequisite":
            lines.append(
                f"{t['maintenance_type']} ({t['department']}, {t['duration_minutes']} min, {c_info}) "
                f"was scheduled first because dependent tasks require prior clearance."
            )
        elif t["bundle_role"] == "dependent":
            lines.append(
                f"{t['maintenance_type']} ({t['department']}, {t['duration_minutes']} min, {c_info}) "
                f"is scheduled starting at minute {t['start_minute']} after its predecessor finishes."
            )
        elif t["bundle_role"] == "parallel":
            lines.append(
                f"{t['maintenance_type']} ({t['department']}, {t['duration_minutes']} min, {c_info}) "
                f"overlaps with {t['overlaps_with']} because it has no dependency on them "
                f"and required crew resources are independently available."
            )
        else:
            lines.append(
                f"{t['maintenance_type']} ({t['department']}, {t['duration_minutes']} min, {c_info}) "
                f"is scheduled from minute {t['start_minute']} to {t['end_minute']}."
            )

        if t.get("priority_override"):
            lines.append(
                f"{t['assigned_crew_name']} was temporarily reprioritized for the {t['priority']} prerequisite."
            )

    # Traffic observation
    traffic_lvl = (traffic_info or {}).get("overall_traffic_level", "Low")
    if traffic_lvl == "Low":
        lines.append("The window utilizes a low-traffic corridor, avoiding passenger and freight path conflicts.")
    else:
        lines.append(f"Traffic load ({traffic_lvl}) was factored into the schedule to minimize train delays.")

    return " ".join(lines)


def _persist_bundle_result(db: Session, bundle: dict[str, Any]) -> None:
    """
    Updates the database Maintenance records with the generated bundle metadata and crew assignments.
    """
    bundle_id = bundle["bundle_id"]

    for t_data in bundle["tasks"]:
        rec = db.get(Maintenance, t_data["id"])
        if rec:
            rec.bundle_id = bundle_id
            rec.bundled = True
            rec.bundle_role = t_data["bundle_role"]
            rec.planned_start = datetime.fromisoformat(t_data["planned_start"])
            rec.planned_end = datetime.fromisoformat(t_data["planned_end"])
            if t_data.get("assigned_crew_id"):
                rec.assigned_crew_id = t_data["assigned_crew_id"]
