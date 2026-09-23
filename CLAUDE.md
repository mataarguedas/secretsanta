# CLAUDE.md — Secret Santa

Read this file first in every session.

- **Product spec:** `PRD.md` (source of truth for behavior).
- **Visual spec:** `DESIGN.md` (source of truth for look and feel), with the approved deviations listed in §6 below.
- If PRD.md and this file disagree about *behavior*, PRD.md wins. If they disagree about *engineering practice*, this file wins.

---

## 1. What we're building

A responsive **PWA** (no native apps, no app stores) where Google-authenticated users host and join Secret Santa events.

Core features:
- Invite links
- Per-event photo wishlists (max 3 photos per item)
- Host-defined exclusion rules
- A host-triggered **reveal** (the draw)
- Direct, anonymous ("Secret Elf #N") and group chat
- Web Push notifications
- Spanish (default) and English

Currency is **CRC only**. Expected load is ~50 users; the design must support 5k.

## 2. Non-negotiable invariants

Break any of these and the product is broken. Each one has tests in `backend/tests/invariants/`.

1. **Assignment secrecy.** A user can read only the assignment where they are the giver. The host gets nothing extra. Never:
   - return, log, or put an assignment in a push, WS frame or Sentry breadcrumb
   - create an endpoint that lists assignments
2. **Anonymous-initiator secrecy.** For a `conversation_members` row with `is_anonymous = true`, the `user_id`, name, email and avatar **never** leave the backend: not in REST, WS, push payloads, logs or error messages. Serialize members only through `MemberPublic` (id, display_name, avatar_url | null, is_self), whose builder handles anonymity. Also:
   - Messages reference `sender_member_id`, never `user_id`.
   - `anon_number` is random and unique per event, assigned per thread.
   - There is no presence, typing indicator or read receipt anywhere.
3. **Frozen roster after draw.** In `drawn`/`archived` states, join, leave, remove and exclusion edits all return `409 EVENT_ALREADY_DRAWN`. Account deletion returns `409 ACCOUNT_IN_ACTIVE_DRAW` while the user is in a `drawn` event.
4. **Draw atomicity.** The draw runs in one transaction with `SELECT … FOR UPDATE` on the event, and only when the state is `open` and there are ≥ 3 participants.
5. **Wishlist push never names the owner.**
6. **Archived = read-only** for everything in that event.
7. **Authorization on every route:** event-membership / host / ownership checks go through the shared dependencies in `app/api/deps.py`. Never inline ad-hoc checks.

## 3. Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript (strict), Vite, React Router, TanStack Query, react-i18next, Tailwind CSS v4, `vite-plugin-pwa` (injectManifest strategy, custom SW), React Hook Form + Zod |
| Backend | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.0 (async, asyncpg), Alembic, Authlib (Google OAuth), PyJWT, `pywebpush`, Pillow + `pillow-heif`, `boto3` (R2 via S3 API), arq (Redis jobs/cron), `redis.asyncio`, slowapi, `sentry-sdk`, structlog |
| Tooling | `uv` (Python), `pnpm` (JS), Ruff + mypy (strict), ESLint + Prettier, pytest + pytest-asyncio + Hypothesis, Vitest + Testing Library, Playwright (e2e) |
| Data | PostgreSQL 16, Redis 7, Cloudflare R2 (MinIO locally) |
| Infra | Docker Compose on a Hetzner VPS, Caddy (TLS + static + reverse proxy), GitHub Actions → GHCR → SSH deploy, Sentry |

Do not add dependencies outside this list without noting why in the PR description.

## 4. Repository layout

