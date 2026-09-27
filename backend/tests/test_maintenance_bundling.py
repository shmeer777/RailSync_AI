import pytest
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.db.base import Base
from app.models.block import Block
from app.models.crew import Crew
from app.models.maintenance import Maintenance
from app.models.train import Train
from app.services.ai.maintenance_bundler import (
    bundle_compatible_maintenance,
    _optimize_block_bundle,
    _generate_bundle_explanation,
)
from app.services.ai.maintenance_compatibility import is_compatible, filter_compatible_tasks
from app.services.ai.traffic_estimator import get_block_train_traffic
from app.services.ai.block_planner import generate_block_plan
from app.main import app


@pytest.fixture
def in_memory_db():
    """Create an isolated in-memory SQLite database with schema and default crews."""
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()

    # Seed default crews
    crews = [
        Crew(id=1, name="Electrical Team A", crew_type="Electrical Team", department="Electrical", capacity=4, status="Available"),
        Crew(id=2, name="S&T Team A", crew_type="S&T Team", department="S&T", capacity=3, status="Available"),
        Crew(id=3, name="Track Team A", crew_type="Track Team", department="Engineering", capacity=6, status="Available"),
        Crew(id=4, name="Electrical Team B", crew_type="Electrical Team", department="Electrical", capacity=4, status="Available"),
        Crew(id=5, name="S&T Team B", crew_type="S&T Team", department="S&T", capacity=3, status="Available"),
        Crew(id=6, name="Track Team B", crew_type="Track Team", department="Engineering", capacity=6, status="Available"),
    ]
    session.add_all(crews)
    session.commit()

    try:
        yield session
    finally:
        session.close()


# 1. Same-block compatible tasks bundle
def test_same_block_compatible_tasks_bundle(in_memory_db):
    t1 = Maintenance(
        id=10, maintenance_type="Electrical Inspection", department="Electrical", crew_type="Electrical Team",
        priority="Critical", status="Planned", location_type="block", block_code="GNT-BZA-01",
        estimated_duration_minutes=60, execution_mode="sequential", sequence_order=1
    )
    t2 = Maintenance(
        id=2, maintenance_type="Track Repair", department="Engineering", crew_type="Track Team",
        priority="High", status="Planned", location_type="block", block_code="GNT-BZA-01",
        estimated_duration_minutes=60, execution_mode="parallel", sequence_order=1
    )
    in_memory_db.add_all([t1, t2])
    in_memory_db.commit()

    bundles = bundle_compatible_maintenance(in_memory_db, target_block_code="GNT-BZA-01")
    assert len(bundles) == 1
    assert bundles[0]["block_code"] == "GNT-BZA-01"
    assert bundles[0]["total_tasks"] == 2
    assert bundles[0]["time_saved_minutes"] == 60


# 2. Different-block tasks do not bundle
def test_different_block_tasks_do_not_bundle(in_memory_db):
    t1 = Maintenance(
        id=101, maintenance_type="Track Inspection", department="Engineering", crew_type="Track Team",
        priority="High", status="Planned", location_type="block", block_code="BLOCK-A",
        estimated_duration_minutes=60
    )
    t2 = Maintenance(
        id=102, maintenance_type="Signal Check", department="S&T", crew_type="S&T Team",
        priority="High", status="Planned", location_type="block", block_code="BLOCK-B",
        estimated_duration_minutes=45
    )
    in_memory_db.add_all([t1, t2])
    in_memory_db.commit()

    bundles = bundle_compatible_maintenance(in_memory_db)
    assert len(bundles) == 2
    bundle_blocks = {b["block_code"] for b in bundles}
    assert bundle_blocks == {"BLOCK-A", "BLOCK-B"}


