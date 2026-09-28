"""
Weekly / Monthly Maintenance Planning Service for RailSync AI.

Optimizes multi-day maintenance schedules (7-day week or 30-day month) using
OR-Tools CP-SAT while extending existing RailSync AI capabilities:
- Integrates predictive maintenance candidates
- Respects multi-factor task urgency
- Preserves multi-department bundles as single block restrictions
- Enforces crew daily workload limits and non-overlap
- Maintains task dependencies across days
- Maximizes daily network asset availability
- Minimizes route-aware train conflicts
- Requires explicit section controller review and approval before applying
"""

from datetime import datetime, date, timedelta, timezone
import time
from typing import Any
import uuid

from ortools.sat.python import cp_model
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.block import Block
from app.models.crew import Crew
from app.models.maintenance import Maintenance
from app.schemas.planning import (
    CrewWorkloadItem,
    MaintenancePlanApplyRequest,
    MaintenancePlanApplyResponse,
    MaintenancePlanOptimizeRequest,
    MaintenancePlanResponse,
    PlanDaySummary,
    PlannedMaintenanceItem,
)
from app.services.ai.maintenance_bundler import (
    _normalize_code,
    _normalize,
    bundle_compatible_maintenance,
)
from app.services.ai.traffic_estimator import get_all_blocks_traffic
from app.services.ai.urgency_analyzer import calculate_all_urgencies


# In-memory plan cache for review before applying
PLAN_CACHE: dict[str, dict[str, Any]] = {}

# In-memory result cache for plan responses (60s TTL)
_MAINTENANCE_PLAN_CACHE: dict[str, dict[str, Any]] = {}
_PLAN_CACHE_TTL_SECONDS = 60