```
/
├── CLAUDE.md  PRD.md  DESIGN.md  README.md
├── frontend/
│   ├── public/                 # icons, apple-touch-icon, fonts (self-hosted woff2)
│   ├── src/
│   │   ├── app/                # router, providers, layout shells (DesktopHeader, BottomTabBar)
│   │   ├── features/           # one folder per domain: auth, events, invites, exclusions,
│   │   │                       #   draw, wishlist, chat, notifications, profile
│   │   │   └── <feature>/      #   api.ts (TanStack hooks), components/, pages/, schemas.ts
│   │   ├── components/ui/      # design-system primitives (Button, Pill, Card, Avatar, Input,
│   │   │                       #   Eyebrow, Banner, Modal, Sheet, Toast, Tabs, Carousel)
│   │   ├── lib/                # apiClient, ws client, formatters (money, dates), push helpers
│   │   ├── i18n/               # es.json, en.json, index.ts
│   │   ├── styles/             # tokens.css (@theme), base.css, fonts.css
│   │   └── sw.ts               # service worker: precache, push, notificationclick
│   ├── e2e/                    # Playwright
│   └── vite.config.ts
├── backend/
│   ├── app/
│   │   ├── main.py             # app factory, middleware, routers
│   │   ├── core/               # config (pydantic-settings), security, logging, errors
│   │   ├── db/                 # engine, session, base, mixins (UUIDv7, timestamps)
│   │   ├── models/             # SQLAlchemy models (one file per aggregate)
│   │   ├── schemas/            # Pydantic request/response models
│   │   ├── api/                # routers per domain + deps.py
│   │   ├── services/           # business logic; draw.py is PURE (no I/O)
│   │   ├── realtime/           # WS endpoint, connection manager, Redis pub/sub bridge
│   │   ├── notifications/      # push sender, templates/{es,en}.py, preference checks
│   │   ├── storage/            # R2 client, image processing pipeline
│   │   └── worker/             # arq settings, tasks, cron jobs
│   ├── alembic/
│   └── tests/                  # unit/, api/, invariants/, conftest.py
├── infra/
│   ├── docker-compose.yml      # production
│   ├── docker-compose.dev.yml  # dev overrides: MinIO, hot reload, exposed ports
│   ├── Caddyfile
│   ├── backup/                 # pg_dump → R2 script
│   └── .env.example
└── .github/workflows/          # ci.yml, deploy.yml
```

Routers stay thin: validate, call a service, serialize. Business rules live in `services/`.

## 5. Commands

```bash
# First-time setup
cp infra/.env.example infra/.env        # fill in the Google, VAPID, R2 and JWT secrets
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d postgres redis minio

# Backend
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
uv run arq app.worker.settings.WorkerSettings        # worker (separate terminal)
uv run pytest                                         # all tests
uv run ruff check . && uv run ruff format --check . && uv run mypy app
uv run alembic revision --autogenerate -m "msg"      # review the generated file before committing!

# Frontend
cd frontend
pnpm install
pnpm dev                                              # Vite on :5173, proxies /api and /ws to :8000
pnpm test            # vitest
pnpm lint && pnpm typecheck
pnpm e2e             # playwright (needs backend running)
pnpm build

# Utilities
uv run python -m app.scripts.gen_vapid_keys           # generate the VAPID keypair
```

Local development runs on `http://localhost`. Google OAuth and Web Push both allow localhost.

## 6. Design system implementation (from DESIGN.md)

### 6.1 Tokens
`frontend/src/styles/tokens.css` contains the Tailwind v4 `@theme` block from DESIGN.md **verbatim**, plus these additions:

```css
@theme {
  /* approved deviation: feedback colors (text/icons/toasts only) */
  --color-success: #2E7D4F;
  --color-error:   #C62828;
  /* font substitutes */
  --font-serif: 'Playfair Display', Georgia, serif;          /* for GascogneTS */
  --font-sans:  'Inter', ui-sans-serif, system-ui, sans-serif; /* for Basis Grotesque Pro */
  --font-mono:  'JetBrains Mono', ui-monospace, monospace;   /* for BasisGrotesquePro-Mono */
}
```

- Self-host the fonts (woff2 in `public/fonts`), with `font-display: swap`.
- Never hard-code hex values in components. Use the tokens.

### 6.2 Rules
- The page background is always `bg-cream-linen`. Cards are `bg-pure-white`, square corners, and have a 1px border: `border-mist` for content, `border-ink-black` for interactive.
- **No `shadow-*` classes. Ever.** Add a lint rule (an ESLint Tailwind-class ban) to enforce it.
- **Every clickable element is a pill** (`rounded-full` / 999px). Cards and images may be square.
- **Coral:**
  - `Button variant="primary"` (coral fill) at most **once per viewport**.
  - `Banner` (coral strip) at most once per screen.
  - Coral is never a large background elsewhere.
- **Button variants:**
  - `primary`: coral fill, white text
  - `secondary`: terracotta 1px outline + text
  - `nav`: black 1px outline
  - `ghost`: text only
- Button padding is 6px × 19px, content-sized (`w-auto`). A full-width button is allowed **only** on mobile forms as the sticky bottom submit, and it's still a pill.
- **Type:**
  - `font-serif` (500) for headings, event names and the wordmark.
  - `font-sans` 400 for all UI. **No bold** body text; emphasis comes from serif, size or color.
  - Positive tracking: `tracking-[0.028em]` body default.
  - `Eyebrow` component: `font-mono uppercase text-coral-pop tracking-[0.056em] text-sm`, used for state labels (`OPEN`, `DRAWN`, `ARCHIVED`), `HOSTING`, and `SECRET ELF #N`.
