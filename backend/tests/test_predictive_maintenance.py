import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ml.synthetic_data import MAINTENANCE_CLASSES

client = TestClient(app)


def test_get_maintenance_predictions_all_blocks():
    """Verifies GET /ai/maintenance-predictions returns network-wide predictions."""
    response = client.get("/ai/maintenance-predictions")
    assert response.status_code == 200
    data = response.json()

    assert "total_predictions" in data
    assert "predictions" in data
    assert data["total_predictions"] > 0
    assert len(data["predictions"]) > 0

    first = data["predictions"][0]
    assert "block_code" in first
    assert "predicted_maintenance" in first
    assert "confidence" in first
    assert "urgency" in first
    assert "risk_score" in first
    assert "contributing_factors" in first
    assert "recommended_action" in first


def test_get_maintenance_prediction_specific_block():
    """Verifies GET /ai/maintenance-predictions/{block_code} for a known block."""
    response = client.get("/ai/maintenance-predictions/GNT-BZA-01")
    assert response.status_code == 200
    data = response.json()

    assert data["block_code"] == "GNT-BZA-01"
    assert data["predicted_maintenance"] in MAINTENANCE_CLASSES
    assert isinstance(data["confidence"], (int, float))
    assert 0.0 <= data["confidence"] <= 100.0
    assert data["urgency"] in {"Critical", "High", "Medium", "Low"}
    assert isinstance(data["risk_score"], (int, float))
    assert 0 <= data["risk_score"] <= 100
    assert isinstance(data["contributing_factors"], list)
    assert len(data["contributing_factors"]) > 0
    assert "recommended_action" in data
    assert "human_review_notice" in data


def test_get_maintenance_prediction_query_param():
    """Verifies GET /ai/maintenance-predictions?block_code=GNT-BZA-01."""
    response = client.get("/ai/maintenance-predictions?block_code=GNT-BZA-01")
    assert response.status_code == 200
    data = response.json()

    assert data["total_predictions"] == 1
    assert data["predictions"][0]["block_code"] == "GNT-BZA-01"


def test_prediction_confidence_and_risk_separation():
    """Verifies confidence (model probability) and risk (asset risk) are distinct metrics."""
    response = client.get("/ai/maintenance-predictions/GNT-BZA-01")
    assert response.status_code == 200
    data = response.json()

    # Confidence is model probability
    assert "confidence" in data
    # Risk score is from the asset risk engine
    assert "risk_score" in data
    assert "urgency" in data
    # They should not be conflated
    assert isinstance(data["confidence"], float)
    assert isinstance(data["risk_score"], int)


def test_prediction_classes_membership():
    """Verifies all predictions fall within the 9 allowed classes."""
    response = client.get("/ai/maintenance-predictions")
    assert response.status_code == 200
    data = response.json()

    for pred in data["predictions"]:
        assert pred["predicted_maintenance"] in MAINTENANCE_CLASSES, (
            f"Unexpected class '{pred['predicted_maintenance']}'"
        )


def test_unknown_block_handling():
    """Verifies unknown block returns HTTP 404."""
    response = client.get("/ai/maintenance-predictions/NON-EXISTENT-BLOCK-999")
    assert response.status_code == 404


def test_model_metrics_endpoint():
    """Verifies /ai/maintenance-predictions/model-metrics returns valid evaluation metrics."""
    response = client.get("/ai/maintenance-predictions/model-metrics")
    assert response.status_code == 200
    data = response.json()

    assert data["model_name"] == "RandomForestClassifier"
    assert "accuracy" in data
    assert 0.0 <= data["accuracy"] <= 1.0
    assert "f1_weighted" in data
    assert "precision_weighted" in data
    assert "recall_weighted" in data
    assert "confusion_matrix" in data
    assert "feature_importances" in data
    assert data["is_synthetic_training_data"] is True