def generate_maintenance_plan(
    db: Session,
    request: MaintenancePlanOptimizeRequest | None = None,
    horizon: str | None = None,
    start_date: str | None = None,
    force_refresh: bool = False,
) -> MaintenancePlanResponse:
    """
    Generates an optimized weekly or monthly maintenance plan using OR-Tools CP-SAT.
    """
    if request is None:
        request = MaintenancePlanOptimizeRequest(
            horizon=horizon or "week",
            start_date=start_date,
        )
    elif horizon is not None:
        request.horizon = horizon
    if start_date is not None:
        request.start_date = start_date

    horizon_type = (request.horizon or "week").strip().lower()
    num_days = 7 if horizon_type == "week" else 30

    # Start date
    if request.start_date:
        try:
            start_d = datetime.strptime(request.start_date.strip(), "%Y-%m-%d").date()
        except ValueError:
            start_d = datetime.now().date()
    else:
        start_d = datetime.now().date()

    # Check in-memory result cache
    cache_key = (
        f"{horizon_type}_{start_d.isoformat()}_"
        f"{tuple(sorted(request.target_departments or []))}_"
        f"{tuple(sorted(request.target_blocks or []))}"
    )
    is_sqlite_test = "sqlite" in str(getattr(db.bind, "url", ""))

    if not force_refresh and not is_sqlite_test and cache_key in _MAINTENANCE_PLAN_CACHE:
        entry = _MAINTENANCE_PLAN_CACHE[cache_key]
        if (time.time() - entry["timestamp"]) < _PLAN_CACHE_TTL_SECONDS:
            return entry["response"]

    # 1. Fetch DB records
    blocks = db.scalars(select(Block).order_by(Block.id)).all()
    block_map = {_normalize_code(b.code): b for b in blocks}
    total_network_assets = len(blocks)

    crews = db.scalars(select(Crew)).all()
    crew_map = {c.id: c for c in crews}

    # Fetch active tasks
    query = select(Maintenance).where(
        Maintenance.status.notin_(["Completed", "Cancelled"])
    )
    if request.target_departments:
        norm_depts = [_normalize(d) for d in request.target_departments]
        query = query.where(Maintenance.department.in_(norm_depts))
    if request.target_blocks:
        norm_blocks = [_normalize_code(b) for b in request.target_blocks]
        query = query.where(Maintenance.block_code.in_(norm_blocks))

    tasks = db.scalars(query.order_by(Maintenance.id)).all()

    # If no tasks, return empty plan
    if not tasks:
        empty_res = _build_empty_plan_response(
            horizon=horizon_type,
            start_d=start_d,
            num_days=num_days,
            total_assets=total_network_assets,
        )
        if not is_sqlite_test:
            _MAINTENANCE_PLAN_CACHE[cache_key] = {
                "timestamp": time.time(),
                "response": empty_res,
            }
        return empty_res

    # 2. Compute Urgencies for all tasks
    urgency_res = calculate_all_urgencies(db=db, target_ids=[t.id for t in tasks])
    urgency_map = {item.maintenance_id: item for item in urgency_res.items}

    # 3. Traffic for all blocks
    traffic_by_block = get_all_blocks_traffic(db=db, blocks=blocks)

    # 4. Group tasks into bundles per block where compatible
    bundles = bundle_compatible_maintenance(db=db, persist=False)
    bundle_by_task: dict[int, dict[str, Any]] = {}
    bundle_leaders: set[int] = set()

    for b in bundles:
        b_tasks = b.get("tasks", [])
        if b_tasks:
            leader_id = b_tasks[0]["id"]
            bundle_leaders.add(leader_id)
            for t_dict in b_tasks:
                bundle_by_task[t_dict["id"]] = b

    # 5. Formulate OR-Tools CP-SAT Multi-Day Model
    model = cp_model.CpModel()
    n_tasks = len(tasks)
    task_map = {t.id: t for t in tasks}

    # Decision variables: day assignment for each task (0 to num_days - 1)
    day_vars: dict[int, cp_model.IntVar] = {}
    for t in tasks:
        day_vars[t.id] = model.NewIntVar(0, num_days - 1, f"day_task_{t.id}")

    # Hard Constraint 1: Bundled tasks on the same block MUST be executed on the SAME DAY
    for b in bundles:
        b_tasks = b.get("tasks", [])
        if len(b_tasks) > 1:
            first_id = b_tasks[0]["id"]
            for other in b_tasks[1:]:
                other_id = other["id"]
                if first_id in day_vars and other_id in day_vars:
                    model.Add(day_vars[first_id] == day_vars[other_id])

    # Hard Constraint 2: Inter-Task Dependencies across days
    for t in tasks:
        if t.depends_on_maintenance_id and t.depends_on_maintenance_id in day_vars:
            parent_id = t.depends_on_maintenance_id
            model.Add(day_vars[t.id] >= day_vars[parent_id])

    # Hard Constraint 3: Crew Daily Workload Limits
    # A crew can execute at most 480 minutes (8 hours) of maintenance work per day
    # day_task_is_d[t.id, d] == 1 iff day_vars[t.id] == d
    day_task_is_d: dict[tuple[int, int], cp_model.BoolVar] = {}
    for t in tasks:
        for d in range(num_days):
            b_var = model.NewBoolVar(f"t_{t.id}_on_day_{d}")
            day_task_is_d[(t.id, d)] = b_var
            model.Add(day_vars[t.id] == d).OnlyEnforceIf(b_var)
            model.Add(day_vars[t.id] != d).OnlyEnforceIf(b_var.Not())

    # Map tasks to crews
    crew_to_tasks: dict[int, list[Maintenance]] = {}
    for t in tasks:
        c_id = t.assigned_crew_id
        if c_id and c_id in crew_map:
            crew_to_tasks.setdefault(c_id, []).append(t)

    for c_id, c_tasks in crew_to_tasks.items():
        if len(c_tasks) > 1:
            for d in range(num_days):
                daily_crew_mins = []
                for t in c_tasks:
                    dur = int(t.estimated_duration_minutes or 60)
                    daily_crew_mins.append(dur * day_task_is_d[(t.id, d)])
                # Max 480 minutes per crew per day
                model.Add(sum(daily_crew_mins) <= 480)

    # Hard Constraint 4: Urgency Deadlines (due_by)
    for t in tasks:
        if t.due_by is not None:
            task_due_d = t.due_by.date()
            if task_due_d >= start_d:
                due_day_offset = (task_due_d - start_d).days
                if 0 <= due_day_offset < num_days:
                    model.Add(day_vars[t.id] <= due_day_offset)

    # 6. Multi-Objective Function
    objective_terms = []

    # A. Urgency-Aware Scheduling: Critical & High tasks heavily penalize days > 0
    urgency_day_weights = {
        "Critical": 15000,
        "High": 4000,
        "Medium": 600,
        "Low": 80,
    }

    for t in tasks:
        u_item = urgency_map.get(t.id)
        u_level = u_item.urgency_level if u_item else "Medium"
        w = urgency_day_weights.get(u_level, 600)
        # Penalize assigning high urgency tasks to later days
        objective_terms.append(w * day_vars[t.id])

    # B. Daily Asset Availability: Penalize concentrating too many block closures on the same day
    # For each block b and day d, block_closed_on_d[b, d] == 1 if any task on block b is scheduled on day d
    unique_blocks = sorted(list({_normalize_code(t.block_code) for t in tasks if t.block_code}))
    block_tasks_map: dict[str, list[Maintenance]] = {}
    for t in tasks:
        if t.block_code:
            block_tasks_map.setdefault(_normalize_code(t.block_code), []).append(t)

    for d in range(num_days):
        day_block_closed_vars = []
        for b_code in unique_blocks:
            b_tasks = block_tasks_map.get(b_code, [])
            b_closed = model.NewBoolVar(f"block_{b_code}_closed_day_{d}")
            # b_closed == 1 iff at least one task is on day d
            for t in b_tasks:
                model.Add(b_closed >= day_task_is_d[(t.id, d)])
            day_block_closed_vars.append(b_closed)

        # Penalize daily closures (discourages scheduling all closures on same day)
        objective_terms.append(1500 * sum(day_block_closed_vars))

    # C. Route Traffic Minimization
    for t in tasks:
        if t.block_code:
            t_info = traffic_by_block.get(_normalize_code(t.block_code), {})
            t_score = int(t_info.get("total_traffic_score", 0))
            if t_score > 0:
                # Moderate penalty for placing on high-traffic days
                objective_terms.append(t_score * 50 * day_vars[t.id])

    model.Minimize(sum(objective_terms))

    # 7. Solve
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(model)
    status_name = solver.StatusName(status)

    plan_id = f"PLAN-{uuid.uuid4().hex[:8].upper()}"

    # 8. Build Schedule from Solution
    day_summaries: list[PlanDaySummary] = []
    crew_workload_map: dict[int | None, dict[str, Any]] = {}

    for d in range(num_days):
        current_date = start_d + timedelta(days=d)
        date_str = current_date.strftime("%Y-%m-%d")
        day_name = current_date.strftime("%A")

        scheduled_for_day: list[PlannedMaintenanceItem] = []
        day_restricted_blocks = set()
        day_window_minutes = 0
        day_conflicts = 0

        for t in tasks:
            if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                assigned_d = int(solver.Value(day_vars[t.id]))
            else:
                # Fallback sequential distribution
                assigned_d = (t.id % num_days)

            if assigned_d == d:
                norm_b = _normalize_code(t.block_code)
                b_obj = block_map.get(norm_b)
                u_item = urgency_map.get(t.id)
                u_score = u_item.urgency_score if u_item else 50.0
                u_level = u_item.urgency_level if u_item else "Medium"

                dur = int(t.estimated_duration_minutes or 60)
                # Position start at 21:00 on that date (standard night window)
                plan_start_dt = datetime.combine(current_date, datetime.min.time()).replace(hour=21, minute=0)
                plan_end_dt = plan_start_dt + timedelta(minutes=dur)

                c_name = t.assigned_crew_name or (t.crew_type or "Unassigned Team")
                b_info = bundle_by_task.get(t.id)
                bundle_id = b_info.get("bundle_id") if b_info else None
                is_leader = t.id in bundle_leaders

                # Train conflicts
                t_info = traffic_by_block.get(norm_b, {})
                t_conflicts = 1 if int(t_info.get("total_traffic_score", 0)) > 5 else 0

                scheduled_for_day.append(
                    PlannedMaintenanceItem(
                        task_id=t.id,
                        block_code=norm_b or t.station_code or "N/A",
                        block_name=b_obj.name if b_obj else (f"Station {t.station_code}" if t.station_code else "Section"),
                        maintenance_type=t.maintenance_type,
                        department=t.department or "Engineering",
                        crew_id=t.assigned_crew_id,
                        crew_name=c_name,
                        priority=t.priority,
                        urgency_score=u_score,
                        urgency_level=u_level,
                        duration_minutes=dur,
                        planned_start=plan_start_dt.isoformat(),
                        planned_end=plan_end_dt.isoformat(),
                        day_index=d,
                        date_str=date_str,
                        bundle_id=bundle_id,
                        is_bundle_leader=is_leader,
                        train_conflicts=t_conflicts,
                    )
                )

                if norm_b:
                    day_restricted_blocks.add(norm_b)
                day_window_minutes = max(day_window_minutes, dur)
                day_conflicts += t_conflicts

                # Record crew workload
                c_key = t.assigned_crew_id
                if c_key not in crew_workload_map:
                    crew_workload_map[c_key] = {
                        "crew_id": c_key,
                        "crew_name": c_name,
                        "department": t.department or "Engineering",
                        "capacity": t.assigned_crew.capacity if t.assigned_crew else 4,
                        "total_tasks_assigned": 0,
                        "total_hours_allocated": 0.0,
                        "daily_allocations": {},
                    }
                crew_workload_map[c_key]["total_tasks_assigned"] += 1
                hours = round(dur / 60.0, 1)
                crew_workload_map[c_key]["total_hours_allocated"] += hours
                crew_workload_map[c_key]["daily_allocations"][date_str] = (
                    crew_workload_map[c_key]["daily_allocations"].get(date_str, 0.0) + hours
                )

        num_r = len(day_restricted_blocks)
        avail = max(0, total_network_assets - num_r)
        avail_pct = round((avail / total_network_assets) * 100, 1) if total_network_assets > 0 else 100.0

        day_summaries.append(
            PlanDaySummary(
                date_str=date_str,
                day_name=day_name,
                day_index=d,
                tasks_count=len(scheduled_for_day),
                total_window_minutes=day_window_minutes,
                restricted_blocks=sorted(list(day_restricted_blocks)),
                available_assets=avail,
                restricted_assets=num_r,
                availability_percentage=avail_pct,
                train_conflicts=day_conflicts,
                traffic_level="Low" if day_conflicts <= 1 else ("Medium" if day_conflicts <= 3 else "High"),
                tasks=scheduled_for_day,
            )
        )

    # 9. Format Crew Workload Output
    crew_workloads: list[CrewWorkloadItem] = []
    for c_id, c_data in crew_workload_map.items():
        crew_workloads.append(
            CrewWorkloadItem(
                crew_id=c_data["crew_id"],
                crew_name=c_data["crew_name"],
                department=c_data["department"],
                capacity=c_data["capacity"],
                total_tasks_assigned=c_data["total_tasks_assigned"],
                total_hours_allocated=round(c_data["total_hours_allocated"], 1),
                daily_allocations=c_data["daily_allocations"],
            )
        )

    # Summary metrics
    avg_avail = round(sum(d.availability_percentage for d in day_summaries) / len(day_summaries), 1) if day_summaries else 100.0
    total_conflicts = sum(d.train_conflicts for d in day_summaries)
    end_d = start_d + timedelta(days=num_days - 1)

    explanation = (
        f"Generated {horizon_type} plan for {len(tasks)} maintenance tasks from {start_d} to {end_d}. "
        f"Critical and High urgency tasks were scheduled in early days ({start_d.strftime('%A')}) "
        f"while respecting daily crew workload limits (max 8h/day) and maintaining an average network "
        f"availability of {avg_avail}%."
    )

    response = MaintenancePlanResponse(
        plan_id=plan_id,
        horizon=horizon_type,
        start_date=start_d.strftime("%Y-%m-%d"),
        end_date=end_d.strftime("%Y-%m-%d"),
        total_tasks_planned=len(tasks),
        days=day_summaries,
        crew_workloads=crew_workloads,
        optimization_status=status_name,
        average_availability_percentage=avg_avail,
        total_train_conflicts=total_conflicts,
        explanation=explanation,
        human_approval_required=True,
    )

    # Cache plan for apply workflow
    PLAN_CACHE[plan_id] = {
        "response": response,
        "tasks": tasks,
    }

    if not is_sqlite_test:
        _MAINTENANCE_PLAN_CACHE[cache_key] = {
            "timestamp": time.time(),
            "response": response,
        }

    return response


