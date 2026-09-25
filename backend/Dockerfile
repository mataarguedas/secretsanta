# syntax=docker/dockerfile:1
# The "api" image, also used for the worker (compose overrides the command).
#   docker build -t santa-api backend/

ARG PYTHON_IMAGE=python:3.12-slim-bookworm

# ── Build: resolve the locked dependencies into /app/.venv ──────────────────────
FROM ${PYTHON_IMAGE} AS build
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
RUN python -m compileall -q app alembic

# ── Runtime ─────────────────────────────────────────────────────────────────────
FROM ${PYTHON_IMAGE} AS runtime

# postgresql-client-16 (pg_dump for the nightly backup) must match the server's major
# version, so it comes from the PostgreSQL apt repository (Debian ships 15). libheif1 is
# the HEIC runtime (pillow-heif's wheel bundles its own copy; this is the fallback).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    . /etc/os-release; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-16 libheif1; \
    apt-get purge -y curl; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 santa \
    && useradd --system --uid 10001 --gid santa --home-dir /app --shell /usr/sbin/nologin santa

WORKDIR /app
# Owned by root and read-only for the app user.
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER santa
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers", "--forwarded-allow-ips=*"]
