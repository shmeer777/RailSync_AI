from datetime import datetime, timezone


def calculate_maintenance_risk(
    priority: str,
    status: str,
    estimated_duration_minutes: float | None,
    scheduled_start: datetime | None,
    scheduled_end: datetime | None,
) -> dict:
    """
    Calculate an explainable maintenance-risk score.

    This is the initial AI decision layer for RailSync AI.
    It is intentionally explainable while historical training data
    is not yet available.
    """

    score = 0
    reasons: list[str] = []

    priority_score = {
        "Low": 10,
        "Medium": 25,
        "High": 40,
        "Critical": 55,
    }

    priority_value = priority_score.get(
        priority.strip().title(),
        25,
    )

    score += priority_value

    if priority.strip().title() in {"High", "Critical"}:
        reasons.append(
            f"{priority.strip().title()} priority maintenance"
        )

    status_normalized = status.strip().lower()

    if status_normalized == "in progress":
        score += 15
        reasons.append("Maintenance is currently in progress")
    elif status_normalized == "planned":
        score += 5
    elif status_normalized == "completed":
        score -= 20

    if estimated_duration_minutes is not None:
        if estimated_duration_minutes >= 480:
            score += 20
            reasons.append("Long maintenance duration")
        elif estimated_duration_minutes >= 240:
            score += 10
            reasons.append("Extended maintenance duration")

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    if scheduled_start is not None:
        if scheduled_start < now and status_normalized not in {
            "completed",
            "cancelled",
        }:
            score += 15
            reasons.append("Scheduled start time has passed")

    if (
        scheduled_start is not None
        and scheduled_end is not None
        and scheduled_end <= scheduled_start
    ):
        score += 20
        reasons.append("Invalid maintenance time window")

    score = max(0, min(score, 100))

    if score >= 75:
        risk_level = "Critical"
    elif score >= 50:
        risk_level = "High"
    elif score >= 25:
        risk_level = "Medium"
    else:
        risk_level = "Low"

    if not reasons:
        reasons.append("No major risk factors detected")

    return {
        "risk_score": score,
        "risk_level": risk_level,
        "reasons": reasons,
    }
