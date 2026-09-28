"""
Asset Availability Optimization Service for RailSync AI.

Innovates maintenance scheduling by globally optimizing maintenance timing and coordination
across the modeled railway network to MAXIMIZE THE AVAILABILITY OF RAILWAY ASSETS
FOR TRAIN OPERATIONS while ensuring all required maintenance is completed.

Balances:
- Required maintenance completion
- Asset availability across time
- Train traffic and route criticality
- Train conflicts
- Maintenance urgency and deadlines
- Multi-department bundled tasks
- Crew availability and capacity constraints
- Task dependencies and exclusive block clearance
"""

from datetime import datetime, timedelta
from typing import Any
import math

from fastapi import HTTPException
from ortools.sat.python import cp_model
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.block import Block
from app.models.crew import Crew
from app.models.maintenance import Maintenance
from app.models.train import Train
from app.schemas.asset_availability import (
    AssetAvailabilityApproveRequest,
    AssetAvailabilityApproveResponse,
    AssetAvailabilityOptimizeRequest,
    AssetAvailabilityResponse,
    AvailabilityImpact,
    AvailabilityMetrics,
    RestrictedBlockInfo,
    TimeSlotAvailability,
)
from app.services.ai.maintenance_bundler import (
    _normalize,
    _normalize_code,
    bundle_compatible_maintenance,
)
from app.services.ai.traffic_estimator import (
    get_all_blocks_traffic,
    resolve_planning_window,
)


def _parse_start_time(time_str: str | None, base_dt: datetime | None = None) -> datetime | None:
    """Parses optional start time string ('HH:MM' or ISO-8601)."""
    if not time_str or not time_str.strip():
        return None
    cleaned = time_str.strip()
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        pass
    base = base_dt or datetime.now().replace(second=0, microsecond=0)
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            t = datetime.strptime(cleaned, fmt).time()
            target_dt = base.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)
            if base.hour >= 20 and t.hour < 12:
                target_dt += timedelta(days=1)
            return target_dt
        except ValueError:
            continue
    return None


_ASSET_AVAILABILITY_CACHE: dict[str, tuple[float, AssetAvailabilityResponse]] = {}
_CACHE_TTL_SECONDS = 60.0
_LATEST_APPROVAL_STATE: dict[str, Any] = {
    "approved": False,
    "approved_at": None,
    "approved_by": None,
    "cache_key": None,
}


