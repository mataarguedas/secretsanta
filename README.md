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

## Production

One VPS (Hetzner CX22, Ubuntu 24.04) runs `infra/docker-compose.yml`:

| Service | Image | Notes |
|---|---|---|
| `caddy` | `ghcr.io/<owner>/santa-web` | Automatic TLS for `APP_DOMAIN`, serves the PWA, proxies `/api/*` and `/ws`. The **only** service with published ports (80, 443 tcp+udp) |
| `api` | `ghcr.io/<owner>/santa-api` | `uvicorn … --workers 2 --proxy-headers` |
| `worker` | `ghcr.io/<owner>/santa-api` | arq: pushes, R2 cleanup, cron jobs (reminders, archive, token pruning, **backups**) |
| `postgres` | `postgres:16` | volume `postgres-data` |
| `redis` | `redis:7` | AOF on, volume `redis-data` |

Every push to `main` runs CI. When CI passes, `.github/workflows/deploy.yml`:
1. builds both images and pushes them to GHCR, tagged with the commit SHA and `latest`
2. copies `docker-compose.yml` and `backup.sh` to `/opt/santa`
3. runs `docker compose pull`, `alembic upgrade head` and `docker compose up -d`
4. checks `https://$APP_DOMAIN/api/v1/health`

### Production `.env`

`/opt/santa/.env` on the server (mode 600, owned by `deploy`). It has the same shape as `infra/.env.example`:

```dotenv
ENV=production
APP_BASE_URL=https://santa.example.com
APP_DOMAIN=santa.example.com

POSTGRES_PASSWORD=<python -c "import secrets; print(secrets.token_hex(24))">
JWT_SECRET=<python -c "import secrets; print(secrets.token_urlsafe(64))">
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
VAPID_PUBLIC_KEY=<uv run python -m app.scripts.gen_vapid_keys>
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com

R2_ACCOUNT_ID=<32 hex chars>
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=secret-santa
# Keep these two EMPTY: storage and presigned photo URLs then use
# https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com, which the CSP allows.
S3_ENDPOINT_URL=
S3_PUBLIC_ENDPOINT_URL=

SENTRY_DSN=
DEFAULT_TIMEZONE=America/Costa_Rica

GHCR_OWNER=mataarguedas
IMAGE_TAG=latest
```

- `DATABASE_URL` and `REDIS_URL` aren't needed. The compose file builds them from `POSTGRES_PASSWORD` and the service names.
- In production, the API won't start unless the JWT, Google, VAPID and R2 settings are set.
- Never change the VAPID pair once phones have subscribed. If you do, every push subscription silently stops working.

### First deploy

Prerequisites (done by hand; see `Instructions.txt`):
- the hostname
- the VPS, with your admin SSH key for `root`
- the R2 bucket and token
- the production secrets
- a separate deploy key pair (`santa_deploy` / `santa_deploy.pub`, no passphrase)

1. **DNS.** Create an `A` record for the hostname that points to the VPS IPv4 (on Cloudflare: *DNS only*, grey cloud). An `AAAA` record is optional. Wait until `nslookup <host>` shows the IP.
2. **Provision the server.** From the repo root, in PowerShell:

   ```powershell
   scp infra/provision.sh infra/docker-compose.yml infra/.env.example infra/backup/backup.sh $HOME\.ssh\santa_deploy.pub root@<host>:/root/
   ssh root@<host> "bash /root/provision.sh /root/santa_deploy.pub"
   ```

   The script is idempotent. It:
   - installs Docker
   - creates the `deploy` user, with your admin key plus the deploy key, the docker group and passwordless sudo
   - turns off root and password SSH logins
   - enables `ufw` (22/tcp, 80/tcp, 443) and unattended upgrades
   - creates `/opt/santa` with the compose file, `backup.sh` and a `.env` template

   **Keep the root session open** until `ssh deploy@<host>` works from a new terminal. From then on, log in as `deploy`.
