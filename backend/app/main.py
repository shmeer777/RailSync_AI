from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.blocks import router as blocks_router
from app.api.routes.maintenance import router as maintenance_router
from app.api.routes.stations import router as stations_router
from app.api.routes.trains import router as trains_router
from app.api.routes.ai import router as ai_router


app = FastAPI(
    title="RailSync AI",
    description="AI-powered railway maintenance and automatic block planning platform.",
    version="0.1.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:5176",
        "http://127.0.0.1:5176",
    ],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(stations_router)
app.include_router(blocks_router)
app.include_router(maintenance_router)
app.include_router(trains_router)
app.include_router(ai_router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "RailSync AI",
    }