# 3. Electrical -> Signal dependency is enforced
def test_electrical_to_signal_dependency_enforced():
    task_elec = Maintenance(
        id=10, maintenance_type="Electrical Inspection", department="Electrical", crew_type="Electrical Team",
        priority="Critical", status="Planned", location_type="block", block_code="GNT-BZA-01",
        estimated_duration_minutes=60, execution_mode="sequential", sequence_order=1
    )
    task_sig = Maintenance(
        id=12, maintenance_type="Signal Maintenance", department="S&T", crew_type="S&T Team",
        priority="High", status="Planned", location_type="block", block_code="GNT-BZA-01",
        estimated_duration_minutes=90, execution_mode="sequential", sequence_order=2,
        depends_on_maintenance_id=10,
    )

    bundle = _optimize_block_bundle("GNT-BZA-01", [task_elec, task_sig], None)
    assert bundle is not None
    tasks_by_id = {t["id"]: t for t in bundle["tasks"]}
    elec_res = tasks_by_id[10]
    sig_res = tasks_by_id[12]

    assert sig_res["start_minute"] >= elec_res["end_minute"]
    assert elec_res["bundle_role"] == "prerequisite"
    assert sig_res["bundle_role"] == "dependent"


# 4. Track can overlap Electrical when allowed
def test_track_can_overlap_electrical_when_allowed():
    task_elec = Maintenance(
        id=10, maintenance_type="Electrical Inspection", department="Electrical", crew_type="Electrical Team",
        priority="Critical", status="Planned", location_type="block", block_code="GNT-BZA-01",
        estimated_duration_minutes=60, execution_mode="sequential", sequence_order=1
    )
    task_track = Maintenance(
        id=2, maintenance_type="Track Repair", department="Engineering", crew_type="Track Team",
        priority="High", status="Planned", location_type="block", block_code="GNT-BZA-01",
        estimated_duration_minutes=60, execution_mode="parallel", sequence_order=1
    )
    task_sig = Maintenance(
        id=12, maintenance_type="Signal Maintenance", department="S&T", crew_type="S&T Team",
        priority="High", status="Planned", location_type="block", block_code="GNT-BZA-01",
        estimated_duration_minutes=90, execution_mode="sequential", sequence_order=2,
        depends_on_maintenance_id=10,
    )

    bundle = _optimize_block_bundle("GNT-BZA-01", [task_elec, task_sig, task_track], None)
    assert bundle is not None
    tasks_by_id = {t["id"]: t for t in bundle["tasks"]}
    elec_res = tasks_by_id[10]
    track_res = tasks_by_id[2]
    sig_res = tasks_by_id[12]

    # Track repair runs 0..60 concurrently with Electrical 0..60
    assert track_res["start_minute"] == 0
    assert track_res["end_minute"] == 60
    assert elec_res["start_minute"] == 0
    assert elec_res["end_minute"] == 60
    assert sig_res["start_minute"] >= 60
    assert bundle["total_window_minutes"] == 150
    assert bundle["time_saved_minutes"] == 60


# 5. Same crew cannot execute conflicting tasks simultaneously
def test_same_crew_cannot_execute_conflicting_tasks():
    crew = Crew(id=1, name="Track Team A", crew_type="Track Team", department="Engineering", capacity=6, status="Available")
    t1 = Maintenance(
        id=20, maintenance_type="Track Welding", department="Engineering", crew_type="Track Team",
        priority="High", status="Planned", location_type="block", block_code="BZA-01",
        estimated_duration_minutes=45, execution_mode="parallel"
    )
    t2 = Maintenance(
        id=21, maintenance_type="Track Fastening", department="Engineering", crew_type="Track Team",
        priority="Medium", status="Planned", location_type="block", block_code="BZA-01",
        estimated_duration_minutes=30, execution_mode="parallel"
    )

    bundle = _optimize_block_bundle("BZA-01", [t1, t2], None, available_crews=[crew])
    assert bundle is not None
    tasks_by_id = {t["id"]: t for t in bundle["tasks"]}
    t1_res = tasks_by_id[20]
    t2_res = tasks_by_id[21]

    # Non-overlap check
    assert (t1_res["end_minute"] <= t2_res["start_minute"]) or (t2_res["end_minute"] <= t1_res["start_minute"])
    assert bundle["total_window_minutes"] == 75