- **Success/error green/red** appear only in `Toast`, inline field errors, and status icons/text. Never as buttons, borders of cards, or backgrounds larger than a toast.
- **Avatars:** `Avatar` circle with a 1px black border. Anonymous members use a cream circle with a mono "✦" glyph and no image.
- **Imagery:** no illustrations or stock art. Empty states are a serif headline, one line of sans body, and one CTA.
- **Layout:**
  - `max-w-[1200px] mx-auto`
  - Section gap: 64px desktop, 32px mobile.
  - Card padding 20px, element gap 15px.
- **Navigation:**
  - ≥ 768px: `DesktopHeader`, with nav pills (Events, Chats) on the left, the centered "Secret Santa" serif wordmark, and the profile avatar on the right.
  - < 768px: compact top bar with the centered wordmark, plus a fixed `BottomTabBar` (Events · Chats · Profile) with pill-shaped active state (coral fill on the active tab icon label pill) and `padding-bottom: env(safe-area-inset-bottom)`.
- **Accessibility:**
  - Focus ring: `outline-2 outline-offset-2 outline-ink-black`.
  - Hit targets ≥ 44px.
  - Every icon-only button needs an `aria-label` (translated).
  - Toasts use `aria-live="polite"`.
  - Primary button text is 18px (contrast mitigation; see PRD §9.4).
- Build every UI primitive in `components/ui/` first, with a Vitest render test each. Feature code composes primitives and never styles raw `<button>`s.

## 7. Backend conventions

- **Config:** `app/core/config.py` (pydantic-settings). All secrets come from env; nothing is hard-coded. `APP_BASE_URL` drives the OAuth redirect, cookie domain and push click URLs.
- **IDs:** UUIDv7, generated in Python. **Timestamps:** `timestamptz`, stored in UTC. **Money:** integer colones (`*_crc` columns). No floats.
- **Errors:**
  - Raise `AppError(code, http_status, **params)`.
  - The handler returns `{"error": {"code", "message"}}`.
  - Codes are SCREAMING_SNAKE and stable, because the frontend translates them. Keep a registry in `core/errors.py`.
- **Auth:**
  - `deps.current_user` reads the `access_token` cookie.
  - Refresh rotation happens at `/auth/refresh`. The frontend `apiClient` retries once on 401 after calling refresh.
  - Mutating requests must carry `X-Requested-With: fetch`; middleware rejects them otherwise.
- **Authorization deps:**
  - `require_participant(event_id)`
  - `require_host(event_id)`
  - `require_event_state(*states)`
  - `require_member(conversation_id)`
  - `require_wishlist_owner(item_id)`
- **Draw:**
  - `services/draw.py` exposes `is_feasible(participants, exclusions) -> bool` and `draw(participants, exclusions, rng) -> dict[giver, receiver]`. Both are pure, with the RNG injected.
  - Use Hopcroft–Karp for feasibility, and randomized backtracking with matching-based pruning for the draw (PRD §6).
  - Tests: Hypothesis property tests (bijection, no self, no excluded pair) plus infeasible fixtures.
