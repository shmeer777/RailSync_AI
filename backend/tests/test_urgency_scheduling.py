import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.db.base import Base
from app.models.block import Block
from app.models.crew import Crew
from app.models.maintenance import Maintenance
from app.models.train import Train
from app.services.ai.urgency_analyzer import (
    calculate_task_urgency,
    calculate_all_urgencies,
    schedule_by_urgency,
)
from app.services.ai.crew_queue_optimizer import optimize_crew_queue
from app.services.ai.maintenance_bundler import bundle_compatible_maintenance
from app.services.ai.asset_availability import calculate_asset_availability
from app.services.ai.what_if_simulator import run_what_if_simulation
from app.services.ai.block_planner import generate_block_plan
from app.schemas.what_if import WhatIfScenarioRequest
from app.schemas.asset_availability import AssetAvailabilityOptimizeRequest
from app.schemas.urgency import UrgencyScheduleRequest
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

    # 1. Blocks
    b1 = Block(id=1, code="GNT-BZA-01", name="Guntur-Vijayawada Block 1", start_station_code="GNT", end_station_code="BZA", distance_km=32.0)
    b2 = Block(id=2, code="BZA-EE-01", name="Vijayawada-Eluru Block 1", start_station_code="BZA", end_station_code="EE", distance_km=60.0)
    session.add_all([b1, b2])

    # 2. Crews
    c1 = Crew(id=1, name="Track Team Alpha", crew_type="Track Team", department="Engineering", capacity=4, status="Available", current_workload=0)
    c2 = Crew(id=2, name="S&T Team Beta", crew_type="S&T Team", department="S&T", capacity=4, status="Available", current_workload=0)
    session.add_all([c1, c2])

    # 3. Trains
    now = datetime.now(timezone.utc).replace(tzinfo=None)
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

    # 4. Maintenance Tasks
    # Task 1: Critical priority, due_by in 4h, blocks Task 2 and 3, exclusive block required
    m1 = Maintenance(
        id=1,
        maintenance_type="Track Rail Fracture Repair",
        department="Engineering",
        crew_type="Track Team",
        crew_size=2,
        assigned_crew_id=1,
        priority="Critical",
        status="Planned",
        location_type="block",
        block_code="GNT-BZA-01",
        estimated_duration_minutes=90,
        due_by=now + timedelta(hours=4),
        requires_exclusive_block=True,
    )
    # Task 2: High priority, depends on Task 1
    m2 = Maintenance(
        id=2,
        maintenance_type="Signal Interlocking Check",
        department="S&T",
        crew_type="S&T Team",
        crew_size=2,
        assigned_crew_id=2,
        priority="High",
        status="Planned",
        location_type="block",
        block_code="GNT-BZA-01",
        estimated_duration_minutes=45,
        depends_on_maintenance_id=1,
        due_by=now + timedelta(days=2),
    )
    # Task 3: Medium priority, depends on Task 1
    m3 = Maintenance(
        id=3,
        maintenance_type="Overhead Wire Tensioning",
        department="Electrical",
        crew_type="Track Team",
        crew_size=2,
        assigned_crew_id=1,
        priority="Medium",
        status="Planned",
        location_type="block",
        block_code="GNT-BZA-01",
        estimated_duration_minutes=60,
        depends_on_maintenance_id=1,
        due_by=now + timedelta(days=5),
    )
    # Task 4: Low priority, no deadline, independent routine work
    m4 = Maintenance(
        id=4,
        maintenance_type="Vegetation Clearance",
        department="Engineering",
        crew_type="Track Team",
        crew_size=2,
        assigned_crew_id=1,
        priority="Low",
        status="Planned",
        location_type="block",
        block_code="BZA-EE-01",
        estimated_duration_minutes=120,
        due_by=None,
    )
    # Task 5: Completed historical task for time-since-maintenance test
    m5 = Maintenance(
        id=5,
        maintenance_type="Track Alignment Check",
        department="Engineering",
        crew_type="Track Team",
        priority="Low",
        status="Completed",
        location_type="block",
        block_code="GNT-BZA-01",
        estimated_duration_minutes=60,
        scheduled_start=now - timedelta(days=120),
        scheduled_end=now - timedelta(days=120) + timedelta(minutes=60),
    )
    session.add_all([m1, m2, m3, m4, m5])
    session.commit()

    yield session
    session.close()


