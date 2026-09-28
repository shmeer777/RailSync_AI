from datetime import datetime, timezone
import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ml.features import FEATURE_NAMES, extract_block_features
from app.ml.trainer import load_trained_model
from app.models.block import Block
from app.models.maintenance import Maintenance
from app.models.train import Train
from app.services.ai.maintenance_risk import calculate_maintenance_risk

# Mapping from predicted maintenance type to recommended department & default parameters
MAINTENANCE_METADATA_MAP = {
    "Signal Maintenance": {
        "department": "S&T",
        "crew_type": "S&T Team",
        "default_duration_minutes": 90,
        "default_priority": "High",
        "action_template": "Schedule preventive signal and interlock inspection during next off-peak corridor.",
    },
    "Signalling Equipment Maintenance": {
        "department": "S&T",
        "crew_type": "S&T Team",
        "default_duration_minutes": 75,
        "default_priority": "Medium",
        "action_template": "Perform diagnostic check and component servicing on wayside signalling equipment.",
    },
    "Track Repair": {
        "department": "Engineering",
        "crew_type": "Track Team",
        "default_duration_minutes": 120,
        "default_priority": "High",
        "action_template": "Schedule track repair and weld restoration with heavy engineering crew.",
    },
    "Track Maintenance": {
        "department": "Engineering",
        "crew_type": "Track Team",
        "default_duration_minutes": 90,
        "default_priority": "Medium",
        "action_template": "Coordinate track alignment, sleeper inspection, and routine ballast maintenance.",
    },
    "Track Inspection": {
        "department": "Engineering",
        "crew_type": "Track Team",
        "default_duration_minutes": 60,
        "default_priority": "Medium",
        "action_template": "Conduct track geometry inspection and ultrasonic rail testing.",
    },
    "Electrical Inspection": {
        "department": "Electrical",
        "crew_type": "Electrical Team",
        "default_duration_minutes": 60,
        "default_priority": "Critical",
        "action_template": "Perform overhead equipment (OHE) electrical inspection and feeder line check.",
    },
    "Electrical Maintenance": {
        "department": "Electrical",
        "crew_type": "Electrical Team",
        "default_duration_minutes": 90,
        "default_priority": "High",
        "action_template": "Schedule substation and traction power distribution maintenance.",
    },
    "Preventive Inspection": {
        "department": "Engineering",
        "crew_type": "Track Team",
        "default_duration_minutes": 45,
        "default_priority": "Low",
        "action_template": "Conduct periodic cross-department visual and sensor-based asset check.",
    },
    "No Immediate Maintenance": {
        "department": "Operations",
        "crew_type": "Inspection Team",
        "default_duration_minutes": 0,
        "default_priority": "Low",
        "action_template": "Asset operating within safe tolerance. Continue continuous telemetry monitoring.",
    },
}

FEATURE_METADATA = {
    "traffic_score": {
        "label": "Corridor Traffic Score",
        "description": "Corridor traffic density and train throughput intensity.",
    },
    "active_train_count": {
        "label": "Active Train Count",
        "description": "Number of trains actively running across block terminal stations.",
    },
    "train_conflict_count": {
        "label": "Train-Block Conflicts",
        "description": "Active conflict events detected between train paths and block occupation.",
    },
    "past_maintenance_count": {
        "label": "Past Maintenance Volume",
        "description": "Total historical maintenance events recorded on this section.",
    },
    "days_since_last_maintenance": {
        "label": "Days Since Last Maintenance",
        "description": "Elapsed days since the most recent maintenance operation.",
    },
    "signal_event_ratio": {
        "label": "Signal Maintenance Ratio",
        "description": "Proportion of historical tasks belonging to Signal & Telecommunication.",
    },
    "track_event_ratio": {
        "label": "Track Maintenance Ratio",
        "description": "Proportion of historical tasks belonging to Civil Engineering / Track.",
    },
    "electrical_event_ratio": {
        "label": "Electrical Maintenance Ratio",
        "description": "Proportion of historical tasks belonging to Electrical Traction.",
    },
    "avg_duration_minutes": {
        "label": "Average Task Duration",
        "description": "Average duration of maintenance interventions on this block.",
    },
    "high_priority_ratio": {
        "label": "High Priority Task Ratio",
        "description": "Proportion of historical interventions categorized as High or Critical priority.",
    },
    "distance_km": {
        "label": "Block Distance",
        "description": "Physical track length of the railway block in kilometers.",
    },
    "operational_stress_index": {
        "label": "Operational Stress Index",
        "description": "Composite operational stress metric combining traffic, delays, and conflicts.",
    },
}