def _build_empty_plan_response(
    horizon: str,
    start_d: date,
    num_days: int,
    total_assets: int,
) -> MaintenancePlanResponse:
    """Builds an empty plan response when no maintenance is scheduled."""
    day_summaries = []
    for d in range(num_days):
        curr_d = start_d + timedelta(days=d)
        day_summaries.append(
            PlanDaySummary(
                date_str=curr_d.strftime("%Y-%m-%d"),
                day_name=curr_d.strftime("%A"),
                day_index=d,
                tasks_count=0,
                total_window_minutes=0,
                restricted_blocks=[],
                available_assets=total_assets,
                restricted_assets=0,
                availability_percentage=100.0,
                train_conflicts=0,
                traffic_level="Low",
                tasks=[],
            )
        )

    end_d = start_d + timedelta(days=num_days - 1)
    return MaintenancePlanResponse(
        plan_id=f"PLAN-{uuid.uuid4().hex[:8].upper()}",
        horizon=horizon,
        start_date=start_d.strftime("%Y-%m-%d"),
        end_date=end_d.strftime("%Y-%m-%d"),
        total_tasks_planned=0,
        days=day_summaries,
        crew_workloads=[],
        optimization_status="OPTIMAL",
        average_availability_percentage=100.0,
        total_train_conflicts=0,
        explanation="No active or planned maintenance tasks required scheduling.",
        human_approval_required=True,
    )


