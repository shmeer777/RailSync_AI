"""
Synthetic Training Data Generator for RailSync AI Predictive Maintenance Prototype.

DATA DISCLOSURE:
----------------
- REAL/PUBLIC STRUCTURAL DATA: Railway blocks, station codes, and physical distances
  are drawn directly from the RailSync AI database.
- SYNTHETIC DEMO/OPERATIONAL DATA: Historical failure patterns, operational stress,
  and maintenance requirement labels are synthetically generated for prototype
  training and evaluation. They do NOT represent proprietary Indian Railways
  incident or failure records.
"""

import numpy as np
import pandas as pd
from app.ml.features import FEATURE_NAMES

MAINTENANCE_CLASSES = [
    "Track Inspection",
    "Track Repair",
    "Track Maintenance",
    "Electrical Inspection",
    "Electrical Maintenance",
    "Signal Maintenance",
    "Signalling Equipment Maintenance",
    "Preventive Inspection",
    "No Immediate Maintenance",
]


def generate_synthetic_training_data(
    n_samples: int = 1200,
    random_state: int = 42,
) -> tuple[pd.DataFrame, pd.Series]:
    """
    Generates a reproducible synthetic dataset for supervised learning.
    Simulates operational patterns linking block features to the maintenance
    type most likely needed.
    """
    rng = np.random.default_rng(random_state)

    data = []
    labels = []

    for _ in range(n_samples):
        # Sample base operational features
        traffic_score = rng.uniform(0.0, 150.0)
        active_train_count = float(rng.integers(0, 10))
        train_conflict_count = float(rng.poisson(lam=1.5))
        past_maintenance_count = float(rng.integers(0, 15))
        days_since_last_maintenance = rng.uniform(5.0, 180.0)
        distance_km = rng.uniform(15.0, 120.0)

        # Department event distribution (Dirichlet distribution for simplex)
        dept_weights = rng.dirichlet(alpha=[1.5, 1.5, 1.5])
        signal_ratio = float(dept_weights[0])
        track_ratio = float(dept_weights[1])
        electrical_ratio = float(dept_weights[2])

        high_priority_ratio = rng.uniform(0.0, 0.8)
        avg_duration_minutes = rng.uniform(30.0, 240.0)

        operational_stress = (
            traffic_score * 0.35
            + train_conflict_count * 12.0
            + active_train_count * 5.0
            + (days_since_last_maintenance / 30.0) * 8.0
            + (1.0 if high_priority_ratio > 0.5 else 0.0) * 15.0
        )

        # Determine true label based on dominant operational risk pattern + noise
        noise = rng.uniform(-10.0, 10.0)
        effective_stress = operational_stress + noise

        if effective_stress < 25.0 and days_since_last_maintenance < 45.0:
            label = "No Immediate Maintenance"
        elif effective_stress < 40.0 and days_since_last_maintenance < 90.0:
            label = "Preventive Inspection"
        else:
            # High operational need: route to dominant department and severity
            max_dept = np.argmax([signal_ratio, track_ratio, electrical_ratio])

            if max_dept == 0:  # S&T
                if effective_stress > 65.0 or train_conflict_count >= 3:
                    label = "Signal Maintenance"
                else:
                    label = "Signalling Equipment Maintenance"
            elif max_dept == 1:  # Track
                if effective_stress > 75.0 or avg_duration_minutes > 120.0:
                    label = "Track Repair"
                elif effective_stress > 50.0:
                    label = "Track Maintenance"
                else:
                    label = "Track Inspection"
            else:  # Electrical
                if effective_stress > 60.0 or high_priority_ratio > 0.4:
                    label = "Electrical Inspection"
                else:
                    label = "Electrical Maintenance"

        row = {
            "traffic_score": round(traffic_score, 2),
            "active_train_count": active_train_count,
            "train_conflict_count": train_conflict_count,
            "past_maintenance_count": past_maintenance_count,
            "days_since_last_maintenance": round(days_since_last_maintenance, 1),
            "signal_event_ratio": round(signal_ratio, 3),
            "track_event_ratio": round(track_ratio, 3),
            "electrical_event_ratio": round(electrical_ratio, 3),
            "avg_duration_minutes": round(avg_duration_minutes, 1),
            "high_priority_ratio": round(high_priority_ratio, 3),
            "distance_km": round(distance_km, 1),
            "operational_stress_index": round(operational_stress, 2),
        }

        data.append(row)
        labels.append(label)

    df_x = pd.DataFrame(data, columns=FEATURE_NAMES)
    s_y = pd.Series(labels, name="predicted_maintenance")

    return df_x, s_y
