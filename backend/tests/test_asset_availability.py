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
from app.schemas.asset_availability import AssetAvailabilityOptimizeRequest
from app.services.ai.asset_availability import calculate_asset_availability
from app.main import app
from app.db.session import get_db


@pytest.fixture
def in_memory_db():
    """Create an isolated in-memory SQLite database with schema and test seed data."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()

    # 1. Seed Blocks (6 blocks in modeled network)
    blocks = [
        Block(id=1, code="GNT-BZA-01", name="Guntur - Vijayawada Block 1", start_station_code="GNT", end_station_code="BZA", distance_km=32.5),
        Block(id=2, code="BZA-EE-01", name="Vijayawada - Eluru Block 1", start_station_code="BZA", end_station_code="EE", distance_km=60.0),
        Block(id=3, code="RU-TPTY-01", name="Renigunta - Tirupati Block 1", start_station_code="RU", end_station_code="TPTY", distance_km=10.0),
        Block(id=4, code="EE-RJY-01", name="Eluru - Rajahmundry Block 1", start_station_code="EE", end_station_code="RJY", distance_km=89.0),
        Block(id=5, code="RJY-VSKP-01", name="Rajahmundry - Visakhapatnam Block 1", start_station_code="RJY", end_station_code="VSKP", distance_km=200.0),
        Block(id=6, code="GNT-TEL-01", name="Guntur - Tenali Block 1", start_station_code="GNT", end_station_code="TEL", distance_km=25.0),
    ]
    session.add_all(blocks)

    # 2. Seed Crews
    crews = [
        Crew(id=1, name="Electrical Team A", crew_type="Electrical Team", department="Electrical", capacity=4, status="Available"),
        Crew(id=2, name="S&T Team A", crew_type="S&T Team", department="S&T", capacity=3, status="Available"),
        Crew(id=3, name="Track Team A", crew_type="Track Team", department="Engineering", capacity=6, status="Available"),
        Crew(id=4, name="Track Team B", crew_type="Track Team", department="Engineering", capacity=6, status="Available"),
    ]
    session.add_all(crews)

    # 3. Seed Maintenance Tasks across multiple blocks:
    # GNT-BZA-01 has multiple compatible tasks (should be bundled into 1 closure)
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
    # BZA-EE-01 has a task
    t3 = Maintenance(
        id=103,
        maintenance_type="Track Repair",
        department="Engineering",
        crew_type="Track Team",
        priority="Medium",
        status="Planned",
        location_type="block",
        block_code="BZA-EE-01",
        estimated_duration_minutes=90,
        execution_mode="parallel",
        sequence_order=1,
    )
    # RU-TPTY-01 has a task
    t4 = Maintenance(
        id=104,
        maintenance_type="Bridge Inspection",
        department="Engineering",
        crew_type="Track Team",
        priority="Low",
        status="Planned",
        location_type="block",
        block_code="RU-TPTY-01",
        estimated_duration_minutes=60,
        execution_mode="parallel",
        sequence_order=1,
    )
    session.add_all([t1, t2, t3, t4])

    # 4. Seed Trains
    trains = [
        Train(
            id=1,
            train_number="12727",
            name="Godavari Express",
            train_type="Express",
            source_station_code="BZA",
            destination_station_code="EE",
            current_station_code="BZA",
            status="Running",
            priority="High",
            speed_kmph=80.0,
            delay_minutes=0,
        ),
        Train(
            id=2,
            train_number="12704",
            name="Falaknuma Express",
            train_type="Superfast",
            source_station_code="GNT",
            destination_station_code="BZA",
            current_station_code="GNT",
            status="Running",
            priority="Critical",
            speed_kmph=75.0,
            delay_minutes=10,
        ),
    ]
    session.add_all(trains)
    session.commit()

    try:
        yield session
    finally:
        session.close()


def test_total_asset_count_from_database(in_memory_db):
    """Requirement 1: Total asset count comes directly from database blocks."""
    res = calculate_asset_availability(db=in_memory_db)
    assert res.total_assets == 6
    assert res.baseline.total_assets == 6
    assert res.optimized.total_assets == 6


def test_available_and_restricted_asset_calculation(in_memory_db):
    """Requirement 2 & 3: Available and restricted asset counts are calculated correctly."""
    res = calculate_asset_availability(db=in_memory_db)
    # Available assets must equal total - restricted
    assert res.optimized.available_assets == res.total_assets - res.optimized.restricted_assets
    assert res.baseline.available_assets == res.total_assets - res.baseline.restricted_assets


def test_availability_percentage_calculation(in_memory_db):
    """Requirement 4: Availability percentage is mathematically correct."""
    res = calculate_asset_availability(db=in_memory_db)
    expected_opt_pct = round((res.optimized.available_assets / res.total_assets) * 100, 1)
    assert res.optimized.availability_percentage == expected_opt_pct

    expected_base_pct = round((res.baseline.available_assets / res.total_assets) * 100, 1)
    assert res.baseline.availability_percentage == expected_base_pct


def test_maintenance_completion_preserved(in_memory_db):
    """Requirement 5 & 11: All required maintenance is completed (no tasks dropped to artificially inflate availability)."""
    res = calculate_asset_availability(db=in_memory_db)
    assert res.optimized.maintenance_tasks_completed == 4
    assert res.baseline.maintenance_tasks_completed == 4


def test_baseline_vs_optimized_real_calculation(in_memory_db):
    """Requirement 6: Baseline vs optimized values are calculated from real schedules."""
    res = calculate_asset_availability(db=in_memory_db)
    # Baseline assumes simultaneous closure of all 3 blocks with maintenance
    assert res.baseline.restricted_assets == 3
    assert res.baseline.available_assets == 3  # 6 - 3 = 3
    assert res.baseline.availability_percentage == 50.0

    # Optimized plan staggers closures, so peak concurrent closures are <= baseline
    assert res.optimized.restricted_assets <= res.baseline.restricted_assets
    assert res.optimized.availability_percentage >= res.baseline.availability_percentage


def test_existing_maintenance_bundle_treated_as_coordinated_work(in_memory_db):
    """Requirement 7: Multiple tasks on the same block form a single coordinated block restriction."""
    res = calculate_asset_availability(db=in_memory_db)
    # GNT-BZA-01 had 2 tasks (101 and 102). In optimized plan, it is 1 block restriction
    gnt_bundle = next((b for b in res.optimized.restricted_blocks if b.block_code == "GNT-BZA-01"), None)
    assert gnt_bundle is not None
    assert gnt_bundle.maintenance_tasks_count == 2
    assert "Electrical" in gnt_bundle.departments
    assert "S&T" in gnt_bundle.departments


def test_train_conflicts_integrated(in_memory_db):
    """Requirement 8: Train conflicts are calculated and integrated."""
    res = calculate_asset_availability(db=in_memory_db)
    assert isinstance(res.optimized.train_conflicts, int)
    assert isinstance(res.baseline.train_conflicts, int)
    assert res.optimized.train_conflicts >= 0


def test_crew_resource_constraints_respected(in_memory_db):
    """Requirement 9: Crew capacity and non-overlap constraints are respected across blocks."""
    # Add another task on EE-RJY-01 that requires the SAME crew as RU-TPTY-01 (Track Team A)
    t_shared = Maintenance(
        id=105,
        maintenance_type="Track Alignment",
        department="Engineering",
        crew_type="Track Team",
        priority="Medium",
        status="Planned",
        location_type="block",
        block_code="EE-RJY-01",
        estimated_duration_minutes=60,
        execution_mode="parallel",
        sequence_order=1,
    )
    in_memory_db.add(t_shared)
    in_memory_db.commit()

    res = calculate_asset_availability(db=in_memory_db)
    assert res.optimization_status in ("OPTIMAL", "FEASIBLE")
    assert res.optimized.maintenance_tasks_completed == 5


def test_dependencies_remain_valid(in_memory_db):
    """Requirement 10: Task dependencies remain strictly respected."""
    res = calculate_asset_availability(db=in_memory_db)
    gnt_bundle = next((b for b in res.optimized.restricted_blocks if b.block_code == "GNT-BZA-01"), None)
    assert gnt_bundle is not None
    tasks = gnt_bundle.tasks
    t101 = next((t for t in tasks if t["id"] == 101), None)
    t102 = next((t for t in tasks if t["id"] == 102), None)
    assert t101 is not None and t102 is not None
    # t102 depends on t101, so t102 start must be >= t101 end
    assert t102["start_minute"] >= t101["end_minute"]


def test_staggering_improves_availability(in_memory_db):
    """Requirement 12: Optimizer staggers compatible maintenance across blocks to improve asset availability."""
    res = calculate_asset_availability(
        db=in_memory_db,
        request=AssetAvailabilityOptimizeRequest(stagger_multi_blocks=True),
    )
    # With staggering, peak concurrent restricted blocks should be lower than naive baseline
    assert res.optimized.restricted_assets < res.baseline.restricted_assets
    assert res.optimized.availability_percentage > res.baseline.availability_percentage
    assert res.impact.availability_change_percentage_points > 0


def test_actual_ortools_solver_status_returned(in_memory_db):
    """Requirement 14: Real solver status (OPTIMAL or FEASIBLE) is returned."""
    res = calculate_asset_availability(db=in_memory_db)
    assert res.optimization_status in ("OPTIMAL", "FEASIBLE")


def test_empty_maintenance_network_100_percent(in_memory_db):
    """When no maintenance is planned, network availability is 100%."""
    # Remove all maintenance
    in_memory_db.query(Maintenance).delete()
    in_memory_db.commit()

    res = calculate_asset_availability(db=in_memory_db)
    assert res.total_assets == 6
    assert res.optimized.available_assets == 6
    assert res.optimized.restricted_assets == 0
    assert res.optimized.availability_percentage == 100.0


def test_api_get_and_post_asset_availability(in_memory_db):
    """Requirement 13 & 16: API endpoints return valid response structures."""
    app.dependency_overrides[get_db] = lambda: in_memory_db
    client = TestClient(app)

    # GET endpoint
    get_res = client.get("/ai/asset-availability?planning_window=night&stagger_multi_blocks=true")
    assert get_res.status_code == 200
    data = get_res.json()
    assert "total_assets" in data
    assert "baseline" in data
    assert "optimized" in data
    assert "impact" in data
    assert "timeline" in data
    assert data["human_approval_required"] is True

    # POST endpoint
    post_res = client.post(
        "/ai/asset-availability/optimize",
        json={
            "planning_window": "night",
            "stagger_multi_blocks": True,
            "target_block_codes": ["GNT-BZA-01", "BZA-EE-01"],
        },
    )
    assert post_res.status_code == 200
    post_data = post_res.json()
    assert post_data["total_assets"] == 6
    assert len(post_data["optimized"]["restricted_blocks"]) == 2

    app.dependency_overrides.clear()
