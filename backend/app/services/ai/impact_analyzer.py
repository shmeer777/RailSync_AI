"""
Maintenance Impact Analysis Service for RailSync AI.

Evaluates and explains: "WHAT WILL THIS MAINTENANCE AFFECT?"
Across 6 structured categories:
1. Block Impact & Station Impact
2. Train Impact & Train Conflict Analysis
3. Crew Impact & Department Impact
4. Dependency Impact
5. Asset Availability Impact
6. Traffic Impact & Maintenance Window

Derived strictly from real database records and CP-SAT scheduler outputs.
Decision-support prototype: does not fabricate data, delays, or railway clearances.
"""

from datetime import datetime, timedelta, timezone
from typing import Any
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.block import Block
from app.models.crew import Crew
from app.models.maintenance import Maintenance
from app.models.station import Station
from app.models.train import Train
from app.schemas.impact import (
    AffectedBlockItem,
    AffectedStationItem,
    AssetAvailabilityImpact,
    BaselineVsOptimized,
    BlockImpact,
    CrewImpact,
    CrewMemberImpact,
    DependencyImpact,
    DependencyRelation,
    ImpactSummary,
    MaintenanceImpactResponse,
    MaintenanceWindowImpact,
    TrafficImpact,
    TrainConflictItem,
    TrainImpact,
)
from app.schemas.what_if import WhatIfScenarioRequest
from app.services.ai.maintenance_bundler import (
    _normalize_code,
    _normalize,
    bundle_compatible_maintenance,
)
from app.services.ai.traffic_estimator import (
    get_block_train_traffic,
    resolve_planning_window,
)
from app.services.ai.urgency_analyzer import find_downstream_blocked_tasks


def calculate_impact_level(
    affected_trains: int,
    restricted_assets: int,
    blocked_tasks: int,
    traffic_level: str,
) -> tuple[str, str]:
    """
    Transparent deterministic formula for Impact Level:
    Points:
    - Affected Trains: > 3 trains = +2 pts; 1-3 trains = +1 pt; 0 = 0 pts
    - Restricted Assets: >= 2 assets = +2 pts; 1 asset = +1 pt; 0 = 0 pts
    - Blocked Tasks (Dependencies): > 0 downstream tasks = +1 pt; 0 = 0 pts
    - Route Traffic Level: 'High' = +2 pts; 'Medium' = +1 pt; 'Low' = 0 pts

    Classification:
    - Score >= 4: 'High'
    - Score 2-3: 'Moderate'
    - Score 0-1: 'Low'

    Returns:
        (impact_level, derivation_explanation)
    """
    score = 0
    factors: list[str] = []

    if affected_trains > 3:
        score += 2
        factors.append(f"{affected_trains} affected trains (+2 pts)")
    elif affected_trains > 0:
        score += 1
        factors.append(f"{affected_trains} affected train(s) (+1 pt)")
    else:
        factors.append("0 affected trains (+0 pts)")

    if restricted_assets >= 2:
        score += 2
        factors.append(f"{restricted_assets} restricted assets (+2 pts)")
    elif restricted_assets == 1:
        score += 1
        factors.append(f"{restricted_assets} restricted asset (+1 pt)")
    else:
        factors.append("0 restricted assets (+0 pts)")

    if blocked_tasks > 0:
        score += 1
        factors.append(f"{blocked_tasks} blocked downstream task(s) (+1 pt)")
    else:
        factors.append("0 blocked downstream tasks (+0 pts)")

    t_upper = str(traffic_level or "").strip().capitalize()
    if t_upper == "High":
        score += 2
        factors.append("High route traffic (+2 pts)")
    elif t_upper == "Medium":
        score += 1
        factors.append("Medium route traffic (+1 pt)")
    else:
        factors.append("Low route traffic (+0 pts)")

    if score >= 4:
        level = "High"
    elif score >= 2:
        level = "Moderate"
    else:
        level = "Low"

    derivation = (
        f"Deterministic Impact Score: {score}/7 ({level}) derived from: {', '.join(factors)}."
    )
    return level, derivation


def _get_station_names_map(db: Session, station_codes: list[str]) -> dict[str, str]:
    """Look up human-readable station names from Station table for given codes."""
    if not station_codes:
        return {}
    clean_codes = [c.strip().upper() for c in station_codes if c]
    records = db.scalars(select(Station).where(Station.code.in_(clean_codes))).all()
    return {r.code.upper(): r.name for r in records}


def _extract_affected_stations(
    db: Session,
    blocks: list[Block],
    fallback_station: str | None = None,
) -> list[AffectedStationItem]:
    """Extracts unique affected stations from block start and end station codes."""
    station_blocks_map: dict[str, set[str]] = {}
    for b in blocks:
        if b.start_station_code:
            s_code = b.start_station_code.strip().upper()
            station_blocks_map.setdefault(s_code, set()).add(b.code)
        if b.end_station_code:
            e_code = b.end_station_code.strip().upper()
            station_blocks_map.setdefault(e_code, set()).add(b.code)

    if not station_blocks_map and fallback_station:
        fb = fallback_station.strip().upper()
        station_blocks_map[fb] = set()

    station_names = _get_station_names_map(db, list(station_blocks_map.keys()))

    items: list[AffectedStationItem] = []
    for s_code in sorted(station_blocks_map.keys()):
        items.append(
            AffectedStationItem(
                station_code=s_code,
                station_name=station_names.get(s_code, f"Station {s_code}"),
                connected_blocks=sorted(list(station_blocks_map[s_code])),
            )
        )
    return items


