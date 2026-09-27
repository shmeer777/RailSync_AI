"""
Maintenance Compatibility Service for RailSync AI.

Evaluates whether maintenance tasks can safely, logically, and operationally
share the same railway block window before optimization.
"""

from typing import Any
from app.models.maintenance import Maintenance
from app.models.crew import Crew


# Configurable matrix of incompatible maintenance work type pairs.
# Pairs that cannot safely or operationally share a block window.
INCOMPATIBLE_WORK_TYPE_PAIRS: set[frozenset[str]] = {
    frozenset({"OHE High Voltage Energization", "Track Ballast Cleaning"}),
    frozenset({"Heavy Track Relay", "Signal Interlocking Live Test"}),
    frozenset({"Bridge Structural Demolition", "Signal Cable Trenching"}),
    frozenset({"Continuous Welded Rail Destressing", "OHE Live Wire Testing"}),
}


def _normalize(val: str | None) -> str:
    return str(val or "").strip().lower()


def _normalize_code(val: str | None) -> str:
    return str(val or "").strip().upper()


def is_compatible(
    task_a: Maintenance,
    task_b: Maintenance,
    available_crews: list[Crew] | None = None,
) -> tuple[bool, str | None]:
    """
    Evaluates pairwise compatibility between two maintenance tasks.

    Checks:
    1. Same block/section requirement
    2. Location type consistency (both must be block maintenance)
    3. Work-type safety conflicts
    4. Circular dependencies
    5. Exclusive block access constraints (if parallel execution is forced)
    6. Crew resource availability

    Returns (is_compatible, reason_if_incompatible).
    """
    # 1. Location type check
    if _normalize(task_a.location_type) != "block" or _normalize(task_b.location_type) != "block":
        return False, (
            f"Incompatible location types: Task {task_a.id} ({task_a.location_type}) "
            f"vs Task {task_b.id} ({task_b.location_type}). Only block maintenance can be bundled."
        )

    # 2. Block code check
    block_a = _normalize_code(task_a.block_code)
    block_b = _normalize_code(task_b.block_code)
    if not block_a or not block_b or block_a != block_b:
        return False, (
            f"Tasks are on different railway blocks: Task {task_a.id} on '{block_a}' "
            f"vs Task {task_b.id} on '{block_b}'."
        )

    # 3. Work type safety conflict check
    work_a = task_a.maintenance_type.strip()
    work_b = task_b.maintenance_type.strip()
    pair = frozenset({work_a, work_b})
    if pair in INCOMPATIBLE_WORK_TYPE_PAIRS:
        return False, (
            f"Safety constraint: '{work_a}' and '{work_b}' are operationally "
            f"incompatible and cannot safely share the same block window."
        )

    # 4. Circular dependency check
    if task_a.depends_on_maintenance_id == task_b.id and task_b.depends_on_maintenance_id == task_a.id:
        return False, (
            f"Circular dependency detected between Task {task_a.id} and Task {task_b.id}."
        )

    # 5. Exclusive block conflict
    # If both require exclusive block and both demand parallel execution
    if (
        getattr(task_a, "requires_exclusive_block", False)
        and getattr(task_b, "requires_exclusive_block", False)
        and _normalize(task_a.execution_mode) == "parallel"
        and _normalize(task_b.execution_mode) == "parallel"
    ):
        return False, (
            f"Exclusive block conflict: Both Task {task_a.id} and Task {task_b.id} "
            f"require exclusive block access and cannot run concurrently."
        )

    # 6. Crew resource availability check (if crews provided)
    if available_crews is not None:
        def has_viable_crew(task: Maintenance) -> bool:
            t_crew_type = _normalize(task.crew_type)
            t_dept = _normalize(task.department)
            req_size = task.crew_size or 1
            for c in available_crews:
                c_type = _normalize(c.crew_type)
                c_dept = _normalize(c.department)
                if (c_type == t_crew_type or c_dept == t_dept) and c.capacity >= req_size:
                    if _normalize(c.status) in {"available", "active"}:
                        return True
            return False

        if not has_viable_crew(task_a):
            return False, (
                f"No available crew for Task {task_a.id} ({task_a.crew_type}, size {task_a.crew_size})."
            )
        if not has_viable_crew(task_b):
            return False, (
                f"No available crew for Task {task_b.id} ({task_b.crew_type}, size {task_b.crew_size})."
            )

    return True, None


def filter_compatible_tasks(
    tasks: list[Maintenance],
    available_crews: list[Crew] | None = None,
) -> tuple[list[Maintenance], list[dict[str, Any]]]:
    """
    Filters a list of maintenance tasks for a block, separating compatible tasks
    from incompatible tasks and providing clear reasons for exclusion.
    """
    if not tasks:
        return [], []

    compatible_tasks: list[Maintenance] = []
    incompatible_records: list[dict[str, Any]] = []

    # First verify individual crew availability if crews provided
    if available_crews is not None:
        def crew_ok(t: Maintenance) -> tuple[bool, str | None]:
            t_crew_type = _normalize(t.crew_type)
            t_dept = _normalize(t.department)
            req_size = t.crew_size or 1
            for c in available_crews:
                c_type = _normalize(c.crew_type)
                c_dept = _normalize(c.department)
                if (c_type == t_crew_type or c_dept == t_dept) and c.capacity >= req_size:
                    if _normalize(c.status) in {"available", "active"}:
                        return True, None
            return False, f"No crew with capacity >= {req_size} available for {t.crew_type} ({t.department})"

        candidate_tasks = []
        for t in tasks:
            ok, reason = crew_ok(t)
            if not ok:
                incompatible_records.append({
                    "task_id": t.id,
                    "maintenance_type": t.maintenance_type,
                    "department": t.department,
                    "reason": reason,
                })
            else:
                candidate_tasks.append(t)
    else:
        candidate_tasks = list(tasks)

    # Now verify pairwise compatibility among candidates
    for t in candidate_tasks:
        is_t_compatible = True
        rejection_reason = None

        for other in candidate_tasks:
            if other.id == t.id:
                continue
            ok, reason = is_compatible(t, other, available_crews=None)
            if not ok:
                is_t_compatible = False
                rejection_reason = reason
                break

        if is_t_compatible:
            compatible_tasks.append(t)
        else:
            incompatible_records.append({
                "task_id": t.id,
                "maintenance_type": t.maintenance_type,
                "department": t.department,
                "reason": rejection_reason or "Incompatible with other tasks on this block",
            })

    return compatible_tasks, incompatible_records
