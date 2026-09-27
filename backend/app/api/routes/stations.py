from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.station import Station


router = APIRouter(
    prefix="/stations",
    tags=["Stations"],
)


class StationCreate(BaseModel):
    code: str
    name: str
    latitude: float | None = None
    longitude: float | None = None


class StationResponse(BaseModel):
    id: int
    code: str
    name: str
    latitude: float | None
    longitude: float | None

    model_config = {
        "from_attributes": True
    }


@router.post("/", response_model=StationResponse, status_code=201)
def create_station(
    station_data: StationCreate,
    db: Session = Depends(get_db),
):
    existing_station = db.scalar(
        select(Station).where(Station.code == station_data.code)
    )

    if existing_station:
        raise HTTPException(
            status_code=409,
            detail="Station with this code already exists.",
        )

    station = Station(
        code=station_data.code,
        name=station_data.name,
        latitude=station_data.latitude,
        longitude=station_data.longitude,
    )

    db.add(station)
    db.commit()
    db.refresh(station)

    return station


@router.get("/", response_model=list[StationResponse])
def get_stations(
    db: Session = Depends(get_db),
):
    stations = db.scalars(
        select(Station).order_by(Station.id)
    ).all()

    return stations


@router.get("/{station_id}", response_model=StationResponse)
def get_station(
    station_id: int,
    db: Session = Depends(get_db),
):
    station = db.get(Station, station_id)

    if station is None:
        raise HTTPException(
            status_code=404,
            detail="Station not found.",
        )

    return station