3. **Fill in `/opt/santa/.env`** with the values above: `ssh deploy@<host>`, then `nano /opt/santa/.env`.
4. **Google OAuth.** In Google Cloud Console › Credentials › your Web client:
   - add the origin `https://<host>`
   - add the redirect URI `https://<host>/api/v1/auth/google/callback`
   - keep the localhost entries

   While the consent screen is in *Testing*, add every Google account that will sign in.
5. **GitHub.** In Settings › Secrets and variables › Actions, add:

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `VPS_HOST` | the hostname (or IP) |
   | Secret | `VPS_USER` | `deploy` |
   | Secret | `VPS_SSH_KEY` | the full contents of the **private** key `santa_deploy` |
   | Secret (optional) | `VPS_KNOWN_HOSTS` | the output of `ssh-keyscan -H <host>`. It pins the host key; without it, each run trusts the key on first use |
   | Variable | `APP_DOMAIN` | the hostname, for the post-deploy health check |
   | Variable (optional) | `VITE_SENTRY_DSN` | the frontend Sentry DSN, compiled into the web image |

   GHCR needs nothing extra. The workflow pushes with its own `GITHUB_TOKEN`, and logs the server in with that token just for the pull, so private packages work.
6. **Push to `main`.** In *Actions*, CI runs, then *Deploy* (build → push → migrate → start → health check). On the server, `docker compose ps` should show every service healthy, and only `caddy` with ports.

To redeploy without a new commit, use Actions › Deploy › *Run workflow*.

To roll back, run this on the server: `cd /opt/santa && IMAGE_TAG=<older sha> docker compose up -d`. Migrations aren't rolled back, so only go back to a commit with the same schema.

### Local production smoke test

This runs the production images on your PC with Caddy's local certificate. It uses a separate compose project, so your dev data isn't touched. If your dev stack is running, the smoke test uses its MinIO on :9000.

1. Copy `infra/.env` to `infra/.env.smoke` (git-ignored) and change these values:

   ```dotenv
   ENV=production
   APP_BASE_URL=https://localhost
   APP_DOMAIN=localhost
   # Dev MinIO, reached from the containers through the host:
   R2_ACCOUNT_ID=
   R2_ACCESS_KEY_ID=<the MinIO root user>
   R2_SECRET_ACCESS_KEY=<the MinIO root password>
   S3_ENDPOINT_URL=http://host.docker.internal:9000
   S3_PUBLIC_ENDPOINT_URL=http://localhost:9000
   CSP_IMG_EXTRA=http://localhost:9000
   # Don't let the browser pin https on localhost (it would break http://localhost:5173):
   HSTS_MAX_AGE=0
   ```

   For Google sign-in, also add `https://localhost` and `https://localhost/api/v1/auth/google/callback` to the OAuth client.
2. Build and start:

   ```powershell
   function smoke { docker compose -p santa-smoke --env-file infra/.env.smoke -f infra/docker-compose.yml @args }
   smoke build
   smoke up -d postgres redis
   smoke run --rm api alembic upgrade head
   smoke up -d
   smoke ps
   ```

3. Open https://localhost and accept the certificate. `curl.exe -skI https://localhost/` should show HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`.
4. Clean up with `smoke down -v`.

### Security headers and caching (Caddy)

- **CSP:**
  - `default-src 'self'`
  - `img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://lh3.googleusercontent.com` (`blob:` is for the cover-photo preview before upload)
  - `connect-src 'self' wss://$APP_DOMAIN`
  - `worker-src 'self'`, `manifest-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`

  Add sources with `CSP_IMG_EXTRA` / `CSP_CONNECT_EXTRA`. With frontend Sentry, set `CSP_CONNECT_EXTRA=https://<org>.ingest.sentry.io`.
- **Other headers:**
  - HSTS for one year
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - a Permissions-Policy that turns off the camera, microphone, geolocation, payment and USB

  Responses are compressed with zstd or gzip.
- **Caching:**
  - `/assets/*` (content-hashed): one year, immutable
  - `index.html` and every SPA route, `sw.js`, `registerSW.js` and the manifest: `no-cache`
  - fonts and icons: one week

### Rotating secrets

Edit `/opt/santa/.env`, then run `cd /opt/santa && docker compose up -d`. Compose recreates the containers whose settings changed.

