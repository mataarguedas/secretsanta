"""FastAPI app factory: settings, logging, Sentry, middleware, error handlers and routers."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import testing
from app.api.router import API_PREFIX, api_router
from app.core.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.middleware import AccessLogMiddleware, CSRFHeaderMiddleware, UnhandledErrorMiddleware
from app.core.rate_limit import register_rate_limiting
from app.core.redis import create_redis
from app.core.sentry import init_sentry
from app.db.engine import create_engine
from app.db.session import create_sessionmaker

log = get_logger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    init_sentry(settings, component="api")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_engine(settings)
        redis = create_redis(settings.redis_url)
        app.state.engine = engine
        app.state.sessionmaker = create_sessionmaker(engine)
        app.state.redis = redis
        log.info("startup", env=settings.env)
        try:
            yield
        finally:
            await redis.aclose()
            await engine.dispose()
            log.info("shutdown")

    docs_enabled = not settings.is_production
    app = FastAPI(
        title="Secret Santa API",
        version="0.1.0",
        lifespan=lifespan,
        openapi_url=f"{API_PREFIX}/openapi.json" if docs_enabled else None,
        docs_url=f"{API_PREFIX}/docs" if docs_enabled else None,
        redoc_url=None,
    )
    app.state.settings = settings

    # Added innermost → outermost: the access log wraps everything, including CSRF rejections.
    app.add_middleware(CSRFHeaderMiddleware)
    app.add_middleware(UnhandledErrorMiddleware)
    app.add_middleware(AccessLogMiddleware)

    register_exception_handlers(app)
    register_rate_limiting(app)
    app.include_router(api_router)
    if settings.is_test:
        # Test-only login; never mounted in development or production.
        app.include_router(testing.router, prefix=API_PREFIX)
    return app


app = create_app()
