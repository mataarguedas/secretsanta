from fastapi import APIRouter

from app.api import auth, events, health, invites, me
from app.api.paths import API_PREFIX

__all__ = ["API_PREFIX", "api_router"]

api_router = APIRouter(prefix=API_PREFIX)
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(me.router)
api_router.include_router(events.router)
api_router.include_router(invites.router)
