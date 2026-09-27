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
from app.schemas.planning import (
    MaintenancePlanOptimizeRequest,
    MaintenancePlanApplyRequest,
)
from app.services.ai.maintenance_planner import (
    generate_maintenance_plan,
    apply_maintenance_plan,
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

    # Blocks
    blocks = [
        Block(id=1, code="GNT-BZA-01", name="Guntur-Vijayawada Block 1", start_station_code="GNT", end_station_code="BZA", distance_km=32.0),
        Block(id=2, code="BZA-EE-01", name="Vijayawada-Eluru Block 1", start_station_code="BZA", end_station_code="EE", distance_km=60.0),
        Block(id=3, code="EE-RJY-01", name="Eluru-Rajahmundry Block 1", start_station_code="EE", end_station_code="RJY", distance_km=89.0),
    ]
    session.add_all(blocks)

    # Crews
    crews = [
        Crew(id=1, name="Track Team Alpha", department="Engineering", crew_type="Track Team", capacity=6, status="Available"),
        Crew(id=2, name="Signal Team Beta", department="S&T", crew_type="S&T Team", capacity=4, status="Available"),
        Crew(id=3, name="Electrical Team Gamma", department="Electrical", crew_type="Electrical Team", capacity=5, status="Available"),
    ]
    session.add_all(crews)

    # Maintenance Tasks
    now = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    tasks = [
        # Bundle 1 on GNT-BZA-01
        Maintenance(
            id=101,
            maintenance_type="Track Geometry Correction",
            department="Engineering",
            crew_type="Track Team",
            assigned_crew_id=1,
            priority="Critical",
            status="Planned",
            location_type="block",
            block_code="GNT-BZA-01",
            estimated_duration_minutes=120,
            due_by=now + timedelta(days=2),
            bundle_id="BUNDLE-GNT-01",
            bundled=True,
            bundle_role="primary",
        ),
        Maintenance(
            id=102,
            maintenance_type="Axle Counter Calibration",
            department="S&T",
            crew_type="S&T Team",
            assigned_crew_id=2,
            priority="High",
            status="Planned",
            location_type="block",
            block_code="GNT-BZA-01",
            estimated_duration_minutes=60,
            due_by=now + timedelta(days=3),
            bundle_id="BUNDLE-GNT-01",
            bundled=True,
            bundle_role="secondary",
        ),
        # Unbundled tasks on BZA-EE-01
        Maintenance(
            id=103,
            maintenance_type="OHE Mast Inspection",
            department="Electrical",
            crew_type="Electrical Team",
            assigned_crew_id=3,
            priority="Medium",
            status="Planned",
            location_type="block",
            block_code="BZA-EE-01",
            estimated_duration_minutes=90,
            due_by=now + timedelta(days=4),
        ),
        Maintenance(
            id=104,
            maintenance_type="Sleeper Replacement",
            department="Engineering",
            crew_type="Track Team",
            assigned_crew_id=1,
            priority="High",
            status="Planned",
            location_type="block",
            block_code="BZA-EE-01",
            estimated_duration_minutes=180,
            due_by=now + timedelta(days=5),
        ),
        # Low priority task on EE-RJY-01
        Maintenance(
            id=105,
            maintenance_type="Drainage Cleaning",
            department="Engineering",
            crew_type="Track Team",
            assigned_crew_id=1,
            priority="Low",
            status="Planned",
            location_type="block",
            block_code="EE-RJY-01",
            estimated_duration_minutes=60,
            due_by=now + timedelta(days=6),
        ),
    ]
    session.add_all(tasks)
    session.commit()

    yield session
    session.close()


def test_weekly_maintenance_plan_generation(test_db):
    """Test generating a 7-day weekly maintenance plan using CP-SAT."""
    start_date = datetime.utcnow().strftime("%Y-%m-%d")
    plan = generate_maintenance_plan(db=test_db, horizon="week", start_date=start_date)

    assert plan is not None
    assert plan.horizon == "week"
    assert len(plan.days) == 7
    assert plan.total_tasks_planned >= 4
    assert plan.human_approval_required is True
    assert plan.average_availability_percentage > 50.0

    # Bundle preservation check: Task 101 and 102 share bundle_id "BUNDLE-GNT-01"
    item_101 = None
    item_102 = None
    for day in plan.days:
        for t in day.tasks:
            if t.task_id == 101:
                item_101 = (day.date_str, t.planned_start)
            if t.task_id == 102:
                item_102 = (day.date_str, t.planned_start)

    assert item_101 is not None
    assert item_102 is not None
    assert item_101[0] == item_102[0], "Bundled tasks must be scheduled on the same date"
    assert item_101[1] == item_102[1], "Bundled tasks must share the coordinated start window"


def test_crew_daily_workload_limit(test_db):
    """Verify no crew is allocated more than 8 hours (480 minutes) on any single day."""
    start_date = datetime.utcnow().strftime("%Y-%m-%d")
    plan = generate_maintenance_plan(db=test_db, horizon="week", start_date=start_date)

    for cw in plan.crew_workloads:
        for day_str, hours in cw.daily_allocations.items():
            assert hours <= 8.0, f"Crew {cw.crew_name} exceeded 8h limit on {day_str}"


def test_monthly_maintenance_plan_generation(test_db):
    """Test generating a 30-day monthly maintenance plan."""
    start_date = datetime.utcnow().strftime("%Y-%m-%d")
    plan = generate_maintenance_plan(db=test_db, horizon="month", start_date=start_date)

    assert plan is not None
    assert plan.horizon == "month"
    assert len(plan.days) == 30
    assert plan.total_tasks_planned >= 4


def test_apply_maintenance_plan(test_db):
    """Test applying an approved plan updates maintenance records in the database."""
    start_date = datetime.utcnow().strftime("%Y-%m-%d")
    plan = generate_maintenance_plan(db=test_db, horizon="week", start_date=start_date)

    req = MaintenancePlanApplyRequest(
        plan_id=plan.plan_id,
        human_approved=True,
        approved_by="Chief Section Controller",
        notes="All corridor safety clearances verified.",
    )

    result = apply_maintenance_plan(db=test_db, request=req)
    assert result.applied_tasks_count >= 1
    assert result.approved_by == "Chief Section Controller"

    # Verify DB update
    m101 = test_db.query(Maintenance).filter(Maintenance.id == 101).first()
    assert m101.status == "Scheduled"
    assert m101.scheduled_start is not None


def test_planning_api_endpoints(test_db):
    """Test planning API endpoints via FastAPI TestClient."""
    def override_get_db():
        try:
            yield test_db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    # 1. GET /ai/maintenance-plan
    res_get = client.get("/ai/maintenance-plan?horizon=week")
    assert res_get.status_code == 200
    data_get = res_get.json()
    assert data_get["horizon"] == "week"
    assert len(data_get["days"]) == 7

    # 2. POST /ai/maintenance-plan/optimize
    res_opt = client.post("/ai/maintenance-plan/optimize", json={"horizon": "week"})
    assert res_opt.status_code == 200
    data_opt = res_opt.json()
    assert data_opt["total_tasks_planned"] >= 4

    # 3. POST /ai/maintenance-plan/apply
    apply_payload = {
        "plan_id": data_opt["plan_id"],
        "human_approved": True,
        "approved_by": "Test Controller",
        "notes": "Clear to execute",
    }
    res_apply = client.post("/ai/maintenance-plan/apply", json=apply_payload)
    assert res_apply.status_code == 200
    data_apply = res_apply.json()
    assert data_apply["applied_tasks_count"] >= 1
    assert data_apply["approved_by"] == "Test Controller"

    app.dependency_overrides.clear()
