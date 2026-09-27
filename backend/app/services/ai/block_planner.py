from heapq import heappop, heappush

from ortools.sat.python import cp_model
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.block import Block
from app.models.maintenance import Maintenance
from app.models.train import Train


def _normalize_code(value: str | None) -> str:
    """Normalize station/block codes for safe comparisons."""
    return str(value or "").strip().upper()


def _build_network_graph(blocks: list[Block]) -> dict[str, list[tuple[str, Block, float]]]:
    """
    Build an undirected railway graph.

    Each block connects its start and end station, allowing route
    discovery in either travel direction.
    """
    graph: dict[str, list[tuple[str, Block, float]]] = {}

    for block in blocks:
        start = _normalize_code(block.start_station_code)
        end = _normalize_code(block.end_station_code)

        if not start or not end:
            continue

        distance = float(block.distance_km or 0.0)

        graph.setdefault(start, []).append(
            (end, block, distance)
        )
        graph.setdefault(end, []).append(
            (start, block, distance)
        )

    return graph


def _find_route_blocks(
    graph: dict[str, list[tuple[str, Block, float]]],
    start_station: str,
    destination_station: str,
) -> list[Block] | None:
    """
    Find the shortest available network route using block distances.

    Returns the ordered list of blocks between start and destination.
    """
    start = _normalize_code(start_station)
    destination = _normalize_code(destination_station)

    if not start or not destination:
        return None

    if start == destination:
        return []

    if start not in graph or destination not in graph:
        return None

    # Dijkstra:
    # distance -> station -> previous station/block
    distances: dict[str, float] = {start: 0.0}
    previous: dict[str, tuple[str, Block]] = {}

    queue: list[tuple[float, str]] = [(0.0, start)]

    while queue:
        current_distance, current_station = heappop(queue)

        if current_distance > distances.get(current_station, float("inf")):
            continue

        if current_station == destination:
            break

        for next_station, block, block_distance in graph.get(
            current_station,
            [],
        ):
            candidate_distance = (
                current_distance + block_distance
            )

            if candidate_distance < distances.get(
                next_station,
                float("inf"),
            ):
                distances[next_station] = candidate_distance
                previous[next_station] = (
                    current_station,
                    block,
                )
                heappush(
                    queue,
                    (candidate_distance, next_station),
                )

    if destination not in distances:
        return None

    route_blocks: list[Block] = []
    station = destination

    while station != start:
        if station not in previous:
            return None

        previous_station, block = previous[station]
        route_blocks.append(block)
        station = previous_station

    route_blocks.reverse()
    return route_blocks


def _build_unplanned_record(
    train: Train,
    reason: str,
    status: str = "Held",
) -> dict:
    """Create a consistent plan record for an unplanned train."""
    return {
        "train_id": train.id,
        "train_number": train.train_number,
        "train_name": train.name,
        "priority": train.priority,
        "current_station_code": train.current_station_code,
        "block_id": None,
        "block_code": None,
        "block_name": None,
        "status": status,
        "reason": reason,
    }


