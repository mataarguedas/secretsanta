# Secret Santa — Product Requirements Document

**Version:** 1.0
**Status:** Approved for build
**Visual system:** see `DESIGN.md` (warm cream canvas, single coral accent, pill buttons, serif/sans pairing). Deviations from DESIGN.md are listed in §9.

---

## 1. Overview

Secret Santa is a responsive web app, installable as a PWA, for organizing gift exchanges. Any user can **host** events and **participate** in events. A single user can host many events and participate in many events.

Participants join through an invite link. They build a per-event wishlist with photos and chat with each other, optionally anonymously. When everyone has joined, the host triggers **the reveal**: the draw that tells each participant whom they are giving a gift to.

### 1.1 Goals
- Frictionless onboarding: Google sign-in, then one tap on an invite link to join.
- A fair, constraint-aware draw (exclusion rules) whose results are secret from everyone except each giver, **including the host**.
- Help givers choose the right gift: photo wishlists plus anonymous questions to anyone in the event.
- Timely push notifications on Android and iOS through Web Push (PWA).
- A warm, clear, fully responsive UI in Spanish and English.

### 1.2 Non-goals (v1)
- Native Android/iOS apps, app store distribution, or Capacitor/React Native.
- Email notifications.
- The exchange-day "who was my Santa" reveal. **Santa identities are never revealed.**
- Chat moderation (reporting, blocking, muting).
- Images, files, reactions, read receipts or typing indicators in chat.
- Multiple currencies. The app uses **CRC (₡) only**.
- Payments and gift purchasing.

### 1.3 Scale targets
- Expected load: **≤ 50 users**.
- Architecture must support **~5,000 users** without redesign, meaning:
  - stateless API
  - Redis pub/sub for WebSocket fan-out
  - background worker for push and scheduled jobs
  - indexed queries and paginated lists

---

## 2. Users & Roles

| Role | Definition | Capabilities |
|---|---|---|
| **User** | Anyone signed in with Google | Create events, join events via link, manage profile and notification settings, delete account |
| **Host** | The user who created an event. Exactly one per event, not transferable. **The host is always a participant in the draw.** | Everything a participant can do, plus: edit event, manage invite link, define exclusions, remove participants (before draw), trigger the reveal, archive the event |
| **Participant** | A user who joined an event (the host included) | View event and all participants' wishlists, manage own wishlist, chat, see own assignment after the reveal |

A role is per event: the same user can be host of event A and a plain participant in event B.

---

## 3. Event Lifecycle

```
 OPEN ──(host triggers reveal)──▶ DRAWN ──(archive)──▶ ARCHIVED
   │
   └──(host deletes)──▶ [deleted]
```

| State | Joining | Leave / remove | Wishlist edits | Chat | Event edits | Assignment visible |
|---|---|---|---|---|---|---|
| **OPEN** | Via invite link (until join deadline, if set) | Participant may leave; host may remove (host cannot leave) | Yes | Yes | All fields | — |
| **DRAWN** | Closed | **Not allowed** for anyone | Yes (notifies giver) | Yes | Description, location, exchange date only | Own assignment only |
| **ARCHIVED** | Closed | Not allowed | Read-only | Read-only | None | Own assignment (read-only) |

**Archiving:**
- Automatic: 7 days after the exchange date, via a daily job.
- Manual: the host may archive any time after the exchange date has passed.
- Archived events remain visible in a separate "Past" section.

**Deletion:** The host may delete an event only while it is **OPEN**. Deletion cascades to participants, wishlists, photos (R2 objects too), exclusions and chats.

---

## 4. Functional Requirements

### 4.1 Authentication (FR-AUTH)
- **FR-AUTH-1** Sign-in only via Google OAuth 2.0 (Authorization Code + PKCE, handled server-side).
- **FR-AUTH-2** On first sign-in, create the user from the Google profile: `google_sub`, email, name, avatar URL. The locale always starts as `es`, whatever the browser language; the user switches to `en` in Profile › Language. The UI is also Spanish before sign-in.
- **FR-AUTH-3** Sessions:
  - Access JWT: 15-minute expiry, in an httpOnly cookie.
  - Refresh token: 30-day expiry, rotated on use, stored hashed in the DB, in an httpOnly cookie.
  - Cookies are `Secure` and `SameSite=Lax`.