def analyze_task_impact(
    db: Session,
    maintenance_id: int,
    proposed_start: datetime | None = None,
) -> MaintenanceImpactResponse:
    """
    Computes real operational impact of an individual maintenance task.
    """
    task = db.get(Maintenance, maintenance_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Maintenance task #{maintenance_id} not found.")

    norm_block = _normalize_code(task.block_code)
    block = db.scalar(select(Block).where(Block.code == norm_block)) if norm_block else None

    all_tasks = db.scalars(select(Maintenance)).all()
    all_blocks = db.scalars(select(Block)).all()
    total_network_assets = len(all_blocks)

    dur = int(task.estimated_duration_minutes or 60)
    start_dt = proposed_start or task.planned_start or task.scheduled_start or datetime.now().replace(second=0, microsecond=0)
    end_dt = start_dt + timedelta(minutes=dur)

    # 1. Block Impact & Station Impact
    affected_blocks_list: list[AffectedBlockItem] = []
    blocks_for_stations: list[Block] = []
    if block:
        blocks_for_stations.append(block)
        affected_blocks_list.append(
            AffectedBlockItem(
                block_code=block.code,
                block_name=block.name,
                distance_km=float(block.distance_km or 0.0),
                start_station_code=block.start_station_code,
                end_station_code=block.end_station_code,
                restriction_start=start_dt.isoformat(),
                restriction_end=end_dt.isoformat(),
                duration_minutes=dur,
                maintenance_task_ids=[task.id],
            )
        )

    affected_stations = _extract_affected_stations(
        db=db,
        blocks=blocks_for_stations,
        fallback_station=task.station_code,
    )

    block_impact = BlockImpact(
        block_code=norm_block or task.station_code or "N/A",
        block_name=block.name if block else (f"Station {task.station_code}" if task.station_code else "Unknown"),
        distance_km=float(block.distance_km or 0.0) if block else 0.0,
        start_station_code=block.start_station_code if block else (task.station_code or "N/A"),
        end_station_code=block.end_station_code if block else (task.station_code or "N/A"),
        restriction_start=start_dt.isoformat(),
        restriction_end=end_dt.isoformat(),
        duration_minutes=dur,
        maintenance_task_ids=[task.id],
        affected_blocks=affected_blocks_list,
        affected_blocks_count=len(affected_blocks_list) if affected_blocks_list else (1 if norm_block else 0),
        affected_stations=affected_stations,
        affected_stations_count=len(affected_stations),
    )

    # 2. Traffic & Train Impact
    traffic_info = get_block_train_traffic(
        db=db,
        block_code=norm_block or "",
        base_time=start_dt,
        horizon_minutes=max(480, dur + 60),
    ) if norm_block else {}

    expected_trains = traffic_info.get("expected_trains", [])
    conflicts: list[dict[str, Any]] = []
    unique_train_numbers: set[str] = set()

    for tr in expected_trains:
        eta = tr.get("eta_minute", 0)
        dep = tr.get("depart_minute", eta + 15)
        # Overlap with [0, dur] relative to start_dt
        if not (dep <= 0 or eta >= dur):
            t_num = str(tr.get("train_number") or tr.get("name") or "Unknown")
            unique_train_numbers.add(t_num)

            # Query real train record if available
            t_rec = db.scalar(select(Train).where(Train.train_number == t_num))

            conflicts.append({
                "train_id": tr.get("train_id"),
                "train_number": t_num,
                "train_name": t_rec.name if t_rec else tr.get("name", f"Train {t_num}"),
                "current_station": t_rec.current_station_code if t_rec else None,
                "affected_block": norm_block or "N/A",
                "conflict_type": "Schedule Overlap",
                "priority": tr.get("priority"),
                "eta_minute": eta,
                "depart_minute": dep,
                "delay_minutes": None,  # Modeled: no fabricated delay
                "conflict_severity": "High" if str(tr.get("priority")).lower() in ("critical", "high") else "Medium",
                "recommendation": "Hold at previous station or route via alternate line during window.",
            })

    train_impact = TrainImpact(
        total_conflicts=len(conflicts),
        affected_trains_count=len(unique_train_numbers),
        train_conflicts_before=len(conflicts),
        train_conflicts_after=None,
        trains=conflicts,
    )

    # 3. Crew & Department Impact
    crews_involved: list[dict[str, Any]] = []
    depts: list[str] = [task.department or "Engineering"]

    if task.assigned_crew:
        crews_involved.append({
            "crew_id": task.assigned_crew.id,
            "name": task.assigned_crew.name,
            "department": task.assigned_crew.department,
            "crew_type": task.assigned_crew.crew_type,
            "assigned_task_ids": [task.id],
            "required_crew_size": task.crew_size,
            "available_capacity": task.assigned_crew.capacity,
            "tasks_assigned_count": 1,
            "workload_notes": f"Assigned to Task #{task.id} (crew size {task.crew_size} within capacity {task.assigned_crew.capacity})",
        })
    elif task.crew_type:
        crews_involved.append({
            "crew_id": None,
            "name": f"{task.crew_type} (Unassigned)",
            "department": task.department or "Engineering",
            "crew_type": task.crew_type,
            "assigned_task_ids": [task.id],
            "required_crew_size": task.crew_size or 2,
            "available_capacity": task.crew_size or 2,
            "tasks_assigned_count": 1,
            "workload_notes": f"Unassigned crew requirement of {task.crew_size or 2} personnel for Task #{task.id}",
        })

    crew_impact = CrewImpact(
        total_crews_involved=len(crews_involved),
        crews=crews_involved,
        departments=sorted(list(set(depts))),
        department_count=len(set(depts)),
    )

    # 4. Dependency Impact
    blocked_ids = find_downstream_blocked_tasks(task.id, all_tasks)
    has_prereqs = task.depends_on_maintenance_id is not None
    prereq_ids = [task.depends_on_maintenance_id] if has_prereqs else []

    dep_notes: list[str] = []
    dep_chain: list[dict[str, Any]] = []

    if has_prereqs:
        prereq_obj = db.get(Maintenance, task.depends_on_maintenance_id)
        p_title = prereq_obj.maintenance_type if prereq_obj else f"Task #{task.depends_on_maintenance_id}"
        dep_notes.append(f"Requires prerequisite task #{task.depends_on_maintenance_id} ({p_title}) to complete first.")
        dep_chain.append({
            "prerequisite_id": task.depends_on_maintenance_id,
            "prerequisite_title": p_title,
            "dependent_id": task.id,
            "dependent_title": task.maintenance_type,
            "relation_type": "finish-to-start",
        })

    if blocked_ids:
        dep_notes.append(f"Blocks {len(blocked_ids)} downstream task(s): [{', '.join(str(i) for i in blocked_ids)}].")
        for b_id in blocked_ids:
            b_obj = db.get(Maintenance, b_id)
            dep_chain.append({
                "prerequisite_id": task.id,
                "prerequisite_title": task.maintenance_type,
                "dependent_id": b_id,
                "dependent_title": b_obj.maintenance_type if b_obj else f"Task #{b_id}",
                "relation_type": "finish-to-start",
            })

    dependency_impact = DependencyImpact(
        has_prerequisites=has_prereqs,
        prerequisite_tasks_count=len(prereq_ids),
        prerequisite_task_ids=prereq_ids,
        blocks_downstream=len(blocked_ids) > 0,
        downstream_tasks_count=len(blocked_ids),
        downstream_task_ids=blocked_ids,
        blocked_task_count=len(blocked_ids),
        dependency_notes=dep_notes,
        dependency_chain=dep_chain,
    )

    # 5. Asset Availability Impact
    restricted_assets = 1 if norm_block else 0
    avail_assets = max(0, total_network_assets - restricted_assets)
    avail_pct = round((avail_assets / total_network_assets) * 100, 1) if total_network_assets > 0 else 100.0

    asset_impact = AssetAvailabilityImpact(
        total_network_assets=total_network_assets,
        restricted_assets=restricted_assets,
        available_assets=avail_assets,
        availability_percentage=avail_pct,
        baseline_availability_percentage=100.0,
        availability_delta=round(avail_pct - 100.0, 1),
        note=f"Restricts 1 block ({norm_block}) out of {total_network_assets} network assets." if norm_block else "No block restriction registered.",
    )

    # 6. Traffic Impact
    slot_traffic = traffic_info.get("slot_traffic", [])
    traffic_level = traffic_info.get("overall_traffic_level", "Low")
    total_traffic_score = int(traffic_info.get("total_traffic_score", 0))
    peak_slot = slot_traffic.index(max(slot_traffic)) if slot_traffic and max(slot_traffic) > 0 else 0

    traffic_impact = TrafficImpact(
        overall_traffic_level=traffic_level,
        total_traffic_score=total_traffic_score,
        slot_traffic=slot_traffic,
        peak_slot_index=peak_slot,
        planning_window=traffic_info.get("planning_window", "daytime"),
        operational_impact_indicators=[
            f"Modeled route traffic level: {traffic_level}",
            f"Expected train conflicts in window: {len(conflicts)}",
        ],
    )

    # 7. Maintenance Window Impact
    maint_window = MaintenanceWindowImpact(
        planned_start=start_dt.isoformat(),
        planned_end=end_dt.isoformat(),
        duration_minutes=dur,
        restricted_period=f"{start_dt.strftime('%H:%M')}–{end_dt.strftime('%H:%M')} ({dur} min)",
        is_coordinated_bundle=False,
    )

    # 8. Deterministic Impact Level & Formula Derivation
    impact_level, derivation = calculate_impact_level(
        affected_trains=len(unique_train_numbers),
        restricted_assets=restricted_assets,
        blocked_tasks=len(blocked_ids),
        traffic_level=traffic_level,
    )

    # 9. Predictive Maintenance Origin
    pred_origin: dict[str, Any] | None = None
    try:
        if norm_block:
            from app.ml.predictor import predict_maintenance_for_block
            p = predict_maintenance_for_block(db, norm_block)
            if p and p.get("predicted_maintenance") == task.maintenance_type:
                pred_origin = {
                    "is_predicted": True,
                    "model_source": "Predictive Maintenance Service",
                    "predicted_maintenance": p.get("predicted_maintenance"),
                    "confidence": p.get("confidence"),
                    "predicted_anomaly": p.get("predicted_anomaly") or "Degradation detected",
                    "notice": "Predicted maintenance provides operational context; impact is modeled from real block/train schedules.",
                }
    except Exception:
        pred_origin = None

    # 10. Urgency Context
    urgency_ctx: dict[str, Any] | None = {
        "priority": task.priority,
        "urgency_score": task.urgency_score,
        "due_by": task.due_by.isoformat() if task.due_by else None,
        "maximum_delay_minutes": task.maximum_delay_minutes,
        "explanation": f"Task priority is {task.priority}. Urgency score explains scheduling necessity despite modeled operational impact.",
    }

    # 11. Impact Summary
    summary = ImpactSummary(
        affected_blocks=1 if norm_block else 0,
        affected_stations=len(affected_stations),
        affected_trains=len(unique_train_numbers),
        train_conflicts=len(conflicts),
        departments=len(set(depts)),
        crews=len(crews_involved),
        dependent_tasks=len(blocked_ids),
        restricted_assets=restricted_assets,
        maintenance_window_minutes=dur,
        traffic_level=traffic_level,
        impact_level=impact_level,
    )

    # 12. Explanation
    exp_parts = [
        f"Task #{task.id} ({task.maintenance_type}) on {norm_block or task.station_code} "
        f"requires a {dur}-minute restriction ({maint_window.restricted_period})."
    ]
    if len(conflicts) > 0:
        exp_parts.append(f"Encountered {len(conflicts)} modeled train conflict(s) across {len(unique_train_numbers)} affected train(s).")
    else:
        exp_parts.append("Zero train movements are projected during this window.")
    if blocked_ids:
        exp_parts.append(f"Delaying this task will postpone {len(blocked_ids)} downstream task(s).")

    return MaintenanceImpactResponse(
        target_type="task",
        target_id=str(task.id),
        block_code=norm_block or task.station_code or "N/A",
        maintenance_types=[task.maintenance_type],
        window_start=start_dt.isoformat(),
        window_end=end_dt.isoformat(),
        duration_minutes=dur,
        impact_level=impact_level,
        impact_level_explanation=derivation,
        impact_summary=summary,
        block_impact=block_impact,
        train_impact=train_impact,
        crew_impact=crew_impact,
        dependency_impact=dependency_impact,
        asset_impact=asset_impact,
        traffic_impact=traffic_impact,
        maintenance_window_impact=maint_window,
        predictive_origin=pred_origin,
        urgency_context=urgency_ctx,
        baseline_vs_optimized=None,
        explanation=" ".join(exp_parts),
        human_approval_required=True,
    )


def analyze_bundle_impact(
    db: Session,
    bundle_id: str,
) -> MaintenanceImpactResponse:
    """
    Computes operational impact of a multi-department maintenance bundle.
    """
    clean_id = bundle_id.strip().upper()
    bundles = bundle_compatible_maintenance(db=db, persist=False)
    bundle = next((b for b in bundles if b.get("bundle_id", "").upper() == clean_id), None)

    if not bundle:
        raise HTTPException(status_code=404, detail=f"Maintenance bundle '{bundle_id}' not found.")

    norm_block = _normalize_code(bundle.get("block_code"))
    block = db.scalar(select(Block).where(Block.code == norm_block))
    all_blocks = db.scalars(select(Block)).all()
    all_tasks = db.scalars(select(Maintenance)).all()
    total_network_assets = len(all_blocks)

    dur = int(bundle.get("total_window_minutes", 60))
    tasks = bundle.get("tasks", [])
    task_ids = [t["id"] for t in tasks]
    maint_types = sorted(list({t.get("maintenance_type", "Maintenance") for t in tasks}))

    start_iso = bundle.get("start_time")
    end_iso = bundle.get("end_time")
    start_dt = datetime.fromisoformat(start_iso) if start_iso else datetime.now().replace(second=0, microsecond=0)
    end_dt = datetime.fromisoformat(end_iso) if end_iso else (start_dt + timedelta(minutes=dur))

    # 1. Block Impact & Station Impact
    affected_blocks_list: list[AffectedBlockItem] = []
    blocks_for_stations: list[Block] = []
    if block:
        blocks_for_stations.append(block)
        affected_blocks_list.append(
            AffectedBlockItem(
                block_code=block.code,
                block_name=block.name,
                distance_km=float(block.distance_km or 0.0),
                start_station_code=block.start_station_code,
                end_station_code=block.end_station_code,
                restriction_start=start_dt.isoformat(),
                restriction_end=end_dt.isoformat(),
                duration_minutes=dur,
                maintenance_task_ids=task_ids,
            )
        )

    affected_stations = _extract_affected_stations(db=db, blocks=blocks_for_stations)

    block_impact = BlockImpact(
        block_code=norm_block,
        block_name=block.name if block else f"Block {norm_block}",
        distance_km=float(block.distance_km or 0.0) if block else 0.0,
        start_station_code=block.start_station_code if block else "N/A",
        end_station_code=block.end_station_code if block else "N/A",
        restriction_start=start_dt.isoformat(),
        restriction_end=end_dt.isoformat(),
        duration_minutes=dur,
        maintenance_task_ids=task_ids,
        affected_blocks=affected_blocks_list,
        affected_blocks_count=len(affected_blocks_list),
        affected_stations=affected_stations,
        affected_stations_count=len(affected_stations),
    )

    # 2. Train Impact
    traffic_info = get_block_train_traffic(
        db=db,
        block_code=norm_block,
        base_time=start_dt,
        horizon_minutes=max(480, dur + 60),
    )
    expected_trains = traffic_info.get("expected_trains", [])
    conflicts: list[dict[str, Any]] = []
    unique_train_numbers: set[str] = set()

    for tr in expected_trains:
        eta = tr.get("eta_minute", 0)
        dep = tr.get("depart_minute", eta + 15)
        if not (dep <= 0 or eta >= dur):
            t_num = str(tr.get("train_number") or tr.get("name") or "Unknown")
            unique_train_numbers.add(t_num)

            t_rec = db.scalar(select(Train).where(Train.train_number == t_num))

            conflicts.append({
                "train_id": tr.get("train_id"),
                "train_number": t_num,
                "train_name": t_rec.name if t_rec else tr.get("name", f"Train {t_num}"),
                "current_station": t_rec.current_station_code if t_rec else None,
                "affected_block": norm_block,
                "conflict_type": "Schedule Overlap",
                "priority": tr.get("priority"),
                "eta_minute": eta,
                "depart_minute": dep,
                "delay_minutes": None,
                "conflict_severity": "High" if str(tr.get("priority")).lower() in ("critical", "high") else "Medium",
                "recommendation": "Hold at previous station or route via alternate line during window.",
            })

    train_impact = TrainImpact(
        total_conflicts=len(conflicts),
        affected_trains_count=len(unique_train_numbers),
        train_conflicts_before=bundle.get("train_conflicts_before", len(conflicts)),
        train_conflicts_after=len(conflicts),
        trains=conflicts,
    )

    # 3. Crew & Department Impact
    crews_involved: list[dict[str, Any]] = []
    for c_name in bundle.get("crews", []):
        c_obj = db.scalar(select(Crew).where(Crew.name == c_name))
        c_task_ids = [t["id"] for t in tasks if t.get("assigned_crew_name") == c_name]
        c_req_size = max([t.get("crew_size", 2) for t in tasks if t.get("assigned_crew_name") == c_name] or [2])
        c_cap = c_obj.capacity if c_obj else c_req_size

        crews_involved.append({
            "crew_id": c_obj.id if c_obj else None,
            "name": c_name,
            "department": c_obj.department if c_obj else "Engineering",
            "crew_type": c_obj.crew_type if c_obj else "Track Team",
            "assigned_task_ids": c_task_ids,
            "required_crew_size": c_req_size,
            "available_capacity": c_cap,
            "tasks_assigned_count": len(c_task_ids),
            "workload_notes": f"Assigned {len(c_task_ids)} bundle task(s) within team capacity {c_cap}",
        })

    departments = sorted(list(set(bundle.get("departments", []))))
    crew_impact = CrewImpact(
        total_crews_involved=len(crews_involved),
        crews=crews_involved,
        departments=departments,
        department_count=len(departments),
    )

    # 4. Dependency Impact
    blocked_ids: list[int] = []
    for tid in task_ids:
        for b_id in find_downstream_blocked_tasks(tid, all_tasks):
            if b_id not in task_ids and b_id not in blocked_ids:
                blocked_ids.append(b_id)

    prereq_ids: list[int] = []
    dep_chain: list[dict[str, Any]] = []

    for t in tasks:
        p_id = t.get("depends_on_maintenance_id")
        if p_id:
            p_obj = db.get(Maintenance, p_id)
            p_title = p_obj.maintenance_type if p_obj else f"Task #{p_id}"
            dep_chain.append({
                "prerequisite_id": p_id,
                "prerequisite_title": p_title,
                "dependent_id": t["id"],
                "dependent_title": t.get("maintenance_type", f"Task #{t['id']}"),
                "relation_type": "finish-to-start",
            })
            if p_id not in task_ids and p_id not in prereq_ids:
                prereq_ids.append(p_id)

    dep_notes: list[str] = []
    if prereq_ids:
        dep_notes.append(f"External prerequisite task(s) [{', '.join(str(i) for i in prereq_ids)}] must finish first.")
    if blocked_ids:
        dep_notes.append(f"Unblocks {len(blocked_ids)} external downstream task(s) upon bundle completion.")
    if dep_chain:
        dep_notes.append(f"Contains {len(dep_chain)} internal/external dependency link(s).")

    dependency_impact = DependencyImpact(
        has_prerequisites=len(prereq_ids) > 0,
        prerequisite_tasks_count=len(prereq_ids),
        prerequisite_task_ids=prereq_ids,
        blocks_downstream=len(blocked_ids) > 0,
        downstream_tasks_count=len(blocked_ids),
        downstream_task_ids=blocked_ids,
        blocked_task_count=len(blocked_ids),
        dependency_notes=dep_notes,
        dependency_chain=dep_chain,
    )

    # 5. Asset Availability Impact
    restricted_assets = 1
    avail_assets = max(0, total_network_assets - restricted_assets)
    avail_pct = round((avail_assets / total_network_assets) * 100, 1) if total_network_assets > 0 else 100.0

    asset_impact = AssetAvailabilityImpact(
        total_network_assets=total_network_assets,
        restricted_assets=restricted_assets,
        available_assets=avail_assets,
        availability_percentage=avail_pct,
        baseline_availability_percentage=100.0,
        availability_delta=round(avail_pct - 100.0, 1),
        note=f"Coordinated bundle restricts only 1 block ({norm_block}) across {len(tasks)} tasks.",
    )

    # 6. Traffic Impact
    slot_traffic = traffic_info.get("slot_traffic", [])
    traffic_level = traffic_info.get("overall_traffic_level", "Low")
    traffic_impact = TrafficImpact(
        overall_traffic_level=traffic_level,
        total_traffic_score=int(traffic_info.get("total_traffic_score", 0)),
        slot_traffic=slot_traffic,
        peak_slot_index=slot_traffic.index(max(slot_traffic)) if slot_traffic and max(slot_traffic) > 0 else 0,
        planning_window=traffic_info.get("planning_window", "night"),
        operational_impact_indicators=[
            f"Bundle coordinated in {traffic_info.get('planning_window', 'night')} window",
            f"Modeled route traffic: {traffic_level}",
            f"{len(conflicts)} train conflicts in window",
        ],
    )

    # 7. Maintenance Window Impact
    maint_window = MaintenanceWindowImpact(
        planned_start=start_dt.isoformat(),
        planned_end=end_dt.isoformat(),
        duration_minutes=dur,
        restricted_period=f"{start_dt.strftime('%H:%M')}–{end_dt.strftime('%H:%M')} ({dur} min)",
        is_coordinated_bundle=True,
    )

    # 8. Deterministic Impact Level
    impact_level, derivation = calculate_impact_level(
        affected_trains=len(unique_train_numbers),
        restricted_assets=restricted_assets,
        blocked_tasks=len(blocked_ids),
        traffic_level=traffic_level,
    )

    # 9. Baseline vs Optimized comparison for bundle
    unbundled_total = int(bundle.get("unbundled_total_minutes", dur))
    baseline_vs_opt = BaselineVsOptimized(
        affected_trains_before=bundle.get("train_conflicts_before", len(conflicts)),
        affected_trains_after=len(unique_train_numbers),
        train_conflicts_before=bundle.get("train_conflicts_before", len(conflicts)),
        train_conflicts_after=len(conflicts),
        restricted_blocks_before=len(tasks),  # Without bundling, multiple sequential block closures
        restricted_blocks_after=1,
        available_assets_before=max(0, total_network_assets - 1),
        available_assets_after=avail_assets,
        maintenance_duration_before=unbundled_total,
        maintenance_duration_after=dur,
    )

    # 10. Impact Summary
    summary = ImpactSummary(
        affected_blocks=1,
        affected_stations=len(affected_stations),
        affected_trains=len(unique_train_numbers),
        train_conflicts=len(conflicts),
        departments=len(departments),
        crews=len(crews_involved),
        dependent_tasks=len(blocked_ids),
        restricted_assets=restricted_assets,
        maintenance_window_minutes=dur,
        traffic_level=traffic_level,
        impact_level=impact_level,
    )

    # 11. Explanation
    exp = (
        f"Bundle {clean_id} on {norm_block} coordinates {len(tasks)} tasks across "
        f"{', '.join(departments)} into a single {dur}-minute window ({maint_window.restricted_period}), "
        f"saving {bundle.get('time_saved_minutes', 0)} minutes of block closures and "
        f"encountering {len(conflicts)} modeled train conflicts."
    )

    return MaintenanceImpactResponse(
        target_type="bundle",
        target_id=clean_id,
        block_code=norm_block,
        maintenance_types=maint_types,
        window_start=start_dt.isoformat(),
        window_end=end_dt.isoformat(),
        duration_minutes=dur,
        impact_level=impact_level,
        impact_level_explanation=derivation,
        impact_summary=summary,
        block_impact=block_impact,
        train_impact=train_impact,
        crew_impact=crew_impact,
        dependency_impact=dependency_impact,
        asset_impact=asset_impact,
        traffic_impact=traffic_impact,
        maintenance_window_impact=maint_window,
        predictive_origin=None,
        urgency_context=None,
        baseline_vs_optimized=baseline_vs_opt,
        explanation=exp,
        human_approval_required=True,
    )


def analyze_what_if_impact(
    db: Session,
    request: WhatIfScenarioRequest,
) -> MaintenanceImpactResponse:
    """
    Evaluates operational impact of a simulated What-If maintenance scenario.
    Recalculates from the scenario plan rather than copying baseline values.
    """
    from app.services.ai.what_if_simulator import run_what_if_simulation

    sim_res = run_what_if_simulation(db=db, request=request)

    target_plan = sim_res.what_if if sim_res.what_if else sim_res.baseline
    norm_block = _normalize_code(request.block_code)
    block = db.scalar(select(Block).where(Block.code == norm_block))
    all_blocks = db.scalars(select(Block)).all()
    total_network_assets = len(all_blocks)

    dur = target_plan.total_window_minutes
    start_iso = target_plan.start_time
    end_iso = target_plan.end_time

    start_dt = datetime.fromisoformat(start_iso) if start_iso else datetime.now().replace(second=0, microsecond=0)
    end_dt = datetime.fromisoformat(end_iso) if end_iso else (start_dt + timedelta(minutes=dur))

    # 1. Block Impact
    blocks_for_stations = [block] if block else []
    affected_stations = _extract_affected_stations(db=db, blocks=blocks_for_stations)
    task_ids = [t["id"] for t in target_plan.tasks]

    block_impact = BlockImpact(
        block_code=norm_block,
        block_name=block.name if block else f"Block {norm_block}",
        distance_km=float(block.distance_km or 0.0) if block else 0.0,
        start_station_code=block.start_station_code if block else "N/A",
        end_station_code=block.end_station_code if block else "N/A",
        restriction_start=start_dt.isoformat(),
        restriction_end=end_dt.isoformat(),
        duration_minutes=dur,
        maintenance_task_ids=task_ids,
        affected_blocks=[
            AffectedBlockItem(
                block_code=norm_block,
                block_name=block.name if block else f"Block {norm_block}",
                distance_km=float(block.distance_km or 0.0) if block else 0.0,
                start_station_code=block.start_station_code if block else "N/A",
                end_station_code=block.end_station_code if block else "N/A",
                restriction_start=start_dt.isoformat(),
                restriction_end=end_dt.isoformat(),
                duration_minutes=dur,
                maintenance_task_ids=task_ids,
            )
        ] if block else [],
        affected_blocks_count=1,
        affected_stations=affected_stations,
        affected_stations_count=len(affected_stations),
    )

    # 2. Train Impact (recalculated from what-if scenario window)
    traffic_info = get_block_train_traffic(
        db=db,
        block_code=norm_block,
        base_time=start_dt,
        horizon_minutes=max(480, dur + 60),
    )
    expected_trains = traffic_info.get("expected_trains", [])
    conflicts: list[dict[str, Any]] = []
    unique_train_numbers: set[str] = set()

    for tr in expected_trains:
        eta = tr.get("eta_minute", 0)
        dep = tr.get("depart_minute", eta + 15)
        if not (dep <= 0 or eta >= dur):
            t_num = str(tr.get("train_number") or tr.get("name") or "Unknown")
            unique_train_numbers.add(t_num)
            t_rec = db.scalar(select(Train).where(Train.train_number == t_num))
            conflicts.append({
                "train_id": tr.get("train_id"),
                "train_number": t_num,
                "train_name": t_rec.name if t_rec else tr.get("name", f"Train {t_num}"),
                "current_station": t_rec.current_station_code if t_rec else None,
                "affected_block": norm_block,
                "conflict_type": "Schedule Overlap",
                "priority": tr.get("priority"),
                "eta_minute": eta,
                "depart_minute": dep,
                "delay_minutes": None,
                "conflict_severity": "High" if str(tr.get("priority")).lower() in ("critical", "high") else "Medium",
                "recommendation": "Adjusted via What-If simulation window.",
            })

    train_impact = TrainImpact(
        total_conflicts=len(conflicts),
        affected_trains_count=len(unique_train_numbers),
        train_conflicts_before=sim_res.baseline.train_conflicts,
        train_conflicts_after=len(conflicts),
        trains=conflicts,
    )

    # 3. Crew Impact
    crews_involved: list[dict[str, Any]] = []
    for c_name in target_plan.crews:
        c_obj = db.scalar(select(Crew).where(Crew.name == c_name))
        c_task_ids = [t["id"] for t in target_plan.tasks if t.get("assigned_crew_name") == c_name]
        c_req_size = max([t.get("crew_size", 2) for t in target_plan.tasks if t.get("assigned_crew_name") == c_name] or [2])
        c_cap = c_obj.capacity if c_obj else c_req_size

        crews_involved.append({
            "crew_id": c_obj.id if c_obj else None,
            "name": c_name,
            "department": c_obj.department if c_obj else "Engineering",
            "crew_type": c_obj.crew_type if c_obj else "Track Team",
            "assigned_task_ids": c_task_ids,
            "required_crew_size": c_req_size,
            "available_capacity": c_cap,
            "tasks_assigned_count": len(c_task_ids),
            "workload_notes": f"Assigned to {len(c_task_ids)} simulated task(s)",
        })

    departments = sorted(list(set(target_plan.departments)))
    crew_impact = CrewImpact(
        total_crews_involved=len(crews_involved),
        crews=crews_involved,
        departments=departments,
        department_count=len(departments),
    )

    # 4. Dependency Impact
    all_tasks = db.scalars(select(Maintenance)).all()
    blocked_ids: list[int] = []
    for tid in task_ids:
        for b_id in find_downstream_blocked_tasks(tid, all_tasks):
            if b_id not in task_ids and b_id not in blocked_ids:
                blocked_ids.append(b_id)

    dependency_impact = DependencyImpact(
        has_prerequisites=False,
        prerequisite_tasks_count=0,
        prerequisite_task_ids=[],
        blocks_downstream=len(blocked_ids) > 0,
        downstream_tasks_count=len(blocked_ids),
        downstream_task_ids=blocked_ids,
        blocked_task_count=len(blocked_ids),
        dependency_notes=[f"What-If scenario validated dependencies for {len(task_ids)} tasks."],
    )

    # 5. Asset Availability Impact
    restricted_assets = target_plan.restricted_assets or 1
    avail_assets = max(0, total_network_assets - restricted_assets)
    avail_pct = round((avail_assets / total_network_assets) * 100, 1) if total_network_assets > 0 else 100.0

    asset_impact = AssetAvailabilityImpact(
        total_network_assets=total_network_assets,
        restricted_assets=restricted_assets,
        available_assets=avail_assets,
        availability_percentage=avail_pct,
        baseline_availability_percentage=sim_res.baseline.availability_percentage,
        availability_delta=round(avail_pct - sim_res.baseline.availability_percentage, 1),
        note="Recalculated from simulated What-If plan.",
    )

    # 6. Traffic Impact
    traffic_level = traffic_info.get("overall_traffic_level", "Low")
    traffic_impact = TrafficImpact(
        overall_traffic_level=traffic_level,
        total_traffic_score=int(traffic_info.get("total_traffic_score", 0)),
        slot_traffic=traffic_info.get("slot_traffic", []),
        peak_slot_index=0,
        planning_window=request.planning_window or "night",
        operational_impact_indicators=[
            f"What-If window preference: {request.planning_window or 'night'}",
            f"Modeled route traffic level: {traffic_level}",
        ],
    )

    # 7. Maintenance Window Impact
    maint_window = MaintenanceWindowImpact(
        planned_start=start_dt.isoformat(),
        planned_end=end_dt.isoformat(),
        duration_minutes=dur,
        restricted_period=f"{start_dt.strftime('%H:%M')}–{end_dt.strftime('%H:%M')} ({dur} min)",
        is_coordinated_bundle=True,
    )

    # 8. Deterministic Impact Level
    impact_level, derivation = calculate_impact_level(
        affected_trains=len(unique_train_numbers),
        restricted_assets=restricted_assets,
        blocked_tasks=len(blocked_ids),
        traffic_level=traffic_level,
    )

    # 9. Baseline vs What-If Comparison
    baseline_vs_opt = BaselineVsOptimized(
        affected_trains_before=sim_res.baseline.train_conflicts,
        affected_trains_after=len(unique_train_numbers),
        train_conflicts_before=sim_res.baseline.train_conflicts,
        train_conflicts_after=len(conflicts),
        restricted_blocks_before=sim_res.baseline.block_closures,
        restricted_blocks_after=target_plan.block_closures,
        available_assets_before=sim_res.baseline.available_assets,
        available_assets_after=avail_assets,
        maintenance_duration_before=sim_res.baseline.total_window_minutes,
        maintenance_duration_after=dur,
    )

    # 10. Summary
    summary = ImpactSummary(
        affected_blocks=1,
        affected_stations=len(affected_stations),
        affected_trains=len(unique_train_numbers),
        train_conflicts=len(conflicts),
        departments=len(departments),
        crews=len(crews_involved),
        dependent_tasks=len(blocked_ids),
        restricted_assets=restricted_assets,
        maintenance_window_minutes=dur,
        traffic_level=traffic_level,
        impact_level=impact_level,
    )

    maint_types = sorted(list({t.get("maintenance_type", "Maintenance") for t in target_plan.tasks}))

    return MaintenanceImpactResponse(
        target_type="what-if",
        target_id=sim_res.scenario_id,
        block_code=norm_block,
        maintenance_types=maint_types,
        window_start=start_dt.isoformat(),
        window_end=end_dt.isoformat(),
        duration_minutes=dur,
        impact_level=impact_level,
        impact_level_explanation=derivation,
        impact_summary=summary,
        block_impact=block_impact,
        train_impact=train_impact,
        crew_impact=crew_impact,
        dependency_impact=dependency_impact,
        asset_impact=asset_impact,
        traffic_impact=traffic_impact,
        maintenance_window_impact=maint_window,
        predictive_origin=None,
        urgency_context=None,
        baseline_vs_optimized=baseline_vs_opt,
        explanation=f"What-If Scenario '{sim_res.name}' simulated for block {norm_block}: {sim_res.explanation}",
        human_approval_required=True,
    )