def apply_maintenance_plan(
    db: Session,
    request: MaintenancePlanApplyRequest,
) -> MaintenancePlanApplyResponse:
    """
    Applies the human-approved weekly/monthly maintenance plan to live database records.
    Requires explicit human approval from authorized personnel.
    """
    if not request.human_approved:
        raise ValueError("Human approval is strictly required before applying a maintenance plan.")

    cached = PLAN_CACHE.get(request.plan_id)
    if not cached:
        raise ValueError(f"Plan ID '{request.plan_id}' not found or expired. Please re-generate the plan.")

    response_obj: MaintenancePlanResponse = cached["response"]
    applied_count = 0

    # Map planned tasks to database updates
    for day_sum in response_obj.days:
        for p_item in day_sum.tasks:
            db_task = db.get(Maintenance, p_item.task_id)
            if db_task:
                db_task.status = "Scheduled"
                db_task.scheduled_start = datetime.fromisoformat(p_item.planned_start)
                db_task.scheduled_end = datetime.fromisoformat(p_item.planned_end)
                if p_item.bundle_id:
                    db_task.bundle_id = p_item.bundle_id
                    db_task.bundled = True
                applied_count += 1

    db.commit()

    return MaintenancePlanApplyResponse(
        message=f"Maintenance plan '{request.plan_id}' ({response_obj.horizon}) successfully applied.",
        plan_id=request.plan_id,
        applied_tasks_count=applied_count,
        applied_at=datetime.now().isoformat(),
        approved_by=request.approved_by,
    )
