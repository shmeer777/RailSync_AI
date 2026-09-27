import sys
from datetime import datetime, timedelta
from pathlib import Path

# Add backend directory to sys.path
backend_path = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_path))

from sqlalchemy import select
from app.db.session import SessionLocal
from app.models.maintenance import Maintenance
from app.services.ai.maintenance_bundler import bundle_compatible_maintenance


def seed_bundle_data():
    db = SessionLocal()
    try:
        print("Checking GNT-BZA-01 maintenance records...")

        # 1. Check or update ID 10: Electrical Inspection
        t10 = db.get(Maintenance, 10)
        if t10:
            t10.block_code = "GNT-BZA-01"
            t10.location_type = "block"
            t10.maintenance_type = "Electrical Inspection"
            t10.department = "Electrical"
            t10.crew_type = "Electrical Team"
            t10.crew_size = 4
            t10.priority = "Critical"
            t10.status = "Planned"
            t10.estimated_duration_minutes = 60.0
            t10.depends_on_maintenance_id = None
            t10.execution_mode = "sequential"
            t10.sequence_order = 1
            t10.dependency_note = "Prerequisite task for block GNT-BZA-01 power clearance"
            print("Updated task 10 (Electrical Inspection).")
        else:
            t10 = Maintenance(
                id=10,
                block_code="GNT-BZA-01",
                location_type="block",
                maintenance_type="Electrical Inspection",
                department="Electrical",
                crew_type="Electrical Team",
                crew_size=4,
                priority="Critical",
                status="Planned",
                estimated_duration_minutes=60.0,
                depends_on_maintenance_id=None,
                execution_mode="sequential",
                sequence_order=1,
                dependency_note="Prerequisite task for block GNT-BZA-01 power clearance",
            )
            db.add(t10)
            print("Created task 10 (Electrical Inspection).")

        # 2. Check or update ID 2: Track Repair
        t2 = db.get(Maintenance, 2)
        if t2:
            t2.block_code = "GNT-BZA-01"
            t2.location_type = "block"
            t2.maintenance_type = "Track Repair"
            t2.department = "Engineering"
            t2.crew_type = "Track Team"
            t2.crew_size = 6
            t2.priority = "High"
            t2.status = "Planned"
            t2.estimated_duration_minutes = 60.0
            t2.depends_on_maintenance_id = None
            t2.execution_mode = "parallel"
            t2.sequence_order = 1
            t2.dependency_note = "Independent track renewal eligible for parallel execution with safe crews"
            print("Updated task 2 (Track Repair).")

        # 3. Check or create Signal Maintenance depending on task 10
        signal_task = db.scalar(
            select(Maintenance).where(
                Maintenance.block_code == "GNT-BZA-01",
                Maintenance.maintenance_type == "Signal Maintenance",
            )
        )

        if signal_task:
            signal_task.department = "S&T"
            signal_task.crew_type = "S&T Team"
            signal_task.crew_size = 3
            signal_task.priority = "High"
            signal_task.status = "Planned"
            signal_task.estimated_duration_minutes = 90.0
            signal_task.depends_on_maintenance_id = 10
            signal_task.execution_mode = "sequential"
            signal_task.sequence_order = 2
            signal_task.dependency_note = "Depends on Electrical Inspection (ID 10) completion"
            print(f"Updated existing Signal Maintenance task (ID {signal_task.id}).")
        else:
            signal_task = Maintenance(
                block_code="GNT-BZA-01",
                location_type="block",
                maintenance_type="Signal Maintenance",
                department="S&T",
                crew_type="S&T Team",
                crew_size=3,
                priority="High",
                status="Planned",
                estimated_duration_minutes=90.0,
                depends_on_maintenance_id=10,
                execution_mode="sequential",
                sequence_order=2,
                dependency_note="Depends on Electrical Inspection (ID 10) completion",
            )
            db.add(signal_task)
            db.flush()
            print(f"Created new Signal Maintenance task (ID {signal_task.id}).")

        db.commit()

        # Run bundler to test and persist
        print("\nRunning bundler optimization...")
        bundles = bundle_compatible_maintenance(db, target_block_code="GNT-BZA-01", persist=True)

        print(f"Bundles found: {len(bundles)}")
        for b in bundles:
            print(f"\nBundle ID: {b['bundle_id']}")
            print(f"Block: {b['block_code']} ({b['block_name']})")
            print(f"Departments: {b['departments']}")
            print(f"Total Window: {b['total_window_minutes']} min (Unbundled: {b['unbundled_total_minutes']} min)")
            print(f"Time Saved: {b['time_saved_minutes']} min ({b['percent_time_saved']}%)")
            print(f"Explanation:\n{b['explanation']}")
            print("\nTasks in bundle:")
            for task in b['tasks']:
                print(f"  - [{task['bundle_role'].upper()}] {task['maintenance_type']} ({task['department']}): "
                      f"start={task['start_minute']}m, end={task['end_minute']}m (dur={task['duration_minutes']}m)")

    finally:
        db.close()


if __name__ == "__main__":
    seed_bundle_data()