# ------------------------------------------------------------
# 1. Critical task receives Critical urgency
# ------------------------------------------------------------
def test_critical_task_receives_critical_urgency(test_db):
    all_tasks = test_db.query(Maintenance).all()
    t1 = next(t for t in all_tasks if t.id == 1)
    u1 = calculate_task_urgency(t1, all_tasks)

    assert u1.urgency_level == "Critical"
    assert u1.urgency_score >= 75.0
    assert "Critical maintenance priority" in "; ".join(u1.contributing_factors)


# ------------------------------------------------------------
# 2. Risk and urgency remain separate metrics
# ------------------------------------------------------------
def test_risk_and_urgency_remain_separate_metrics(test_db):
    all_tasks = test_db.query(Maintenance).all()
    t1 = next(t for t in all_tasks if t.id == 1)
    u1 = calculate_task_urgency(t1, all_tasks)

    # Risk score and urgency score are separate numeric metrics
    assert u1.risk_score is not None
    assert u1.urgency_score is not None
    # They should not be conflated as equal
    assert u1.urgency_score != u1.risk_score
    assert u1.factors.risk_factor == round(u1.risk_score * 0.25, 1)


# ------------------------------------------------------------
# 3. Model confidence remains separate from risk and urgency
# ------------------------------------------------------------
def test_model_confidence_remains_separate_metric(test_db):
    all_tasks = test_db.query(Maintenance).all()
    t1 = next(t for t in all_tasks if t.id == 1)
    u1 = calculate_task_urgency(t1, all_tasks, model_confidence=87.5)

    assert u1.model_confidence == 87.5
    assert u1.model_confidence != u1.risk_score
    assert u1.model_confidence != u1.urgency_score


# ------------------------------------------------------------
# 4. Dependency impact increases urgency when downstream tasks blocked
# ------------------------------------------------------------
def test_dependency_impact_increases_urgency(test_db):
    all_tasks = test_db.query(Maintenance).all()
    t1 = next(t for t in all_tasks if t.id == 1)
    t4 = next(t for t in all_tasks if t.id == 4)

    u1 = calculate_task_urgency(t1, all_tasks)
    u4 = calculate_task_urgency(t4, all_tasks)

    assert u1.dependent_task_count == 2
    assert set(u1.blocked_task_ids) == {2, 3}
    assert u1.factors.dependency_impact > 0
    assert u4.dependent_task_count == 0
    assert u4.factors.dependency_impact == 0.0


# ------------------------------------------------------------
# 5. Deadline pressure works when valid deadline exists
# ------------------------------------------------------------
def test_deadline_pressure_with_valid_deadline(test_db):
    all_tasks = test_db.query(Maintenance).all()
    t1 = next(t for t in all_tasks if t.id == 1)
    u1 = calculate_task_urgency(t1, all_tasks)

    assert u1.deadline_pressure == "Urgent (<24h)"
    assert u1.factors.deadline_pressure == 20.0
    assert u1.deadline is not None


# ------------------------------------------------------------
# 6. Missing deadline does not cause fabricated deadline data
# ------------------------------------------------------------
def test_missing_deadline_does_not_fabricate_data(test_db):
    all_tasks = test_db.query(Maintenance).all()
    t4 = next(t for t in all_tasks if t.id == 4)
    u4 = calculate_task_urgency(t4, all_tasks)

    assert u4.deadline is None
    assert u4.deadline_status == "No Deadline"
    assert u4.deadline_pressure == "None"
    assert u4.factors.deadline_pressure == 0.0


