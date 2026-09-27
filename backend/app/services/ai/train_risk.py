def calculate_train_operational_risk(
    delay_minutes: int,
    speed_kmph: float,
    status: str,
    priority: str,
    direction: str,
    current_station_code: str | None,
) -> dict:
    """
    Calculate an explainable operational-risk score for a train.

    This is the initial operational intelligence layer for RailSync AI.
    It combines delay, speed, status, priority, direction, and position
    information while historical labelled railway data is unavailable.
    """

    score = 0
    reasons: list[str] = []

    normalized_status = status.strip().lower()
    normalized_priority = priority.strip().title()
    normalized_direction = direction.strip().lower()

    # Delay is the strongest operational-risk factor.
    if delay_minutes >= 120:
        score += 45
        reasons.append("Severely delayed train")
    elif delay_minutes >= 60:
        score += 35
        reasons.append("Train delay exceeds one hour")
    elif delay_minutes >= 20:
        score += 20
        reasons.append("Train is moderately delayed")
    elif delay_minutes > 0:
        score += 10
        reasons.append("Train is slightly delayed")

    # Abnormal speed can indicate an operational issue.
    if speed_kmph <= 0 and normalized_status == "running":
        score += 25
        reasons.append("Running train has zero speed")
    elif speed_kmph > 160:
        score += 20
        reasons.append("Unusually high operating speed")
    elif 0 < speed_kmph < 30 and normalized_status == "running":
        score += 10
        reasons.append("Running train has unusually low speed")

    # Operational state.
    if normalized_status in {"stopped", "blocked", "emergency"}:
        score += 30
        reasons.append(
            f"Train status is {status.strip()}"
        )
    elif normalized_status in {"delayed", "held"}:
        score += 15
        reasons.append(
            f"Train status is {status.strip()}"
        )

    # High-priority trains deserve closer operational monitoring.
    if normalized_priority == "Critical":
        score += 10
        reasons.append("Critical-priority train")
    elif normalized_priority == "High":
        score += 5
        reasons.append("High-priority train")

    # Direction/position completeness check.
    if not current_station_code:
        score += 5
        reasons.append("Current train position is unavailable")

    if normalized_direction not in {"forward", "reverse"}:
        score += 5
        reasons.append("Train direction requires verification")

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
        reasons.append("No major operational risk factors detected")

    return {
        "risk_score": score,
        "risk_level": risk_level,
        "reasons": reasons,
    }
