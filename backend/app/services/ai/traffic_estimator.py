"""
Traffic Estimation Service for RailSync AI.

Derives traffic load scores, expected train arrivals, and candidate maintenance windows
for railway blocks based on synthetic/demo train positions, routes, and speeds.
"""

from datetime import datetime, time, timedelta
from typing import Any
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.block import Block
from app.models.train import Train
from app.services.ai.block_planner import _build_network_graph, _find_route_blocks, _normalize_code


PLANNING_WINDOWS = {
    "night": {"start_hour": 21, "end_hour": 6, "description": "Night Corridor (21:00 - 06:00)"},
    "evening": {"start_hour": 18, "end_hour": 23, "description": "Evening Off-Peak (18:00 - 23:00)"},
    "daytime": {"start_hour": 10, "end_hour": 16, "description": "Midday Maintenance (10:00 - 16:00)"},
    "earliest": {"start_hour": None, "end_hour": None, "description": "Earliest Feasible Safe Window"},
}


def get_block_train_traffic(
    db: Session,
    block_code: str,
    base_time: datetime | None = None,
    horizon_minutes: int = 480,
) -> dict[str, Any]:
    """
    Analyzes train routes across the railway topology and calculates the expected
    traffic load on a specific block over a given planning horizon.

    Returns:
    - expected_trains: list of trains traversing the block with arrival/departure ETAs
    - slot_traffic: traffic score per 30-minute slot across the horizon
    - total_trains_count: number of expected trains
    - overall_traffic_level: 'Low', 'Medium', or 'High'
    """
    norm_block_code = _normalize_code(block_code)

    blocks = db.scalars(select(Block)).all()
    target_block = next((b for b in blocks if _normalize_code(b.code) == norm_block_code), None)
    if not target_block:
        return {
            "block_code": block_code,
            "expected_trains": [],
            "slot_traffic": [0] * (horizon_minutes // 30),
            "total_trains_count": 0,
            "overall_traffic_level": "Low",
        }

    graph = _build_network_graph(blocks)
    trains = db.scalars(select(Train).where(Train.status.in_(["Running", "Delayed", "Held"]))).all()

    expected_trains: list[dict[str, Any]] = []
    num_slots = max(1, horizon_minutes // 30)
    slot_scores = [0] * num_slots

    priority_weights = {
        "critical": 5,
        "high": 3,
        "normal": 2,
        "medium": 2,
        "low": 1,
    }

    for train in trains:
        curr = _normalize_code(train.current_station_code) or _normalize_code(train.source_station_code)
        dest = _normalize_code(train.destination_station_code)
        if not curr or not dest or curr == dest:
            continue

        route = _find_route_blocks(graph, curr, dest)
        if not route:
            continue

        # Check if target block is in this train's route
        block_idx = next((i for i, b in enumerate(route) if _normalize_code(b.code) == norm_block_code), None)
        if block_idx is None:
            continue

        # Calculate distance up to target block
        dist_to_block = sum(float(b.distance_km or 20.0) for b in route[:block_idx])
        block_dist = float(target_block.distance_km or 25.0)

        speed = float(train.speed_kmph or 80.0)
        if speed <= 5.0:
            speed = 60.0  # Fallback reasonable speed for delayed/stopped train

        delay = int(train.delay_minutes or 0)
        eta_minutes = int((dist_to_block / speed) * 60) + delay
        transit_minutes = max(5, int((block_dist / speed) * 60))
        depart_minutes = eta_minutes + transit_minutes

        p_str = str(train.priority or "Normal").strip().lower()
        p_weight = priority_weights.get(p_str, 2)

        # Record train if within horizon
        if eta_minutes < horizon_minutes + 120 and depart_minutes >= 0:
            expected_trains.append({
                "train_id": train.id,
                "train_number": train.train_number,
                "name": train.name,
                "priority": train.priority,
                "eta_minute": eta_minutes,
                "depart_minute": depart_minutes,
                "priority_weight": p_weight,
            })

            # Add to 30-min slots
            s_start = max(0, eta_minutes // 30)
            s_end = min(num_slots - 1, depart_minutes // 30)
            for s in range(s_start, s_end + 1):
                slot_scores[s] += p_weight

    # Determine overall traffic level
    total_conflicts = len(expected_trains)
    total_score = sum(slot_scores)

    if total_score <= 4:
        level = "Low"
    elif total_score <= 10:
        level = "Medium"
    else:
        level = "High"

    return {
        "block_code": block_code,
        "expected_trains": expected_trains,
        "slot_traffic": slot_scores,
        "total_trains_count": total_conflicts,
        "total_traffic_score": total_score,
        "overall_traffic_level": level,
    }


def get_all_blocks_traffic(
    db: Session,
    blocks: list[Block] | None = None,
    horizon_minutes: int = 480,
) -> dict[str, dict[str, Any]]:
    """
    Efficiently computes traffic for all blocks in a single pass by caching train routes.
    """
    if blocks is None:
        blocks = db.scalars(select(Block)).all()

    graph = _build_network_graph(blocks)
    trains = db.scalars(select(Train).where(Train.status.in_(["Running", "Delayed", "Held"]))).all()

    priority_weights = {
        "critical": 5,
        "high": 3,
        "normal": 2,
        "medium": 2,
        "low": 1,
    }

    train_routes = []
    for train in trains:
        curr = _normalize_code(train.current_station_code) or _normalize_code(train.source_station_code)
        dest = _normalize_code(train.destination_station_code)
        if not curr or not dest or curr == dest:
            continue
        route = _find_route_blocks(graph, curr, dest)
        if route:
            train_routes.append((train, route))

    results = {}
    num_slots = max(1, horizon_minutes // 30)

    for target_block in blocks:
        norm_code = _normalize_code(target_block.code)
        expected_trains = []
        slot_scores = [0] * num_slots

        for train, route in train_routes:
            block_idx = next((i for i, b in enumerate(route) if _normalize_code(b.code) == norm_code), None)
            if block_idx is None:
                continue

            dist_to_block = sum(float(b.distance_km or 20.0) for b in route[:block_idx])
            block_dist = float(target_block.distance_km or 25.0)

            speed = float(train.speed_kmph or 80.0)
            if speed <= 5.0:
                speed = 60.0

            delay = int(train.delay_minutes or 0)
            eta_minutes = int((dist_to_block / speed) * 60) + delay
            transit_minutes = max(5, int((block_dist / speed) * 60))
            depart_minutes = eta_minutes + transit_minutes

            p_str = str(train.priority or "Normal").strip().lower()
            p_weight = priority_weights.get(p_str, 2)

            if eta_minutes < horizon_minutes + 120 and depart_minutes >= 0:
                expected_trains.append({
                    "train_id": train.id,
                    "train_number": train.train_number,
                    "name": train.name,
                    "priority": train.priority,
                    "eta_minute": eta_minutes,
                    "depart_minute": depart_minutes,
                    "priority_weight": p_weight,
                })
                s_start = max(0, eta_minutes // 30)
                s_end = min(num_slots - 1, depart_minutes // 30)
                for s in range(s_start, s_end + 1):
                    slot_scores[s] += p_weight

        total_score = sum(slot_scores)
        level = "Low" if total_score <= 4 else ("Medium" if total_score <= 10 else "High")

        results[target_block.code] = {
            "block_code": target_block.code,
            "expected_trains": expected_trains,
            "slot_traffic": slot_scores,
            "total_trains_count": len(expected_trains),
            "total_traffic_score": total_score,
            "overall_traffic_level": level,
        }

    return results


def resolve_planning_window(
    window_preference: str | None = None,
    base_time: datetime | None = None,
) -> tuple[datetime, int, str]:
    """
    Resolves the start datetime, horizon in minutes, and description
    for a chosen planning window preference (e.g. 'night', 'daytime', 'evening', 'earliest').
    """
    if base_time is None:
        base_time = datetime.now().replace(second=0, microsecond=0)

    pref = (window_preference or "night").strip().lower()
    cfg = PLANNING_WINDOWS.get(pref, PLANNING_WINDOWS["night"])

    if pref == "night":
        # Target 21:00 on the same day (or next day if already past 21:00)
        target_start = base_time.replace(hour=21, minute=0)
        if base_time.hour >= 22:
            target_start += timedelta(days=1)
        horizon = 540  # 9 hours (21:00 - 06:00)
        return target_start, horizon, cfg["description"]

    elif pref == "evening":
        target_start = base_time.replace(hour=18, minute=0)
        if base_time.hour >= 19:
            target_start += timedelta(days=1)
        horizon = 300  # 5 hours (18:00 - 23:00)
        return target_start, horizon, cfg["description"]

    elif pref == "daytime":
        target_start = base_time.replace(hour=10, minute=0)
        if base_time.hour >= 11:
            target_start += timedelta(days=1)
        horizon = 360  # 6 hours (10:00 - 16:00)
        return target_start, horizon, cfg["description"]

    else:
        # 'earliest': next clean 15-minute mark from base_time
        next_min = ((base_time.minute // 15) + 1) * 15
        if next_min >= 60:
            target_start = (base_time + timedelta(hours=1)).replace(minute=0)
        else:
            target_start = base_time.replace(minute=next_min)
        horizon = 480  # 8 hours
        return target_start, horizon, "Earliest Feasible Safe Window"
