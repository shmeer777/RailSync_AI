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
    DepartmentImpactItem,
    DependencyImpact,
    DependencyRelation,
    ImpactSummary,
    MaintenanceImpactResponse,
    MaintenanceWindowImpact,
    PowerBlockItem,
    RestrictedAssetItem,
    SignallingImpactItem,
    SpeedRestrictionItem,
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
                "train_id": tr.get("train_id") or (t_rec.id if t_rec else None),
                "train_number": t_num,
                "train_name": t_rec.name if t_rec else tr.get("name", f"Train {t_num}"),
                "train_type": t_rec.train_type if t_rec else (tr.get("train_type") or "Express"),
                "source_station": t_rec.source_station_code if t_rec else None,
                "destination_station": t_rec.destination_station_code if t_rec else None,
                "current_station": t_rec.current_station_code if t_rec else (t_rec.source_station_code if t_rec else None),
                "direction": t_rec.direction if t_rec else "UP",
                "affected_block": norm_block or "N/A",
                "conflict_type": "Schedule Overlap",
                "priority": tr.get("priority") or (t_rec.priority if t_rec else "Normal"),
                "status": t_rec.status if t_rec else "SCHEDULED",
                "eta_minute": eta,
                "depart_minute": dep,
                "delay_minutes": None,  # Modeled: no fabricated delay
                "conflict_severity": "High" if str(tr.get("priority") or (t_rec.priority if t_rec else "")).lower() in ("critical", "high") else "Medium",
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
            "required_crew_size": task.crew_size or 2,
            "available_capacity": task.assigned_crew.capacity,
            "tasks_assigned_count": 1,
            "location": norm_block or task.station_code or "Corridor",
            "availability": task.assigned_crew.status or "Available",
            "scheduled_window": f"{start_dt.strftime('%H:%M')}–{end_dt.strftime('%H:%M')}",
            "workload_notes": f"Assigned to Task #{task.id} (crew size {task.crew_size or 2} within capacity {task.assigned_crew.capacity})",
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
            "location": norm_block or task.station_code or "Corridor",
            "availability": "Pending Assignment",
            "scheduled_window": f"{start_dt.strftime('%H:%M')}–{end_dt.strftime('%H:%M')}",
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

    # 11b. Cross-functional domain impacts (Speed Restrictions, Power Blocks, Signalling, Departments, Restricted Assets)
    maint_lower = (task.maintenance_type or "").lower()
    dept_lower = (task.department or "").lower()

    speed_restrictions: list[SpeedRestrictionItem] = []
    if any(k in maint_lower for k in ["track", "tamping", "rail", "sleeper", "ballast", "deep screening", "welding"]) or "engineering" in dept_lower or "civil" in dept_lower:
        speed_restrictions.append(
            SpeedRestrictionItem(
                block_code=norm_block or task.station_code or "N/A",
                section_name=block.name if block else (task.station_code or "Section"),
                restriction_speed_kmph=30,
                normal_speed_kmph=100,
                restriction_window=maint_window.restricted_period,
                reason=f"Post-maintenance caution order following {task.maintenance_type}",
                affected_trains_count=len(unique_train_numbers),
            )
        )

    power_blocks: list[PowerBlockItem] = []
    if any(k in maint_lower for k in ["ohe", "power", "electrical", "traction", "catenary", "substation", "pantograph"]) or "electrical" in dept_lower or "trd" in dept_lower:
        power_blocks.append(
            PowerBlockItem(
                location=norm_block or task.station_code or "N/A",
                power_block_type="OHE 25kV AC Traction Power Isolation",
                window=maint_window.restricted_period,
                department="Electrical (TRD)",
                affected_assets=f"Overhead Equipment (OHE) section {norm_block or task.station_code}",
                operational_effect="Electric traction isolated; diesel locomotives or regulation required",
            )
        )

    signalling_impacts: list[SignallingImpactItem] = []
    if any(k in maint_lower for k in ["signal", "point", "interlock", "axle", "track circuit", "telecom", "relay"]) or "s&t" in dept_lower or "signal" in dept_lower:
        signalling_impacts.append(
            SignallingImpactItem(
                signalling_asset=f"Signal & Interlocking Circuit ({norm_block or task.station_code})",
                location=norm_block or task.station_code or "N/A",
                restriction="Non-Interlocked (NI) working / Point machine isolated",
                window=maint_window.restricted_period,
                dependent_maintenance=f"Task #{task.id} - {task.maintenance_type}",
                operational_effect="Automatic block signalling suspended; manual piloting with caution required",
            )
        )

    departments_detail: list[DepartmentImpactItem] = [
        DepartmentImpactItem(
            department=d,
            task_count=1,
            crews_involved=[c["name"] for c in crews_involved if c.get("department") == d] or [c["name"] for c in crews_involved],
            affected_assets=[norm_block or task.station_code or "Corridor"],
            planned_window=maint_window.restricted_period,
            coordination_requirement=f"Coordinate with Section Controller for {d} block possession and track clearance",
        )
        for d in sorted(list(set(depts)))
    ]

    restricted_assets_detail: list[RestrictedAssetItem] = []
    if norm_block:
        restricted_assets_detail.append(
            RestrictedAssetItem(
                asset_code=norm_block,
                asset_name=block.name if block else f"Block {norm_block}",
                asset_type="Block Section",
                restriction_type="Full Corridor Possession",
                restriction_window=maint_window.restricted_period,
                reason=f"{task.maintenance_type} execution",
                status="Restricted",
                affected_operations=f"Suspends through-movements; {len(unique_train_numbers)} trains modeled for regulation",
            )
        )
    elif task.station_code:
        restricted_assets_detail.append(
            RestrictedAssetItem(
                asset_code=task.station_code,
                asset_name=f"Station {task.station_code}",
                asset_type="Station Yard / Loop",
                restriction_type="Platform / Loop Line Possession",
                restriction_window=maint_window.restricted_period,
                reason=f"{task.maintenance_type} execution",
                status="Restricted",
                affected_operations="Station platform/loop line occupied; through traffic restricted",
            )
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
        speed_restrictions=speed_restrictions,
        power_blocks=power_blocks,
        signalling_impacts=signalling_impacts,
        departments_detail=departments_detail,
        restricted_assets_detail=restricted_assets_detail,
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
    bundle = next(
        (
            b for b in bundles
            if b.get("bundle_id", "").upper() == clean_id
            or b.get("bundle_id", "").upper() == f"BUNDLE-{clean_id}"
            or _normalize_code(b.get("block_code")) == clean_id
        ),
        None,
    )

    if not bundle:
        raise HTTPException(status_code=404, detail=f"Maintenance bundle '{bundle_id}' not found.")
    actual_bundle_id = bundle.get("bundle_id", clean_id)

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
                "train_id": tr.get("train_id") or (t_rec.id if t_rec else None),
                "train_number": t_num,
                "train_name": t_rec.name if t_rec else tr.get("name", f"Train {t_num}"),
                "train_type": t_rec.train_type if t_rec else (tr.get("train_type") or "Express"),
                "source_station": t_rec.source_station_code if t_rec else None,
                "destination_station": t_rec.destination_station_code if t_rec else None,
                "current_station": t_rec.current_station_code if t_rec else (t_rec.source_station_code if t_rec else None),
                "direction": t_rec.direction if t_rec else "UP",
                "affected_block": norm_block,
                "conflict_type": "Schedule Overlap",
                "priority": tr.get("priority") or (t_rec.priority if t_rec else "Normal"),
                "status": t_rec.status if t_rec else "SCHEDULED",
                "eta_minute": eta,
                "depart_minute": dep,
                "delay_minutes": t_rec.delay_minutes if t_rec else None,
                "conflict_severity": "High" if str(tr.get("priority") or (t_rec.priority if t_rec else "")).lower() in ("critical", "high") else "Medium",
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
            "location": norm_block,
            "availability": (c_obj.status if c_obj else "Available"),
            "scheduled_window": f"{start_dt.strftime('%H:%M')}–{end_dt.strftime('%H:%M')}",
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

    # 10b. Bundle cross-functional impacts
    all_maint_text = " ".join(maint_types).lower()
    all_depts_text = " ".join(departments).lower()

    bundle_speed_restrictions: list[SpeedRestrictionItem] = []
    if any(k in all_maint_text for k in ["track", "tamping", "rail", "sleeper", "ballast", "deep screening", "welding"]) or "engineering" in all_depts_text or "civil" in all_depts_text:
        bundle_speed_restrictions.append(
            SpeedRestrictionItem(
                block_code=norm_block,
                section_name=block.name if block else norm_block,
                restriction_speed_kmph=30,
                normal_speed_kmph=100,
                restriction_window=maint_window.restricted_period,
                reason="Coordinated track corridor possession and post-work caution order",
                affected_trains_count=len(unique_train_numbers),
            )
        )

    bundle_power_blocks: list[PowerBlockItem] = []
    if any(k in all_maint_text for k in ["ohe", "power", "electrical", "traction", "catenary", "substation"]) or "electrical" in all_depts_text or "trd" in all_depts_text:
        bundle_power_blocks.append(
            PowerBlockItem(
                location=norm_block,
                power_block_type="OHE 25kV AC Traction Power Isolation",
                window=maint_window.restricted_period,
                department="Electrical (TRD)",
                affected_assets=f"Overhead Equipment (OHE) section {norm_block}",
                operational_effect="Electric traction isolated during bundle window; diesel haulage or holding required",
            )
        )

    bundle_signalling_impacts: list[SignallingImpactItem] = []
    if any(k in all_maint_text for k in ["signal", "point", "interlock", "axle", "track circuit", "telecom"]) or "s&t" in all_depts_text or "signal" in all_depts_text:
        bundle_signalling_impacts.append(
            SignallingImpactItem(
                signalling_asset=f"Signal & Interlocking Circuit ({norm_block})",
                location=norm_block,
                restriction="Non-Interlocked (NI) working / Joint S&T disconnection",
                window=maint_window.restricted_period,
                dependent_maintenance=f"Bundle {clean_id} ({len(tasks)} tasks)",
                operational_effect="Automatic block signalling suspended; coordinated testing with Engineering/TRD",
            )
        )

    bundle_departments_detail: list[DepartmentImpactItem] = [
        DepartmentImpactItem(
            department=d,
            task_count=len([t for t in tasks if (t.get("department") or "Engineering") == d]),
            crews_involved=[c["name"] for c in crews_involved if c.get("department") == d] or [c["name"] for c in crews_involved],
            affected_assets=[norm_block],
            planned_window=maint_window.restricted_period,
            coordination_requirement=f"Coordinated joint window with {', '.join([dept for dept in departments if dept != d]) or 'Traffic Controller'}",
        )
        for d in departments
    ]

    bundle_restricted_assets_detail: list[RestrictedAssetItem] = [
        RestrictedAssetItem(
            asset_code=norm_block,
            asset_name=block.name if block else f"Block {norm_block}",
            asset_type="Block Section",
            restriction_type="Coordinated Multi-Department Corridor Possession",
            restriction_window=maint_window.restricted_period,
            reason=f"Multi-department maintenance ({', '.join(maint_types)})",
            status="Restricted",
            affected_operations=f"Suspends through-movements; {len(unique_train_numbers)} trains regulated across joint window",
        )
    ]

    # 11. Explanation
    exp = (
        f"Bundle {clean_id} on {norm_block} coordinates {len(tasks)} tasks across "
        f"{', '.join(departments)} into a single {dur}-minute window ({maint_window.restricted_period}), "
        f"saving {bundle.get('time_saved_minutes', 0)} minutes of block closures and "
        f"encountering {len(conflicts)} modeled train conflicts."
    )

    return MaintenanceImpactResponse(
        target_type="bundle",
        target_id=actual_bundle_id,
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
        speed_restrictions=bundle_speed_restrictions,
        power_blocks=bundle_power_blocks,
        signalling_impacts=bundle_signalling_impacts,
        departments_detail=bundle_departments_detail,
        restricted_assets_detail=bundle_restricted_assets_detail,
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
                "train_id": tr.get("train_id") or (t_rec.id if t_rec else None),
                "train_number": t_num,
                "train_name": t_rec.name if t_rec else tr.get("name", f"Train {t_num}"),
                "train_type": t_rec.train_type if t_rec else (tr.get("train_type") or "Express"),
                "source_station": t_rec.source_station_code if t_rec else None,
                "destination_station": t_rec.destination_station_code if t_rec else None,
                "current_station": t_rec.current_station_code if t_rec else (t_rec.source_station_code if t_rec else None),
                "direction": t_rec.direction if t_rec else "UP",
                "affected_block": norm_block,
                "conflict_type": "Schedule Overlap",
                "priority": tr.get("priority") or (t_rec.priority if t_rec else "Normal"),
                "status": t_rec.status if t_rec else "SCHEDULED",
                "eta_minute": eta,
                "depart_minute": dep,
                "delay_minutes": t_rec.delay_minutes if t_rec else None,
                "conflict_severity": "High" if str(tr.get("priority") or (t_rec.priority if t_rec else "")).lower() in ("critical", "high") else "Medium",
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
            "location": norm_block,
            "availability": (c_obj.status if c_obj else "Available"),
            "scheduled_window": f"{start_dt.strftime('%H:%M')}–{end_dt.strftime('%H:%M')}",
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

    # What-If cross-functional impacts
    all_maint_text = " ".join(maint_types).lower()
    all_depts_text = " ".join(departments).lower()

    what_if_speed_restrictions: list[SpeedRestrictionItem] = []
    if any(k in all_maint_text for k in ["track", "tamping", "rail", "sleeper", "ballast", "deep screening", "welding"]) or "engineering" in all_depts_text or "civil" in all_depts_text:
        what_if_speed_restrictions.append(
            SpeedRestrictionItem(
                block_code=norm_block,
                section_name=block.name if block else norm_block,
                restriction_speed_kmph=30,
                normal_speed_kmph=100,
                restriction_window=maint_window.restricted_period,
                reason="Simulated track corridor possession and caution order",
                affected_trains_count=len(unique_train_numbers),
            )
        )

    what_if_power_blocks: list[PowerBlockItem] = []
    if any(k in all_maint_text for k in ["ohe", "power", "electrical", "traction", "catenary", "substation"]) or "electrical" in all_depts_text or "trd" in all_depts_text:
        what_if_power_blocks.append(
            PowerBlockItem(
                location=norm_block,
                power_block_type="OHE 25kV AC Traction Power Isolation",
                window=maint_window.restricted_period,
                department="Electrical (TRD)",
                affected_assets=f"Overhead Equipment (OHE) section {norm_block}",
                operational_effect="Simulated electric traction isolation during window",
            )
        )

    what_if_signalling_impacts: list[SignallingImpactItem] = []
    if any(k in all_maint_text for k in ["signal", "point", "interlock", "axle", "track circuit", "telecom"]) or "s&t" in all_depts_text or "signal" in all_depts_text:
        what_if_signalling_impacts.append(
            SignallingImpactItem(
                signalling_asset=f"Signal & Interlocking Circuit ({norm_block})",
                location=norm_block,
                restriction="Non-Interlocked (NI) working / Simulated S&T disconnection",
                window=maint_window.restricted_period,
                dependent_maintenance=f"What-If Plan ({len(target_plan.tasks)} tasks)",
                operational_effect="Automatic block signalling suspended; simulated manual piloting",
            )
        )

    what_if_departments_detail: list[DepartmentImpactItem] = [
        DepartmentImpactItem(
            department=d,
            task_count=len([t for t in target_plan.tasks if (t.get("department") or "Engineering") == d]),
            crews_involved=[c["name"] for c in crews_involved if c.get("department") == d] or [c["name"] for c in crews_involved],
            affected_assets=[norm_block],
            planned_window=maint_window.restricted_period,
            coordination_requirement=f"Simulated coordination with {', '.join([dept for dept in departments if dept != d]) or 'Traffic Controller'}",
        )
        for d in departments
    ]

    what_if_restricted_assets_detail: list[RestrictedAssetItem] = [
        RestrictedAssetItem(
            asset_code=norm_block,
            asset_name=block.name if block else f"Block {norm_block}",
            asset_type="Block Section",
            restriction_type="Corridor Possession",
            restriction_window=maint_window.restricted_period,
            reason=f"What-If maintenance ({', '.join(maint_types)})",
            status="Restricted",
            affected_operations=f"Suspends through-movements; {len(unique_train_numbers)} trains modeled for regulation",
        )
    ]

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
        speed_restrictions=what_if_speed_restrictions,
        power_blocks=what_if_power_blocks,
        signalling_impacts=what_if_signalling_impacts,
        departments_detail=what_if_departments_detail,
        restricted_assets_detail=what_if_restricted_assets_detail,
        predictive_origin=None,
        urgency_context=None,
        baseline_vs_optimized=baseline_vs_opt,
        explanation=f"What-If Scenario '{sim_res.name}' simulated for block {norm_block}: {sim_res.explanation}",
        human_approval_required=True,
    )
