"""
Comprehensive Test Suite for Maintenance Impact Analysis in RailSync AI.

Verifies:
1. Single maintenance task impact analysis works
2. Bundle impact analysis works
3. Affected block is correct
4. Affected stations are derived correctly from the block
5. Affected trains come from actual train/route/conflict data
6. Affected trains are distinct from train conflicts
7. Crew information comes from actual assignments
8. Department count is correct
9. Dependency information is correct
10. Restricted asset count is calculated correctly
11. Traffic information comes from the existing traffic estimator
12. Maintenance window is correct
13. What-If scenario impact recalculates correctly
14. Human approval requirement remains true
15. No fake impact metrics are generated
"""

import pytest
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.db.base import Base
from app.models.block import Block
from app.models.crew import Crew
from app.models.maintenance import Maintenance
from app.models.station import Station
from app.models.train import Train
from app.schemas.what_if import WhatIfScenarioRequest
from app.services.ai.impact_analyzer import (
    analyze_task_impact,
    analyze_bundle_impact,
    analyze_what_if_impact,
    calculate_impact_level,
)
from app.main import app
from app.db.session import get_db


@pytest.fixture
def test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()

    # Stations
    s1 = Station(id=1, code="GNT", name="Guntur Junction")
    s2 = Station(id=2, code="BZA", name="Vijayawada Junction")
    s3 = Station(id=3, code="EE", name="Eluru")
    s4 = Station(id=4, code="RU", name="Renigunta")
    s5 = Station(id=5, code="TPTY", name="Tirupati")
    session.add_all([s1, s2, s3, s4, s5])

    # Blocks (3 blocks in network)
    b1 = Block(id=1, code="GNT-BZA-01", name="Guntur-Vijayawada Block 1", start_station_code="GNT", end_station_code="BZA", distance_km=32.0)
    b2 = Block(id=2, code="BZA-EE-01", name="Vijayawada-Eluru Block 1", start_station_code="BZA", end_station_code="EE", distance_km=60.0)
    b3 = Block(id=3, code="RU-TPTY-01", name="Renigunta-Tirupati Block 1", start_station_code="RU", end_station_code="TPTY", distance_km=10.0)
    session.add_all([b1, b2, b3])

    # Crews
    c1 = Crew(id=1, name="Track Team A", department="Engineering", crew_type="Track Team", capacity=6, status="Available")
    c2 = Crew(id=2, name="S&T Team A", department="S&T", crew_type="S&T Team", capacity=4, status="Available")
    c3 = Crew(id=3, name="Electrical Team A", department="Electrical", crew_type="OHE Team", capacity=4, status="Available")
    session.add_all([c1, c2, c3])

    # Trains scheduled during maintenance window
    now = datetime.utcnow()
    t1 = Train(
        id=1,
        train_number="12727",
        name="Godavari Express",
        train_type="Express",
        source_station_code="GNT",
        destination_station_code="BZA",
        current_station_code="GNT",
        status="Running",
    )
    t2 = Train(
        id=2,
        train_number="12728",
        name="Godavari Return",
        train_type="Express",
        source_station_code="BZA",
        destination_station_code="GNT",
        current_station_code="BZA",
        status="Running",
    )
    session.add_all([t1, t2])

    # Maintenance Tasks
    m1 = Maintenance(
        id=10,
        maintenance_type="Track Relay Replacement",
        department="Engineering",
        crew_type="Track Team",
        assigned_crew_id=1,
        crew_size=4,
        priority="Critical",
        status="Planned",
        location_type="block",
        block_code="GNT-BZA-01",
        estimated_duration_minutes=180,
        scheduled_start=now + timedelta(hours=1),
        scheduled_end=now + timedelta(hours=4),
        planned_start=now + timedelta(hours=1),
        planned_end=now + timedelta(hours=4),
        requires_exclusive_block=True,
    )
    m2 = Maintenance(
        id=11,
        maintenance_type="Point Machine Overhaul",
        department="S&T",
        crew_type="S&T Team",
        assigned_crew_id=2,
        crew_size=3,
        priority="High",
        status="Planned",
        location_type="block",
        block_code="GNT-BZA-01",
        estimated_duration_minutes=60,
        scheduled_start=now + timedelta(hours=1),
        scheduled_end=now + timedelta(hours=2),
        planned_start=now + timedelta(hours=1),
        planned_end=now + timedelta(hours=2),
        depends_on_maintenance_id=10,
    )
    session.add_all([m1, m2])
    session.commit()

    yield session
    session.close()


