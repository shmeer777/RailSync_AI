from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.station import Station
from app.models.train import Train


router = APIRouter(
    prefix="/trains",
    tags=["Trains"],
)


class TrainCreate(BaseModel):
    train_number: str
    name: str
    train_type: str
    source_station_code: str
    destination_station_code: str
    current_station_code: str | None = None
    status: str = "Running"
    delay_minutes: int = 0
    speed_kmph: float = 0
    direction: str = "Forward"
    priority: str = "Normal"


class TrainResponse(BaseModel):
    id: int
    train_number: str
    name: str
    train_type: str
    source_station_code: str
    destination_station_code: str
    current_station_code: str | None
    status: str
    delay_minutes: int
    speed_kmph: float
    direction: str
    priority: str

    model_config = {
        "from_attributes": True
    }


def station_exists(
    db: Session,
    station_code: str,
) -> bool:
    return db.scalar(
        select(Station).where(
            Station.code == station_code
        )
    ) is not None


@router.post(
    "/",
    response_model=TrainResponse,
    status_code=201,
)
def create_train(
    train_data: TrainCreate,
    db: Session = Depends(get_db),
):
    existing_train = db.scalar(
        select(Train).where(
            Train.train_number == train_data.train_number
        )
    )

    if existing_train:
        raise HTTPException(
            status_code=409,
            detail="Train with this number already exists.",
        )

    if not station_exists(
        db,
        train_data.source_station_code,
    ):
        raise HTTPException(
            status_code=404,
            detail=(
                f"Source station "
                f"'{train_data.source_station_code}' not found."
            ),
        )

    if not station_exists(
        db,
        train_data.destination_station_code,
    ):
        raise HTTPException(
            status_code=404,
            detail=(
                f"Destination station "
                f"'{train_data.destination_station_code}' not found."
            ),
        )

    if (
        train_data.current_station_code
        and not station_exists(
            db,
            train_data.current_station_code,
        )
    ):
        raise HTTPException(
            status_code=404,
            detail=(
                f"Current station "
                f"'{train_data.current_station_code}' not found."
            ),
        )

    train = Train(
        train_number=train_data.train_number,
        name=train_data.name,
        train_type=train_data.train_type,
        source_station_code=train_data.source_station_code,
        destination_station_code=train_data.destination_station_code,
        current_station_code=train_data.current_station_code,
        status=train_data.status,
        delay_minutes=train_data.delay_minutes,
        speed_kmph=train_data.speed_kmph,
        direction=train_data.direction,
        priority=train_data.priority,
    )

    db.add(train)
    db.commit()
    db.refresh(train)

    return train


@router.get(
    "/",
    response_model=list[TrainResponse],
)
def get_trains(
    db: Session = Depends(get_db),
):
    trains = db.scalars(
        select(Train).order_by(Train.id)
    ).all()

    return trains


@router.get(
    "/{train_id}",
    response_model=TrainResponse,
)
def get_train(
    train_id: int,
    db: Session = Depends(get_db),
):
    train = db.get(Train, train_id)

    if train is None:
        raise HTTPException(
            status_code=404,
            detail="Train not found.",
        )

    return train