# Cached SHAP explainer instance
_tree_explainer = None
_last_model_id = None


def _get_tree_explainer(model):
    global _tree_explainer, _last_model_id
    if _tree_explainer is None or _last_model_id != id(model):
        try:
            import shap
            _tree_explainer = shap.TreeExplainer(model)
            _last_model_id = id(model)
        except Exception:
            _tree_explainer = None
    return _tree_explainer


def _determine_urgency(predicted_type: str, confidence: float, risk_score: int) -> str:
    """
    Synthesize model confidence, predicted maintenance type, and risk score
    into an actionable urgency level.
    """
    if predicted_type == "No Immediate Maintenance":
        return "Low"

    if predicted_type in {"Electrical Inspection", "Track Repair"} and (confidence >= 75.0 or risk_score >= 70):
        return "Critical"

    if predicted_type in {"Signal Maintenance", "Track Repair", "Electrical Maintenance"} or risk_score >= 50 or confidence >= 75.0:
        return "High"

    if predicted_type in {"Track Maintenance", "Signalling Equipment Maintenance", "Track Inspection"} or risk_score >= 25:
        return "Medium"

    return "Low"


def _extract_top_contributing_features(
    features: dict[str, float],
    model,
    predicted_class: str,
    feature_row: pd.DataFrame,
    class_idx: int,
) -> list[dict]:
    """
    Extracts top contributing features from actual model inputs using SHAP local attribution
    when available, with fallback to Random Forest feature importances.
    Ensures that every returned feature strictly belongs to FEATURE_NAMES.
    """
    importances = model.feature_importances_

    # Attempt SHAP local attribution for the predicted class
    shap_vals_class = None
    try:
        explainer = _get_tree_explainer(model)
        if explainer is not None:
            sv = explainer.shap_values(feature_row)
            if isinstance(sv, list) and class_idx < len(sv):
                shap_vals_class = np.array(sv[class_idx]).flatten()
            elif isinstance(sv, np.ndarray):
                if sv.ndim == 3 and class_idx < sv.shape[2]:
                    shap_vals_class = sv[0, :, class_idx]
                elif sv.ndim == 2:
                    shap_vals_class = sv[0, :]
    except Exception:
        shap_vals_class = None

    results = []

    for i, name in enumerate(FEATURE_NAMES):
        val = float(features.get(name, 0.0))
        meta = FEATURE_METADATA.get(name, {"label": name, "description": name})

        if shap_vals_class is not None and i < len(shap_vals_class):
            local_shap = float(shap_vals_class[i])
            imp_score = round(abs(local_shap), 4)
            direction = "increases_probability" if local_shap >= 0 else "decreases_probability"
        else:
            imp_score = round(float(importances[i]), 4)
            direction = "increases_probability"

        # Determine influence level based on importance score and feature value
        if imp_score >= 0.10 or (name in ["operational_stress_index", "signal_event_ratio", "track_event_ratio", "electrical_event_ratio"] and val > 0.25):
            level = "High"
        elif imp_score >= 0.04 or val > 0:
            level = "Moderate"
        else:
            level = "Low"

        # Generate human-friendly explanation strictly tied to actual value and feature
        if name == "signal_event_ratio":
            explanation = f"Historical signal maintenance ratio ({round(val * 100, 1)}%) increased the model's likelihood of predicting Signal Maintenance."
        elif name == "track_event_ratio":
            explanation = f"Historical track maintenance ratio ({round(val * 100, 1)}%) influenced civil engineering predictions."
        elif name == "electrical_event_ratio":
            explanation = f"Historical electrical maintenance ratio ({round(val * 100, 1)}%) influenced traction predictions."
        elif name == "operational_stress_index":
            explanation = f"Operational stress index of {round(val, 1)} reflects current corridor throughput and load."
        elif name == "train_conflict_count":
            explanation = f"{int(val)} active train-block conflicts detected on this corridor."
        elif name == "traffic_score":
            explanation = f"Corridor traffic score of {round(val, 1)} indicates high train density."
        elif name == "days_since_last_maintenance":
            explanation = f"{int(val)} days elapsed since previous recorded maintenance intervention."
        elif name == "high_priority_ratio":
            explanation = f"{round(val * 100, 1)}% of past maintenance was Critical or High priority."
        elif name == "active_train_count":
            explanation = f"{int(val)} active trains currently operating across block terminal stations."
        elif name == "avg_duration_minutes":
            explanation = f"Average past intervention duration is {round(val, 1)} minutes."
        elif name == "distance_km":
            explanation = f"Block physical length is {round(val, 1)} km."
        else:
            explanation = f"Feature '{name}' (value: {round(val, 2)}) was evaluated by the model."

        results.append({
            "feature": name,
            "feature_label": meta["label"],
            "value": round(val, 2),
            "importance": imp_score,
            "influence_level": level,
            "direction": direction,
            "human_explanation": explanation,
        })

    # Sort descending by influence level and importance score, return top 4
    results.sort(key=lambda item: (item["influence_level"] == "High", item["importance"]), reverse=True)
    return results[:4]