# ------------------------------------------------------------
# 7. Critical tasks are scheduled at earliest feasible window
# ------------------------------------------------------------
def test_critical_tasks_scheduled_at_earliest_feasible_window(test_db):
    res = schedule_by_urgency(test_db)

    assert res.optimization_status in ("OPTIMAL", "FEASIBLE")
    assert len(res.schedule_items) > 0

    item_1 = next(i for i in res.schedule_items if i["maintenance_id"] == 1)
    # Task 1 (Critical) must be scheduled at minute 0 (earliest feasible window)
    assert item_1["start_minute"] == 0
    assert "earliest feasible window" in item_1["timing_reason"].lower()


# ------------------------------------------------------------
# 8. Crew availability is respected
# ------------------------------------------------------------
def test_crew_availability_respected(test_db):
    res = schedule_by_urgency(test_db)
    items = res.schedule_items

    # Task 1 and Task 3 are both assigned to Crew 1 (Track Team Alpha)
    item_1 = next(i for i in items if i["maintenance_id"] == 1)
    item_3 = next(i for i in items if i["maintenance_id"] == 3)

    # Crew 1 cannot work on both simultaneously: item 3 must start after item 1 ends
    assert item_3["start_minute"] >= item_1["end_minute"]


# ------------------------------------------------------------
# 9. A dependency cannot be violated to satisfy urgency
# ------------------------------------------------------------
def test_dependency_cannot_be_violated(test_db):
    res = schedule_by_urgency(test_db)
    items = res.schedule_items

    item_1 = next(i for i in items if i["maintenance_id"] == 1)
    item_2 = next(i for i in items if i["maintenance_id"] == 2)

    # Task 2 depends on Task 1: start_2 >= end_1
    assert item_2["start_minute"] >= item_1["end_minute"]
    assert "prerequisite" in item_2["timing_reason"].lower() or "dependency" in item_2["timing_reason"].lower()


# ------------------------------------------------------------
# 10. Traffic-aware scheduling does not indefinitely delay Critical tasks
# ------------------------------------------------------------
def test_traffic_does_not_indefinitely_delay_critical(test_db):
    res = schedule_by_urgency(test_db)
    item_1 = next(i for i in res.schedule_items if i["maintenance_id"] == 1)

    # Critical urgency dominates traffic: scheduled at earliest opportunity (0m)
    assert item_1["start_minute"] == 0


# ------------------------------------------------------------
# 11. Lower-priority routine tasks can move to lower-impact windows
# ------------------------------------------------------------
def test_lower_priority_routine_tasks_can_move(test_db):
    res = schedule_by_urgency(test_db)
    item_1 = next(i for i in res.schedule_items if i["maintenance_id"] == 1)
    item_4 = next(i for i in res.schedule_items if i["maintenance_id"] == 4)

    # Low priority Task 4 must not delay Critical Task 1
    assert item_1["start_minute"] < item_4["end_minute"]


# ------------------------------------------------------------
# 12. Existing crew priority logic still works
# ------------------------------------------------------------
def test_existing_crew_priority_logic_still_works(test_db):
    cq_res = optimize_crew_queue(db=test_db, crew_id=1)
    assert cq_res.optimization_status in ("OPTIMAL", "FEASIBLE")
    assert len(cq_res.optimized_queue) > 0


# ------------------------------------------------------------
# 13. Existing maintenance bundling still works
# ------------------------------------------------------------
def test_existing_maintenance_bundling_still_works(test_db):
    bundles = bundle_compatible_maintenance(db=test_db, persist=False)
    assert isinstance(bundles, list)


# ------------------------------------------------------------
# 14. Existing predictive maintenance risk logic works
# ------------------------------------------------------------
def test_existing_predictive_risk_logic_works(test_db):
    all_tasks = test_db.query(Maintenance).all()
    t1 = next(t for t in all_tasks if t.id == 1)
    u1 = calculate_task_urgency(t1, all_tasks)
    assert u1.risk_score > 0


# ------------------------------------------------------------
# 15. Existing asset availability logic still works
# ------------------------------------------------------------
def test_existing_asset_availability_logic_still_works(test_db):
    req = AssetAvailabilityOptimizeRequest(planning_window="night", stagger_multi_blocks=True)
    res = calculate_asset_availability(db=test_db, request=req)
    assert res.optimization_status in ("OPTIMAL", "FEASIBLE", "BASELINE_FALLBACK")
    assert res.total_assets == 2