- **FR-AUTH-4** Logout revokes the refresh token.
- **FR-AUTH-5** Opening an invite link while signed out goes to sign-in, then returns to the join screen (a `next` param validated against a relative-path allowlist).

### 4.2 Events (FR-EVT)
- **FR-EVT-1** Create an event with these fields:

  | Field | Required | Notes |
  |---|---|---|
  | name | yes | 3–80 chars |
  | description | no | ≤ 1000 chars |
  | budget | yes | Integer colones ≥ 0; displayed as `₡25 000` |
  | exchange_date | yes | Date/time; must be in the future at creation |
  | join_deadline | no | Must be before exchange_date |
  | location | no | Free text, or an "Online" toggle |
  | cover photo | no | Same upload pipeline as wishlist photos |
  | group_chat_enabled | yes | Boolean, default `true` |

- **FR-EVT-2** The creator becomes host and participant automatically.
- **FR-EVT-3** Dashboard sections:
  - "Hosting"
  - "Participating"
  - "Past" (archived)

  Each event card shows its state, participant count, exchange date and budget.
- **FR-EVT-4** The event page has these tabs:
  - Overview
  - Participants
  - Wishlists
  - Chat
  - Manage (host only)

### 4.3 Invitations (FR-INV)
- **FR-INV-1** Each event has one active invite link: `/join/{token}` (URL-safe random, 32 bytes).
- **FR-INV-2** The host can copy or share the link (Web Share API when available), **regenerate** it (invalidating the old one), or **disable** it.
- **FR-INV-3** The join screen shows the event name, host, budget, exchange date and participant count. A single "Join" button completes it.
- **FR-INV-4** Joining fails with a clear message when:
  - the link is invalid or disabled
  - the event is DRAWN or ARCHIVED
  - the join deadline has passed
  - the user is already a participant (in this case, redirect to the event instead)

### 4.4 Exclusion Rules (FR-EXC)
- **FR-EXC-1** The host defines pairs of participants who **cannot draw each other**. Pairs are symmetric: if A–B is excluded, neither draws the other.
- **FR-EXC-2** A participant may be in any number of exclusions (e.g., a whole nuclear family). The UI offers:
  - pair creation
  - a "group" helper that creates all pairs among the selected members
- **FR-EXC-3** Exclusions are editable only while OPEN. Removing a participant deletes their exclusions.
- **FR-EXC-4** After every change, the backend runs a feasibility check (see §6). If no valid draw exists, the Manage tab shows a warning and the reveal button is disabled.
- **FR-EXC-5** Exclusions are visible only to the host.

### 4.5 The Reveal / Draw (FR-DRW)
- **FR-DRW-1** Only the host can trigger it, only while OPEN, and only with **≥ 3 participants**.
- **FR-DRW-2** Before confirming, the host sees:
  - a modal listing all current participants
  - a reminder that joining closes and no one can leave afterwards
  - the confirm action: *"Everyone is in — reveal"*
- **FR-DRW-3** The server computes the assignment with the algorithm in §6. Each participant gives to exactly one person and receives from exactly one person, with no self-assignment and no excluded pairs. The draw is atomic: assignments are saved and state is set to DRAWN in one transaction.
- **FR-DRW-4** After the reveal, each participant sees a "You're giving to…" card: the receiver's name and avatar, with a link to their wishlist.
- **FR-DRW-5** **Secrecy:** no API endpoint, WebSocket payload, push payload or log line ever exposes an assignment other than the requesting giver's own. The host has no special access. Assignments are reachable only through direct DB access.
- **FR-DRW-6** Redraws are not supported.

### 4.6 Wishlists (FR-WSH)
- **FR-WSH-1** Wishlists are **per event**. Each participant has one wishlist per event they're in.
- **FR-WSH-2** Item fields:

  | Field | Required | Notes |
  |---|---|---|
  | title | yes | ≤ 120 chars |
  | note | no | ≤ 1000 chars |
  | store link | no | http/https URL |
  | approximate price | no | Integer CRC |
  | priority | yes | low / medium / high, default medium |
  | photos | no | 0–**3** |

- **FR-WSH-3** Photo uploads:
  - Accepted formats: JPEG, PNG, WebP, HEIC.
  - Max 10 MB each.
  - Server-side processing: EXIF (including GPS) is stripped, then the image is resized to max 1600px long edge and converted to WebP, plus a 400px thumbnail.
  - Storage: Cloudflare R2.
