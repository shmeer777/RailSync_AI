from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.block import Block
from app.models.station import Station


router = APIRouter(
    prefix="/blocks",
    tags=["Blocks"],
)


class BlockCreate(BaseModel):
    code: str
    name: str
    start_station_code: str
    end_station_code: str
    distance_km: float | None = None


class BlockResponse(BaseModel):
    id: int
    code: str
    name: str
    start_station_code: str
    end_station_code: str
    distance_km: float | None

    model_config = {
        "from_attributes": True
    }


@router.post("/", response_model=BlockResponse, status_code=201)
def create_block(
    block_data: BlockCreate,
    db: Session = Depends(get_db),
):
    existing_block = db.scalar(
        select(Block).where(Block.code == block_data.code)
    )

    if existing_block:
        raise HTTPException(
            status_code=409,
            detail="Block with this code already exists.",
        )

    start_station = db.scalar(
        select(Station).where(
            Station.code == block_data.start_station_code
        )
    )

    if start_station is None:
        raise HTTPException(
            status_code=404,
            detail=f"Start station '{block_data.start_station_code}' not found.",
        )

    end_station = db.scalar(
        select(Station).where(
            Station.code == block_data.end_station_code
        )
    )

    if end_station is None:
        raise HTTPException(
            status_code=404,
            detail=f"End station '{block_data.end_station_code}' not found.",
        )

    block = Block(
        code=block_data.code,
        name=block_data.name,
        start_station_code=block_data.start_station_code,
        end_station_code=block_data.end_station_code,
        distance_km=block_data.distance_km,
    )

    db.add(block)
    db.commit()
    db.refresh(block)

    return block


@router.get("/", response_model=list[BlockResponse])
def get_blocks(
    db: Session = Depends(get_db),
):
    blocks = db.scalars(
        select(Block).order_by(Block.id)
    ).all()

    return blocks


@router.get("/{block_id}", response_model=BlockResponse)
def get_block(
    block_id: int,
    db: Session = Depends(get_db),
):
    block = db.get(Block, block_id)

    if block is None:
        raise HTTPException(
            status_code=404,
            detail="Block not found.",
        )

    return block