def _generate_prediction_explanation(
    predicted_class: str,
    confidence: float,
    top_features: list[dict],
    features: dict[str, float],
    use_ollama: bool = False,
) -> tuple[list[dict], str]:
    """
    Produces:
    1. A list of structured explanation objects explaining WHY the model predicted this maintenance type.
    2. A readable summary sentence/paragraph (using Ollama if requested, with immediate graceful fallback).
    """
    explanation_objects = [
        {
            "feature": item["feature"],
            "importance": item["importance"],
            "direction": item["direction"],
            "human_explanation": item["human_explanation"],
        }
        for item in top_features
    ]

    # Summary synthesis: Try Ollama with strict prompt if requested, fallback to template
    summary = (
        f"The model predicts {predicted_class} with {confidence}% confidence primarily because "
        f"recent maintenance patterns, operational stress, and corridor throughput were influential factors."
    )

    if use_ollama:
        try:
            from app.services.ai.ollama_service import ask_ollama
            # Pass ONLY the actual model factors to Ollama
            factors_text = "; ".join([f"{f['human_explanation']}" for f in top_features[:3]])
            prompt = (
                f"In 2 sentences, explain why a machine learning model predicted '{predicted_class}' "
                f"for a railway block based ONLY on these factors: {factors_text}. "
                f"Do not invent new facts, events, or failure causes. State that this is an AI advisory recommendation, not a guaranteed failure."
            )
            ai_resp = ask_ollama(prompt)
            if ai_resp and len(ai_resp.strip()) > 20 and "No response" not in ai_resp:
                summary = ai_resp.strip()
        except Exception:
            pass

    return explanation_objects, summary


def predict_maintenance_for_block(
    db: Session,
    block_code: str,
    cached_block: Block | None = None,
    cached_conflicts: list[dict] | None = None,
    cached_records: list[Maintenance] | None = None,
    cached_trains: list[Train] | None = None,
    cached_traffic: dict | None = None,
    cached_model_and_metrics: tuple | None = None,
    use_ollama: bool = False,
) -> dict:
    """
    Predicts the maintenance type most likely needed for a specific block.
    Returns predicted type, confidence, urgency, risk score, contributing factors,
    top contributing features, detailed explanation, and recommended action.
    """
    block = cached_block or db.scalar(select(Block).where(Block.code == block_code))
    if not block:
        raise ValueError(f"Block with code '{block_code}' not found.")

    # 1. Extract block features
    features = extract_block_features(
        db,
        block,
        cached_conflicts=cached_conflicts,
        cached_records=cached_records,
        cached_trains=cached_trains,
        cached_traffic=cached_traffic,
    )

    # 2. Query existing asset risk from the Risk Engine
    if cached_records is not None:
        maintenance_records = [m for m in cached_records if m.block_code == block.code]
    else:
        maintenance_records = db.scalars(
            select(Maintenance).where(
                Maintenance.location_type == "block",
                Maintenance.block_code == block.code,
            )
        ).all()

    risk_scores = []
    for m in maintenance_records:
        r = calculate_maintenance_risk(
            priority=m.priority,
            status=m.status,
            estimated_duration_minutes=m.estimated_duration_minutes,
            scheduled_start=m.scheduled_start,
            scheduled_end=m.scheduled_end,
        )
        risk_scores.append(r["risk_score"])

    if risk_scores:
        avg_risk_score = int(round(sum(risk_scores) / len(risk_scores)))
    else:
        baseline = min(100, int(round(features["traffic_score"] * 0.4 + features["train_conflict_count"] * 15.0)))
        avg_risk_score = baseline

    # 3. Supervised Model Inference
    if cached_model_and_metrics is not None:
        model, metrics = cached_model_and_metrics
    else:
        model, metrics = load_trained_model()

    feature_row = pd.DataFrame([[features[k] for k in FEATURE_NAMES]], columns=FEATURE_NAMES)
    probabilities = model.predict_proba(feature_row)[0]
    classes = list(model.classes_)

    top_idx = int(np.argmax(probabilities))
    predicted_class = classes[top_idx]
    confidence_pct = round(float(probabilities[top_idx]) * 100.0, 1)

    # 4. Synthesize Urgency, Top Contributing Features & Explanations
    urgency = _determine_urgency(predicted_class, confidence_pct, avg_risk_score)
    top_features = _extract_top_contributing_features(features, model, predicted_class, feature_row, top_idx)
    explanation_objects, ai_summary = _generate_prediction_explanation(
        predicted_class, confidence_pct, top_features, features, use_ollama=use_ollama
    )

    meta = MAINTENANCE_METADATA_MAP.get(predicted_class, {
        "department": "Engineering",
        "crew_type": "Track Team",
        "default_duration_minutes": 60,
        "default_priority": "Medium",
        "action_template": "Review asset telemetry and schedule preventive maintenance.",
    })

    return {
        "block_code": block.code,
        "block_name": block.name,
        "start_station_code": block.start_station_code,
        "end_station_code": block.end_station_code,
        "distance_km": block.distance_km,
        "predicted_maintenance": predicted_class,
        "confidence": confidence_pct,
        "model_probability": confidence_pct,
        "urgency": urgency,
        "risk_score": avg_risk_score,
        "contributing_factors": [f["human_explanation"] for f in top_features],
        "top_contributing_features": top_features,
        "prediction_explanation": explanation_objects,
        "ai_explanation_summary": ai_summary,
        "recommended_action": meta["action_template"],
        "recommended_task_details": {
            "department": meta["department"],
            "crew_type": meta["crew_type"],
            "estimated_duration_minutes": meta["default_duration_minutes"],
            "default_priority": meta["default_priority"],
        },
        "model_info": {
            "model_name": metrics.get("model_name", "RandomForestClassifier"),
            "model_version": metrics.get("model_version", "1.0.0"),
            "accuracy": metrics.get("accuracy", 0.9),
            "is_synthetic_training_data": metrics.get("is_synthetic_training_data", True),
        },
        "features": features,
        "human_review_notice": (
            "AI prediction is decision support. Authorized railway personnel review and approve recommendations before execution."
        ),
    }


