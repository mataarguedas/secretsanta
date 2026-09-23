"""Test-only login (``POST /api/v1/test/login``). ``create_app`` mounts it **only** when
``ENV=test``; in every other environment the path does not exist (404)."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.cookies import set_session_cookies
from app.api.deps import get_app_settings, get_db
from app.core.config import Settings
from app.models.user import User
from app.schemas.auth import TestLoginRequest
from app.schemas.me import MeResponse
from app.services.auth import issue_session, locale_from_accept_language

router = APIRouter(prefix="/test", tags=["test"])


@router.post("/login", response_model=MeResponse)
async def login_for_tests(
    body: TestLoginRequest,
    request: Request,
    settings: Settings = Depends(get_app_settings),
    session: AsyncSession = Depends(get_db),
) -> JSONResponse:
    if not settings.is_test:  # defense in depth; the router isn't mounted otherwise
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    user = await session.scalar(select(User).where(User.email == body.email))
    if user is None:
        user = User(
            google_sub=f"test:{body.email.lower()}",
            email=body.email,
            name=body.name,
            locale=locale_from_accept_language(request.headers.get("accept-language")),
        )
        session.add(user)
        await session.flush()
    tokens, _ = await issue_session(session, user.id, settings, request.headers.get("user-agent"))
    await session.commit()
    response = JSONResponse(MeResponse.model_validate(user).model_dump(mode="json"))
    set_session_cookies(response, tokens, settings)
    return response