- **FR-WSH-4** Items can be reordered (drag on desktop, up/down controls on mobile), edited and deleted.
- **FR-WSH-5** "Copy from another event" imports items (with photos copied) from one of the user's other wishlists.
- **FR-WSH-6** All participants of an event can view all wishlists in that event. Wishlists of archived events are read-only.
- **FR-WSH-7** After the draw, creating, updating or deleting an item triggers a notification to that user's giver (see §5), debounced to one push per 10 minutes per wishlist.

### 4.7 Chat (FR-CHT)
- **FR-CHT-1** Conversation types, all scoped to one event:
  - **Direct:** between two named participants. One per pair per event.
  - **Anonymous:** one participant (the *initiator*) is shown as **"Secret Elf #N"**; the other (the *recipient*) is shown by name. One anonymous thread per (initiator, recipient, event).
  - **Group:** all participants of the event. It exists only if `group_chat_enabled`. Senders are always named.
- **FR-CHT-2** Any participant can start a direct or anonymous conversation with any other participant in the same event, regardless of assignment.
- **FR-CHT-3** Anonymity guarantees:
  - `N` is a random number unique within the event, assigned **per anonymous thread**, not per user. This keeps two threads from the same initiator unlinkable.
  - Identities stay hidden **forever**. The initiator cannot opt to reveal, and there is no admin UI to reveal them.
  - The API and WebSocket expose only a conversation-member id and display alias for the initiator, never their `user_id`, email, name or avatar.
  - No online presence, typing indicator, or read receipt exists anywhere. Nothing timing-related leaks except the message timestamp.
  - The recipient's unread count and push notification name only "Secret Elf #N".
  - A user can hold both a direct thread and an anonymous thread with the same person.
- **FR-CHT-4** Messages are **text only**, 1–2000 chars, emoji allowed. There are no edits. The sender can delete their own message, which leaves a "Message deleted" placeholder.
- **FR-CHT-5** Delivery is real-time over WebSocket. History is loaded via REST with cursor pagination (50 per page, newest first).
- **FR-CHT-6** The Chats tab (bottom bar) lists all conversations across events, grouped by event and sorted by last message, with unread counts (tracked privately per member).
- **FR-CHT-7** Conversations of archived events are read-only.
- **FR-CHT-8** Rate limit: 30 messages per minute per user.

### 4.8 Notifications (FR-NTF)
- **FR-NTF-1** Delivery is **Web Push only** (VAPID). It works:
  - on Android (Chrome, Edge, Firefox, Samsung Internet)
  - on desktop browsers
  - on **iOS/iPadOS 16.4+ only when the app is installed to the Home Screen**
- **FR-NTF-2** Notification types:

  | Type | Recipient | Trigger | Example body (en) |
  |---|---|---|---|
  | `reveal` | All participants | Host triggers the draw | "The draw for *Office Party* is done — see who you're giving to!" |
  | `message` | Other member(s) of the conversation | New message | "Secret Elf #3: Does she prefer…" / "Ana: Hola!" |
  | `wishlist_updated` | The giver of the wishlist owner | Wishlist item created/updated/deleted after the draw (debounced) | "The person you're giving to updated their wishlist" |
  | `exchange_reminder` | All participants | 7 days and 1 day before `exchange_date`, at 09:00 America/Costa_Rica | "1 day until *Office Party* — budget ₡25 000" |

  Nothing else sends a push. In particular, "someone joined" and "all joined" do not notify.
- **FR-NTF-3** The `reveal` type is always on. `message`, `wishlist_updated` and `exchange_reminder` each have a per-user toggle in Profile › Notifications, default on.
- **FR-NTF-4** The `wishlist_updated` push **never names the owner**. Naming them would reveal the assignment to anyone looking at the lock screen.
- **FR-NTF-5** Message pushes include a preview of up to 80 chars, plus the event name as the notification title. Group-chat pushes are collapsed per conversation with the notification `tag`.
- **FR-NTF-6** Push is suppressed for a conversation the user currently has open (the client reports its active conversation over the WebSocket).
- **FR-NTF-7** Push text is localized to the recipient's saved locale.
- **FR-NTF-8** Tapping a notification opens or focuses the PWA on the relevant screen (event page, conversation, wishlist).
- **FR-NTF-9** Permission UX:
  - The app never prompts on load. Permission is requested only after an explicit tap on "Enable notifications" (required by iOS).
  - On iOS Safari when not installed, the app shows an "Add to Home Screen" guide instead.
  - Expired or invalid subscriptions (HTTP 404/410) are deleted.
