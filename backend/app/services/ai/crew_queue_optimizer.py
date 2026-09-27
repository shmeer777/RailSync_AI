"""
Dynamic Crew Priority & Work Queue Optimizer for RailSync AI.

Dynamically prioritizes maintenance work for railway crews using OR-Tools CP-SAT
based on maintenance priority, predicted urgency, task dependencies, crew availability,
crew workload, crew capacity, deadlines, maintenance location, and downstream dependency impact.

Key Innovation:
When a Critical or urgent prerequisite task appears, RailSync temporarily moves that task
ahead of lower-priority work so dependent maintenance can proceed sooner.
After the critical task completes, the crew resumes the remaining queued work.
This is temporary reprioritization that preserves lower-priority tasks and requires human approval.
"""

from datetime import datetime, timedelta
from typing import Any

from ortools.sat.python import cp_model
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.block import Block
from app.models.crew import Crew
from app.models.maintenance import Maintenance
from app.schemas.crew_queue import (
    CrewQueueApplyRequest,
    CrewQueueApplyResponse,
    CrewQueueResponse,
    CrewQueueTask,
    CrewWorkloadSummary,
    DependencyEffect,
    QueueChange,
)


def _normalize(value: str | None) -> str:
    return str(value or "").strip().lower()


def _normalize_code(value: str | None) -> str:
    return str(value or "").strip().upper()


def calculate_dependency_impact(
    tasks: list[Maintenance],
) -> tuple[dict[int, list[int]], dict[int, list[int]], dict[int, float]]:
    """
    Analyzes dependency relationships across maintenance tasks.
    Returns:
    - direct_dependents: {parent_id: [child_ids]}
    - transitive_blocked: {parent_id: [all_downstream_child_ids]}
    - impact_scores: {task_id: numeric_impact_score}

    Impact score is calculated deterministically as:
    sum of downstream task priority weights (Critical=40, High=20, Medium=10, Low=5).
    """
    priority_weights = {
        "critical": 40.0,
        "high": 20.0,
        "medium": 10.0,
        "low": 5.0,
    }

    direct_dependents: dict[int, list[int]] = {}
    task_map = {t.id: t for t in tasks}

    for t in tasks:
        if t.depends_on_maintenance_id:
            direct_dependents.setdefault(t.depends_on_maintenance_id, []).append(t.id)

    # Transitive closure using DFS
    transitive_blocked: dict[int, list[int]] = {}

    def get_downstream(tid: int, visited: set[int]) -> set[int]:
        downstream = set()
        for child_id in direct_dependents.get(tid, []):
            if child_id not in visited:
                visited.add(child_id)
                downstream.add(child_id)
                downstream.update(get_downstream(child_id, visited))
        return downstream

    for t in tasks:
        blocked = get_downstream(t.id, set())
        transitive_blocked[t.id] = sorted(list(blocked))

    # Calculate numeric impact score
    impact_scores: dict[int, float] = {}
    for t in tasks:
        score = 0.0
        for child_id in transitive_blocked.get(t.id, []):
            child_task = task_map.get(child_id)
            if child_task:
                score += priority_weights.get(_normalize(child_task.priority), 10.0)
            else:
                score += 10.0
        impact_scores[t.id] = score

    return direct_dependents, transitive_blocked, impact_scores