# ------------------------------------------------------------
# 16. Existing What-If simulation still works
# ------------------------------------------------------------
def test_existing_what_if_simulation_still_works(test_db):
    from app.schemas.what_if import TaskOverride
    req = WhatIfScenarioRequest(
        block_code="GNT-BZA-01",
        name="Test Delay Scenario",
        task_overrides=[TaskOverride(task_id=1, delay_minutes=30, priority="High")],
    )
    res = run_what_if_simulation(db=test_db, request=req)
    assert res.optimization_status in ("OPTIMAL", "FEASIBLE")


# ------------------------------------------------------------
# 17. Existing route-aware block planning still works
# ------------------------------------------------------------
def test_existing_route_aware_block_planning_still_works(test_db):
    bp_res = generate_block_plan(db=test_db)
    assert "plans" in bp_res
    assert len(bp_res["plans"]) > 0


# ------------------------------------------------------------
# 18. OR-Tools solver status is real
# ------------------------------------------------------------
def test_ortools_solver_status_is_real(test_db):
    res = schedule_by_urgency(test_db)
    assert res.optimization_status in ("OPTIMAL", "FEASIBLE")
    assert res.scheduled_tasks_count == 4


# ------------------------------------------------------------
# 19. No fake urgency scores are returned (deterministic and traceable)
# ------------------------------------------------------------
def test_no_fake_urgency_scores_returned(test_db):
    all_tasks = test_db.query(Maintenance).all()
    for t in all_tasks:
        if t.status not in ("Completed", "Cancelled"):
            item = calculate_task_urgency(t, all_tasks)
            expected_sum = round(
                item.factors.priority_weight
                + item.factors.risk_factor
                + item.factors.dependency_impact
                + item.factors.deadline_pressure
                + item.factors.operational_impact
                + item.factors.duration_penalty,
                1,
            )
            assert item.urgency_score >= expected_sum
            assert 0.0 <= item.urgency_score <= 100.0


# ------------------------------------------------------------
# 20. Human approval flag remains true
# ------------------------------------------------------------
def test_human_approval_flag_remains_true(test_db):
    res = schedule_by_urgency(test_db)
    assert res.human_approval_required is True

    all_urgencies = calculate_all_urgencies(test_db)
    for item in all_urgencies.items:
        assert item.human_approval_required is True


# ------------------------------------------------------------
# API Endpoints Test
# ------------------------------------------------------------
def test_urgency_api_endpoints(test_db):
    def override_get_db():
        try:
            yield test_db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    # 1. GET /ai/maintenance-urgency
    res_all = client.get("/ai/maintenance-urgency")
    assert res_all.status_code == 200
    data_all = res_all.json()
    assert "items" in data_all
    assert data_all["total_tasks"] == 4
    assert data_all["items"][0]["maintenance_id"] == 1
    assert data_all["items"][0]["urgency_level"] == "Critical"
    assert "contributing_factors" in data_all["items"][0]
    assert "recommended_window" in data_all["items"][0]

    # 2. GET /ai/maintenance-urgency/1
    res_single = client.get("/ai/maintenance-urgency/1")
    assert res_single.status_code == 200
    data_single = res_single.json()
    assert data_single["maintenance_id"] == 1
    assert data_single["urgency_level"] == "Critical"
    assert "explanation" in data_single
    assert data_single["human_approval_required"] is True

    # 3. POST /ai/maintenance-urgency/schedule
    res_sched = client.post("/ai/maintenance-urgency/schedule", json={"human_approved": True})
    assert res_sched.status_code == 200
    data_sched = res_sched.json()
    assert data_sched["optimization_status"] in ("OPTIMAL", "FEASIBLE")
    assert "comparison" in data_sched
    assert "schedule_items" in data_sched
    assert data_sched["human_approval_required"] is True

    app.dependency_overrides.clear()