- **FR-NTF-10** A user may have multiple subscriptions (one per device/browser).

### 4.9 Profile & Account (FR-ACC)
- **FR-ACC-1** Profile shows avatar, name and email (from Google; not editable in v1).
- **FR-ACC-2** Settings:
  - Language (Español / English)
  - Notification toggles
  - Devices with push enabled, each removable
- **FR-ACC-3** **Delete account** deletes the user and all their data: memberships, wishlists, photos (R2 objects too), push subscriptions and tokens. Messages the user sent are replaced by a "Deleted user" author, and their content is removed.
  - Deletion is **blocked** while the user participates in any event in the DRAWN state. The reason: participants can't leave after the draw, and removing someone would break the chain.
  - Events the user hosts that are still OPEN are deleted with the account, after a confirmation that lists them.
  - Once all their events are archived, the user can delete.
- **FR-ACC-4** Static pages hold placeholder content, localized:
  - `/privacy` (Privacy Policy)
  - `/terms` (Terms of Service)

### 4.10 Internationalization (FR-I18N)
- **FR-I18N-1** The full UI is available in **Spanish (es-CR, default)** and **English (en)**.
- **FR-I18N-2** The backend returns stable error **codes** (e.g., `EVENT_ALREADY_DRAWN`), and the frontend translates them. Push notification text is rendered server-side from locale templates.
- **FR-I18N-3** Formatting:
  - Money: `₡25 000` (es-CR grouping).
  - Dates: formatted with `Intl.DateTimeFormat` in the user's locale.
  - Times: stored in UTC and displayed in the browser time zone, with the default assumption America/Costa_Rica.

### 4.11 PWA (FR-PWA)
- **FR-PWA-1** Web app manifest:
  - `name` "Secret Santa", `short_name` "Secret Santa"
  - `theme_color` `#fff5e6`, `background_color` `#fff5e6`
  - `display: standalone`
  - Icons 192/512 plus maskable (placeholder until the logo is designed), and an Apple touch icon
- **FR-PWA-2** Service worker:
  - precaches the app shell
  - handles `push` and `notificationclick`
  - uses network-first for API calls, with no offline writes in v1
- **FR-PWA-3** An install prompt/banner appears on the dashboard: `beforeinstallprompt` on Android/desktop, and the iOS guide on Safari.

---

## 5. Notification Matrix (summary)

| Event in system | reveal | message | wishlist_updated | exchange_reminder |
|---|:-:|:-:|:-:|:-:|
| Host triggers draw | ✅ all participants | | | |
| Message in direct/anonymous thread | | ✅ other member | | |
| Message in group chat | | ✅ all except sender | | |
| Wishlist change after draw | | | ✅ that owner's giver | |
| T–7 days, T–1 day before exchange | | | | ✅ all participants |
| User joins / leaves / removed | ❌ | ❌ | ❌ | ❌ |

---

## 6. Draw Algorithm

**Input:**
- Participants `P` (n ≥ 3).
- Forbidden set `F` = the pairs `(i, i)` plus both directions of every exclusion pair.

**Output:** a permutation `σ` with `σ(i) ≠ i` and `(i, σ(i)) ∉ F` for all `i`.

1. **Feasibility check.** A valid assignment exists iff the bipartite graph "givers × receivers, edge when allowed" has a perfect matching. Run Hopcroft–Karp; it's trivial at n ≤ a few hundred. This runs on every exclusion change and again at draw time.
2. **Random draw.**
   - Shuffle participants with `secrets.SystemRandom`.
   - Run randomized backtracking: for each giver in shuffled order, try receivers in shuffled order, pruning with a matching-feasibility check on the remaining subgraph.
   - Up to 1,000 random restarts are allowed. This produces a uniformly-random-looking valid assignment and cannot dead-end once feasibility is proven.
3. The draw is **not** required to form a single cycle.
4. Persist all assignments and the state change in one transaction with `SELECT … FOR UPDATE` on the event row, so double-clicks and races can't draw twice.
5. Enqueue `reveal` pushes after commit.

The algorithm lives in a pure, fully unit-tested module (`app/services/draw.py`). Required tests:
- property-based tests with Hypothesis (random n, random exclusions)
- infeasible cases (e.g., 3 people where one is excluded from both others)
- the nuclear-family case

---

## 7. Data Model (PostgreSQL 16)

