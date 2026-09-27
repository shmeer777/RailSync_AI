from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.block import Block
from app.models.maintenance import Maintenance
from app.models.train import Train
from app.services.ai.traffic_estimator import get_block_train_traffic
from app.services.ai.conflict_detection import detect_train_block_conflicts

FEATURE_NAMES = [
    "traffic_score",
    "active_train_count",
    "train_conflict_count",
    "past_maintenance_count",
    "days_since_last_maintenance",
    "signal_event_ratio",
    "track_event_ratio",
    "electrical_event_ratio",
    "avg_duration_minutes",
    "high_priority_ratio",
    "distance_km",
    "operational_stress_index",
]


def extract_block_features(
    db: Session,
    block: Block,
    cached_conflicts: list[dict] | None = None,
    cached_records: list[Maintenance] | None = None,
    cached_trains: list[Train] | None = None,
    cached_traffic: dict | None = None,
) -> dict[str, float]:
    """
    Extract operational and historical features for a given railway block.
    Combines real block topology, current train density, conflict counts,
    and historical maintenance records.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # 1. Traffic score from traffic estimator
    if cached_traffic is not None and block.code in cached_traffic:
        traffic_score = float(cached_traffic[block.code])
    else:
        traffic_info = get_block_train_traffic(db, block.code)
        traffic_score = float(traffic_info.get("total_traffic_score", 0.0))

    # 2. Maintenance history on this block
    if cached_records is not None:
        records = [m for m in cached_records if m.block_code == block.code]
    else:
        records = db.scalars(
            select(Maintenance).where(
                Maintenance.location_type == "block",
                Maintenance.block_code == block.code,
            )
        ).all()

    past_maintenance_count = len(records)

    # 3. Department distribution & priorities
    signal_count = 0
    track_count = 0
    electrical_count = 0
    high_priority_count = 0
    durations: list[float] = []
    most_recent_date: datetime | None = None

    for m in records:
        dept = (m.department or "").strip().lower()
        m_type = (m.maintenance_type or "").strip().lower()

        if "signal" in dept or "s&t" in dept or "signal" in m_type:
            signal_count += 1
        elif "electrical" in dept or "electric" in m_type:
            electrical_count += 1
        elif "track" in dept or "engineering" in dept or "track" in m_type or "bridge" in m_type:
            track_count += 1

        if (m.priority or "").strip().title() in {"High", "Critical"}:
            high_priority_count += 1

        dur = m.estimated_duration_minutes or 60.0
        durations.append(dur)

        m_date = m.scheduled_start or m.planned_start
        if m_date:
            if most_recent_date is None or m_date > most_recent_date:
                most_recent_date = m_date

    signal_ratio = signal_count / past_maintenance_count if past_maintenance_count > 0 else 0.0
    track_ratio = track_count / past_maintenance_count if past_maintenance_count > 0 else 0.0
    electrical_ratio = electrical_count / past_maintenance_count if past_maintenance_count > 0 else 0.0
    high_priority_ratio = high_priority_count / past_maintenance_count if past_maintenance_count > 0 else 0.0
    avg_duration = sum(durations) / len(durations) if durations else 60.0

    if most_recent_date:
        delta_days = max(0.0, (now - most_recent_date).total_seconds() / 86400.0)
    else:
        delta_days = 90.0  # Default assumption if no recorded maintenance

    # 4. Active trains operating around block stations
    if cached_trains is not None:
        active_trains = [
            t for t in cached_trains
            if t.current_station_code in {block.start_station_code, block.end_station_code}
        ]
    else:
        active_trains = db.scalars(
            select(Train).where(
                Train.status != "Completed",
                Train.current_station_code.in_([block.start_station_code, block.end_station_code]),
            )
        ).all()
    active_train_count = float(len(active_trains))

    # 5. Train-block conflict count
    if cached_conflicts is not None:
        all_conflicts = cached_conflicts
    else:
        all_conflicts = detect_train_block_conflicts(db)

    block_conflicts = [
        c for c in all_conflicts
        if c.get("block_code") == block.code or (c.get("location_type") == "block" and c.get("block_code") == block.code)
    ]
    train_conflict_count = float(len(block_conflicts))

    # 6. Physical distance
    distance_km = float(block.distance_km or 40.0)

    # 7. Operational stress index (composite)
    operational_stress_index = (
        traffic_score * 0.35
        + train_conflict_count * 12.0
        + active_train_count * 5.0
        + (delta_days / 30.0) * 8.0
        + (1.0 if high_priority_ratio > 0.5 else 0.0) * 15.0
    )

    return {
        "traffic_score": traffic_score,
        "active_train_count": active_train_count,
        "train_conflict_count": train_conflict_count,
        "past_maintenance_count": float(past_maintenance_count),
        "days_since_last_maintenance": delta_days,
        "signal_event_ratio": signal_ratio,
        "track_event_ratio": track_ratio,
        "electrical_event_ratio": electrical_ratio,
        "avg_duration_minutes": avg_duration,
        "high_priority_ratio": high_priority_ratio,
        "distance_km": distance_km,
        "operational_stress_index": round(operational_stress_index, 2),
    }


def extract_all_block_features(db: Session) -> list[dict]:
    """
    Extract features for all blocks in the database.
    """
    blocks = db.scalars(select(Block).order_by(Block.code)).all()
    if not blocks:
        return []

    all_conflicts = detect_train_block_conflicts(db)
    all_records = db.scalars(select(Maintenance).where(Maintenance.location_type == "block")).all()
    all_trains = db.scalars(select(Train).where(Train.status != "Completed")).all()

    results = []
    for b in blocks:
        feats = extract_block_features(
            db,
            b,
            cached_conflicts=all_conflicts,
            cached_records=all_records,
            cached_trains=all_trains,
        )
        feats["block_code"] = b.code
        feats["block_name"] = b.name
        results.append(feats)
    return results