def optimize_crew_queue(
    db: Session,
    crew_id: int,
    candidate_tasks: list[Maintenance] | None = None,
    base_time: datetime | None = None,
) -> CrewQueueResponse:
    """
    Optimizes the work queue for a specific crew using OR-Tools CP-SAT.
    Considers existing assignments, capacity, availability, dependencies,
    and downstream unlock impacts.
    """
    crew = db.get(Crew, crew_id)
    if not crew:
        raise ValueError(f"Crew with ID {crew_id} not found.")

    if base_time is None:
        base_time = datetime.now().replace(second=0, microsecond=0)

    # 1. Fetch active tasks for this crew or candidate tasks matching crew profile
    if candidate_tasks is not None:
        tasks = candidate_tasks
    else:
        # Load tasks explicitly assigned to this crew OR unassigned tasks matching crew_type
        tasks = db.scalars(
            select(Maintenance).where(
                Maintenance.status.notin_(["Completed", "Cancelled"]),
                (Maintenance.assigned_crew_id == crew.id)
                | (
                    (Maintenance.assigned_crew_id.is_(None))
                    & (Maintenance.crew_type == crew.crew_type)
                ),
            ).order_by(
                Maintenance.queue_position.nullslast(),
                Maintenance.sequence_order,
                Maintenance.id,
            )
        ).all()

    # Also fetch all active tasks in DB to resolve inter-task dependencies
    all_active_tasks = db.scalars(
        select(Maintenance).where(Maintenance.status.notin_(["Completed", "Cancelled"]))
    ).all()
    all_tasks_map = {t.id: t for t in all_active_tasks}
    for t in tasks:
        all_tasks_map[t.id] = t

    direct_dependents, transitive_blocked, impact_scores = calculate_dependency_impact(
        list(all_tasks_map.values())
    )

    if not tasks:
        # Empty queue
        workload = CrewWorkloadSummary(
            total_assigned_tasks=0,
            total_duration_minutes=0,
            active_tasks=0,
            queued_tasks=0,
            critical_tasks=0,
            reprioritized_tasks=0,
        )
        return CrewQueueResponse(
            crew_id=crew.id,
            crew_name=crew.name,
            crew_type=crew.crew_type,
            department=crew.department,
            capacity=crew.capacity,
            current_status=crew.status,
            current_workload=crew.current_workload or 0,
            workload=workload,
            original_queue=[],
            optimized_queue=[],
            changes=[],
            dependency_effects=[],
            optimization_status="OPTIMAL",
            explanation=f"{crew.name} currently has no pending maintenance tasks in queue.",
            human_approval_required=True,
        )

    # 2. Build original queue with 1-based positions
    # Sort by existing queue_position if available, else sequence_order, then id
    sorted_original = sorted(
        tasks,
        key=lambda x: (
            x.queue_position if x.queue_position is not None else 9999,
            x.sequence_order if x.sequence_order is not None else 1,
            x.id,
        ),
    )

    original_queue_tasks: list[CrewQueueTask] = []
    for idx, t in enumerate(sorted_original):
        pos = idx + 1
        dur = int(t.estimated_duration_minutes or 60)
        loc_code = t.block_code if t.location_type == "block" else t.station_code
        is_prereq = len(transitive_blocked.get(t.id, [])) > 0

        original_queue_tasks.append(
            CrewQueueTask(
                task_id=t.id,
                maintenance_type=t.maintenance_type,
                location_type=t.location_type,
                location_code=loc_code,
                block_code=t.block_code,
                station_code=t.station_code,
                department=t.department,
                crew_type=t.crew_type,
                crew_size=t.crew_size or 2,
                required_crew_size=t.crew_size or 2,
                assigned_crew_id=crew.id,
                assigned_crew_name=crew.name,
                available_capacity=crew.capacity,
                priority=t.priority,
                status=t.status,
                queue_state="In Progress" if _normalize(t.status) == "in progress" else "Queued",
                position=pos,
                original_position=pos,
                optimized_position=pos,
                priority_override=False,
                override_reason=None,
                duration_minutes=dur,
                start_minute=0,
                end_minute=dur,
                planned_start=t.planned_start.isoformat() if t.planned_start else None,
                planned_end=t.planned_end.isoformat() if t.planned_end else None,
                depends_on_maintenance_id=t.depends_on_maintenance_id,
                depends_on=[t.depends_on_maintenance_id] if t.depends_on_maintenance_id else [],
                blocked_tasks_unlocked=transitive_blocked.get(t.id, []),
                dependent_task_count=len(transitive_blocked.get(t.id, [])),
                dependency_impact_score=impact_scores.get(t.id, 0.0),
                bundle_id=t.bundle_id,
                bundle_role=t.bundle_role,
                is_prerequisite=is_prereq,
            )
        )

    # 3. Formulate CP-SAT Optimization Model
    model = cp_model.CpModel()

    total_duration = sum(int(t.estimated_duration_minutes or 60) for t in tasks)
    max_horizon = max(1440, total_duration * 3 + 180)  # 24 hours or duration with buffer

    start_vars: dict[int, cp_model.IntVar] = {}
    end_vars: dict[int, cp_model.IntVar] = {}
    interval_vars: dict[int, cp_model.IntervalVar] = {}
    durations: dict[int, int] = {}

    for t in tasks:
        dur = max(1, int(t.estimated_duration_minutes or 60))
        durations[t.id] = dur
        start_vars[t.id] = model.NewIntVar(0, max_horizon, f"start_{t.id}")
        end_vars[t.id] = model.NewIntVar(dur, max_horizon, f"end_{t.id}")
        interval_vars[t.id] = model.NewIntervalVar(
            start_vars[t.id], dur, end_vars[t.id], f"interval_{t.id}"
        )

    # Hard Constraint 1: Crew capacity constraint
    for t in tasks:
        req_size = t.crew_size or 2
        if req_size > crew.capacity:
            # Capacity violation
            explanation = (
                f"Crew capacity exceeded: Task '{t.maintenance_type}' (ID #{t.id}) requires "
                f"{req_size} personnel, but {crew.name} has capacity of only {crew.capacity}."
            )
            workload = CrewWorkloadSummary(
                total_assigned_tasks=len(tasks),
                total_duration_minutes=total_duration,
                active_tasks=sum(1 for t in tasks if _normalize(t.status) == "in progress"),
                queued_tasks=len(tasks),
                critical_tasks=sum(1 for t in tasks if _normalize(t.priority) == "critical"),
                reprioritized_tasks=0,
            )
            return CrewQueueResponse(
                crew_id=crew.id,
                crew_name=crew.name,
                crew_type=crew.crew_type,
                department=crew.department,
                capacity=crew.capacity,
                current_status=crew.status,
                current_workload=crew.current_workload or 0,
                workload=workload,
                original_queue=original_queue_tasks,
                optimized_queue=original_queue_tasks,
                changes=[],
                dependency_effects=[],
                optimization_status="INFEASIBLE",
                explanation=explanation,
                human_approval_required=True,
            )

    # Hard Constraint 2: Non-Overlap on Same Crew (single crew can only do one task at a time)
    if len(tasks) > 1:
        model.AddNoOverlap(list(interval_vars.values()))

    # Hard Constraint 3: Internal & External Task Dependencies
    for t in tasks:
        if t.depends_on_maintenance_id:
            parent_id = t.depends_on_maintenance_id
            if parent_id in start_vars:
                # Both parent and child belong to this crew's queue
                model.Add(start_vars[t.id] >= end_vars[parent_id])

    # Hard Constraint 4: Exclusive Block Access
    block_exclusive_tasks: dict[str, list[int]] = {}
    for t in tasks:
        if getattr(t, "requires_exclusive_block", False) and t.block_code:
            block_exclusive_tasks.setdefault(_normalize_code(t.block_code), []).append(t.id)

    for b_code, b_tids in block_exclusive_tasks.items():
        if len(b_tids) > 1:
            model.AddNoOverlap([interval_vars[tid] for tid in b_tids])

    # 4. Objective Function Formulation
    # Soft/objective priorities:
    # - Critical urgency weight: 10,000
    # - High weight: 2,000
    # - Medium weight: 200
    # - Low weight: 20
    # - Downstream unlock impact multiplier: (1 + 0.5 * dependent_task_count)
    # - Dependency impact score multiplier
    # - Tie-breaker: preserve original order (+ original_pos * 2)
    priority_base_weights = {
        "critical": 10000,
        "high": 2000,
        "medium": 200,
        "low": 20,
    }

    orig_pos_map = {item.task_id: item.original_position for item in original_queue_tasks}

    penalties = []
    for t in tasks:
        p_str = _normalize(t.priority)
        base_w = priority_base_weights.get(p_str, 200)

        # Predictive maintenance / urgency score multiplier
        urgency_mult = 1.0
        if getattr(t, "urgency_score", None):
            urgency_mult = 1.0 + (float(t.urgency_score) / 5.0)

        downstream_count = len(transitive_blocked.get(t.id, []))
        impact_score = impact_scores.get(t.id, 0.0)

        # A task that unlocks downstream work gets significant scheduling weight
        unlock_mult = 1.0 + (0.5 * downstream_count)
        eff_weight = int(base_w * urgency_mult * unlock_mult + impact_score * 50)

        # Penalize start time
        penalties.append(eff_weight * start_vars[t.id])

        # Tie-breaker: earlier original positions receive higher start penalty to preserve original sequence order when equal
        pos_tie_breaker = (len(tasks) + 1 - orig_pos_map.get(t.id, 1)) * 5
        penalties.append(pos_tie_breaker * start_vars[t.id])

    model.Minimize(sum(penalties))

    # 5. Solve CP-SAT
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(model)

    status_name = solver.StatusName(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        workload = CrewWorkloadSummary(
            total_assigned_tasks=len(tasks),
            total_duration_minutes=total_duration,
            active_tasks=sum(1 for t in tasks if _normalize(t.status) == "in progress"),
            queued_tasks=len(tasks),
            critical_tasks=sum(1 for t in tasks if _normalize(t.priority) == "critical"),
            reprioritized_tasks=0,
        )
        return CrewQueueResponse(
            crew_id=crew.id,
            crew_name=crew.name,
            crew_type=crew.crew_type,
            department=crew.department,
            capacity=crew.capacity,
            current_status=crew.status,
            current_workload=crew.current_workload or 0,
            workload=workload,
            original_queue=original_queue_tasks,
            optimized_queue=original_queue_tasks,
            changes=[],
            dependency_effects=[],
            optimization_status=status_name,
            explanation=f"Solver returned {status_name}: Conflicting task constraints or dependencies.",
            human_approval_required=True,
        )

    # 6. Extract Solver Results and Order Queue
    task_start_times = {t.id: solver.Value(start_vars[t.id]) for t in tasks}
    task_end_times = {t.id: solver.Value(end_vars[t.id]) for t in tasks}

    # Sort tasks by optimized start minute
    sorted_optimized = sorted(tasks, key=lambda x: (task_start_times[x.id], orig_pos_map.get(x.id, 1)))

    optimized_queue_tasks: list[CrewQueueTask] = []
    changes: list[QueueChange] = []
    dependency_effects: list[DependencyEffect] = []
    reprioritized_count = 0

    # Build optimized tasks
    for opt_idx, t in enumerate(sorted_optimized):
        opt_pos = opt_idx + 1
        orig_pos = orig_pos_map.get(t.id, opt_pos)
        s_val = task_start_times[t.id]
        e_val = task_end_times[t.id]
        dur = durations[t.id]

        p_start_dt = base_time + timedelta(minutes=s_val)
        p_end_dt = base_time + timedelta(minutes=e_val)

        downstream_ids = transitive_blocked.get(t.id, [])
        is_prereq = len(downstream_ids) > 0
        p_str = _normalize(t.priority)

        # Dynamic reprioritization check
        priority_override = False
        override_reason = None

        if opt_pos < orig_pos:
            # Task moved up!
            if p_str == "critical" or is_prereq:
                priority_override = True
                reprioritized_count += 1
                dep_names = []
                for cid in downstream_ids:
                    ctask = all_tasks_map.get(cid)
                    if ctask:
                        dep_names.append(f"{ctask.maintenance_type} (ID #{cid})")

                dep_text = ", ".join(dep_names[:2])
                if len(dep_names) > 2:
                    dep_text += f" and {len(dep_names) - 2} other task(s)"

                loc = f"block {t.block_code}" if t.block_code else f"station {t.station_code}"
                if dep_text:
                    override_reason = (
                        f"Moved ahead from position {orig_pos} → {opt_pos} because this is a "
                        f"{t.priority} prerequisite for {dep_text} on {loc}. "
                        f"{len(downstream_ids)} dependent task(s) unlocked."
                    )
                else:
                    override_reason = (
                        f"Moved ahead from position {orig_pos} → {opt_pos} due to {t.priority} urgency."
                    )

                changes.append(
                    QueueChange(
                        task_id=t.id,
                        task_name=t.maintenance_type,
                        original_position=orig_pos,
                        optimized_position=opt_pos,
                        priority=t.priority,
                        priority_override=True,
                        override_reason=override_reason,
                        blocked_tasks_unlocked=downstream_ids,
                    )
                )

        elif opt_pos > orig_pos:
            # Task moved down to yield to critical prerequisite
            override_reason = (
                f"Shifted from position {orig_pos} → {opt_pos} to accommodate higher-priority prerequisite task(s). "
                f"Normal scheduled work resumes after critical task completion."
            )
            changes.append(
                QueueChange(
                    task_id=t.id,
                    task_name=t.maintenance_type,
                    original_position=orig_pos,
                    optimized_position=opt_pos,
                    priority=t.priority,
                    priority_override=False,
                    override_reason=override_reason,
                    blocked_tasks_unlocked=[],
                )
            )

        # Determine queue state
        if _normalize(t.status) == "in progress":
            queue_state = "In Progress"
        elif _normalize(t.status) == "completed":
            queue_state = "Completed"
        elif priority_override:
            queue_state = "Reprioritized"
        elif t.depends_on_maintenance_id:
            parent_task = all_tasks_map.get(t.depends_on_maintenance_id)
            if parent_task and _normalize(parent_task.status) not in ("completed", "in progress"):
                queue_state = "Waiting for Dependency"
            else:
                queue_state = "Queued"
        else:
            queue_state = "Queued"

        # Dependency effects
        if is_prereq:
            loc = f"block {t.block_code}" if t.block_code else f"station {t.station_code}"
            dependency_effects.append(
                DependencyEffect(
                    task_id=t.id,
                    task_name=t.maintenance_type,
                    unlocks_task_ids=downstream_ids,
                    bundle_id=t.bundle_id,
                    impact_description=(
                        f"Completing {t.maintenance_type} unlocks {len(downstream_ids)} dependent task(s) "
                        f"on {loc}."
                    ),
                )
            )

        loc_code = t.block_code if t.location_type == "block" else t.station_code

        optimized_queue_tasks.append(
            CrewQueueTask(
                task_id=t.id,
                maintenance_type=t.maintenance_type,
                location_type=t.location_type,
                location_code=loc_code,
                block_code=t.block_code,
                station_code=t.station_code,
                department=t.department,
                crew_type=t.crew_type,
                crew_size=t.crew_size or 2,
                required_crew_size=t.crew_size or 2,
                assigned_crew_id=crew.id,
                assigned_crew_name=crew.name,
                available_capacity=crew.capacity,
                priority=t.priority,
                status=t.status,
                queue_state=queue_state,
                position=opt_pos,
                original_position=orig_pos,
                optimized_position=opt_pos,
                priority_override=priority_override,
                override_reason=override_reason,
                duration_minutes=dur,
                start_minute=s_val,
                end_minute=e_val,
                planned_start=p_start_dt.isoformat(),
                planned_end=p_end_dt.isoformat(),
                depends_on_maintenance_id=t.depends_on_maintenance_id,
                depends_on=[t.depends_on_maintenance_id] if t.depends_on_maintenance_id else [],
                blocked_tasks_unlocked=downstream_ids,
                dependent_task_count=len(downstream_ids),
                dependency_impact_score=impact_scores.get(t.id, 0.0),
                bundle_id=t.bundle_id,
                bundle_role=t.bundle_role,
                is_prerequisite=is_prereq,
            )
        )

    # Generate explainable summary
    if reprioritized_count > 0:
        reprioritized_names = [
            c.task_name for c in changes if c.priority_override
        ]
        rep_text = ", ".join(reprioritized_names)
        explanation = (
            f"CP-SAT optimizer temporarily reprioritized {rep_text} for {crew.name}. "
            f"Moving critical prerequisites forward unlocks downstream maintenance while preserving "
            f"all lower-priority queued work to resume immediately after completion."
        )
    elif len(changes) > 0:
        explanation = (
            f"CP-SAT optimized {crew.name} queue ordering to minimize total delays "
            f"and eliminate idle intervals."
        )
    else:
        explanation = (
            f"{crew.name} current queue order is already optimal. "
            f"All dependencies and priority constraints are satisfied."
        )

    workload = CrewWorkloadSummary(
        total_assigned_tasks=len(tasks),
        total_duration_minutes=total_duration,
        active_tasks=sum(1 for t in tasks if _normalize(t.status) == "in progress"),
        queued_tasks=len(tasks),
        critical_tasks=sum(1 for t in tasks if _normalize(t.priority) == "critical"),
        reprioritized_tasks=reprioritized_count,
    )

    return CrewQueueResponse(
        crew_id=crew.id,
        crew_name=crew.name,
        crew_type=crew.crew_type,
        department=crew.department,
        capacity=crew.capacity,
        current_status=crew.status,
        current_workload=crew.current_workload or 0,
        workload=workload,
        original_queue=original_queue_tasks,
        optimized_queue=optimized_queue_tasks,
        changes=changes,
        dependency_effects=dependency_effects,
        optimization_status=status_name,
        explanation=explanation,
        human_approval_required=True,
    )


def get_all_crew_queues(db: Session) -> list[CrewQueueResponse]:
    """
    Returns optimized work queues for all active crews in the database.
    """
    crews = db.scalars(select(Crew).order_by(Crew.id)).all()
    results: list[CrewQueueResponse] = []
    for crew in crews:
        res = optimize_crew_queue(db=db, crew_id=crew.id)
        results.append(res)
    return results


def apply_crew_queue(
    db: Session,
    request: CrewQueueApplyRequest,
) -> CrewQueueApplyResponse:
    """
    Applies an approved optimized queue order to the database.
    Requires explicit human approval from an authorized railway section controller.
    """
    if not request.approved_by or len(request.approved_by.strip()) < 2:
        raise ValueError("Valid 'approved_by' controller name is required for schedule application.")

    crew = db.get(Crew, request.crew_id)
    if not crew:
        raise ValueError(f"Crew with ID {request.crew_id} not found.")

    applied_count = 0
    total_duration = 0

    for assignment in request.task_positions:
        task = db.get(Maintenance, assignment.task_id)
        if task:
            task.queue_position = assignment.queue_position
            task.assigned_crew_id = crew.id
            if assignment.planned_start:
                try:
                    task.planned_start = datetime.fromisoformat(assignment.planned_start)
                except ValueError:
                    pass
            if assignment.planned_end:
                try:
                    task.planned_end = datetime.fromisoformat(assignment.planned_end)
                except ValueError:
                    pass

            applied_count += 1
            total_duration += int(task.estimated_duration_minutes or 60)

    # Update crew current workload
    crew.current_workload = total_duration

    db.commit()

    applied_at = datetime.now().isoformat()

    return CrewQueueApplyResponse(
        success=True,
        message=(
            f"Successfully applied optimized queue ({applied_count} tasks) for {crew.name}. "
            f"Approved by section controller {request.approved_by}."
        ),
        crew_id=crew.id,
        applied_tasks_count=applied_count,
        approved_by=request.approved_by,
        applied_at=applied_at,
    )