All tables have `id UUID PK` (UUIDv7 generated in the app), `created_at timestamptz`, and `updated_at timestamptz`, unless noted otherwise.

```
users
  google_sub TEXT UNIQUE NOT NULL
  email CITEXT UNIQUE NOT NULL
  name TEXT NOT NULL
  avatar_url TEXT
  locale TEXT NOT NULL DEFAULT 'es'          -- 'es' | 'en'
  notify_message BOOL DEFAULT true
  notify_wishlist BOOL DEFAULT true
  notify_reminder BOOL DEFAULT true

refresh_tokens
  user_id FK users ON DELETE CASCADE
  token_hash TEXT UNIQUE NOT NULL
  expires_at timestamptz
  revoked_at timestamptz NULL
  user_agent TEXT

events
  host_id FK users
  name TEXT, description TEXT
  budget_crc INTEGER NOT NULL CHECK (budget_crc >= 0)
  exchange_at timestamptz NOT NULL
  join_deadline timestamptz NULL
  location TEXT NULL, is_online BOOL DEFAULT false
  cover_photo_key TEXT NULL
  group_chat_enabled BOOL DEFAULT true
  state TEXT NOT NULL CHECK (state IN ('open','drawn','archived'))
  invite_token TEXT UNIQUE NULL               -- NULL = link disabled
  drawn_at timestamptz NULL, archived_at timestamptz NULL
  INDEX (host_id), INDEX (state, exchange_at)

event_participants
  event_id FK events ON DELETE CASCADE
  user_id  FK users  ON DELETE CASCADE
  joined_at timestamptz
  UNIQUE (event_id, user_id), INDEX (user_id)

exclusions
  event_id FK events ON DELETE CASCADE
  user_a_id FK users, user_b_id FK users
  CHECK (user_a_id < user_b_id)               -- canonical order → symmetric, no dupes
  UNIQUE (event_id, user_a_id, user_b_id)

assignments                                    -- SECRET
  event_id FK events ON DELETE CASCADE
  giver_id FK users, receiver_id FK users
  UNIQUE (event_id, giver_id), UNIQUE (event_id, receiver_id)
  CHECK (giver_id <> receiver_id)

wishlist_items
  event_id FK events ON DELETE CASCADE
  user_id FK users ON DELETE CASCADE
  title TEXT, note TEXT, url TEXT
  price_crc INTEGER NULL
  priority TEXT CHECK (priority IN ('low','medium','high'))
  position INTEGER NOT NULL
  INDEX (event_id, user_id, position)

wishlist_photos
  item_id FK wishlist_items ON DELETE CASCADE
  object_key TEXT NOT NULL, thumb_key TEXT NOT NULL
  width INT, height INT, position SMALLINT
  -- max 3 per item enforced in service + DB trigger

conversations
  event_id FK events ON DELETE CASCADE
  kind TEXT CHECK (kind IN ('direct','anonymous','group'))
  last_message_at timestamptz NULL
  INDEX (event_id, last_message_at DESC)

conversation_members
  conversation_id FK conversations ON DELETE CASCADE
  user_id FK users ON DELETE SET NULL         -- NEVER serialized for anonymous initiators
  is_anonymous BOOL DEFAULT false
  anon_number SMALLINT NULL                   -- "Secret Elf #N"
  last_read_at timestamptz NULL               -- private, never exposed to others
  UNIQUE (conversation_id, user_id)
  -- partial unique (event scope via join table or denormalized event_id):
  --   UNIQUE (event_id, anon_number) WHERE is_anonymous

-- uniqueness of direct/anonymous pairs enforced with a denormalized
-- conversations.pair_key TEXT NULL UNIQUE:
--   direct:    'd:{event}:{min_user}:{max_user}'
--   anonymous: 'a:{event}:{initiator}:{recipient}'
-- pair_key is internal only.

messages
  conversation_id FK conversations ON DELETE CASCADE
  sender_member_id FK conversation_members    -- member, not user → anonymity-safe
  body TEXT NULL                              -- NULL when deleted
  deleted_at timestamptz NULL
  INDEX (conversation_id, created_at DESC)

push_subscriptions
  user_id FK users ON DELETE CASCADE
  endpoint TEXT UNIQUE NOT NULL
  p256dh TEXT, auth TEXT
  user_agent TEXT, last_success_at timestamptz

notification_log                               -- idempotency for scheduled pushes
  user_id FK users ON DELETE CASCADE
  event_id FK events ON DELETE CASCADE
  kind TEXT                                    -- 'reminder_7d' | 'reminder_1d' | 'wishlist_debounce'
  sent_at timestamptz
  UNIQUE (user_id, event_id, kind) for reminders
```

