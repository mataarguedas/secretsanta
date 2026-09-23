import asyncio
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.api.deps import get_engine, get_redis
from app.core.logging import get_logger

router = APIRouter(tags=["health"])
log = get_logger(__name__)

CHECK_TIMEOUT_S = 3.0

ComponentStatus = Literal["ok", "error"]


class HealthResponse(BaseModel):
    status: ComponentStatus
    db: ComponentStatus
    redis: ComponentStatus


async def _check_db(engine: AsyncEngine) -> ComponentStatus:
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_S), engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:
        log.warning("health_check_failed", component="db", error=type(exc).__name__)
        return "error"
    return "ok"


async def _check_redis(redis: "Redis") -> ComponentStatus:
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_S):
            await redis.ping()
    except Exception as exc:
        log.warning("health_check_failed", component="redis", error=type(exc).__name__)
        return "error"
    return "ok"


@router.get(
    "/health",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse, "description": "A dependency is unavailable"}},
)
async def health(
    engine: AsyncEngine = Depends(get_engine),
    redis: "Redis" = Depends(get_redis),
) -> JSONResponse:
    db_status, redis_status = await asyncio.gather(_check_db(engine), _check_redis(redis))
    ok = db_status == "ok" and redis_status == "ok"
    body = HealthResponse(status="ok" if ok else "error", db=db_status, redis=redis_status)
    return JSONResponse(body.model_dump(), status_code=200 if ok else 503)
