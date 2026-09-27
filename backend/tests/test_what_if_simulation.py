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
from app.schemas.what_if import (
    TaskOverride,
    WhatIfApplyRequest,
    WhatIfScenarioRequest,
)
from app.services.ai.what_if_simulator import (
    apply_simulated_plan,
    run_what_if_simulation,
)
from app.main import app
from app.db.session import get_db


@pytest.fixture
def in_memory_db():
    """Create an isolated in-memory SQLite database with schema and default seed data."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()

    # Seed crews
    crews = [
        Crew(id=1, name="Electrical Team A", crew_type="Electrical Team", department="Electrical", capacity=4, status="Available"),
        Crew(id=2, name="S&T Team A", crew_type="S&T Team", department="S&T", capacity=3, status="Available"),
        Crew(id=3, name="Track Team A", crew_type="Track Team", department="Engineering", capacity=6, status="Available"),
        Crew(id=4, name="Electrical Team B", crew_type="Electrical Team", department="Electrical", capacity=4, status="Available"),
        Crew(id=5, name="S&T Team B", crew_type="S&T Team", department="S&T", capacity=3, status="Available"),
        Crew(id=6, name="Track Team B", crew_type="Track Team", department="Engineering", capacity=6, status="Available"),
    ]
    session.add_all(crews)

    # Seed block
    block = Block(
        id=1,
        code="GNT-BZA-01",
        name="Guntur - Vijayawada Block 1",
        start_station_code="GNT",
        end_station_code="BZA",
        distance_km=32.5,
    )
    session.add(block)

    # Seed maintenance tasks
    t1 = Maintenance(
        id=101,
        maintenance_type="Electrical Inspection",
        department="Electrical",
        crew_type="Electrical Team",
        priority="Critical",
        status="Planned",
        location_type="block",
        block_code="GNT-BZA-01",
        estimated_duration_minutes=60,
        execution_mode="sequential",
        sequence_order=1,
    )
    t2 = Maintenance(
        id=102,
        maintenance_type="Signal Maintenance",
        department="S&T",
        crew_type="S&T Team",
        priority="High",
        status="Planned",
        location_type="block",
        block_code="GNT-BZA-01",
        estimated_duration_minutes=45,
        execution_mode="sequential",
        sequence_order=2,
        depends_on_maintenance_id=101,
    )
    t3 = Maintenance(
        id=103,
        maintenance_type="Track Repair",
        department="Engineering",
        crew_type="Track Team",
        priority="Medium",
        status="Planned",
        location_type="block",
        block_code="GNT-BZA-01",
        estimated_duration_minutes=90,
        execution_mode="parallel",
        sequence_order=1,
    )
    session.add_all([t1, t2, t3])
    session.commit()

    try:
        yield session
    finally:
        session.close()


def test_what_if_baseline_simulation_no_db_mutation(in_memory_db):
    """Verifies that running a what-if simulation does not mutate live DB records."""
    req = WhatIfScenarioRequest(
        block_code="GNT-BZA-01",
        name="Test Simulation",
        planning_window="night",
    )

    resp = run_what_if_simulation(in_memory_db, req)

    assert resp.feasible is True
    assert resp.optimization_status in ("OPTIMAL", "FEASIBLE")
    assert resp.baseline is not None
    assert resp.what_if is not None
    assert resp.impact is not None
    assert len(resp.baseline.tasks) == 3
    assert len(resp.what_if.tasks) == 3

    # CRITICAL: Verify DB records are untouched
    for tid in [101, 102, 103]:
        db_rec = in_memory_db.get(Maintenance, tid)
        assert db_rec.status == "Planned"
        assert db_rec.bundle_id is None
        assert db_rec.bundled is False or db_rec.bundled is None


def test_what_if_window_shift(in_memory_db):
    """Verifies shifting maintenance window changes start time and reports timing impact."""
    req = WhatIfScenarioRequest(
        block_code="GNT-BZA-01",
        name="Shift Window",
        start_time="23:30",
        planning_window="night",
    )

    resp = run_what_if_simulation(in_memory_db, req)
    assert resp.feasible is True
    assert "23:30" in resp.what_if.start_time
    assert resp.impact.task_timing_changes is not None


def test_what_if_task_delay(in_memory_db):
    """Verifies that delaying a task enforces its minimum start minute."""
    req = WhatIfScenarioRequest(
        block_code="GNT-BZA-01",
        name="Delay Track Repair",
        task_overrides=[
            TaskOverride(task_id=103, delay_minutes=30),
        ],
    )

    resp = run_what_if_simulation(in_memory_db, req)
    assert resp.feasible is True

    t3_sim = next(t for t in resp.what_if.tasks if t["id"] == 103)
    assert t3_sim["start_minute"] >= 30


def test_what_if_task_duration_change(in_memory_db):
    """Verifies that changing task duration updates the plan span and metrics."""
    req = WhatIfScenarioRequest(
        block_code="GNT-BZA-01",
        name="Extend Track Repair",
        task_overrides=[
            TaskOverride(task_id=103, duration_minutes=150),
        ],
    )

    resp = run_what_if_simulation(in_memory_db, req)
    assert resp.feasible is True

    t3_sim = next(t for t in resp.what_if.tasks if t["id"] == 103)
    assert t3_sim["duration_minutes"] == 150
    assert resp.what_if.unbundled_total_minutes == 60 + 45 + 150


def test_what_if_crew_override(in_memory_db):
    """Verifies overriding a task's crew assignment reflects in the what-if plan and impact."""
    # Baseline assigned task 101 to Crew 4 (Electrical Team B); override to Crew 1 (Electrical Team A)
    req = WhatIfScenarioRequest(
        block_code="GNT-BZA-01",
        name="Switch to Team A",
        task_overrides=[
            TaskOverride(task_id=101, crew_id=1),
        ],
    )

    resp = run_what_if_simulation(in_memory_db, req)
    assert resp.feasible is True

    t1_sim = next(t for t in resp.what_if.tasks if t["id"] == 101)
    assert t1_sim["assigned_crew_id"] == 1
    assert t1_sim["assigned_crew_name"] == "Electrical Team A"

    # Check that crew change is recorded in impact metrics
    crew_changes = resp.impact.crew_changes
    assert any(c["task_id"] == 101 and c["what_if_crew"] == "Electrical Team A" for c in crew_changes)