---

## 8. API Surface (FastAPI, prefix `/api/v1`)

Conventions:
- JSON bodies, cookie auth.
- Errors use the shape `{ "error": { "code": "…", "message": "…" } }`.
- List endpoints use cursor pagination.

| Method & path | Who | Purpose |
|---|---|---|
| `GET /auth/google/login?next=` | public | Start OAuth |
| `GET /auth/google/callback` | public | Finish OAuth, set cookies, redirect |
| `POST /auth/refresh` | cookie | Rotate tokens |
| `POST /auth/logout` | user | Revoke |
| `GET /me` · `PATCH /me` · `DELETE /me` | user | Profile, locale, notification toggles, delete account |
| `GET /events?section=hosting\|participating\|past` | user | Dashboard lists |
| `POST /events` | user | Create |
| `GET /events/{id}` | participant | Details, including `my_role` and `my_assignment` (if drawn) |
| `PATCH /events/{id}` · `DELETE /events/{id}` | host | Edit (field rules per state) / delete (OPEN only) |
| `POST /events/{id}/invite/regenerate` · `DELETE /events/{id}/invite` | host | Manage link |
| `GET /invites/{token}` | user | Invite preview |
| `POST /invites/{token}/join` | user | Join |
| `GET /events/{id}/participants` | participant | List |
| `DELETE /events/{id}/participants/{userId}` | host (OPEN) | Remove |
| `POST /events/{id}/leave` | participant (OPEN, not host) | Leave |
| `GET/POST/DELETE /events/{id}/exclusions` | host (OPEN) | Manage; responses include `{ feasible: bool }` |
| `POST /events/{id}/draw` | host (OPEN) | The reveal |
| `POST /events/{id}/archive` | host (after exchange date) | Archive |
| `GET /events/{id}/wishlists/{userId}` | participant | View a wishlist |
| `POST/PATCH/DELETE /events/{id}/wishlist/items[/{itemId}]` | owner | Manage own items |
| `PUT /events/{id}/wishlist/order` | owner | Reorder |
| `POST /events/{id}/wishlist/copy-from/{otherEventId}` | owner | Import |
| `POST /wishlist/items/{itemId}/photos` (multipart) · `DELETE …/photos/{photoId}` | owner | Photos |
| `GET /conversations?event_id=` | user | List with unread counts |
| `POST /events/{id}/conversations` `{kind, recipient_id}` | participant | Start direct/anonymous (idempotent: returns the existing one) |
| `GET /conversations/{id}/messages?cursor=` | member | History |
| `POST /conversations/{id}/messages` | member | Send (also possible over WS) |
| `DELETE /messages/{id}` | sender | Soft-delete |
| `POST /conversations/{id}/read` | member | Mark read |
| `GET /push/vapid-public-key` · `POST /push/subscriptions` · `DELETE /push/subscriptions/{id}` | user | Web Push |
| `GET /health` | public | Liveness/readiness (DB + Redis) |

**Photo URLs:** photos are served through short-lived (1 h) R2 presigned GET URLs issued in the API responses. The bucket is private.

**WebSocket `/ws`:**
- One connection per tab, authenticated by the access-token cookie on the same origin.
- Client → server:
  - `{type:"subscribe", conversation_ids}`
  - `{type:"active", conversation_id|null}`
  - `{type:"send", conversation_id, body, client_id}`
- Server → client:
  - `{type:"message", conversation_id, message}`
  - `{type:"message_deleted", …}`
  - `{type:"event_drawn", event_id}`
  - `{type:"ack", client_id, message_id}`
- Fan-out uses Redis pub/sub channels `conv:{id}` and `user:{id}`, so any number of API replicas works.

---

## 9. UX / UI Requirements

### 9.1 Applying DESIGN.md
- **Canvas:** Cream Linen `#fff5e6` everywhere. Cards and sheets are Pure White `#ffffff`, square corners, 1px border (`#cccccc` for content cards, `#000` for interactive).
- **No shadows anywhere.**
- **Type:**
  - GascogneTS substitute **Playfair Display** for page titles, event names and the "You're giving to…" name.
  - Basis Grotesque Pro substitute **Inter** 400, with positive tracking, for all UI text.
  - **JetBrains Mono** uppercase eyebrow labels, e.g. `OPEN`, `DRAWN`, `HOSTING`, `SECRET ELF #3`.
