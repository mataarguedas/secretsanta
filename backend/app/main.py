"""FastAPI app factory: settings, logging, Sentry, middleware, error handlers and routers."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from arq import create_pool
from arq.connections import RedisSettings
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
from app.realtime.bridge import RedisBridge
from app.realtime.endpoint import router as realtime_router
from app.realtime.manager import ConnectionManager

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
        # arq's pool: jobs for the worker (enqueued only after a commit, worker/queue.py).
        app.state.arq = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        # Realtime: this process's sockets, fed by its Redis subscriber (CLAUDE.md §7).
        app.state.ws_manager = ConnectionManager()
        app.state.ws_bridge = RedisBridge(settings.redis_url, app.state.ws_manager)
        await app.state.ws_bridge.start()
        log.info("startup", env=settings.env)
        try:
            yield
        finally:
            await app.state.ws_bridge.stop()
            await app.state.arq.aclose()
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
    app.include_router(realtime_router)  # /ws, outside the /api/v1 prefix
    if settings.is_test:
        # Test-only login; never mounted in development or production.
        app.include_router(testing.router, prefix=API_PREFIX)
    return app


app = create_app()
