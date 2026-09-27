from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.block import Block
from app.models.maintenance import Maintenance
from app.models.train import Train


def detect_train_block_conflicts(
    db: Session,
) -> list[dict]:
    trains = db.scalars(
        select(Train).order_by(Train.id)
    ).all()

    maintenance_records = db.scalars(
        select(Maintenance)
        .where(
            Maintenance.status.notin_(
                ["Completed", "Cancelled"]
            )
        )
        .order_by(Maintenance.id)
    ).all()

    conflicts = []

    for maintenance in maintenance_records:

        # ==========================================================
        # STATION MAINTENANCE
        # ==========================================================
        if maintenance.location_type == "station":
            if not maintenance.station_code:
                continue

            maintenance_station = (
                maintenance.station_code.strip().upper()
            )

            for train in trains:
                if not train.current_station_code:
                    continue

                current_station = (
                    train.current_station_code.strip().upper()
                )

                if current_station != maintenance_station:
                    continue

                severity = "Medium"

                reasons = [
                    (
                        f"Train {train.train_number} is currently at "
                        f"{train.current_station_code}"
                    ),
                    (
                        f"Maintenance is active at station "
                        f"{maintenance.station_code}"
                    ),
                ]

                # Critical priority
                if (
                    maintenance.priority.strip().title()
                    == "Critical"
                    or train.priority.strip().title()
                    == "Critical"
                ):
                    severity = "Critical"
                    reasons.append(
                        "Critical priority requires immediate attention"
                    )

                # High priority
                elif (
                    maintenance.priority.strip().title()
                    == "High"
                    or train.priority.strip().title()
                    == "High"
                ):
                    severity = "High"
                    reasons.append(
                        "High-priority train or maintenance"
                    )

                recommendation = (
                    "Coordinate train movement with station "
                    "maintenance."
                )

                if severity == "Critical":
                    recommendation = (
                        "Immediately protect the station maintenance "
                        "area and prevent conflicting train movement."
                    )
                elif severity == "High":
                    recommendation = (
                        "Coordinate train movement with station "
                        "maintenance and consider holding the train."
                    )

                conflicts.append(
                    {
                        "train_id": train.id,
                        "train_number": train.train_number,
                        "train_name": train.name,
                        "train_status": train.status,
                        "train_priority": train.priority,
                        "current_station_code": (
                            train.current_station_code
                        ),

                        "location_type": "station",

                        "block_id": None,
                        "block_code": None,
                        "block_name": None,
                        "block_start_station": None,
                        "block_end_station": None,

                        "station_code": (
                            maintenance.station_code
                        ),

                        "maintenance_id": maintenance.id,
                        "maintenance_type": (
                            maintenance.maintenance_type
                        ),
                        "maintenance_priority": (
                            maintenance.priority
                        ),
                        "maintenance_status": (
                            maintenance.status
                        ),

                        "severity": severity,
                        "reasons": reasons,
                        "recommendation": recommendation,
                    }
                )

            continue

        # ==========================================================
        # BLOCK MAINTENANCE
        # ==========================================================
        if maintenance.location_type != "block":
            continue

        if not maintenance.block_code:
            continue

        block = db.scalar(
            select(Block).where(
                Block.code == maintenance.block_code
            )
        )

        if block is None:
            continue

        for train in trains:
            if not train.current_station_code:
                continue

            current_station = (
                train.current_station_code.strip().upper()
            )

            start_station = (
                block.start_station_code.strip().upper()
            )

            end_station = (
                block.end_station_code.strip().upper()
            )

            position_matches = current_station in {
                start_station,
                end_station,
            }

            if not position_matches:
                continue

            severity = "Medium"

            reasons = [
                (
                    f"Train {train.train_number} is currently at "
                    f"{train.current_station_code}"
                ),
                (
                    f"Maintenance is active on block "
                    f"{maintenance.block_code}"
                ),
            ]

            # Critical priority
            if (
                maintenance.priority.strip().title()
                == "Critical"
                or train.priority.strip().title()
                == "Critical"
            ):
                severity = "Critical"
                reasons.append(
                    "Critical priority requires immediate attention"
                )

            # High priority
            elif (
                maintenance.priority.strip().title()
                == "High"
                or train.priority.strip().title()
                == "High"
            ):
                severity = "High"
                reasons.append(
                    "High-priority train or maintenance"
                )

            recommendation = (
                "Hold or reroute the train if required."
            )

            if severity == "Critical":
                recommendation = (
                    "Immediately protect the maintenance block "
                    "and prevent conflicting train movement."
                )
            elif severity == "High":
                recommendation = (
                    "Coordinate train movement with maintenance "
                    "and consider holding the train."
                )

            conflicts.append(
                {
                    "train_id": train.id,
                    "train_number": train.train_number,
                    "train_name": train.name,
                    "train_status": train.status,
                    "train_priority": train.priority,
                    "current_station_code": (
                        train.current_station_code
                    ),

                    "location_type": "block",

                    "block_id": block.id,
                    "block_code": block.code,
                    "block_name": block.name,
                    "block_start_station": (
                        block.start_station_code
                    ),
                    "block_end_station": (
                        block.end_station_code
                    ),

                    "station_code": None,

                    "maintenance_id": maintenance.id,
                    "maintenance_type": (
                        maintenance.maintenance_type
                    ),
                    "maintenance_priority": (
                        maintenance.priority
                    ),
                    "maintenance_status": (
                        maintenance.status
                    ),

                    "severity": severity,
                    "reasons": reasons,
                    "recommendation": recommendation,
                }
            )

    return conflicts