_ALL_PREDICTIONS_CACHE: list[dict] | None = None
_ALL_PREDICTIONS_CACHE_TIME: float = 0.0
_PREDICTIONS_CACHE_TTL: float = 120.0  # 2 minutes TTL


def get_cached_all_block_predictions() -> list[dict] | None:
    global _ALL_PREDICTIONS_CACHE, _ALL_PREDICTIONS_CACHE_TIME
    import time
    if _ALL_PREDICTIONS_CACHE is not None and (time.time() - _ALL_PREDICTIONS_CACHE_TIME) < _PREDICTIONS_CACHE_TTL:
        return _ALL_PREDICTIONS_CACHE
    return None


def predict_maintenance_for_all_blocks(db: Session, force_refresh: bool = False) -> list[dict]:
    """
    Generates predictions for all blocks in the database efficiently,
    caching the result for 120s to prevent redundant SHAP/inference computations.
    """
    global _ALL_PREDICTIONS_CACHE, _ALL_PREDICTIONS_CACHE_TIME
    import time

    if not force_refresh:
        cached = get_cached_all_block_predictions()
        if cached is not None:
            return cached

    from app.services.ai.conflict_detection import detect_train_block_conflicts
    from app.services.ai.traffic_estimator import get_all_blocks_traffic
    from app.models.train import Train

    blocks = db.scalars(select(Block).order_by(Block.code)).all()
    if not blocks:
        return []

    # Pre-fetch shared operational data once across all blocks
    all_conflicts = detect_train_block_conflicts(db)
    all_records = db.scalars(
        select(Maintenance).where(Maintenance.location_type == "block")
    ).all()
    all_trains = db.scalars(
        select(Train).where(Train.status != "Completed")
    ).all()
    all_traffic_data = get_all_blocks_traffic(db, blocks)
    all_traffic_scores = {code: data["total_traffic_score"] for code, data in all_traffic_data.items()}
    model_and_metrics = load_trained_model()

    results = []
    for b in blocks:
        pred = predict_maintenance_for_block(
            db,
            b.code,
            cached_block=b,
            cached_conflicts=all_conflicts,
            cached_records=all_records,
            cached_trains=all_trains,
            cached_traffic=all_traffic_scores,
            cached_model_and_metrics=model_and_metrics,
        )
        results.append(pred)

    _ALL_PREDICTIONS_CACHE = results
    _ALL_PREDICTIONS_CACHE_TIME = time.time()
    return results