def test_what_if_bundle_vs_separate(in_memory_db):
    """Verifies separating a task creates independent execution and increases closure count."""
    req = WhatIfScenarioRequest(
        block_code="GNT-BZA-01",
        name="Unbundle Track Work",
        task_overrides=[
            TaskOverride(task_id=103, bundled=False),
        ],
    )

    resp = run_what_if_simulation(in_memory_db, req)
    assert resp.feasible is True
    assert resp.what_if.bundle_count > 1
    assert resp.what_if.block_closures > 1

    t3_sim = next(t for t in resp.what_if.tasks if t["id"] == 103)
    assert t3_sim["bundle_role"] == "separate"


def test_what_if_infeasible_scenario(in_memory_db):
    """Verifies that an infeasible scenario returns structured infeasibility without crashing."""
    # Delay exceeds max horizon (e.g. 5000 minutes)
    req = WhatIfScenarioRequest(
        block_code="GNT-BZA-01",
        name="Impossible Delay",
        task_overrides=[
            TaskOverride(task_id=101, delay_minutes=5000),
        ],
    )

    resp = run_what_if_simulation(in_memory_db, req)
    assert resp.feasible is False
    assert resp.optimization_status in ("INFEASIBLE", "MODEL_INVALID", "UNKNOWN")
    assert resp.infeasibility_reason is not None
    assert resp.what_if is None


def test_what_if_apply_requires_human_approval(in_memory_db):
    """Verifies that applying a simulated plan without human approval raises HTTP 400."""
    from fastapi import HTTPException

    req = WhatIfApplyRequest(
        block_code="GNT-BZA-01",
        scenario_id="SIM-TEST01",
        human_approved=False,
    )

    with pytest.raises(HTTPException) as exc_info:
        apply_simulated_plan(in_memory_db, req)

    assert exc_info.value.status_code == 400
    assert "Human approval is required" in exc_info.value.detail


def test_what_if_apply_plan_success(in_memory_db):
    """Verifies applying a plan with human approval updates DB records with audit info."""
    req = WhatIfApplyRequest(
        block_code="GNT-BZA-01",
        scenario_id="SIM-TEST02",
        human_approved=True,
        approved_by="Chief Controller Sharma",
        notes="Approved for midnight execution",
    )

    result = apply_simulated_plan(in_memory_db, req)
    assert result["human_approved"] is True
    assert result["approved_by"] == "Chief Controller Sharma"
    assert result["updated_records_count"] == 3

    # Check DB records
    for tid in [101, 102, 103]:
        db_rec = in_memory_db.get(Maintenance, tid)
        assert db_rec.status == "Scheduled"
        assert db_rec.bundle_id == "APPLIED-SIM-TEST02"
        assert "Chief Controller Sharma" in db_rec.dependency_note


def test_what_if_api_endpoint(in_memory_db):
    """Verifies the HTTP POST /ai/maintenance-what-if endpoint works via TestClient."""
    app.dependency_overrides[get_db] = lambda: in_memory_db
    client = TestClient(app)

    try:
        response = client.post(
            "/ai/maintenance-what-if",
            json={
                "block_code": "GNT-BZA-01",
                "name": "API Test",
                "planning_window": "night",
                "task_overrides": [
                    {"task_id": 103, "delay_minutes": 15, "duration_minutes": 100}
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["feasible"] is True
        assert data["block_code"] == "GNT-BZA-01"
        assert data["baseline"]["total_window_minutes"] > 0
        assert data["what_if"]["total_window_minutes"] > 0
        assert data["impact"]["time_difference_minutes"] is not None

        # Test apply endpoint via HTTP
        apply_resp = client.post(
            "/ai/maintenance-what-if/apply",
            json={
                "block_code": "GNT-BZA-01",
                "scenario_id": data["scenario_id"],
                "human_approved": True,
                "approved_by": "Test Controller",
            },
        )
        assert apply_resp.status_code == 200
        apply_data = apply_resp.json()
        assert apply_data["human_approved"] is True
        assert apply_data["updated_records_count"] == 3

    finally:
        app.dependency_overrides.clear()
