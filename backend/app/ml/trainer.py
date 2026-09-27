import os
from datetime import datetime, timezone
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support
from sklearn.model_selection import train_test_split

from app.ml.features import FEATURE_NAMES
from app.ml.synthetic_data import MAINTENANCE_CLASSES, generate_synthetic_training_data

ARTIFACT_DIR = os.path.join(os.path.dirname(__file__), "artifacts")
MODEL_PATH = os.path.join(ARTIFACT_DIR, "maintenance_predictor.joblib")
METRICS_PATH = os.path.join(ARTIFACT_DIR, "model_metrics.joblib")


_cached_model = None
_cached_metrics = None


def train_and_save_model(
    n_samples: int = 1200,
    random_state: int = 42,
) -> dict:
    """
    Trains the supervised RandomForestClassifier, computes evaluation metrics
    on a held-out 20% test set, and persists the model artifact.
    """
    global _cached_model, _cached_metrics
    os.makedirs(ARTIFACT_DIR, exist_ok=True)

    # 1. Generate synthetic operational dataset
    x_df, y_s = generate_synthetic_training_data(
        n_samples=n_samples,
        random_state=random_state,
    )

    # 2. Train-test split (80/20 stratified)
    x_train, x_test, y_train, y_test = train_test_split(
        x_df,
        y_s,
        test_size=0.20,
        random_state=random_state,
        stratify=y_s,
    )

    # 3. Supervised Model: RandomForestClassifier
    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=12,
        min_samples_split=4,
        random_state=random_state,
        class_weight="balanced",
    )
    model.fit(x_train, y_train)

    # 4. Evaluation on test set
    y_pred = model.predict(x_test)

    accuracy = float(accuracy_score(y_test, y_pred))
    precision_w, recall_w, f1_w, _ = precision_recall_fscore_support(
        y_test, y_pred, average="weighted", zero_division=0
    )
    precision_m, recall_m, f1_m, _ = precision_recall_fscore_support(
        y_test, y_pred, average="macro", zero_division=0
    )

    cm = confusion_matrix(y_test, y_pred, labels=model.classes_).tolist()

    # 5. Feature importances
    importances = {
        name: round(float(imp), 4)
        for name, imp in zip(FEATURE_NAMES, model.feature_importances_)
    }

    metrics = {
        "model_name": "RandomForestClassifier",
        "model_version": "1.0.0",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "total_samples": n_samples,
        "train_samples": len(x_train),
        "test_samples": len(x_test),
        "classes": list(model.classes_),
        "accuracy": round(accuracy, 4),
        "precision_weighted": round(float(precision_w), 4),
        "recall_weighted": round(float(recall_w), 4),
        "f1_weighted": round(float(f1_w), 4),
        "precision_macro": round(float(precision_m), 4),
        "recall_macro": round(float(recall_m), 4),
        "f1_macro": round(float(f1_m), 4),
        "confusion_matrix": cm,
        "feature_importances": importances,
        "is_synthetic_training_data": True,
        "disclosure": "Trained on synthetic operational demo data anchored to real Indian Railways block topology.",
    }

    # 6. Persist artifacts
    joblib.dump(model, MODEL_PATH)
    joblib.dump(metrics, METRICS_PATH)
    _cached_model = model
    _cached_metrics = metrics

    return metrics


def get_model_metrics() -> dict:
    """
    Returns stored evaluation metrics or trains the model if artifact does not exist yet.
    """
    global _cached_metrics
    if _cached_metrics is not None:
        return _cached_metrics

    if os.path.exists(METRICS_PATH):
        try:
            _cached_metrics = joblib.load(METRICS_PATH)
            return _cached_metrics
        except Exception:
            pass
    return train_and_save_model()


def load_trained_model() -> tuple[RandomForestClassifier, dict]:
    """
    Loads or trains the model and returns (model, metrics).
    """
    global _cached_model, _cached_metrics
    if _cached_model is not None and _cached_metrics is not None:
        return _cached_model, _cached_metrics

    if os.path.exists(MODEL_PATH) and os.path.exists(METRICS_PATH):
        try:
            _cached_model = joblib.load(MODEL_PATH)
            _cached_metrics = joblib.load(METRICS_PATH)
            return _cached_model, _cached_metrics
        except Exception:
            pass

    _cached_metrics = train_and_save_model()
    _cached_model = joblib.load(MODEL_PATH)
    return _cached_model, _cached_metrics