def calculate_asset_availability(
    db: Session,
    request: AssetAvailabilityOptimizeRequest | None = None,
    force_refresh: bool = False,
) -> AssetAvailabilityResponse:
    """
    Computes baseline vs. OR-Tools CP-SAT optimized asset availability across the modeled railway network.
    """
    import time

    if request is None:
        request = AssetAvailabilityOptimizeRequest()

    window_pref = request.planning_window or "night"
    stagger_enabled = request.stagger_multi_blocks

    # Check cache for PostgreSQL production/local environments (skip for sqlite in-memory tests)
    is_sqlite_test = False
    try:
        bind_url = str(db.get_bind().url)
        if "sqlite" in bind_url:
            is_sqlite_test = True
    except Exception:
        pass

    target_keys = sorted(request.target_block_codes or [])
    cache_key = f"{window_pref}:{stagger_enabled}:{request.start_time}:{','.join(target_keys)}"

    if not is_sqlite_test and not force_refresh and cache_key in _ASSET_AVAILABILITY_CACHE:
        cached_time, cached_res = _ASSET_AVAILABILITY_CACHE[cache_key]
        if time.time() - cached_time < _CACHE_TTL_SECONDS:
            return cached_res

    # 1. Read actual operational blocks from database
    blocks = db.scalars(select(Block).order_by(Block.id)).all()
    total_assets = len(blocks)
    block_map = {_normalize_code(b.code): b for b in blocks}

    # 2. Resolve planning window & horizon
    start_time_override = _parse_start_time(request.start_time)
    plan_start_dt, horizon_minutes, window_desc = resolve_planning_window(
        window_preference=window_pref,
        base_time=start_time_override,
    )
    if start_time_override:
        plan_start_dt = start_time_override

    # 3. Retrieve active maintenance tasks on blocks
    query = select(Maintenance).where(
        Maintenance.location_type == "block",
        Maintenance.block_code.isnot(None),
        Maintenance.status.notin_(["Completed", "Cancelled"]),
    )
    if request.target_block_codes:
        normalized_targets = [_normalize_code(c) for c in request.target_block_codes]
        query = query.where(Maintenance.block_code.in_(normalized_targets))

    active_tasks = db.scalars(query.order_by(Maintenance.id)).all()

    # If no maintenance is scheduled, network is 100% available
    if not active_tasks or total_assets == 0:
        return _build_empty_maintenance_response(
            total_assets=total_assets,
            window_pref=window_pref,
            horizon_minutes=horizon_minutes,
            plan_start_dt=plan_start_dt,
        )

    # 4. Generate Multi-Department Maintenance Bundles per block
    bundles = bundle_compatible_maintenance(
        db=db,
        persist=False,
        window_preference=window_pref,
        base_time=plan_start_dt,
    )

    if request.target_block_codes:
        normalized_targets = {_normalize_code(c) for c in request.target_block_codes}
        bundles = [b for b in bundles if _normalize_code(b.get("block_code")) in normalized_targets]

    # Filter out any bundles with no tasks
    bundles = [b for b in bundles if b.get("total_tasks", 0) > 0 and b.get("tasks")]

    if not bundles:
        return _build_empty_maintenance_response(
            total_assets=total_assets,
            window_pref=window_pref,
            horizon_minutes=horizon_minutes,
            plan_start_dt=plan_start_dt,
        )

    # 5. Fetch Route-Aware Traffic & Route Criticality for all blocks
    traffic_by_block = get_all_blocks_traffic(
        db=db,
        blocks=blocks,
        horizon_minutes=horizon_minutes,
    )

    # 6. CALCULATE BASELINE (Naive simultaneous uncoordinated schedule)
    baseline_metrics, baseline_conflicts = _compute_baseline_schedule(
        bundles=bundles,
        total_assets=total_assets,
        traffic_by_block=traffic_by_block,
        plan_start_dt=plan_start_dt,
        horizon_minutes=horizon_minutes,
    )

    # 7. CP-SAT ASSET AVAILABILITY OPTIMIZER
    optimized_result = _optimize_asset_availability_cpsat(
        bundles=bundles,
        total_assets=total_assets,
        traffic_by_block=traffic_by_block,
        plan_start_dt=plan_start_dt,
        horizon_minutes=horizon_minutes,
        stagger_enabled=stagger_enabled,
    )

    optimized_metrics = optimized_result["metrics"]
    timeline = optimized_result["timeline"]
    opt_status = optimized_result["status"]
    explanation = optimized_result["explanation"]

    # 8. Compute Impact Deltas
    avail_diff = round(
        optimized_metrics.availability_percentage - baseline_metrics.availability_percentage,
        1,
    )
    restricted_diff = optimized_metrics.restricted_assets - baseline_metrics.restricted_assets
    conflict_diff = optimized_metrics.train_conflicts - baseline_metrics.train_conflicts
    closure_diff = optimized_metrics.block_closures - baseline_metrics.block_closures
    time_saved = max(
        0,
        baseline_metrics.maintenance_window_minutes - optimized_metrics.maintenance_window_minutes,
    )

    impact = AvailabilityImpact(
        availability_change_percentage_points=avail_diff,
        restricted_asset_change=restricted_diff,
        train_conflict_change=conflict_diff,
        block_closure_change=closure_diff,
        time_saved_minutes=time_saved,
    )

    is_approved = False
    approved_by = None
    approved_at = None

    if _LATEST_APPROVAL_STATE.get("approved") and _LATEST_APPROVAL_STATE.get("cache_key") == cache_key:
        is_approved = True
        approved_by = _LATEST_APPROVAL_STATE.get("approved_by")
        approved_at = _LATEST_APPROVAL_STATE.get("approved_at")
    elif not force_refresh:
        db_approved_note = db.scalar(
            select(Maintenance.dependency_note)
            .where(Maintenance.dependency_note.like("%Approved via Asset Availability%"))
            .order_by(Maintenance.id.desc())
        )
        if db_approved_note:
            import re
            m = re.search(r"Approved via Asset Availability Optimization by (.+) at (.+)", db_approved_note)
            if m:
                is_approved = True
                approved_by = m.group(1).strip()
                approved_at = m.group(2).strip()

    res = AssetAvailabilityResponse(
        total_assets=total_assets,
        planning_window=window_pref,
        horizon_minutes=horizon_minutes,
        baseline=baseline_metrics,
        optimized=optimized_metrics,
        impact=impact,
        timeline=timeline,
        optimization_status=opt_status,
        explanation=explanation,
        human_approval_required=True,
        approved=is_approved,
        approved_at=approved_at,
        approved_by=approved_by,
    )

    if not is_sqlite_test:
        import time
        _ASSET_AVAILABILITY_CACHE[cache_key] = (time.time(), res)

    return res