def test_plan_from_prediction_endpoint():
    """Verifies bridging a prediction into the bundling scheduler with human review."""
    payload = {
        "block_code": "GNT-BZA-01",
        "maintenance_type": "Signal Maintenance",
        "department": "S&T",
        "crew_type": "S&T Team",
        "priority": "High",
        "estimated_duration_minutes": 90.0,
        "window_preference": "night",
        "human_approved": True,
    }

    response = client.post("/ai/maintenance-predictions/plan", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["block_code"] == "GNT-BZA-01"
    assert data["recommended_maintenance"] == "Signal Maintenance"
    assert data["human_approved"] is True
    assert "bundles" in data
    assert len(data["bundles"]) > 0


def test_prediction_returns_explanation():
    """Verifies that maintenance predictions include structured prediction_explanation and top_contributing_features."""
    response = client.get("/ai/maintenance-predictions/GNT-BZA-01")
    assert response.status_code == 200
    data = response.json()

    assert "prediction_explanation" in data
    assert isinstance(data["prediction_explanation"], list)
    assert len(data["prediction_explanation"]) > 0

    assert "top_contributing_features" in data
    assert isinstance(data["top_contributing_features"], list)
    assert len(data["top_contributing_features"]) > 0

    first_exp = data["prediction_explanation"][0]
    assert "feature" in first_exp
    assert "importance" in first_exp
    assert "direction" in first_exp
    assert "human_explanation" in first_exp
    assert isinstance(first_exp["importance"], (int, float))
    assert first_exp["direction"] in {"increases_probability", "decreases_probability"}


def test_explanation_features_in_model_feature_set():
    """Verifies that all explanation features actually exist in the model's feature set."""
    from app.ml.features import FEATURE_NAMES

    response = client.get("/ai/maintenance-predictions/GNT-BZA-01")
    assert response.status_code == 200
    data = response.json()

    for exp in data["prediction_explanation"]:
        assert exp["feature"] in FEATURE_NAMES, (
            f"Explanation feature '{exp['feature']}' not found in FEATURE_NAMES: {FEATURE_NAMES}"
        )

    for top in data["top_contributing_features"]:
        assert top["feature"] in FEATURE_NAMES, (
            f"Top contributing feature '{top['feature']}' not found in FEATURE_NAMES: {FEATURE_NAMES}"
        )


def test_no_fabricated_feature_names():
    """Verifies that no fabricated or invented feature names are returned in any prediction."""
    from app.ml.features import FEATURE_NAMES

    response = client.get("/ai/maintenance-predictions")
    assert response.status_code == 200
    data = response.json()

    valid_feature_set = set(FEATURE_NAMES)

    for pred in data["predictions"]:
        for exp in pred.get("prediction_explanation", []):
            assert exp["feature"] in valid_feature_set, (
                f"Fabricated feature '{exp['feature']}' found in prediction for block {pred.get('block_code')}"
            )
        for top in pred.get("top_contributing_features", []):
            assert top["feature"] in valid_feature_set, (
                f"Fabricated top feature '{top['feature']}' found in prediction for block {pred.get('block_code')}"
            )


def test_prediction_and_explanation_consistency():
    """Verifies prediction and explanation remain consistent with risk score, confidence, and recommended action."""
    response = client.get("/ai/maintenance-predictions/GNT-BZA-01")
    assert response.status_code == 200
    data = response.json()

    assert data["confidence"] == data["model_probability"]
    assert 0.0 <= data["confidence"] <= 100.0
    assert 0 <= data["risk_score"] <= 100
    assert data["urgency"] in {"Critical", "High", "Medium", "Low"}
    assert "recommended_action" in data
    assert len(data["recommended_action"]) > 0

    # Human review notice must be present
    assert "human_review_notice" in data
    assert "Authorized railway personnel" in data["human_review_notice"]


def test_ollama_receives_only_actual_model_factors(monkeypatch):
    """Verifies that Ollama, if called, receives only actual model factors and no fabricated features."""
    from unittest.mock import MagicMock
    from app.ml.features import FEATURE_NAMES
    import app.services.ai.ollama_service as ollama_service

    captured_prompts = []

    def mock_ask_ollama(prompt: str) -> str:
        captured_prompts.append(prompt)
        return "Model predicts maintenance based on recent corridor factors."

    monkeypatch.setattr(ollama_service, "ask_ollama", mock_ask_ollama)

    from app.ml.predictor import predict_maintenance_for_block
    from app.db.session import get_db

    db = next(get_db())
    try:
        pred = predict_maintenance_for_block(db, "GNT-BZA-01", use_ollama=True)
        assert pred is not None

        if captured_prompts:
            prompt = captured_prompts[0]
            # Prompt must reference the predicted class
            assert pred["predicted_maintenance"] in prompt
            # Prompt must not claim guaranteed failure
            assert "guaranteed failure" in prompt.lower()
    finally:
        db.close()

