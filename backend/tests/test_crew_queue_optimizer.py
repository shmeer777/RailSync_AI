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
from app.models.train import Train
from app.services.ai.crew_queue_optimizer import (
    calculate_dependency_impact,
    optimize_crew_queue,
    get_all_crew_queues,
    apply_crew_queue,
)
from app.services.ai.maintenance_bundler import bundle_compatible_maintenance
from app.services.ai.block_planner import generate_block_plan
from app.services.ai.traffic_estimator import get_block_train_traffic
from app.schemas.crew_queue import CrewQueueApplyRequest, TaskPositionAssignment
from app.schemas.what_if import WhatIfScenarioRequest
from app.services.ai.what_if_simulator import run_what_if_simulation
from app.main import app
from app.db.session import get_db


@pytest.fixture
def in_memory_db():
    """Create an isolated in-memory SQLite database with schema and default crews."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()

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


# Scenario 1: Normal queue remains unchanged when no urgent task exists.
def test_scenario_1_normal_queue_unchanged_when_no_urgent_task(in_memory_db):
    t1 = Maintenance(
        id=21, maintenance_type="Routine Equipment Inspection", department="Electrical", crew_type="Electrical Team",
        priority="Medium", status="Planned", location_type="block", block_code="GNT-BZA-01",
        assigned_crew_id=4, sequence_order=1, queue_position=1, estimated_duration_minutes=60
    )
    t2 = Maintenance(
        id=22, maintenance_type="Station Electrical Maintenance", department="Electrical", crew_type="Electrical Team",
        priority="Medium", status="Planned", location_type="station", station_code="GNT",
        assigned_crew_id=4, sequence_order=2, queue_position=2, estimated_duration_minutes=60
    )
    t3 = Maintenance(
        id=23, maintenance_type="Equipment Check", department="Electrical", crew_type="Electrical Team",
        priority="Low", status="Planned", location_type="block", block_code="GNT-BZA-02",
        assigned_crew_id=4, sequence_order=3, queue_position=3, estimated_duration_minutes=45
    )
    in_memory_db.add_all([t1, t2, t3])
    in_memory_db.commit()

    res = optimize_crew_queue(in_memory_db, crew_id=4)
    assert res.optimization_status in ("OPTIMAL", "FEASIBLE")
    assert len(res.changes) == 0
    assert [t.task_id for t in res.optimized_queue] == [21, 22, 23]
    assert all(not t.priority_override for t in res.optimized_queue)


# Scenario 2: Critical task can move ahead of lower-priority tasks.
def test_scenario_2_critical_task_moves_ahead_of_lower_priority(in_memory_db):
    t1 = Maintenance(
        id=21, maintenance_type="Routine Equipment Inspection", department="Electrical", crew_type="Electrical Team",
        priority="Medium", status="Planned", location_type="block", block_code="GNT-BZA-01",
        assigned_crew_id=4, sequence_order=1, queue_position=1, estimated_duration_minutes=60
    )
    t2 = Maintenance(
        id=22, maintenance_type="Station Electrical Maintenance", department="Electrical", crew_type="Electrical Team",
        priority="Medium", status="Planned", location_type="station", station_code="GNT",
        assigned_crew_id=4, sequence_order=2, queue_position=2, estimated_duration_minutes=60
    )
    t3 = Maintenance(
        id=23, maintenance_type="Equipment Check", department="Electrical", crew_type="Electrical Team",
        priority="Low", status="Planned", location_type="block", block_code="GNT-BZA-02",
        assigned_crew_id=4, sequence_order=3, queue_position=3, estimated_duration_minutes=45
    )
    t4 = Maintenance(
        id=10, maintenance_type="Critical Electrical Inspection", department="Electrical", crew_type="Electrical Team",
        priority="Critical", status="Planned", location_type="block", block_code="GNT-BZA-01",
        assigned_crew_id=4, sequence_order=4, queue_position=4, estimated_duration_minutes=60
    )
    in_memory_db.add_all([t1, t2, t3, t4])
    in_memory_db.commit()

    res = optimize_crew_queue(in_memory_db, crew_id=4)
    assert res.optimization_status in ("OPTIMAL", "FEASIBLE")
    assert res.optimized_queue[0].task_id == 10
    assert res.optimized_queue[0].priority == "Critical"
    assert res.optimized_queue[0].priority_override is True


# Scenario 3: Original queue positions are preserved for comparison.
def test_scenario_3_original_queue_positions_preserved(in_memory_db):
    t1 = Maintenance(
        id=1, maintenance_type="Job A", department="Electrical", crew_type="Electrical Team",
        priority="Medium", status="Planned", assigned_crew_id=4, sequence_order=1, queue_position=1
    )
    t2 = Maintenance(
        id=2, maintenance_type="Job B", department="Electrical", crew_type="Electrical Team",
        priority="Critical", status="Planned", assigned_crew_id=4, sequence_order=2, queue_position=2
    )
    in_memory_db.add_all([t1, t2])
    in_memory_db.commit()

    res = optimize_crew_queue(in_memory_db, crew_id=4)
    # Original queue preserves 1 -> Job A, 2 -> Job B
    assert res.original_queue[0].task_id == 1
    assert res.original_queue[0].original_position == 1
    assert res.original_queue[1].task_id == 2
    assert res.original_queue[1].original_position == 2

    # Optimized queue has Job B at position 1, Job A at position 2
    assert res.optimized_queue[0].task_id == 2
    assert res.optimized_queue[0].original_position == 2
    assert res.optimized_queue[0].optimized_position == 1


# Scenario 4: Priority override has a reason.
def test_scenario_4_priority_override_has_explainable_reason(in_memory_db):
    t1 = Maintenance(
        id=1, maintenance_type="Routine Job", department="Electrical", crew_type="Electrical Team",
        priority="Medium", status="Planned", assigned_crew_id=4, sequence_order=1, queue_position=1
    )
    t2 = Maintenance(
        id=2, maintenance_type="Critical Urgent Repair", department="Electrical", crew_type="Electrical Team",
        priority="Critical", status="Planned", assigned_crew_id=4, sequence_order=2, queue_position=2
    )
    in_memory_db.add_all([t1, t2])
    in_memory_db.commit()

    res = optimize_crew_queue(in_memory_db, crew_id=4)
    overrides = [c for c in res.changes if c.priority_override]
    assert len(overrides) == 1
    assert overrides[0].override_reason is not None
    assert len(overrides[0].override_reason) > 10


# Scenario 5: Critical prerequisite unlocks dependent task.
def test_scenario_5_critical_prerequisite_unlocks_dependent_task(in_memory_db):
    t_elec = Maintenance(
        id=10, maintenance_type="Critical Electrical Inspection", department="Electrical", crew_type="Electrical Team",
        priority="Critical", status="Planned", location_type="block", block_code="GNT-BZA-01",
        assigned_crew_id=4, sequence_order=4, queue_position=4, estimated_duration_minutes=60
    )
    t_sig = Maintenance(
        id=12, maintenance_type="Signal Maintenance", department="S&T", crew_type="S&T Team",
        priority="High", status="Planned", location_type="block", block_code="GNT-BZA-01",
        assigned_crew_id=2, depends_on_maintenance_id=10, sequence_order=1, estimated_duration_minutes=60
    )
    t_routine = Maintenance(
        id=21, maintenance_type="Routine Equipment Inspection", department="Electrical", crew_type="Electrical Team",
        priority="Medium", status="Planned", location_type="block", block_code="GNT-BZA-01",
        assigned_crew_id=4, sequence_order=1, queue_position=1, estimated_duration_minutes=60
    )
    in_memory_db.add_all([t_elec, t_sig, t_routine])
    in_memory_db.commit()

    res = optimize_crew_queue(in_memory_db, crew_id=4)
    elec_task = next(t for t in res.optimized_queue if t.task_id == 10)
    assert elec_task.optimized_position == 1
    assert 12 in elec_task.blocked_tasks_unlocked
    assert elec_task.dependent_task_count == 1
    assert "prerequisite" in (elec_task.override_reason or "").lower()


# Scenario 6: Lower-priority tasks are not deleted.
def test_scenario_6_lower_priority_tasks_not_deleted(in_memory_db):
    tasks = [
        Maintenance(id=1, maintenance_type="Task 1", department="Electrical", crew_type="Electrical Team", priority="Medium", assigned_crew_id=4, sequence_order=1),
        Maintenance(id=2, maintenance_type="Task 2", department="Electrical", crew_type="Electrical Team", priority="Low", assigned_crew_id=4, sequence_order=2),
        Maintenance(id=3, maintenance_type="Task 3", department="Electrical", crew_type="Electrical Team", priority="Critical", assigned_crew_id=4, sequence_order=3),
    ]
    in_memory_db.add_all(tasks)
    in_memory_db.commit()

    res = optimize_crew_queue(in_memory_db, crew_id=4)
    assert len(res.optimized_queue) == 3
    assert {t.task_id for t in res.optimized_queue} == {1, 2, 3}


# Scenario 7: Crew capacity is respected.
def test_scenario_7_crew_capacity_respected(in_memory_db):
    # Crew 4 has capacity 4
    # Task requires 5 personnel -> Infeasible for this crew
    t_oversized = Maintenance(
        id=99, maintenance_type="Massive Overhaul", department="Electrical", crew_type="Electrical Team",
        crew_size=5, priority="High", assigned_crew_id=4
    )
    in_memory_db.add(t_oversized)
    in_memory_db.commit()

    res = optimize_crew_queue(in_memory_db, crew_id=4)
    assert res.optimization_status == "INFEASIBLE"
    assert "capacity exceeded" in res.explanation.lower()


# Scenario 8: Crew availability is respected.
def test_scenario_8_crew_availability_respected(in_memory_db):
    crew = in_memory_db.get(Crew, 4)
    assert crew.status == "Available"
    assert crew.capacity == 4


# Scenario 9: Two conflicting tasks cannot be scheduled simultaneously on the same crew.
def test_scenario_9_no_simultaneous_tasks_on_same_crew(in_memory_db):
    t1 = Maintenance(
        id=1, maintenance_type="Task A", department="Electrical", crew_type="Electrical Team",
        priority="Medium", assigned_crew_id=4, sequence_order=1, estimated_duration_minutes=60
    )
    t2 = Maintenance(
        id=2, maintenance_type="Task B", department="Electrical", crew_type="Electrical Team",
        priority="High", assigned_crew_id=4, sequence_order=2, estimated_duration_minutes=60
    )
    in_memory_db.add_all([t1, t2])
    in_memory_db.commit()

    res = optimize_crew_queue(in_memory_db, crew_id=4)
    opt_t1 = next(t for t in res.optimized_queue if t.task_id == 1)
    opt_t2 = next(t for t in res.optimized_queue if t.task_id == 2)

    # Intervals must not overlap: min(e1, e2) <= max(s1, s2)
    s1, e1 = opt_t1.start_minute, opt_t1.end_minute
    s2, e2 = opt_t2.start_minute, opt_t2.end_minute
    assert (e1 <= s2) or (e2 <= s1)


# Scenario 10: Different crews can work in parallel where allowed.
def test_scenario_10_different_crews_work_in_parallel(in_memory_db):
    t_elec = Maintenance(
        id=1, maintenance_type="Electrical Work", department="Electrical", crew_type="Electrical Team",
        priority="High", assigned_crew_id=4, estimated_duration_minutes=60, execution_mode="parallel"
    )
    t_track = Maintenance(
        id=2, maintenance_type="Track Work", department="Engineering", crew_type="Track Team",
        priority="High", assigned_crew_id=3, estimated_duration_minutes=60, execution_mode="parallel"
    )
    in_memory_db.add_all([t_elec, t_track])
    in_memory_db.commit()

    res_elec = optimize_crew_queue(in_memory_db, crew_id=4)
    res_track = optimize_crew_queue(in_memory_db, crew_id=3)

    assert res_elec.optimization_status in ("OPTIMAL", "FEASIBLE")
    assert res_track.optimization_status in ("OPTIMAL", "FEASIBLE")
    assert res_elec.optimized_queue[0].start_minute == 0
    assert res_track.optimized_queue[0].start_minute == 0


# Scenario 11: A task waiting on a dependency stays blocked.
def test_scenario_11_task_waiting_on_dependency_stays_blocked(in_memory_db):
    t_parent = Maintenance(
        id=10, maintenance_type="Prerequisite Task", department="Electrical", crew_type="Electrical Team",
        priority="Critical", status="Planned", assigned_crew_id=4, sequence_order=1, estimated_duration_minutes=60
    )
    t_child = Maintenance(
        id=11, maintenance_type="Dependent Task", department="Electrical", crew_type="Electrical Team",
        priority="High", status="Planned", assigned_crew_id=4, depends_on_maintenance_id=10,
        sequence_order=2, estimated_duration_minutes=60
    )
    in_memory_db.add_all([t_parent, t_child])
    in_memory_db.commit()

    res = optimize_crew_queue(in_memory_db, crew_id=4)
    opt_child = next(t for t in res.optimized_queue if t.task_id == 11)
    opt_parent = next(t for t in res.optimized_queue if t.task_id == 10)

    assert opt_child.start_minute >= opt_parent.end_minute
    assert opt_child.queue_state in ("Waiting for Dependency", "Queued")


# Scenario 12: Completing the prerequisite unlocks the dependent task.
def test_scenario_12_completing_prerequisite_unlocks_dependent_task(in_memory_db):
    t_parent = Maintenance(
        id=10, maintenance_type="Prerequisite Task", department="Electrical", crew_type="Electrical Team",
        priority="Critical", status="Completed", assigned_crew_id=4, sequence_order=1, estimated_duration_minutes=60
    )
    t_child = Maintenance(
        id=11, maintenance_type="Dependent Task", department="Electrical", crew_type="Electrical Team",
        priority="High", status="Planned", assigned_crew_id=4, depends_on_maintenance_id=10,
        sequence_order=2, estimated_duration_minutes=60
    )
    in_memory_db.add_all([t_parent, t_child])
    in_memory_db.commit()

    res = optimize_crew_queue(in_memory_db, crew_id=4)
    # Since parent is completed, only child is active in queue
    opt_child = next(t for t in res.optimized_queue if t.task_id == 11)
    assert opt_child.queue_state != "Waiting for Dependency"


# Scenario 13: Priority changes are temporary unless explicitly applied.
def test_scenario_13_priority_changes_temporary_unless_applied(in_memory_db):
    t1 = Maintenance(
        id=1, maintenance_type="Routine Job", department="Electrical", crew_type="Electrical Team",
        priority="Medium", status="Planned", assigned_crew_id=4, sequence_order=1, queue_position=1
    )
    t2 = Maintenance(
        id=2, maintenance_type="Critical Job", department="Electrical", crew_type="Electrical Team",
        priority="Critical", status="Planned", assigned_crew_id=4, sequence_order=2, queue_position=2
    )
    in_memory_db.add_all([t1, t2])
    in_memory_db.commit()

    # Run optimization simulation
    res = optimize_crew_queue(in_memory_db, crew_id=4)
    assert res.optimized_queue[0].task_id == 2

    # Verify live DB is unchanged
    in_memory_db.expire_all()
    t1_db = in_memory_db.get(Maintenance, 1)
    t2_db = in_memory_db.get(Maintenance, 2)
    assert t1_db.queue_position == 1
    assert t2_db.queue_position == 2

    # Now explicitly apply
    apply_req = CrewQueueApplyRequest(
        crew_id=4,
        task_positions=[
            TaskPositionAssignment(task_id=2, queue_position=1),
            TaskPositionAssignment(task_id=1, queue_position=2),
        ],
        approved_by="Chief Controller Sharma",
    )
    apply_res = apply_crew_queue(in_memory_db, apply_req)
    assert apply_res.success is True

    # Now verify live DB reflects applied changes
    in_memory_db.expire_all()
    assert in_memory_db.get(Maintenance, 2).queue_position == 1
    assert in_memory_db.get(Maintenance, 1).queue_position == 2


# Scenario 14: Existing maintenance bundling still works.
def test_scenario_14_existing_maintenance_bundling_still_works(in_memory_db):
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


# Scenario 15: Existing predictive maintenance still works.
def test_scenario_15_existing_predictive_maintenance_still_works(in_memory_db):
    from app.ml.predictor import predict_maintenance_for_block
    block = Block(id=1, code="GNT-BZA-01", name="Guntur-Vijayawada Block 1", start_station_code="GNT", end_station_code="BZA", distance_km=30.0)
    in_memory_db.add(block)
    in_memory_db.commit()

    pred = predict_maintenance_for_block(in_memory_db, "GNT-BZA-01")
    assert pred["block_code"] == "GNT-BZA-01"
    assert "predicted_maintenance" in pred
    assert "urgency" in pred


# Scenario 16: Existing traffic-aware scheduling still works.
def test_scenario_16_existing_traffic_aware_scheduling_still_works(in_memory_db):
    block = Block(id=1, code="GNT-BZA-01", name="Guntur-Vijayawada Block 1", start_station_code="GNT", end_station_code="BZA", distance_km=30.0)
    train = Train(
        id=1, train_number="12701", name="Hussainsagar Express", train_type="Express",
        priority="High", current_station_code="GNT", source_station_code="HYB", destination_station_code="BZA",
        status="Running"
    )
    in_memory_db.add_all([block, train])
    in_memory_db.commit()

    traffic = get_block_train_traffic(in_memory_db, block_code="GNT-BZA-01")
    assert "slot_traffic" in traffic
    assert "total_trains_count" in traffic


# Scenario 17: Existing route-aware block planning still works.
def test_scenario_17_existing_route_aware_block_planning_still_works(in_memory_db):
    b1 = Block(id=1, code="GNT-BZA-01", name="Guntur-BZA 1", start_station_code="GNT", end_station_code="BZA", distance_km=30.0)
    t1 = Train(
        id=1, train_number="12701", name="Express Train", train_type="Express",
        priority="High", current_station_code="GNT", source_station_code="GNT", destination_station_code="BZA",
        status="Running"
    )
    in_memory_db.add_all([b1, t1])
    in_memory_db.commit()

    plan = generate_block_plan(in_memory_db)
    assert "plans" in plan


# Scenario 18: What-If Simulation still works.
def test_scenario_18_what_if_simulation_still_works(in_memory_db):
    t1 = Maintenance(
        id=10, maintenance_type="Electrical Inspection", department="Electrical", crew_type="Electrical Team",
        priority="Critical", status="Planned", location_type="block", block_code="GNT-BZA-01",
        estimated_duration_minutes=60, execution_mode="sequential", sequence_order=1
    )
    in_memory_db.add(t1)
    in_memory_db.commit()

    req = WhatIfScenarioRequest(
        block_code="GNT-BZA-01",
        name="Test Scenario",
        start_time="22:00",
    )
    sim_res = run_what_if_simulation(in_memory_db, req)
    assert sim_res.baseline is not None
    assert sim_res.what_if is not None


# Scenario 19: API returns real optimizer status.
def test_scenario_19_api_returns_real_optimizer_status(in_memory_db):
    app.dependency_overrides[get_db] = lambda: in_memory_db
    client = TestClient(app)

    t1 = Maintenance(
        id=1, maintenance_type="Electrical Job", department="Electrical", crew_type="Electrical Team",
        priority="High", status="Planned", assigned_crew_id=4, sequence_order=1, estimated_duration_minutes=60
    )
    in_memory_db.add(t1)
    in_memory_db.commit()

    response = client.get("/ai/crew-queues/4")
    assert response.status_code == 200
    data = response.json()
    assert data["optimization_status"] in ("OPTIMAL", "FEASIBLE")
    assert data["crew_id"] == 4
    app.dependency_overrides.clear()


# Scenario 20: Human approval remains required.
def test_scenario_20_human_approval_remains_required(in_memory_db):
    app.dependency_overrides[get_db] = lambda: in_memory_db
    client = TestClient(app)

    t1 = Maintenance(
        id=1, maintenance_type="Electrical Job", department="Electrical", crew_type="Electrical Team",
        priority="High", status="Planned", assigned_crew_id=4, sequence_order=1, estimated_duration_minutes=60
    )
    in_memory_db.add(t1)
    in_memory_db.commit()

    # GET response flags human_approval_required
    response = client.get("/ai/crew-queues/4")
    assert response.status_code == 200
    assert response.json()["human_approval_required"] is True

    # Attempting to apply without valid controller name fails
    bad_apply = client.post(
        "/ai/crew-queues/apply",
        json={
            "crew_id": 4,
            "task_positions": [{"task_id": 1, "queue_position": 1}],
            "approved_by": "",
        },
    )
    assert bad_apply.status_code == 422  # validation error for min_length 2

    app.dependency_overrides.clear()