def _build_empty_maintenance_response(
    total_assets: int,
    window_pref: str,
    horizon_minutes: int,
    plan_start_dt: datetime,
) -> AssetAvailabilityResponse:
    """Builds a response when no maintenance is active or required."""
    empty_metrics = AvailabilityMetrics(
        total_assets=total_assets,
        available_assets=total_assets,
        restricted_assets=0,
        availability_percentage=100.0,
        peak_available_assets=total_assets,
        minimum_available_assets=total_assets,
        maintenance_tasks_completed=0,
        maintenance_window_minutes=0,
        train_conflicts=0,
        block_closures=0,
        restricted_blocks=[],
    )

    # Generate timeline slots with 100% availability
    slot_count = max(1, horizon_minutes // 60)
    timeline = []
    for s in range(slot_count):
        slot_start_m = s * 60
        slot_end_m = (s + 1) * 60
        s_dt = plan_start_dt + timedelta(minutes=slot_start_m)
        e_dt = plan_start_dt + timedelta(minutes=slot_end_m)
        timeline.append(
            TimeSlotAvailability(
                slot_index=s,
                time_label=f"{s_dt.strftime('%H:%M')}–{e_dt.strftime('%H:%M')}",
                start_minute=slot_start_m,
                end_minute=slot_end_m,
                total_assets=total_assets,
                available_assets=total_assets,
                restricted_assets=0,
                availability_percentage=100.0,
                restricted_blocks=[],
                is_peak=True,
                is_bottleneck=False,
            )
        )

    return AssetAvailabilityResponse(
        total_assets=total_assets,
        planning_window=window_pref,
        horizon_minutes=horizon_minutes,
        baseline=empty_metrics,
        optimized=empty_metrics,
        impact=AvailabilityImpact(
            availability_change_percentage_points=0.0,
            restricted_asset_change=0,
            train_conflict_change=0,
            block_closure_change=0,
            time_saved_minutes=0,
        ),
        timeline=timeline,
        optimization_status="OPTIMAL",
        explanation="All railway blocks are fully operational. No active or planned maintenance restrictions.",
        human_approval_required=True,
    )


def _compute_baseline_schedule(
    bundles: list[dict[str, Any]],
    total_assets: int,
    traffic_by_block: dict[str, dict[str, Any]],
    plan_start_dt: datetime,
    horizon_minutes: int,
) -> tuple[AvailabilityMetrics, int]:
    """
    Computes a deterministic baseline scenario representing an uncoordinated, non-staggered schedule.
    In the baseline:
    - All maintenance bundles start at the beginning of the planning window (t=0) simultaneously.
    - All affected blocks are restricted at the same time.
    - Train conflicts are evaluated during this simultaneous closure.
    """
    num_restricted = len(bundles)
    available_assets = max(0, total_assets - num_restricted)
    avail_pct = round((available_assets / total_assets) * 100, 1) if total_assets > 0 else 0.0

    total_tasks_completed = sum(b.get("total_tasks", 0) for b in bundles)
    max_duration = max((int(b.get("total_window_minutes", 60)) for b in bundles), default=0)

    # Count unbundled closures in baseline (each task would have required a separate closure if uncoordinated)
    baseline_closures = sum(len(b.get("tasks", [])) for b in bundles)

    # Calculate train conflicts during baseline concurrent window
    train_conflicts = 0
    restricted_info_list = []

    for b in bundles:
        b_code = b.get("block_code", "")
        b_dur = int(b.get("total_window_minutes", 60))
        t_info = traffic_by_block.get(b_code, {})
        crit = int(t_info.get("total_traffic_score", 0))

        # Train conflicts for baseline: trains traversing block during [0, b_dur]
        block_conflicts = 0
        for tr in t_info.get("expected_trains", []):
            if tr.get("eta_minute", 0) < b_dur:
                block_conflicts += 1

        train_conflicts += block_conflicts

        restricted_info_list.append(
            RestrictedBlockInfo(
                block_code=b_code,
                block_name=b.get("block_name", f"Block {b_code}"),
                start_time=plan_start_dt.isoformat(),
                end_time=(plan_start_dt + timedelta(minutes=b_dur)).isoformat(),
                start_minute=0,
                end_minute=b_dur,
                duration_minutes=b_dur,
                maintenance_tasks_count=b.get("total_tasks", 0),
                departments=b.get("departments", []),
                crews=b.get("crews", []),
                route_criticality=crit,
                train_conflicts=block_conflicts,
                tasks=b.get("tasks", []),
            )
        )

    metrics = AvailabilityMetrics(
        total_assets=total_assets,
        available_assets=available_assets,
        restricted_assets=num_restricted,
        availability_percentage=avail_pct,
        peak_available_assets=total_assets,
        minimum_available_assets=available_assets,
        maintenance_tasks_completed=total_tasks_completed,
        maintenance_window_minutes=max_duration,
        train_conflicts=train_conflicts,
        block_closures=baseline_closures,
        restricted_blocks=restricted_info_list,
    )

    return metrics, train_conflicts


def _optimize_asset_availability_cpsat(
    bundles: list[dict[str, Any]],
    total_assets: int,
    traffic_by_block: dict[str, dict[str, Any]],
    plan_start_dt: datetime,
    horizon_minutes: int,
    stagger_enabled: bool = True,
) -> dict[str, Any]:
    """
    Formulates and solves the network-wide Asset Availability Optimization problem
    using OR-Tools CP-SAT.

    Hard Constraints:
    - Maintenance completion: All required tasks/bundles must be scheduled within horizon.
    - Crew non-overlap: If a crew is assigned to tasks across different blocks, they cannot overlap.
    - Dependencies: Inter-task and inter-block dependencies must be preserved.
    - Horizon: All work must complete before horizon_minutes.

    Objectives (Weighted Multi-Objective):
    1. Maximize Asset Availability / Minimize concurrent restricted blocks:
       - Penalize concurrent block restrictions across time slots.
       - Strongly penalize peak simultaneous block closures.
    2. Minimize Train Conflicts:
       - Penalize scheduling restrictions during slots with active train movements.
    3. Respect Maintenance Urgency:
       - Critical / High urgency tasks penalize excessive scheduling delay.
    4. Compact Maintenance Window:
       - Moderate penalty on total makespan to keep work contained.
    """
    model = cp_model.CpModel()
    n_bundles = len(bundles)

    # 1. Horizon setup
    max_bundle_dur = max((int(b.get("total_window_minutes", 60)) for b in bundles), default=60)
    sum_durations = sum(int(b.get("total_window_minutes", 60)) for b in bundles)
    effective_horizon = max(horizon_minutes, sum_durations + 180)

    # Time slot granularity for availability evaluation (30-minute intervals)
    slot_size_minutes = 30
    num_slots = max(1, effective_horizon // slot_size_minutes)

    # Decision variables for each block bundle
    start_vars: dict[int, cp_model.IntVar] = {}
    end_vars: dict[int, cp_model.IntVar] = {}
    interval_vars: dict[int, cp_model.IntervalVar] = {}
    durations: dict[int, int] = {}

    for idx, b in enumerate(bundles):
        dur = max(1, int(b.get("total_window_minutes", 60)))
        durations[idx] = dur
        start_vars[idx] = model.NewIntVar(0, effective_horizon - dur, f"start_bundle_{idx}")
        end_vars[idx] = model.NewIntVar(dur, effective_horizon, f"end_bundle_{idx}")
        interval_vars[idx] = model.NewIntervalVar(
            start_vars[idx], dur, end_vars[idx], f"interval_bundle_{idx}"
        )

    # 2. Crew Non-Overlap Constraints Across Blocks
    # If the same crew is utilized in multiple block bundles, their windows cannot overlap
    crew_to_bundles: dict[str, list[int]] = {}
    for idx, b in enumerate(bundles):
        for crew_name in b.get("crews", []):
            norm_c = _normalize(crew_name)
            if norm_c and norm_c not in {"standard crew", "general", "independent team"}:
                crew_to_bundles.setdefault(norm_c, []).append(idx)

    for crew_name, bundle_indices in crew_to_bundles.items():
        if len(bundle_indices) > 1:
            crew_intervals = [interval_vars[i] for i in bundle_indices]
            model.AddNoOverlap(crew_intervals)

    # 3. Inter-Task Dependencies Across Bundles
    # Check if any task in bundle B depends on a task in bundle A
    task_to_bundle: dict[int, int] = {}
    for idx, b in enumerate(bundles):
        for t in b.get("tasks", []):
            task_to_bundle[t["id"]] = idx

    for idx, b in enumerate(bundles):
        for t in b.get("tasks", []):
            parent_id = t.get("depends_on_maintenance_id")
            if parent_id and parent_id in task_to_bundle:
                parent_bundle_idx = task_to_bundle[parent_id]
                if parent_bundle_idx != idx:
                    # Bundle idx must start after parent bundle ends
                    model.Add(start_vars[idx] >= end_vars[parent_bundle_idx])

    # 4. Disjunctive Staggering & Slot Occupancy Variables
    # is_active[idx, s] == 1 if bundle idx is restricted during slot s
    is_active: dict[tuple[int, int], cp_model.BoolVar] = {}

    for idx in range(n_bundles):
        dur = durations[idx]
        for s in range(num_slots):
            s_start = s * slot_size_minutes
            s_end = (s + 1) * slot_size_minutes

            b_active = model.NewBoolVar(f"active_b{idx}_s{s}")
            is_active[(idx, s)] = b_active

            before_s = model.NewBoolVar(f"b{idx}_before_s{s}")
            after_s = model.NewBoolVar(f"b{idx}_after_s{s}")

            model.Add(end_vars[idx] <= s_start).OnlyEnforceIf(before_s)
            model.Add(start_vars[idx] >= s_end).OnlyEnforceIf(after_s)
            model.Add(before_s + after_s + b_active == 1)

    # 5. Objective Formulation
    objective_terms = []

    # A. Staggering & Availability Objective:
    # Minimize concurrent restrictions in each slot
    if stagger_enabled and n_bundles > 1:
        # Penalize simultaneous closures
        max_concurrent = model.NewIntVar(0, n_bundles, "max_concurrent_restricted")
        for s in range(num_slots):
            slot_restricted = [is_active[(idx, s)] for idx in range(n_bundles)]
            # Slot restriction sum
            slot_r_sum = model.NewIntVar(0, n_bundles, f"slot_{s}_r_sum")
            model.Add(slot_r_sum == sum(slot_restricted))
            model.Add(max_concurrent >= slot_r_sum)

            # Linear penalty for each restricted block in slot s
            objective_terms.append(1000 * slot_r_sum)

        # Strongly penalize the peak concurrent restrictions
        objective_terms.append(25000 * max_concurrent)
    else:
        # Standard restriction penalty
        for s in range(num_slots):
            for idx in range(n_bundles):
                objective_terms.append(500 * is_active[(idx, s)])

    # B. Train Traffic & Route Criticality Integration:
    # Penalize scheduling restrictions during slots with train traffic
    for idx, b in enumerate(bundles):
        b_code = b.get("block_code", "")
        t_info = traffic_by_block.get(b_code, {})
        slot_traffic = t_info.get("slot_traffic", [])

        for s in range(min(num_slots, len(slot_traffic))):
            t_score = slot_traffic[s]
            if t_score > 0:
                # Heavy penalty for closing block during high train traffic slots
                objective_terms.append(t_score * 3500 * is_active[(idx, s)])

    # C. Urgency Penalties:
    # Critical and High urgency tasks should not be delayed needlessly
    urgency_weights = {
        "critical": 8000,
        "high": 2500,
        "medium": 300,
        "low": 50,
    }

    for idx, b in enumerate(bundles):
        tasks = b.get("tasks", [])
        highest_p = "medium"
        for t in tasks:
            p = _normalize(t.get("priority", "medium"))
            if p == "critical":
                highest_p = "critical"
                break
            elif p == "high" and highest_p != "critical":
                highest_p = "high"

        w = urgency_weights.get(highest_p, 300)
        objective_terms.append(w * start_vars[idx])

    # D. Makespan (compactness)
    overall_end = model.NewIntVar(0, effective_horizon, "overall_end")
    model.AddMaxEquality(overall_end, list(end_vars.values()))
    objective_terms.append(20 * overall_end)

    model.Minimize(sum(objective_terms))

    # 6. Solve Model
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(model)
    status_name = solver.StatusName(status)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Fallback to sequential safe plan if solver fails
        return _build_fallback_result(
            bundles=bundles,
            total_assets=total_assets,
            traffic_by_block=traffic_by_block,
            plan_start_dt=plan_start_dt,
            horizon_minutes=horizon_minutes,
            status_name=status_name,
        )

    # 7. Extract Scheduled Values
    scheduled_bundles = []
    for idx, b in enumerate(bundles):
        s_val = int(solver.Value(start_vars[idx]))
        e_val = int(solver.Value(end_vars[idx]))
        b_code = b.get("block_code", "")
        t_info = traffic_by_block.get(b_code, {})
        crit = int(t_info.get("total_traffic_score", 0))

        # Calculate actual train conflicts in optimized window
        conflicts = 0
        for tr in t_info.get("expected_trains", []):
            eta = tr.get("eta_minute", 0)
            dep = tr.get("depart_minute", eta + 15)
            if not (dep <= s_val or eta >= e_val):
                conflicts += 1

        scheduled_bundles.append({
            "block_code": b_code,
            "block_name": b.get("block_name", f"Block {b_code}"),
            "start_minute": s_val,
            "end_minute": e_val,
            "duration_minutes": e_val - s_val,
            "start_time": (plan_start_dt + timedelta(minutes=s_val)).isoformat(),
            "end_time": (plan_start_dt + timedelta(minutes=e_val)).isoformat(),
            "total_tasks": b.get("total_tasks", 0),
            "departments": b.get("departments", []),
            "crews": b.get("crews", []),
            "route_criticality": crit,
            "train_conflicts": conflicts,
            "tasks": b.get("tasks", []),
        })

    # 8. Build Time-Aware Hourly Timeline
    timeline_slots = max(1, effective_horizon // 60)
    timeline: list[TimeSlotAvailability] = []
    slot_availabilities = []

    for s in range(timeline_slots):
        s_start_m = s * 60
        s_end_m = (s + 1) * 60
        s_dt = plan_start_dt + timedelta(minutes=s_start_m)
        e_dt = plan_start_dt + timedelta(minutes=s_end_m)

        # Blocks restricted in this 60-min slot
        r_blocks = []
        for sb in scheduled_bundles:
            if not (sb["end_minute"] <= s_start_m or sb["start_minute"] >= s_end_m):
                r_blocks.append(sb["block_code"])

        num_r = len(r_blocks)
        avail = max(0, total_assets - num_r)
        pct = round((avail / total_assets) * 100, 1) if total_assets > 0 else 0.0

        slot_availabilities.append(avail)

        timeline.append(
            TimeSlotAvailability(
                slot_index=s,
                time_label=f"{s_dt.strftime('%H:%M')}–{e_dt.strftime('%H:%M')}",
                start_minute=s_start_m,
                end_minute=s_end_m,
                total_assets=total_assets,
                available_assets=avail,
                restricted_assets=num_r,
                availability_percentage=pct,
                restricted_blocks=r_blocks,
                is_peak=False,
                is_bottleneck=False,
            )
        )

    # Mark peaks and bottlenecks in timeline
    if slot_availabilities:
        max_avail = max(slot_availabilities)
        min_avail = min(slot_availabilities)
        for t_slot in timeline:
            if t_slot.available_assets == max_avail:
                t_slot.is_peak = True
            if t_slot.available_assets == min_avail and min_avail < total_assets:
                t_slot.is_bottleneck = True

    # 9. Compute Summary Metrics
    peak_avail = max(slot_availabilities) if slot_availabilities else total_assets
    min_avail = min(slot_availabilities) if slot_availabilities else total_assets
    max_concurrent_restricted = max((len(t.restricted_blocks) for t in timeline), default=0)

    # Operational asset availability represents the guaranteed operational capacity during maintenance
    operational_available = total_assets - max_concurrent_restricted
    operational_avail_pct = (
        round((operational_available / total_assets) * 100, 1) if total_assets > 0 else 0.0
    )

    total_tasks_completed = sum(sb["total_tasks"] for sb in scheduled_bundles)
    total_window_span = max((sb["end_minute"] for sb in scheduled_bundles), default=0)
    total_conflicts = sum(sb["train_conflicts"] for sb in scheduled_bundles)
    total_closures = len(scheduled_bundles)

    restricted_info_list = [
        RestrictedBlockInfo(
            block_code=sb["block_code"],
            block_name=sb["block_name"],
            start_time=sb["start_time"],
            end_time=sb["end_time"],
            start_minute=sb["start_minute"],
            end_minute=sb["end_minute"],
            duration_minutes=sb["duration_minutes"],
            maintenance_tasks_count=sb["total_tasks"],
            departments=sb["departments"],
            crews=sb["crews"],
            route_criticality=sb["route_criticality"],
            train_conflicts=sb["train_conflicts"],
            tasks=sb["tasks"],
        )
        for sb in scheduled_bundles
    ]

    metrics = AvailabilityMetrics(
        total_assets=total_assets,
        available_assets=operational_available,
        restricted_assets=max_concurrent_restricted,
        availability_percentage=operational_avail_pct,
        peak_available_assets=peak_avail,
        minimum_available_assets=min_avail,
        maintenance_tasks_completed=total_tasks_completed,
        maintenance_window_minutes=total_window_span,
        train_conflicts=total_conflicts,
        block_closures=total_closures,
        restricted_blocks=restricted_info_list,
    )

    # 10. Generate Deterministic Explanation
    explanation = _generate_explanation(
        scheduled_bundles=scheduled_bundles,
        total_assets=total_assets,
        max_concurrent_restricted=max_concurrent_restricted,
        total_conflicts=total_conflicts,
        stagger_enabled=stagger_enabled,
    )

    return {
        "metrics": metrics,
        "timeline": timeline,
        "status": status_name,
        "explanation": explanation,
    }


def _build_fallback_result(
    bundles: list[dict[str, Any]],
    total_assets: int,
    traffic_by_block: dict[str, dict[str, Any]],
    plan_start_dt: datetime,
    horizon_minutes: int,
    status_name: str,
) -> dict[str, Any]:
    """Generates a sequential fallback result if CP-SAT encounters an infeasible formulation."""
    curr_offset = 0
    scheduled_bundles = []

    for b in bundles:
        dur = int(b.get("total_window_minutes", 60))
        s_val = curr_offset
        e_val = s_val + dur
        b_code = b.get("block_code", "")
        t_info = traffic_by_block.get(b_code, {})

        scheduled_bundles.append({
            "block_code": b_code,
            "block_name": b.get("block_name", f"Block {b_code}"),
            "start_minute": s_val,
            "end_minute": e_val,
            "duration_minutes": dur,
            "start_time": (plan_start_dt + timedelta(minutes=s_val)).isoformat(),
            "end_time": (plan_start_dt + timedelta(minutes=e_val)).isoformat(),
            "total_tasks": b.get("total_tasks", 0),
            "departments": b.get("departments", []),
            "crews": b.get("crews", []),
            "route_criticality": int(t_info.get("total_traffic_score", 0)),
            "train_conflicts": 0,
            "tasks": b.get("tasks", []),
        })
        curr_offset = e_val

    timeline_slots = max(1, horizon_minutes // 60)
    timeline = []
    for s in range(timeline_slots):
        s_start_m = s * 60
        s_end_m = (s + 1) * 60
        s_dt = plan_start_dt + timedelta(minutes=s_start_m)
        e_dt = plan_start_dt + timedelta(minutes=s_end_m)
        r_blocks = [
            sb["block_code"]
            for sb in scheduled_bundles
            if not (sb["end_minute"] <= s_start_m or sb["start_minute"] >= s_end_m)
        ]
        avail = max(0, total_assets - len(r_blocks))
        pct = round((avail / total_assets) * 100, 1) if total_assets > 0 else 0.0

        timeline.append(
            TimeSlotAvailability(
                slot_index=s,
                time_label=f"{s_dt.strftime('%H:%M')}–{e_dt.strftime('%H:%M')}",
                start_minute=s_start_m,
                end_minute=s_end_m,
                total_assets=total_assets,
                available_assets=avail,
                restricted_assets=len(r_blocks),
                availability_percentage=pct,
                restricted_blocks=r_blocks,
                is_peak=False,
                is_bottleneck=False,
            )
        )

    metrics = AvailabilityMetrics(
        total_assets=total_assets,
        available_assets=total_assets - 1 if scheduled_bundles else total_assets,
        restricted_assets=1 if scheduled_bundles else 0,
        availability_percentage=round(((total_assets - 1) / total_assets) * 100, 1)
        if total_assets > 0
        else 0.0,
        peak_available_assets=total_assets,
        minimum_available_assets=total_assets - 1 if scheduled_bundles else total_assets,
        maintenance_tasks_completed=sum(sb["total_tasks"] for sb in scheduled_bundles),
        maintenance_window_minutes=curr_offset,
        train_conflicts=0,
        block_closures=len(scheduled_bundles),
        restricted_blocks=[
            RestrictedBlockInfo(
                block_code=sb["block_code"],
                block_name=sb["block_name"],
                start_time=sb["start_time"],
                end_time=sb["end_time"],
                start_minute=sb["start_minute"],
                end_minute=sb["end_minute"],
                duration_minutes=sb["duration_minutes"],
                maintenance_tasks_count=sb["total_tasks"],
                departments=sb["departments"],
                crews=sb["crews"],
                route_criticality=sb["route_criticality"],
                train_conflicts=0,
                tasks=sb["tasks"],
            )
            for sb in scheduled_bundles
        ],
    )

    return {
        "metrics": metrics,
        "timeline": timeline,
        "status": status_name,
        "explanation": (
            f"Solver status: {status_name}. Sequential scheduling was used to prevent "
            "simultaneous restrictions and preserve asset availability."
        ),
    }


def _generate_explanation(
    scheduled_bundles: list[dict[str, Any]],
    total_assets: int,
    max_concurrent_restricted: int,
    total_conflicts: int,
    stagger_enabled: bool,
) -> str:
    """Produces a deterministic, factual explanation of the optimizer's decisions."""
    parts = []
    num_blocks = len(scheduled_bundles)

    if num_blocks == 0:
        return "No maintenance restrictions were required. Network operates at 100% capacity."

    if num_blocks == 1:
        sb = scheduled_bundles[0]
        parts.append(
            f"Maintenance on block {sb['block_code']} was scheduled as a single coordinated "
            f"window of {sb['duration_minutes']} minutes ({sb['total_tasks']} tasks across "
            f"{', '.join(sb['departments']) or 'Engineering'})."
        )
        if sb["train_conflicts"] == 0:
            parts.append("Window was positioned during a zero-traffic period to eliminate train conflicts.")
        else:
            parts.append(f"Window was optimized to minimize route impact, encountering {sb['train_conflicts']} modeled conflict(s).")
        return " ".join(parts)

    # Multi-block explanation
    parts.append(
        f"Maintenance across {num_blocks} blocks was coordinated to maximize network asset availability. "
    )

    if stagger_enabled and max_concurrent_restricted < num_blocks:
        parts.append(
            f"By staggering block windows across the planning horizon, peak simultaneous closures "
            f"were limited to {max_concurrent_restricted} block(s), leaving at least "
            f"{total_assets - max_concurrent_restricted} of {total_assets} operational sections "
            f"({round(((total_assets - max_concurrent_restricted) / total_assets) * 100, 1)}%) "
            f"open for train movements at all times."
        )
    else:
        parts.append(
            f"Scheduled windows respect crew capacity and task dependencies while completing all "
            f"{sum(sb['total_tasks'] for sb in scheduled_bundles)} required tasks."
        )

    # Bundling note
    bundled_blocks = [sb['block_code'] for sb in scheduled_bundles if sb['total_tasks'] > 1]
    if bundled_blocks:
        parts.append(
            f"Multi-department tasks on {', '.join(bundled_blocks)} were bundled into coordinated "
            f"closures, preventing repeated shutdowns of the same sections."
        )

    # Train conflict note
    if total_conflicts == 0:
        parts.append("All windows were successfully placed into low-traffic slots, eliminating train conflicts.")
    else:
        parts.append(f"Windows were aligned to minimize disruption to active routes ({total_conflicts} modeled conflict(s)).")

    return " ".join(parts)


def approve_asset_availability_schedule(
    db: Session,
    request: AssetAvailabilityApproveRequest,
) -> AssetAvailabilityApproveResponse:
    """
    Validates that a feasible CP-SAT asset availability schedule exists,
    confirms explicit human approval, updates the affected maintenance tasks
    in the database to 'Scheduled' with their optimized window times, and records approval.
    """
    if not request.human_approved:
        raise HTTPException(
            status_code=400,
            detail="Human approval is strictly required before approving an asset availability schedule.",
        )

    # 1. Obtain current optimization result
    opt_req = AssetAvailabilityOptimizeRequest(
        planning_window=request.planning_window,
        stagger_multi_blocks=request.stagger_multi_blocks,
        target_block_codes=request.target_block_codes,
        start_time=request.start_time,
    )
    opt_res = calculate_asset_availability(db=db, request=opt_req)

    # 2. Validation
    if not opt_res or not opt_res.optimized:
        raise HTTPException(
            status_code=400,
            detail="No valid optimized schedule is available for approval.",
        )

    status_upper = str(opt_res.optimization_status).upper()
    if status_upper not in ("OPTIMAL", "FEASIBLE"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve schedule: solver status is '{opt_res.optimization_status}'. Must be OPTIMAL or FEASIBLE.",
        )

    restricted_blocks = opt_res.optimized.restricted_blocks
    if not restricted_blocks:
        raise HTTPException(
            status_code=400,
            detail="No valid maintenance tasks found in the optimized schedule to approve.",
        )

    now_iso = datetime.now().isoformat()
    updated_count = 0

    # 3. Apply schedule to database records
    for rb in restricted_blocks:
        start_dt = datetime.fromisoformat(rb.start_time) if rb.start_time else None
        end_dt = datetime.fromisoformat(rb.end_time) if rb.end_time else None

        for t in rb.tasks:
            t_id = t.get("id")
            if not t_id:
                continue
            db_task = db.get(Maintenance, t_id)
            if db_task:
                db_task.status = "Scheduled"
                if start_dt:
                    db_task.scheduled_start = start_dt
                if end_dt:
                    db_task.scheduled_end = end_dt
                db_task.dependency_note = (
                    f"Approved via Asset Availability Optimization by {request.approved_by} at {now_iso}"
                )
                db_task.bundle_id = f"AVAIL-{request.planning_window.upper()}-{rb.block_code}"
                updated_count += 1

    db.commit()

    # 4. Invalidate / update cache
    target_keys = sorted(request.target_block_codes or [])
    cache_key = f"{request.planning_window}:{request.stagger_multi_blocks}:{request.start_time}:{','.join(target_keys)}"

    _LATEST_APPROVAL_STATE["approved"] = True
    _LATEST_APPROVAL_STATE["approved_at"] = now_iso
    _LATEST_APPROVAL_STATE["approved_by"] = request.approved_by
    _LATEST_APPROVAL_STATE["cache_key"] = cache_key

    opt_res.approved = True
    opt_res.approved_at = now_iso
    opt_res.approved_by = request.approved_by
    _ASSET_AVAILABILITY_CACHE[cache_key] = (datetime.now().timestamp(), opt_res)

    return AssetAvailabilityApproveResponse(
        status="approved",
        message=f"Asset availability schedule approved successfully. Updated {updated_count} task(s).",
        approved_at=now_iso,
        approved_by=request.approved_by,
        human_approval_required=True,
        human_approval_completed=True,
        updated_tasks_count=updated_count,
        planning_window=request.planning_window,
    )