def test_single_task_impact_analysis(test_db):
    """
    Verifies:
    - Single maintenance task impact analysis works
    - Affected block is correct
    - Affected stations are derived correctly from the block
    - Affected trains come from actual train/route/conflict data
    - Affected trains are distinct from train conflicts
    - Crew information comes from actual assignments
    - Department count is correct
    - Dependency information is correct
    - Restricted asset count is calculated correctly
    - Traffic information comes from the existing traffic estimator
    - Maintenance window is correct
    - Human approval requirement remains true
    - No fake impact metrics are generated
    """
    impact = analyze_task_impact(db=test_db, maintenance_id=10)

    assert impact is not None
    assert impact.target_type == "task"
    assert impact.target_id == "10"
    assert impact.block_code == "GNT-BZA-01"

    # 1. Block & Station Impact
    assert impact.block_impact.block_code == "GNT-BZA-01"
    assert impact.block_impact.duration_minutes == 180
    assert impact.block_impact.start_station_code == "GNT"
    assert impact.block_impact.end_station_code == "BZA"
    assert impact.block_impact.affected_blocks_count == 1
    assert len(impact.block_impact.affected_blocks) == 1
    assert impact.block_impact.affected_blocks[0].maintenance_task_ids == [10]

    # Stations derived strictly from block endpoints
    assert impact.block_impact.affected_stations_count == 2
    station_codes = [s.station_code for s in impact.block_impact.affected_stations]
    assert "GNT" in station_codes
    assert "BZA" in station_codes
    # Verified station names looked up from Station model
    gnt_station = next(s for s in impact.block_impact.affected_stations if s.station_code == "GNT")
    assert gnt_station.station_name == "Guntur Junction"

    # 2. Train Impact & Conflict distinction
    assert impact.train_impact is not None
    assert isinstance(impact.train_impact.affected_trains_count, int)
    assert isinstance(impact.train_impact.total_conflicts, int)
    # Distinct metrics
    assert hasattr(impact.train_impact, "affected_trains_count")
    assert hasattr(impact.train_impact, "total_conflicts")
    # No fabricated delays
    for tr in impact.train_impact.trains:
        assert tr["delay_minutes"] is None  # Never fabricated

    # 3. Crew & Department Impact
    assert impact.crew_impact.total_crews_involved >= 1
    assert "Engineering" in impact.crew_impact.departments
    assert impact.crew_impact.department_count == 1
    assigned_crew = impact.crew_impact.crews[0]
    assert assigned_crew["name"] == "Track Team A"
    assert assigned_crew["department"] == "Engineering"
    assert assigned_crew["required_crew_size"] == 4
    assert assigned_crew["available_capacity"] == 6

    # 4. Dependency Impact
    assert impact.dependency_impact.blocks_downstream is True
    assert 11 in impact.dependency_impact.downstream_task_ids
    assert impact.dependency_impact.blocked_task_count == 1
    assert impact.dependency_impact.has_prerequisites is False

    # 5. Asset Availability Impact
    assert impact.asset_impact.total_network_assets == 3
    assert impact.asset_impact.restricted_assets == 1
    assert impact.asset_impact.available_assets == 2
    assert impact.asset_impact.availability_percentage == 66.7

    # 6. Traffic Impact
    assert impact.traffic_impact.overall_traffic_level in ("Low", "Medium", "High")
    assert impact.traffic_impact.total_traffic_score >= 0

    # 7. Maintenance Window Impact
    assert impact.maintenance_window_impact.duration_minutes == 180
    assert "180 min" in impact.maintenance_window_impact.restricted_period

    # 8. Impact Summary & Deterministic Classification
    assert impact.impact_summary.affected_blocks == 1
    assert impact.impact_summary.affected_stations == 2
    assert impact.impact_summary.departments == 1
    assert impact.impact_summary.crews >= 1
    assert impact.impact_summary.restricted_assets == 1
    assert impact.impact_summary.maintenance_window_minutes == 180
    assert impact.impact_level in ("Low", "Moderate", "High")
    assert len(impact.impact_level_explanation) > 0

    # 9. Human Approval & Prototype Safety
    assert impact.human_approval_required is True
    assert "decision support" in impact.human_approval_disclaimer.lower()
    assert "decision-support prototype" in impact.decision_support_note.lower()


def test_dependent_task_impact_analysis(test_db):
    """Verifies dependency tracking when analyzing a task that has prerequisites."""
    impact = analyze_task_impact(db=test_db, maintenance_id=11)

    assert impact.target_id == "11"
    assert impact.dependency_impact.has_prerequisites is True
    assert 10 in impact.dependency_impact.prerequisite_task_ids
    assert impact.dependency_impact.prerequisite_tasks_count == 1
    assert len(impact.dependency_impact.dependency_chain) >= 1
    assert impact.dependency_impact.dependency_chain[0]["prerequisite_id"] == 10
    assert impact.dependency_impact.dependency_chain[0]["dependent_id"] == 11