- **Buttons:**
  - Everything clickable is a 999px pill.
  - Primary is a Coral Pop filled pill, **at most one per viewport**: "Create event", "Join", "Reveal", "Send".
  - Secondary is a Terracotta outlined pill.
  - Tertiary is a black-outlined nav pill.
- **Coral banner strip:** one per screen at most, e.g. the "You're giving to…" card header after the draw, or an "Invite your friends" band.
- **Avatars:** 999px circles with a 1px black border (the "Category Circle" component). Participant rows use them.
- **Imagery:** user photos only; no illustrations. Empty states are typographic: serif headline, sans body, one CTA.
- **Layout:** max-width 1200px, 64px section gaps on desktop (32px on mobile), card padding 20px, element gap 15px.

### 9.2 Deviations from DESIGN.md (approved)

| DESIGN.md rule | Secret Santa rule | Reason |
|---|---|---|
| No second vivid color | **Success = green `#2E7D4F`, Error = red `#C62828`**, used only for toasts, inline validation and status text/icons, never for buttons or surfaces | Clear feedback, per product owner |
| Centered "Beautiful" wordmark | Centered **"Secret Santa"** wordmark in Playfair Display 500 (logo TBD) | Brand |
| Nav pills + search icon header | Desktop (≥ 768px): header with nav pills on the left (Events, Chats), centered wordmark, profile avatar circle on the right. **Mobile (< 768px): bottom tab bar** (Events · Chats · Profile) and a compact centered wordmark top bar | Mobile ergonomics |
| Proprietary fonts | Playfair Display / Inter / JetBrains Mono, self-hosted | Licensing |

### 9.3 Key Screens
1. **Landing (signed out):** hero with the serif headline, one short line, and a "Continue with Google" pill.
2. **Dashboard:** Hosting / Participating / Past event cards, with a "Create event" CTA.
3. **Create/Edit event:** single-column form. Budget input has a ₡ prefix. Date pickers use native inputs.
4. **Event page:**
   - header with the eyebrow state label, serif name, budget, date and location
   - tabs: Overview, Participants, Wishlists, Chat, Manage (host)
   - after the draw, a prominent "You're giving to…" card on Overview
5. **Manage (host):** invite link card (copy / share / regenerate / disable), exclusions editor (pairs + group helper, feasibility banner), and the Reveal button with a confirmation modal.
6. **Wishlist:** item cards with a photo carousel (arrow buttons per DESIGN.md "Carousel Arrow Button"), priority chip and price. Owner view has an edit mode and a 3-slot photo uploader with progress.
7. **Chats:** conversation list grouped by event, and a thread view. Anonymous threads show a clear "You are anonymous — they see you as Secret Elf #3" banner to the initiator. The "New conversation" sheet has a *Named* / *Anonymous* segmented pill.
8. **Profile:** language, notification toggles, devices, install guide, links to privacy/terms, delete account.
9. **Join screen:** `/join/{token}`.
10. **iOS install guide:** a modal with steps for Share › Add to Home Screen.

### 9.4 Accessibility & Responsiveness
- WCAG 2.1 AA target:
  - visible focus rings (2px black outline, 2px offset)
  - labels on all inputs
  - `aria-live` for toasts and incoming messages
  - hit targets ≥ 44×44 px
- **Known conflict:** white text on Coral Pop (`#fa7864`) is ≈ 2.6:1 contrast, which fails AA. **Default:** keep DESIGN.md's white text but raise primary button text to 18px. This is flagged for product-owner review (alternative: Ink Black text on coral, ≈ 8:1).
- Breakpoints: `sm 640`, `md 768`, `lg 1024`, `xl 1200`. Everything must work from 320px width.
- Mobile uses safe-area insets (`env(safe-area-inset-*)`) for the bottom tab bar in standalone PWA mode.
- Respect `prefers-reduced-motion`.

---