- **Exclusions:** store in canonical order (`user_a_id < user_b_id`). The "group" helper expands to all pairs server-side.
- **Uploads:**
  - Read at most 10 MB and sniff the MIME type (don't trust the extension).
  - Pillow with `pillow-heif`: `ImageOps.exif_transpose`, then strip all metadata, resize to 1600px long edge, WebP q=82, plus a 400px thumbnail.
  - Store in R2 as `events/{event_id}/items/{item_id}/{uuid}.webp`.
  - Enforce the 3-photo limit in both the service and a DB trigger.
  - Serve via presigned GET URLs (1 h).
  - Processing is synchronous in the request for v1 (small files); keep the function worker-safe for later.
- **Deletion cleanup:** R2 object deletion goes through an arq task (`delete_objects(keys)`) enqueued after commit.
- **Chat and realtime:**
  - `/ws` authenticates by cookie.
  - The `ConnectionManager` is per-process. Cross-process fan-out uses Redis pub/sub (`conv:{id}`, `user:{id}`). Never assume a single process.
  - Persist the message first, then publish, then enqueue the push task.
  - Client `active` frames are stored in Redis (`active:{user_id}` → conversation_id, TTL 60 s, refreshed on heartbeat) to suppress pushes.
- **Serialization of chat:** always go through `schemas/chat.py::build_member_public(member, viewer)`. Unit test: serializing an anonymous member for any non-self viewer never contains the user id, email or name.
- **Notifications:**
  - `notifications/sender.py::notify(user_ids, kind, context)` checks preferences, renders localized templates, sends to all subscriptions, and deletes a subscription on 404/410.
  - Always called from the worker, never inline in requests.
  - `wishlist_updated` is debounced with a Redis key `wl_debounce:{event}:{owner}` (TTL 600 s).
- **Cron jobs** (arq): reminders (every 15 min, idempotent via `notification_log`), auto-archive, token pruning, backups. The timezone for "09:00" is `America/Costa_Rica`.
- **Logging:** structlog JSON. Never log message bodies, assignment pairs, anonymous member→user mappings, tokens or cookies. Add a Sentry `before_send` scrubber for the same fields.
- **Rate limits** (slowapi, Redis storage):
  - Auth: 10/min/IP
  - Messages: 30/min/user
  - Uploads: 20/min/user
- **Migrations:** Alembic only; never `create_all` outside tests. Review autogenerated diffs. Use one migration per logical change.

## 8. Frontend conventions

- All server state goes through TanStack Query hooks in `features/*/api.ts`. Query keys are `['events', id]`, `['conversations', {eventId}]`, and so on. No server data in React context.
- `lib/apiClient.ts` is a fetch wrapper. It sets `credentials: 'include'` and `X-Requested-With`, does the 401 → refresh → retry-once flow, and throws `ApiError(code)`. UI maps `code` → `t('errors.CODE')`.
- `lib/ws.ts` is a single reconnecting WebSocket (exponential backoff up to 30 s, 25 s heartbeat). Incoming messages update the TanStack cache via `queryClient.setQueryData`. Outgoing messages are optimistic with `client_id` and reconciled on `ack`.
- **Forms:** React Hook Form + Zod schemas that mirror the backend limits (PRD §4.2 and §4.6).
- **i18n:**
  - Every user-facing string goes through `t()`. No literals in JSX. `es` is the default and fallback.
  - Keys are namespaced by feature (`events.create.title`).
  - Money is formatted with `Intl.NumberFormat('es-CR', {style:'currency', currency:'CRC', maximumFractionDigits:0})`.
  - Dates use `Intl.DateTimeFormat(locale)`.
- **Push UX** (`features/notifications`):
  - Detect support (`'PushManager' in window`), iOS, and standalone mode (`navigator.standalone` / `display-mode: standalone`).
  - On iOS when not standalone, show `IosInstallGuide` instead of the enable button.
  - Call `Notification.requestPermission()` **only inside a click handler**.
  - Subscribe with the VAPID key from `/push/vapid-public-key`, then POST the subscription.
- **Service worker (`sw.ts`):**
  - Workbox precache of the app shell.
  - `push` → `showNotification(title, {body, tag, data:{url}, icon, badge})`.
  - `notificationclick` → focus an existing client and navigate, or `clients.openWindow(url)`.
- **Routing:**
  - `/` (landing or dashboard)
  - `/events/new`
  - `/events/:id/:tab?`
  - `/join/:token`
  - `/chats`
  - `/chats/:conversationId`
  - `/profile`
  - `/privacy`
  - `/terms`

  Protected routes redirect to `/` with `next`.
- **Responsiveness:** mobile-first Tailwind. Test every screen at 320, 768 and 1200 widths. The chat thread uses `100dvh` layout, with the composer staying above the iOS keyboard.

## 9. Testing requirements

- **Backend**, coverage ≥ 85% on `services/` and `api/`:
  - `tests/invariants/test_assignment_secrecy.py`: for every GET endpoint and WS frame type, as the host and as others, assert that no other giver→receiver pair appears.
  - `tests/invariants/test_anonymity.py`: create an anonymous thread, hit every chat endpoint, the WS, and the rendered push payload as the recipient, then grep the raw JSON for the initiator's user_id, email and name. Assert absent.
  - `tests/invariants/test_frozen_roster.py`: after the draw, join, leave, remove, exclusion edits and account deletion all return 409.
  - Draw: Hypothesis property tests, plus the nuclear-family and infeasible fixtures.
  - Tests use a real Postgres (docker service in CI), not SQLite.
- **Frontend:** a Vitest test for each UI primitive and each form's validation. Include an axe check (`vitest-axe`) on key pages.
- **E2E (Playwright):** the create → join (2 extra users via auth-bypass test fixture, enabled only when `ENV=test`) → exclusions → reveal → wishlist → anonymous chat happy path, run in both locales and at mobile and desktop viewports.

## 10. Deployment

- **Production compose** has these services:
  - `caddy`: ports 80/443; serves `frontend/dist`; proxies `/api/*` and `/ws` to `api:8000`
  - `api`: `uvicorn app.main:app --workers 2 --proxy-headers`
  - `worker`
  - `postgres`: volume
  - `redis`: AOF on

  All services use `restart: unless-stopped`, and only Caddy is exposed.
- **Hostname:** production needs one (see PRD §11.1). Google OAuth rejects IP redirect URIs, and Web Push requires HTTPS. Everything reads `APP_BASE_URL`/`APP_DOMAIN` from env, and the Caddyfile uses `{$APP_DOMAIN}` for automatic TLS.
- **CI (`ci.yml`, on PR):**
  - backend: ruff, mypy, pytest with postgres and redis services
  - frontend: lint, typecheck, vitest, build
  - Playwright on `main` only
- **Deploy (`deploy.yml`, on push to `main`):**
  1. Build and push `api` (also used for the worker) and `web` images to GHCR.
  2. SSH to the VPS (secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`).
  3. Run `docker compose pull && docker compose run --rm api alembic upgrade head && docker compose up -d`.
- **Backups:** nightly `pg_dump` to R2 (`backups/`), 14-day retention. Keep the restore steps in README.
- **Hardening:**
  - `ufw` allows only 22, 80, 443.
  - SSH is key-only.
  - Unattended security upgrades are on.
  - Caddy sets HSTS and a strict CSP (`default-src 'self'`; `img-src 'self' data: https://*.r2.cloudflarestorage.com https://lh3.googleusercontent.com`; `connect-src 'self' wss://{$APP_DOMAIN}`).

### Environment variables (`infra/.env.example`)
```
ENV=production|development|test
APP_BASE_URL=https://example.com
APP_DOMAIN=example.com
DATABASE_URL=postgresql+asyncpg://santa:***@postgres:5432/santa
REDIS_URL=redis://redis:6379/0
JWT_SECRET=***
GOOGLE_CLIENT_ID=***
GOOGLE_CLIENT_SECRET=***
VAPID_PUBLIC_KEY=***
VAPID_PRIVATE_KEY=***
VAPID_SUBJECT=mailto:admin@example.com
R2_ACCOUNT_ID=***
R2_ACCESS_KEY_ID=***
R2_SECRET_ACCESS_KEY=***
R2_BUCKET=secret-santa
S3_ENDPOINT_URL=              # set to http://minio:9000 in dev; derived from R2_ACCOUNT_ID in prod
SENTRY_DSN=
DEFAULT_TIMEZONE=America/Costa_Rica
```

## 11. Build order

Complete each milestone with its tests before starting the next.

1. **Scaffold:** monorepo, compose dev stack, CI skeleton, config, logging, `/health`, Tailwind tokens + fonts, i18n setup, UI primitives with tests, layout shells (DesktopHeader / BottomTabBar).
2. **Auth:** Google OAuth, cookies, refresh rotation, `/me`, landing and protected routes, profile page with language switch.
3. **Events and invites:** CRUD, dashboard sections, invite link manage/preview/join, participants list, leave/remove (OPEN only).
4. **Exclusions and draw:** pure draw module + property tests, exclusions API/UI with the group helper and feasibility banner, reveal flow + "You're giving to…" card, the frozen-roster invariants.
5. **Wishlists:** items CRUD, reorder, R2/MinIO upload pipeline, carousel, copy-from-event.
6. **Chat:** models, REST history, WS + Redis fan-out, direct/anonymous/group, Chats tab, anonymity invariant tests.
7. **Notifications:** VAPID, subscriptions, custom SW, iOS install guide, the notify pipeline, reveal/message/wishlist pushes, reminder cron, preferences UI.
8. **Lifecycle and account:** auto-archive, read-only archived UI, account deletion rules + R2 cleanup, privacy/terms placeholders.
9. **Production:** Caddy, production compose, deploy workflow, backups, Sentry, hardening, Playwright suite, accessibility pass.

## 12. Definition of done (every PR)
- Lint, typecheck and tests pass. New behavior has tests; invariant tests are untouched or strengthened.
- All strings exist in both `es.json` and `en.json`.
- The UI is checked at 320, 768 and 1200 widths. It has no shadows, all clickables are pills, and there's no more than one coral primary action per viewport.
- There are no secrets, message bodies or assignment data in logs.
- A migration is included if models changed.

## 13. Open items (don't block on these; use placeholders)
- Logo: text wordmark "Secret Santa" in Playfair Display 500 until provided. Generate simple placeholder PWA icons (coral "S" on cream, 1px black ring).
- Production hostname.
- Coral button text color (white at 18px for now).
- Legal copy for `/privacy` and `/terms`.