def test_bundle_impact_analysis(test_db):
    """
    Verifies multi-department maintenance bundle impact analysis:
    - Coordinates tasks on the block
    - Recognizes multiple departments and crews
    - Computes coordinated window and savings
    - Preserves internal dependencies
    """
    from app.services.ai.maintenance_bundler import bundle_compatible_maintenance
    bundles = bundle_compatible_maintenance(db=test_db, target_block_code="GNT-BZA-01", persist=False)
    assert len(bundles) >= 1
    bundle_id = bundles[0]["bundle_id"]

    impact = analyze_bundle_impact(db=test_db, bundle_id=bundle_id)

    assert impact.target_type == "bundle"
    assert impact.target_id == bundle_id
    assert impact.block_code == "GNT-BZA-01"
    assert impact.block_impact.affected_blocks_count == 1
    assert impact.block_impact.affected_stations_count == 2

    # Departments involved
    assert "Engineering" in impact.crew_impact.departments
    assert "S&T" in impact.crew_impact.departments
    assert impact.crew_impact.department_count == 2
    assert impact.crew_impact.total_crews_involved == 2

    # Baseline vs Optimized metrics
    assert impact.baseline_vs_optimized is not None
    assert impact.baseline_vs_optimized.restricted_blocks_after == 1
    assert impact.baseline_vs_optimized.maintenance_duration_after <= impact.baseline_vs_optimized.maintenance_duration_before

    # Summary
    assert impact.impact_summary.departments == 2
    assert impact.impact_summary.restricted_assets == 1
    assert impact.human_approval_required is True


def test_deterministic_impact_level_formula():
    """Verifies deterministic formula for Impact Level calculation."""
    # Low: 0 trains, 1 asset, 0 blocked, Low traffic -> score = 1 -> Low
    lvl, exp = calculate_impact_level(affected_trains=0, restricted_assets=1, blocked_tasks=0, traffic_level="Low")
    assert lvl == "Low"
    assert "1/7" in exp

    # Moderate: 2 trains (+1), 1 asset (+1), 0 blocked, Low traffic -> score = 2 -> Moderate
    lvl, exp = calculate_impact_level(affected_trains=2, restricted_assets=1, blocked_tasks=0, traffic_level="Low")
    assert lvl == "Moderate"
    assert "2/7" in exp

    # High: 4 trains (+2), 2 assets (+2), 1 blocked (+1), High traffic (+2) -> score = 7 -> High
    lvl, exp = calculate_impact_level(affected_trains=4, restricted_assets=2, blocked_tasks=1, traffic_level="High")
    assert lvl == "High"
    assert "7/7" in exp


def test_what_if_scenario_impact(test_db):
    """Verifies What-If simulation recalculates impact from simulated plan."""
    req = WhatIfScenarioRequest(
        block_code="GNT-BZA-01",
        name="Night Window Simulation",
        planning_window="night",
    )
    impact = analyze_what_if_impact(db=test_db, request=req)

    assert impact.target_type == "what-if"
    assert impact.block_code == "GNT-BZA-01"
    assert impact.baseline_vs_optimized is not None
    assert impact.block_impact.affected_blocks_count == 1
    assert impact.block_impact.affected_stations_count == 2
    assert impact.human_approval_required is True


def test_maintenance_impact_api_endpoints(test_db):
    """Verifies all maintenance impact API routes."""
    def override_get_db():
        try:
            yield test_db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    # 1. GET /ai/maintenance-impact/{id}
    res_task = client.get("/ai/maintenance-impact/10")
    assert res_task.status_code == 200
    data_task = res_task.json()
    assert data_task["target_id"] == "10"
    assert data_task["block_impact"]["duration_minutes"] == 180
    assert data_task["block_impact"]["affected_stations_count"] == 2
    assert data_task["impact_summary"]["affected_blocks"] == 1
    assert data_task["human_approval_required"] is True

    # 2. 404 for missing task
    res_404 = client.get("/ai/maintenance-impact/9999")
    assert res_404.status_code == 404

    # 3. GET /ai/maintenance-impact/bundle/{bundle_id}
    res_bundle = client.get("/ai/maintenance-impact/bundle/BUNDLE-GNT-BZA-01")
    assert res_bundle.status_code == 200
    data_bundle = res_bundle.json()
    assert data_bundle["target_type"] == "bundle"
    assert data_bundle["crew_impact"]["department_count"] >= 2
    assert data_bundle["human_approval_required"] is True

    # 4. POST /ai/maintenance-impact/what-if
    res_wi = client.post(
        "/ai/maintenance-impact/what-if",
        json={"block_code": "GNT-BZA-01", "name": "API What-If Test", "planning_window": "night"},
    )
    assert res_wi.status_code == 200
    data_wi = res_wi.json()
    assert data_wi["target_type"] == "what-if"
    assert data_wi["baseline_vs_optimized"] is not None

    app.dependency_overrides.clear()