def generate_block_plan(db: Session) -> dict:
    """
    Generate a route-aware automatic block allocation plan.

    Core behavior:
    1. Active block maintenance removes only those blocks from
       the planning pool.
    2. Station maintenance does not automatically close blocks.
    3. Each train is routed from its current location to its
       destination using the railway network.
    4. Only the train's NEXT valid route block can be assigned.
    5. CP-SAT resolves competition when multiple trains require
       the same next block.
    6. Higher-priority trains receive higher optimization weight.

    This prevents the previous behavior where a train could be
    assigned to an unrelated block somewhere else in the network.
    """

    trains = db.scalars(
        select(Train).order_by(Train.id)
    ).all()

    blocks = db.scalars(
        select(Block).order_by(Block.id)
    ).all()

    active_maintenance = db.scalars(
        select(Maintenance).where(
            Maintenance.status.notin_(
                ["Completed", "Cancelled"]
            )
        )
    ).all()

    # ------------------------------------------------------------
    # 1. Identify blocks currently unavailable because of
    #    active block maintenance.
    # ------------------------------------------------------------
    maintenance_block_codes = {
        _normalize_code(maintenance.block_code)
        for maintenance in active_maintenance
        if (
            maintenance.location_type == "block"
            and maintenance.block_code
        )
    }

    # Map blocks to active maintenance tasks for detailed route explanations
    maintenance_by_block: dict[str, list[Maintenance]] = {}
    for m in active_maintenance:
        if m.location_type == "block" and m.block_code:
            code = _normalize_code(m.block_code)
            maintenance_by_block.setdefault(code, []).append(m)

    available_blocks = [
        block
        for block in blocks
        if _normalize_code(block.code)
        not in maintenance_block_codes
    ]

    available_block_ids = {
        block.id
        for block in available_blocks
    }

    # ------------------------------------------------------------
    # Basic empty-data handling.
    # ------------------------------------------------------------
    if not trains:
        return {
            "status": "No trains available",
            "total_trains": 0,
            "available_blocks": len(available_blocks),
            "maintenance_block_count": len(
                maintenance_block_codes
            ),
            "planned_trains": 0,
            "unplanned_trains": 0,
            "route_aware": True,
            "plans": [],
        }

    # ------------------------------------------------------------
    # 2. Build the complete railway topology.
    #
    # We use ALL blocks here for route discovery, including blocks
    # currently under maintenance. This is intentional:
    # maintenance should affect availability, not erase the
    # railway's underlying route.
    # ------------------------------------------------------------
    graph = _build_network_graph(blocks)

    # ------------------------------------------------------------
    # 3. Determine each train's NEXT valid route block.
    #
    # We create exactly one candidate block per train.
    # A train cannot jump to a random block farther down the route.
    # ------------------------------------------------------------
    next_route_block: dict[int, Block] = {}
    route_failures: dict[int, str] = {}
    reached_destinations: set[int] = set()

    for train in trains:
        current_station = _normalize_code(
            train.current_station_code
        )

        destination_station = _normalize_code(
            train.destination_station_code
        )

        # If current position is missing, use the source as the
        # planning starting point.
        if not current_station:
            current_station = _normalize_code(
                train.source_station_code
            )

        if not current_station:
            route_failures[train.id] = (
                "Train has no valid current or source station."
            )
            continue

        if not destination_station:
            route_failures[train.id] = (
                "Train has no valid destination station."
            )
            continue

        if current_station == destination_station:
            reached_destinations.add(train.id)
            continue

        route_blocks = _find_route_blocks(
            graph,
            current_station,
            destination_station,
        )

        if route_blocks is None:
            route_failures[train.id] = (
                f"No connected railway route found from "
                f"{current_station} to {destination_station}."
            )
            continue

        if not route_blocks:
            reached_destinations.add(train.id)
            continue

        # The FIRST block is the only valid next assignment.
        next_block = route_blocks[0]

        if next_block.id not in available_block_ids:
            tasks_on_block = maintenance_by_block.get(
                _normalize_code(next_block.code), []
            )
            if len(tasks_on_block) > 1:
                depts = sorted(list({t.department for t in tasks_on_block}))
                route_failures[train.id] = (
                    f"Next route block {next_block.code} is currently unavailable "
                    f"due to coordinated multi-department maintenance ({len(tasks_on_block)} tasks: {', '.join(depts)})."
                )
            else:
                route_failures[train.id] = (
                    f"Next route block {next_block.code} is "
                    f"currently unavailable because of active "
                    f"maintenance."
                )
            continue

        next_route_block[train.id] = next_block

    # ------------------------------------------------------------
    # 4. CP-SAT model.
    #
    # Each train has at most one candidate: its actual next
    # route block.
    #
    # Each block can be used by at most one train during this
    # planning cycle.
    # ------------------------------------------------------------
    model = cp_model.CpModel()

    assignments: dict[tuple[int, int], cp_model.IntVar] = {}

    for train_id, block in next_route_block.items():
        assignments[(train_id, block.id)] = model.NewBoolVar(
            f"train_{train_id}_next_block_{block.id}"
        )

    # A train can have at most one assignment.
    for train in trains:
        train_variables = [
            variable
            for (train_id, _), variable in assignments.items()
            if train_id == train.id
        ]

        if train_variables:
            model.Add(sum(train_variables) <= 1)

    # A block can be assigned to at most one train.
    for block in available_blocks:
        block_variables = [
            variable
            for (train_id, block_id), variable in assignments.items()
            if block_id == block.id
        ]

        if block_variables:
            model.Add(sum(block_variables) <= 1)

    priority_weight = {
        "Critical": 40,
        "High": 30,
        "Medium": 20,
        "Low": 10,
        "Normal": 10,
    }

    objective_terms = []

    for train in trains:
        block = next_route_block.get(train.id)

        if block is None:
            continue

        variable = assignments[(train.id, block.id)]

        priority = str(
            train.priority or "Normal"
        ).strip().title()

        weight = priority_weight.get(
            priority,
            10,
        )

        # Priority is the primary objective.
        objective_terms.append(
            weight * 1000 * variable
        )

    if objective_terms:
        model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0

    if objective_terms:
        status = solver.Solve(model)
    else:
        status = cp_model.OPTIMAL

    if objective_terms and status not in {
        cp_model.OPTIMAL,
        cp_model.FEASIBLE,
    }:
        plans = [
            _build_unplanned_record(
                train,
                route_failures.get(
                    train.id,
                    "No feasible route-aware allocation found.",
                ),
                status="Unplanned",
            )
            for train in trains
        ]

        return {
            "status": "No feasible plan",
            "total_trains": len(trains),
            "available_blocks": len(available_blocks),
            "maintenance_block_count": len(
                maintenance_block_codes
            ),
            "planned_trains": 0,
            "unplanned_trains": len(trains),
            "route_aware": True,
            "plans": plans,
        }

    # ------------------------------------------------------------
    # 5. Convert solver results to API response.
    # ------------------------------------------------------------
    plans: list[dict] = []

    for train in trains:
        # Train already reached its destination.
        if train.id in reached_destinations:
            plans.append(
                _build_unplanned_record(
                    train,
                    "Train is already at its destination; "
                    "no forward block assignment is required.",
                    status="At Destination",
                )
            )
            continue

        # Route could not be established or next block is under
        # maintenance.
        if train.id in route_failures:
            plans.append(
                _build_unplanned_record(
                    train,
                    route_failures[train.id],
                    status="Held",
                )
            )
            continue

        block = next_route_block.get(train.id)

        if block is None:
            plans.append(
                _build_unplanned_record(
                    train,
                    "No valid next route block was identified.",
                    status="Held",
                )
            )
            continue

        variable = assignments[(train.id, block.id)]

        if solver.Value(variable) == 1:
            plans.append(
                {
                    "train_id": train.id,
                    "train_number": train.train_number,
                    "train_name": train.name,
                    "priority": train.priority,
                    "current_station_code": (
                        train.current_station_code
                    ),
                    "block_id": block.id,
                    "block_code": block.code,
                    "block_name": block.name,
                    "status": "Planned",
                    "reason": (
                        "Route-aware CP-SAT assignment: "
                        f"{block.code} is the next valid block "
                        "on the train's route."
                    ),
                }
            )
        else:
            plans.append(
                _build_unplanned_record(
                    train,
                    (
                        f"The next route block {block.code} "
                        "was contested by another higher-priority "
                        "train in this planning cycle."
                    ),
                    status="Held",
                )
            )

    planned_count = sum(
        1
        for plan in plans
        if plan["status"] == "Planned"
    )

    from app.services.ai.maintenance_bundler import bundle_compatible_maintenance
    bundles = bundle_compatible_maintenance(db)

    return {
        "status": "Plan generated",
        "total_trains": len(trains),
        "available_blocks": len(available_blocks),
        "maintenance_block_count": len(
            maintenance_block_codes
        ),
        "planned_trains": planned_count,
        "unplanned_trains": (
            len(trains) - planned_count
        ),
        "route_aware": True,
        "plans": plans,
        "maintenance_bundles": [
            {
                "bundle_id": b["bundle_id"],
                "block_code": b["block_code"],
                "total_tasks": b["total_tasks"],
                "departments": b["departments"],
                "total_window_minutes": b["total_window_minutes"],
                "time_saved_minutes": b["time_saved_minutes"],
            }
            for b in bundles
        ],
    }