## 10. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | p95 API < 200 ms (excluding uploads). Initial JS < 250 KB gzipped. LCP < 2.5 s on 4G |
| Real-time | Message delivered to online recipients < 1 s |
| Security | See below |
| Privacy | Assignment and anonymous-sender secrecy (§4.5, §4.7) covered by dedicated tests. Logs must not contain message bodies, assignment pairs or anonymous-initiator ids |
| Reliability | Nightly `pg_dump` to R2 (14-day retention). Restore procedure documented. Docker `restart: unless-stopped` |
| Observability | Sentry (frontend + backend + worker), structured JSON logs, `/health` endpoint |
| Browser support | Last 2 versions of Chrome, Edge, Firefox, Safari. iOS Safari 16.4+ |

**Security requirements:**
- HTTPS only, with HSTS.
- Same-origin frontend/API, so no CORS is needed.
- CSRF: `SameSite=Lax` cookies plus a required `X-Requested-With` header on mutating requests.
- Rate limiting on auth, messages and uploads.
- Upload MIME sniffing (not trusting the extension).
- Strict CSP.
- Every endpoint authorizes by event membership or ownership.

---

## 11. Deployment

- **Target:** a single **Hetzner VPS** (CX22 or larger: 2 vCPU, 4 GB) running Ubuntu 24.04 with Docker Compose.
- **Services:**
  - `caddy`: TLS, static frontend, reverse proxy of `/api` and `/ws`
  - `api`: FastAPI with Uvicorn workers
  - `worker`: arq, for push sending, photo processing, scheduled jobs
  - `postgres:16`
  - `redis:7`
- **Storage:** Cloudflare R2 private bucket for photos and DB backups.
- **CI/CD:** GitHub Actions.
  1. On PR: lint, type-check and test both apps.
  2. On merge to `main`: build and push images to GHCR.
  3. Then SSH deploy: `docker compose pull && docker compose up -d`, then `alembic upgrade head`.
- **Environments:** local (Docker Compose dev profile, with MinIO standing in for R2) and production.

### ⚠️ 11.1 Deployment prerequisite: a domain name
Three required features depend on a real domain:
- **Google OAuth** does not accept raw IP addresses as redirect URIs; only `localhost` is exempt.
- **Web Push and PWA installation** require HTTPS (a secure context).
- **Trusted TLS** is only practical with a domain.

So production **must** have a hostname before launch. The codebase treats it as configuration (`APP_BASE_URL`), so any of these works without code changes:
- **(a) Recommended, zero cost:** a subdomain of an existing domain, e.g. `santa.snhware.lat` (a single DNS A record to the VPS).
- **(b)** A cheap dedicated domain.

Until then, development runs entirely on `localhost`, which Google OAuth and Web Push both accept.

---

## 12. Scheduled Jobs (arq cron, worker)

| Job | Schedule | Action |
|---|---|---|
| `send_exchange_reminders` | Every 15 min | For DRAWN events with `exchange_at` in 7 days / 1 day (window hits 09:00 CR time), push to participants who haven't received that reminder (uses `notification_log`) |
| `auto_archive_events` | Daily 03:00 CR | Archive events where `exchange_at + 7 days < now()` |
| `close_expired_invites` | (implicit) | Join deadline is checked at join time; no job needed |
| `prune_refresh_tokens` | Daily | Delete expired/revoked tokens |
| `backup_database` | Daily 02:00 CR | `pg_dump` → gzip → R2 |

---

## 13. Acceptance Criteria (release gate)

1. A new user signs in with Google, creates an event, and shares the link. Two other users join from phones.
2. The host defines exclusions. Infeasible exclusions block the reveal with a clear message.
3. The host reveals. Every participant gets a push (Android and installed iOS PWA) and sees only their own receiver. An automated test proves no endpoint leaks other pairs to the host.
4. Leave/remove are refused after the draw.
5. A participant uploads 3 photos to an item. A 4th upload is rejected. EXIF GPS is absent in the stored file.
6. After the draw, a wishlist edit pushes to the correct giver only, without naming the owner.
7. Anonymous chat: the recipient sees "Secret Elf #N" everywhere (UI, WS frames, push, API JSON), verified by an automated test that greps responses for the initiator's id, name and email.
8. Reminders fire at T–7d and T–1d exactly once.
9. The UI passes axe checks on the key screens and works at 320px, 768px and 1200px widths in both languages.
10. Account deletion removes R2 objects and DB rows and is blocked during a DRAWN event.

---

## 14. Open Items
- Logo design (placeholder wordmark until then).
- Production hostname (§11.1).
- Coral button text color for accessibility (§9.4).
- Final Privacy Policy / Terms text (placeholders ship in v1).