| Secret | How | Side effects |
|---|---|---|
| `JWT_SECRET` | Generate a new `token_urlsafe(64)` | Access tokens become invalid; clients refresh silently |
| `POSTGRES_PASSWORD` | First run `docker compose exec postgres psql -U santa -d santa -c "ALTER USER santa PASSWORD '<new>';"`, then change `.env` | None. (The volume keeps the old password until you run `ALTER USER`.) |
| `GOOGLE_CLIENT_SECRET` | In Google Cloud Console, add a new secret, update `.env`, then delete the old secret | None |
| R2 token | In Cloudflare, create a new token for the bucket, update `.env`, then delete the old token | None |
| `VAPID_*` | **Don't**, unless the private key leaked | Every push subscription stops working; users must re-enable notifications |
| Deploy key | Create a new key pair. Add the `.pub` to `/home/deploy/.ssh/authorized_keys`, update the `VPS_SSH_KEY` secret, then remove the old line | None |

### Sentry (optional)

- **Backend and worker:** set `SENTRY_DSN` in `/opt/santa/.env`, then run `docker compose up -d`.
  - Events are tagged `component=api|worker`, and failed arq jobs are reported.
  - The `before_send` scrubber drops request bodies, cookies and query strings, and redacts tokens, message bodies, and assignment and anonymity fields.
  - Stack-frame local variables are never sent.
- **Frontend:** set the GitHub variable `VITE_SENTRY_DSN` and `CSP_CONNECT_EXTRA`, then redeploy.
  - Without the DSN, the SDK isn't in the bundle at all.
  - There's no replay and no tracing.
  - Request bodies, cookies, query strings, invite tokens and console breadcrumbs are stripped.

## Backups and restore

**Nightly:** the worker's `backup_database` cron job runs at 02:00 America/Costa_Rica. It runs `pg_dump | gzip` and uploads the result to the R2 bucket as `backups/santa-YYYYMMDD-HHMM.sql.gz` (UTC time). Once the upload succeeds, it deletes backups older than 14 days.

**By hand**, on the server as `deploy`:

```bash
cd /opt/santa
bash backup.sh            # the same job, now: a new backup in R2
bash backup.sh --local    # a dump in /opt/santa/backups/ only (no R2), e.g. before a risky change
docker compose run --rm -T worker python -m app.scripts.backups list    # R2 backups, newest first
```

### Restore

Always restore into a **scratch database** first, and check it:

```bash
cd /opt/santa
KEY=$(docker compose run --rm -T worker python -m app.scripts.backups list | head -1)   # or pick one
docker compose run --rm -T worker python -m app.scripts.backups cat "$KEY" > /tmp/restore.sql.gz
gzip -t /tmp/restore.sql.gz

docker compose exec -T postgres psql -U santa -d postgres -c "DROP DATABASE IF EXISTS santa_restore" -c "CREATE DATABASE santa_restore"
gunzip -c /tmp/restore.sql.gz | docker compose exec -T postgres psql -q -U santa -d santa_restore -v ON_ERROR_STOP=1
docker compose exec -T postgres psql -U santa -d santa_restore -c "select count(*) from users;" -c "select version_num from alembic_version;"
```

To restore from a local `--local` dump, skip the first two commands and use `backups/santa-….sql.gz`.

To **replace production** with that backup:

```bash
docker compose stop caddy api worker
docker compose exec -T postgres psql -U santa -d postgres -c "DROP DATABASE santa WITH (FORCE)" -c "CREATE DATABASE santa"
gunzip -c /tmp/restore.sql.gz | docker compose exec -T postgres psql -q -U santa -d santa -v ON_ERROR_STOP=1
docker compose run --rm api alembic upgrade head      # in case the backup is older than the code
docker compose up -d
docker compose exec -T postgres psql -U santa -d postgres -c "DROP DATABASE santa_restore"
rm /tmp/restore.sql.gz
```

This procedure was tested end to end against the production images: worker backup → R2 (MinIO) → `backups cat` → scratch database → row counts.

Photos aren't in the dump; they stay in R2. A restored database can point at photos that were deleted after the backup was taken. Those photos just don't load.