# 6. Crew capacity is respected
def test_crew_capacity_respected():
    # Crew has capacity 4. Task requires 6. Cannot assign this crew.
    small_crew = Crew(id=1, name="Small Crew", crew_type="Track Team", department="Engineering", capacity=4, status="Available")
    large_crew = Crew(id=2, name="Large Crew", crew_type="Track Team", department="Engineering", capacity=8, status="Available")

    task = Maintenance(
        id=30, maintenance_type="Heavy Track Work", department="Engineering", crew_type="Track Team",
        crew_size=6, priority="High", status="Planned", location_type="block", block_code="BZA-01",
        estimated_duration_minutes=60
    )

    bundle = _optimize_block_bundle("BZA-01", [task], None, available_crews=[small_crew, large_crew])
    assert bundle is not None
    task_res = bundle["tasks"][0]
    assert task_res["assigned_crew_id"] == 2
    assert task_res["assigned_crew_name"] == "Large Crew"
    assert task_res["available_capacity"] >= task_res["required_crew_size"]


# 7. Crew assignment is returned
def test_crew_assignment_returned(in_memory_db):
    task_elec = Maintenance(
        id=10, maintenance_type="Electrical Inspection", department="Electrical", crew_type="Electrical Team",
        crew_size=2, priority="Critical", status="Planned", location_type="block", block_code="GNT-BZA-01",
        estimated_duration_minutes=60
    )
    in_memory_db.add(task_elec)
    in_memory_db.commit()

    bundles = bundle_compatible_maintenance(in_memory_db, target_block_code="GNT-BZA-01")
    assert len(bundles) == 1
    task_res = bundles[0]["tasks"][0]
    assert task_res["assigned_crew_id"] is not None
    assert task_res["assigned_crew_name"] is not None
    assert task_res["assigned_crew_type"] == "Electrical Team"
    assert task_res["required_crew_size"] == 2
    assert task_res["available_capacity"] >= 2


# 8. Critical task can reprioritize the crew queue
def test_critical_task_can_reprioritize_crew_queue():
    crew = Crew(id=1, name="Electrical Team A", crew_type="Electrical Team", department="Electrical", capacity=4, status="Available")

    # Routine task originally sequence_order=1, Critical prerequisite originally sequence_order=2
    t_routine = Maintenance(
        id=40, maintenance_type="Routine Lighting Check", department="Electrical", crew_type="Electrical Team",
        priority="Low", status="Planned", location_type="block", block_code="GNT-BZA-01",
        estimated_duration_minutes=40, sequence_order=1
    )
    t_critical = Maintenance(
        id=41, maintenance_type="Critical OHE Inspection", department="Electrical", crew_type="Electrical Team",
        priority="Critical", status="Planned", location_type="block", block_code="GNT-BZA-01",
        estimated_duration_minutes=60, sequence_order=2
    )
    t_dependent = Maintenance(
        id=42, maintenance_type="Signal Interlock", department="S&T", crew_type="S&T Team",
        priority="High", status="Planned", location_type="block", block_code="GNT-BZA-01",
        estimated_duration_minutes=60, sequence_order=3, depends_on_maintenance_id=41
    )

    bundle = _optimize_block_bundle("GNT-BZA-01", [t_routine, t_critical, t_dependent], None, available_crews=[crew])
    assert bundle is not None
    tasks_by_id = {t["id"]: t for t in bundle["tasks"]}
    crit_res = tasks_by_id[41]

    # Critical task is scheduled at minute 0 ahead of routine work
    assert crit_res["start_minute"] == 0
    assert crit_res["priority_override"] is True
    assert "temporarily prioritized" in crit_res["override_reason"]


# 9. Routine maintenance prefers lower-traffic windows
def test_routine_maintenance_prefers_lower_traffic():
    # Slot 0 has high traffic (score 10), slot 2 has 0 traffic
    traffic_info = {
        "slot_traffic": [10, 8, 0, 0, 0, 0, 0, 0],
        "total_trains_count": 4,
        "total_traffic_score": 18,
        "overall_traffic_level": "High",
    }
    t_routine = Maintenance(
        id=50, maintenance_type="Routine Track Oiling", department="Engineering", crew_type="Track Team",
        priority="Low", status="Planned", location_type="block", block_code="TEST-01",
        estimated_duration_minutes=30
    )

    bundle = _optimize_block_bundle("TEST-01", [t_routine], None, traffic_info=traffic_info)
    assert bundle is not None
    task_res = bundle["tasks"][0]
    # Routine task is shifted away from slot 0 (0..30 min) to a lower-traffic slot
    assert task_res["start_minute"] >= 30


