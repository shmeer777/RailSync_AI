from app.services.ai.ollama_service import ask_ollama


def explain_block_decision(
    train_number: str,
    train_name: str,
    train_status: str,
    train_priority: str,
    delay_minutes: int,
    speed_kmph: float,
    current_station_code: str | None,
    block_code: str | None,
    block_name: str | None,
    plan_status: str,
    plan_reason: str,
    conflict_severity: str | None = None,
    conflict_reasons: list[str] | None = None,
    recommendation: str | None = None,
) -> str:
    """
    Generate a human-readable explanation of a RailSync
    automatic block-planning decision.
    """

    conflict_text = (
        "\n".join(
            f"- {reason}"
            for reason in (conflict_reasons or [])
        )
        or "No active conflict detected."
    )

    prompt = f"""
You are RailSync AI, a railway operations decision-support assistant.

Explain the following automatic block-planning decision to a railway
operations controller.

IMPORTANT:
- Use only the information provided below.
- Do not invent railway data.
- Do not change the decision made by the optimization system.
- Do not claim that you control railway signalling.
- Keep the explanation clear and professional.
- Give a concise explanation in 3 to 5 sentences.

TRAIN
Train number: {train_number}
Train name: {train_name}
Status: {train_status}
Priority: {train_priority}
Delay: {delay_minutes} minutes
Speed: {speed_kmph} km/h
Current station: {current_station_code}

BLOCK PLAN
Block: {block_code}
Block name: {block_name}
Plan status: {plan_status}
Planner reason: {plan_reason}

CONFLICT
Severity: {conflict_severity or "None"}
Reasons:
{conflict_text}

RECOMMENDATION
{recommendation or "No additional recommendation."}

Explain why this plan was generated and what the operator should
understand from it.
"""

    return ask_ollama(prompt)