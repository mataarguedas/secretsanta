# Secret Santa

Secret Santa is a responsive PWA for organizing gift exchanges. People sign in with Google, host or join events through an invite link, keep photo wishlists for each event, set exclusion rules, and let the host run a secret draw (the "reveal"). The app also has direct, anonymous ("Secret Elf #N") and group chat, plus Web Push notifications. The UI is in Spanish (default) and English, and the only currency is CRC (₡).

| Doc | What it is |
|---|---|
| [`PRD.md`](PRD.md) | Product spec, the source of truth for behavior |
| [`DESIGN.md`](DESIGN.md) | Visual spec, the source of truth for look and feel |
| [`CLAUDE.md`](CLAUDE.md) | Engineering guide: stack, layout, conventions and **all dev commands** |
| [`PROMPTS.md`](PROMPTS.md) | Step-by-step build plan with manual tests |

**Stack:** React 18 + Vite + Tailwind v4 (frontend), FastAPI + SQLAlchemy async + arq (backend), PostgreSQL 16, Redis 7, Cloudflare R2 (MinIO locally). Production runs on Docker Compose behind Caddy.

## Repository layout

```
frontend/   React PWA (Vite, pnpm)
backend/    FastAPI API + arq worker (uv)
infra/      Docker Compose files, Caddyfile, backup scripts, .env.example
.github/    CI and deploy workflows
```

See CLAUDE.md §4 for the full tree.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Compose v2)
- Python 3.12 and [`uv`](https://docs.astral.sh/uv/)
- Node 22.12+ (24 LTS recommended) and `pnpm` 12 (`npm i -g pnpm`, or `corepack enable`)
- Git
- Optional: [`exiftool`](https://exiftool.org/), to check that photo metadata is stripped

## First-time setup

1. **Create your env file.** It's git-ignored.

   ```powershell
   Copy-Item infra/.env.example infra/.env
   ```

   For the local stack, set at least these values:
   - `POSTGRES_PASSWORD`. Use the same password inside `DATABASE_URL`.
   - `R2_ACCESS_KEY_ID` (≥ 3 chars) and `R2_SECRET_ACCESS_KEY` (≥ 8 chars). In dev, these are also the MinIO root user and password.

   The Google, JWT and VAPID secrets come in later milestones.

2. **Start the local infrastructure** (Postgres, Redis, and MinIO standing in for R2):

   ```powershell
   function dc { docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml @args }
   dc up -d postgres redis minio minio-init
   dc ps
   ```

   postgres, redis and minio should show `healthy`. `minio-init` should exit with code 0 after it creates the private `secret-santa` bucket.

| Service | Address |
|---|---|
| PostgreSQL | `localhost:5432` (user/db `santa`) |
| Redis | `localhost:6379` |
| MinIO S3 API | http://localhost:9000 |
| MinIO console | http://localhost:9001 (log in with the R2 key/secret) |
| Frontend (Vite) | http://localhost:5173, which proxies `/api` and `/ws` to :8000 |
| API | http://localhost:8000 |

The dev ports are bound to `127.0.0.1` only. If a native PostgreSQL already uses port 5432 (for example a Windows `postgresql-x64-*` service), set `POSTGRES_HOST_PORT=5433` in `infra/.env` and use the same port in `DATABASE_URL`. Data lives in the named volumes `postgres-data`, `redis-data` and `minio-data`, so it survives `dc down`. To wipe everything, run `dc down -v`.

3. **Run the backend and frontend.** Use the commands in [CLAUDE.md §5](CLAUDE.md#5-commands).

## Backups and restore

TODO(prompt 29): nightly `pg_dump` to R2 and the restore steps.