# 10. Critical maintenance is not delayed simply because another window has lower traffic
def test_critical_maintenance_not_delayed_by_traffic():
    traffic_info = {
        "slot_traffic": [10, 8, 0, 0, 0, 0, 0, 0],
        "total_trains_count": 4,
        "total_traffic_score": 18,
        "overall_traffic_level": "High",
    }
    t_critical = Maintenance(
        id=51, maintenance_type="Emergency Rail Inspection", department="Engineering", crew_type="Track Team",
        priority="Critical", status="Planned", location_type="block", block_code="TEST-01",
        estimated_duration_minutes=30
    )

    bundle = _optimize_block_bundle("TEST-01", [t_critical], None, traffic_info=traffic_info)
    assert bundle is not None
    task_res = bundle["tasks"][0]
    # Critical maintenance starts immediately at minute 0 despite traffic score
    assert task_res["start_minute"] == 0


# 11. Incompatible tasks are not bundled
def test_incompatible_tasks_not_bundled():
    t_ballast = Maintenance(
        id=60, maintenance_type="Track Ballast Cleaning", department="Engineering", crew_type="Track Team",
        priority="High", status="Planned", location_type="block", block_code="BLK-01",
        estimated_duration_minutes=60
    )
    t_ohe = Maintenance(
        id=61, maintenance_type="OHE High Voltage Energization", department="Electrical", crew_type="Electrical Team",
        priority="High", status="Planned", location_type="block", block_code="BLK-01",
        estimated_duration_minutes=60
    )

    compat, reason = is_compatible(t_ballast, t_ohe)
    assert compat is False
    assert "Safety constraint" in reason

    compatible, incompatible = filter_compatible_tasks([t_ballast, t_ohe])
    assert len(incompatible) > 0


# 12. Optimization result comes from actual CP-SAT status
def test_optimization_status_is_real():
    t1 = Maintenance(
        id=70, maintenance_type="Track Check", department="Engineering", crew_type="Track Team",
        priority="Medium", status="Planned", location_type="block", block_code="BLK-02",
        estimated_duration_minutes=30
    )
    bundle = _optimize_block_bundle("BLK-02", [t1], None)
    assert bundle is not None
    assert bundle["optimization_status"] in ("OPTIMAL", "FEASIBLE")


# 13. Existing route-aware train block planning still works
def test_route_aware_block_planning_still_works(in_memory_db):
    b1 = Block(id=1, code="STNA-STNB-01", name="Block A-B", start_station_code="STNA", end_station_code="STNB", distance_km=25.0)
    train1 = Train(id=1, train_number="T101", name="Express 1", train_type="Express", source_station_code="STNA", destination_station_code="STNB", current_station_code="STNA", status="Running", priority="High")
    in_memory_db.add_all([b1, train1])
    in_memory_db.commit()

    plan = generate_block_plan(in_memory_db)
    assert plan is not None
    assert "plans" in plan


# 14. Existing APIs continue working
def test_existing_apis_continue_working(in_memory_db):
    client = TestClient(app)
    resp = client.get("/maintenance/bundles")
    assert resp.status_code == 200
    assert "total_bundles" in resp.json()
    assert "bundles" in resp.json()


# 15. Existing database records remain intact
def test_existing_db_records_intact(in_memory_db):
    t = Maintenance(
        id=999, maintenance_type="Legacy Inspection", department="Engineering", crew_type="Track Team",
        priority="High", status="Planned", location_type="block", block_code="LEGACY-01",
        estimated_duration_minutes=45
    )
    in_memory_db.add(t)
    in_memory_db.commit()

    bundle = bundle_compatible_maintenance(in_memory_db, target_block_code="LEGACY-01", persist=True)
    assert len(bundle) == 1

    in_memory_db.refresh(t)
    assert t.id == 999
    assert t.maintenance_type == "Legacy Inspection"
    assert t.bundled is True
    assert t.bundle_id == "BUNDLE-LEGACY-01"
