# syntax=docker/dockerfile:1
# The "web" image: Caddy serving the built PWA and proxying /api and /ws to the API.
# The build context is the repository root (it needs infra/Caddyfile):
#   docker build -f frontend/Dockerfile -t santa-web .

# ── Build: dist/ ────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
RUN npm install -g pnpm@12.6.0
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY frontend/ ./
# Optional: frontend Sentry is compiled in only when this is set (see src/lib/sentry.ts).
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
RUN pnpm build

# ── Runtime: Caddy ──────────────────────────────────────────────────────────────
FROM caddy:2
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv/dist
