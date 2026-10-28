# Family Planner on the Yana stack: migration plan

Moves Family Planner from **Deno + Supabase (Postgres, Edge Function) + a Vite SPA on GitHub Pages**
to the stack `fa-krug/yana-server` runs on: **Next.js 16 / React 19 / TypeScript, SQLite via
Drizzle + better-sqlite3, Better Auth, next-intl, shadcn on Base UI, Vitest, one Docker image
deployed to Portainer behind Traefik**. One language, one toolchain, one process, one container.

Yana's `CLAUDE.md` is the reference for every convention named here; this plan says what is copied
from it, what has to be built because Family Planner needs it and Yana does not, and in what order.

## Decisions

| Topic         | Decision                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository    | Stays `fa-krug/family-planner`; **not** merged into Yana. Separate domain, users and release cycle; the stack is shared by copying Yana's scaffold and conventions, not by a shared package.                                                                                                                                                                   |
| Domain        | `family-planner.fa-krug.de` unchanged, so **existing passkeys keep working** (their `rp_id` is that host).                                                                                                                                                                                                                                                     |
| Runtime       | Node 26.12.1 (pinned three times, as in Yana: `.nvmrc`, `engines.node`, Dockerfile). Exact dependency pins, no `^`/`~`.                                                                                                                                                                                                                                        |
| Database      | SQLite at `/app/data/family-planner.db`, Yana's `getDb()` / `writeTransaction()` / PRAGMAs / `BEGIN IMMEDIATE`, migrations applied at startup by `src/instrumentation.ts` → `runStartupTasks()`.                                                                                                                                                               |
| Schema        | **Greenfield** Drizzle schema matching the _final_ state of the 17 Supabase migrations (one `0000`), not a replay of them. Existing data arrives by a one-shot import script (phase 8).                                                                                                                                                                        |
| Backend logic | **Port, don't rewrite.** The handler already sits behind a `Store` interface and speaks `Request → Response`. A `DrizzleStore` implements `Store`; the handler is mounted in a Next route handler. The domain modules (`vacation.ts`, `finance.ts`, `ai/*`, `ics.ts`, `agent.ts`) move almost unchanged.                                                       |
| Auth          | **Better Auth**, configured like Yana (`usePlural`, `admin()` plugin with `role`, passkey plugin, `nextCookies()` last, `disableSignUp`, `/admin/*` in `disabledPaths`). Family Planner's own sessions, passkey ceremony and PBKDF2 code are deleted. API tokens and setup links stay as small app tables (see phase 3).                                       |
| API           | Same routes, new base: `https://family-planner.fa-krug.de/api` (was `https://<ref>.supabase.co/functions/v1/api`). `/sessions/...` alias stays. The old Supabase URL becomes a redirect shim (phase 9) so calendar subscriptions and scripts survive.                                                                                                          |
| Frontend      | Next App Router with **real paths** (`/f/[id]/vacation`, `/f/[id]/finance`, `/f/[id]/settings/[section]`) instead of `HashRouter`; `/#/...` links are converted by a client redirect on `/`. The interactive pages (year grid, transactions, chat) stay client components on the existing REST client; account, login and admin pages are **taken from Yana**. |
| UI kit        | shadcn regenerated on **Base UI** (Yana's `components/ui`), `asChild` → `render`.                                                                                                                                                                                                                                                                              |
| i18n          | `app/src/lib/i18n.ts` (1 689 lines) → `messages/en.json` + `messages/de.json` with next-intl, typed via `AppConfig`, plural functions → ICU `plural`.                                                                                                                                                                                                          |
| Rate limits   | In-process fixed windows (one process, no shared store needed); same limits as `RATE_LIMITS`. The `rate_limits` table is dropped.                                                                                                                                                                                                                              |
| AI chat turns | Run in-process in the background (no platform time limit any more); the hand-off-to-a-new-invocation machinery collapses to an in-process call. Lease/takeover stays for container restarts.                                                                                                                                                                   |
| Deployment    | Yana's pipeline, renamed: CI (lint, format, typecheck, test, dev-boot smoke) → multi-arch image `sascha384/family-planner` on Docker Hub → Portainer stack redeploy. GitHub Pages and the Supabase deploy jobs are removed after cutover.                                                                                                                      |

## Inventory: what exists today

| Area                 | Today                                                                                                | Size         |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ------------ |
| API handler + domain | `supabase/functions/_shared/*.ts`, `ai/*.ts`                                                         | ~11 k lines  |
| Storage              | `store.ts` (interface + in-memory), `supabase_store.ts`, 5 PL/pgSQL functions                        | ~1.7 k lines |
| Schema               | 17 migrations → 17 live tables (`families` + 16)                                                     |              |
| Auth                 | `auth.ts`, `passwords.ts` (PBKDF2-SHA256, 600 k), `webauthn.ts` (@simplewebauthn/server), `admin.ts` | ~950 lines   |
| Frontend             | `app/` Vite + React 19 + Radix shadcn, `HashRouter`, own i18n, localStorage cache                    | ~17 k lines  |
| Tests                | Deno tests against the in-memory store                                                               | ~4.9 k lines |
| Dev server           | `dev/server.ts` (`--persist --seed --rate-limit --mock-ai`), `dev/mock_ai.ts`                        | ~630 lines   |
| Deploy               | `.github/workflows/deploy.yml`: Supabase migrations + function, `gh-pages`                           |              |

Deno-specific code is small: `npm:` specifiers (3 files), `Deno.serve`, `Deno.env`,
`Deno.resolveDns` (in `ai/net.ts`), `EdgeRuntime.waitUntil`. Everything else is WebCrypto and
`fetch`, which Node 26 has.

## Target layout

```
.
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # root: providers, theme, locale (from Yana)
│   │   ├── health/route.ts            # GET /health, SELECT 1 (from Yana)
│   │   ├── api/auth/[...all]/route.ts # Better Auth (from Yana)
│   │   ├── api/[...path]/route.ts     # the ported handler: GET/POST/PATCH/PUT/DELETE
│   │   ├── login/page.tsx             # from Yana (passkey first)
│   │   ├── setup/[token]/page.tsx     # one-time setup link → session → set password/passkey
│   │   └── (app)/
│   │       ├── layout.tsx             # requireUser(); left sidebar + chat panel
│   │       ├── page.tsx               # family picker / landing; converts /#/... links
│   │       ├── account/page.tsx       # from Yana + API tokens section
│   │       ├── admin/users/...        # from Yana's /users CRUD, + setup-link action
│   │       ├── admin/families/...     # new, on Yana's CRUD kit
│   │       └── f/[id]/
│   │           ├── vacation/page.tsx  # client: year grid (ported)
│   │           ├── finance/page.tsx   # client: transactions, overview (ported)
│   │           └── settings/[[...section]]/page.tsx
│   ├── server/                        # ported from supabase/functions/_shared
│   │   ├── handler.ts, families.ts, vacation.ts, finance.ts, ics.ts, agent.ts, ...
│   │   ├── ai/ (chat, chats, tools, calc, analytics, categorize, net, provider, context)
│   │   └── store.ts                   # the Store interface, unchanged
│   ├── lib/
│   │   ├── db/ (client.ts, migrate.ts, schema/, drizzle-store.ts, test-support.ts)
│   │   ├── auth/ (server.ts, session.ts, roles.ts, bootstrap.ts, client.ts, legacy-password.ts)
│   │   ├── startup.ts
│   │   └── rate-limit.ts              # in-process windows
│   ├── features/                      # ported client features (vacation, finance, chat, ...)
│   ├── components/ui/                 # Base UI shadcn (from Yana)
│   ├── i18n/, proxy.ts, instrumentation.ts
├── messages/en.json, de.json
├── drizzle/
├── scripts/import-supabase.ts         # one-shot data import (phase 8)
├── Dockerfile, docker-compose.yml, docker-compose.production.yml
└── .github/workflows/ci.yml
```

`supabase/`, `dev/`, `web/` (the old `app/`, moved in phase 1), `deno.json` and `tests/` are deleted
at the end (phase 10), not before: until cutover they are the reference and the fallback.

## Phases

Each phase ends green on `npm run lint && npm run format:check && npm run typecheck && npm test`
(and the dev-boot smoke once it exists). Work happens on a long-lived `next` branch; `main` keeps
deploying the Supabase version until phase 9.

### Phase 1 — Scaffold (copy from Yana)

Copy, then strip Yana's feature code:

- `package.json` pins (Next 16.2.12, React 19.2.4, Drizzle, better-sqlite3 13.0.2 with the
  `better-auth` override, next-intl, Base UI, Vitest, ESLint/Prettier config), `.nvmrc`,
  `tsconfig.json` + `vitest.config.ts` (`@/*` alias in both, the `node` / `dom` projects split by
  extension, the raised timeouts), `eslint.config.mjs`, `next.config.ts` (`outputFileTracingRoot`,
  `output: "standalone"`, the edge `IgnorePlugin`, `--webpack`).
- `src/lib/db/client.ts`, `migrate.ts`, `test-support.ts`; `src/lib/startup.ts`;
  `src/instrumentation.ts` (one import, kept as tripwire-tested as in Yana); `src/app/health`; root
  `layout.tsx`, `global-error.tsx`, theme provider; `src/test/*`.
- Dockerfile and both compose files, renamed (`DATABASE_PATH=/app/data/family-planner.db`, no
  `media/` volume, no `vips` — nothing here processes images).
- `CLAUDE.md` for this repository, starting from the subset of Yana's that applies (database,
  `connection()`, streaming pattern, Base UI, i18n, testing), so agents in this repo get the same
  rules.
- **The Vite app moves from `app/` to `web/`.** Next.js prefers a root `app/` over `src/app/`, so
  with the old frontend at `app/` the build finds no routes. `ci.yml`, `deploy.yml`, `deno.json`,
  `dev/server.ts`, `tests/` and the README follow the move.
- **`deno.json` gets `"nodeModulesDir": "none"`** and `fmt`/`lint` scoped with `include` to the old
  trees: with a root `package.json`, Deno otherwise expects every `npm:` import of `supabase/` in
  `node_modules` and `deno check` fails.
- A `next.yml` workflow beside `ci.yml`: lint, format, typecheck, test, dev-boot smoke, and an image
  build plus container smoke that pushes nothing (publishing arrives in phase 9).

**Done when:** `rm -rf data && npm run build && ls data` reports no `data/`, `/health` answers on
`npm run dev`, the image builds and starts.

### Phase 2 — Schema and `DrizzleStore`

- Drizzle schema, one module per group: `families.ts` (families, family_members), `vacation.ts`
  (entry_types, day_entries, day_notes), `finance.ts` (family_settings/finance settings,
  finance_accounts, finance_categories, transactions), `ai.ts` (ai_settings, ai_chats,
  ai_chat_items, ai_chat_messages), `auth.ts` (Better Auth's tables + `api_tokens`, `setup_tokens`).
  `rate_limits`, `auth_tokens` (as such), `auth_challenges` and the old `passkeys` shape are not
  carried over.
- Postgres → SQLite mapping, following Yana's rules:
  - `timestamptz` → `integer(..., { mode: "timestamp" })`; `updatedAt` with `$onUpdate`.
  - `jsonb` (`csv_mappings`, `benchmark`, chat `queue`, chat items/messages) →
    `text(..., { mode: "json" })` **with a `json_valid(...)` CHECK**, added with the column.
  - `text[]` → JSON text; `boolean` → `integer({ mode: "boolean" })`; enum-like `text check (...)` →
    `CHECK` constraints mirroring the Postgres ones (they exist there already).
  - Foreign keys with `on delete cascade` as in Postgres (`foreign_keys = ON` is a PRAGMA).
- The five PL/pgSQL functions become synchronous TypeScript inside `writeTransaction()`:
  `replace_family_contents`, `delete_finance_category`, `finance_account_totals_until` (a
  `SUM ... GROUP BY`), `ai_chat_queue_push` / `ai_chat_queue_take` (read-modify-write of the JSON
  queue, safe under `BEGIN IMMEDIATE`), `ai_chat_put_items` (the `rev` counter).
- `claimChat()` is the one compare-and-swap that matters: a single
  `UPDATE ... WHERE id = ? AND (status = 'idle' OR run_until < ?)` checked on `changes === 1`,
  exactly as Yana's job `claim()` does.
- `DrizzleStore implements Store`. Its methods stay `async` (the interface is), but the bodies are
  synchronous better-sqlite3 calls — never an `async` callback inside `writeTransaction()`.

**Done when:** the existing store-level behaviour is covered by real-SQLite tests in the Yana style
(temp `DATABASE_PATH`, `applyMigrations()`), including a `db.query.*` traversal per relation.

### Phase 3 — Auth on Better Auth

Copy Yana's `src/lib/auth/` (server, session, roles, bootstrap, client, next-path, sign-in-errors,
test-support) and its `proxy.ts`, then adapt:

- **Roles:** `is_admin` → `role` (`"admin"` via `roles.ts`). Family roles (`editor` / `viewer`) stay
  in `family_members`; they are not Better Auth roles.
- **Bootstrap:** Yana's `ensureAdminExists()` replaces `ensureAdmin()`. Family Planner's "the first
  admin becomes editor of every existing family" step runs inside it, once. `INITIAL_ADMIN_PASSWORD`
  stays as an env var for the first boot.
- **`mustChangePassword`:** an additional user field (`input: false`); the `(app)` layout redirects
  to `/account?password=required` while it is set, as the SPA does today.
- **Legacy passwords:** imported `pbkdf2-sha256$...` hashes keep working through a custom
  `emailAndPassword.password.verify` that dispatches on the prefix (PBKDF2 code from `passwords.ts`,
  Better Auth's scrypt otherwise). After a successful PBKDF2 sign-in an `after` hook rewrites the
  credential with Better Auth's own `hash`, so the legacy path empties itself.
- **Plain-name logins:** Family Planner allows `admin` (no `@`) as a sign-in name; Better Auth's
  email sign-in validates an email address. Imported plain names are rewritten to
  `<name>@family-planner.local` and the user is told at first sign-in. (Alternative: Better Auth's
  `username` plugin. Rejected unless the live data has many such accounts: it is a second sign-in
  path to keep in sync with the rest of Yana's auth code.)
- **Passkeys:** Better Auth's passkey plugin with `rpID = family-planner.fa-krug.de`,
  `origin = PUBLIC_URL`. Imported rows map `id → credentialID`, `public_key → publicKey` (check the
  encoding Better Auth expects; convert base64url ↔ base64 in the import if needed), `counter`,
  `transports` (array → comma string), `name`, `user_id`.
- **API tokens:** a small `api_tokens` table (`id`, `userId`, `name`, `hash` = SHA-256, `createdAt`,
  `lastUsedAt`), the same scheme as today, so **imported tokens keep working**. The handler's
  `authenticate()` accepts a Better Auth session cookie _or_ `Bearer <api token>`; API tokens can
  only read `GET /auth/me` plus the family routes, as today. (Better Auth's `apiKey` plugin would
  not accept the existing hashes.)
- **Setup links:** a `setup_tokens` table (hashed, 7-day expiry, single use, revoked by a new one).
  `/setup/[token]` redeems it, creates a session via `internalAdapter.createSession`, and the
  session is allowed to set a password without the current one (today's `can_reset`). Kept separate
  from the `oneTimeToken` plugin, whose single global expiry is sized for minutes.
- **Deleted:** `auth.ts` session handling, `webauthn.ts`, `auth_challenges`, the `/auth/login`,
  `/auth/passkey/*`, `/auth/passkeys/*`, `/auth/password`, `/auth/logout` routes (the browser uses
  Better Auth's endpoints; `GET/PATCH /auth/me` and `/auth/tokens` stay for scripts).
- **Proxy:** `/api` is in `PUBLIC_PREFIXES` for the same reason `/api/v1` is in Yana — the handler
  authenticates itself (Bearer or cookie) and the calendar feed must work without either. `/setup`
  is public too.

**Done when:** sign-in with password, with a passkey (by hand), with an imported PBKDF2 hash (test),
with a setup link (test); admin bootstrap tested against a real database as in Yana.

### Phase 4 — Mount the API in Next

- Move `supabase/functions/_shared` → `src/server/`. Mechanical changes only: drop `npm:` specifiers
  (`@simplewebauthn/server` goes away with phase 3), `Deno.resolveDns` → `node:dns/promises`
  `lookup({ all: true })` in `ai/net.ts` (the private-network guard must keep refusing after
  redirects — keep its tests), `Deno.env` → `process.env`.
- `src/app/api/[...path]/route.ts` exports `GET/POST/PATCH/PUT/DELETE/OPTIONS`, each
  `await connection()` and delegating to one `createHandler(new DrizzleStore(), options)` built once
  per process. `publicBase` = `${PUBLIC_URL}/api`.
- **Background work:** `background: (task) => void task.catch(log)`. `selfFetch` for the chat
  hand-off is replaced by an in-process call of the handler, so `handOn()` keeps its shape but never
  leaves the process. Leases stay: after a container restart, a `running` chat whose lease expired
  is taken over when someone opens it (existing behaviour); `runStartupTasks()` additionally resets
  leases older than the boot.
- **SSE:** the `events` and streaming chat routes return `ReadableStream` responses; with one
  process, live deltas always come from the in-memory `runs` map, and the polling fallback only
  matters across a restart.
- **Rate limits:** `RateLimiter` implemented in memory (`Map` of fixed windows, swept every minute).
  Client address: Traefik **appends** to `X-Forwarded-For`, so the first entry is whatever the
  client sent; take the entry Traefik added (the right-most, with one proxy hop), configurable via
  `TRUSTED_PROXY_HOPS`. Keyed hash as today, with `BETTER_AUTH_SECRET` as key.
- **Secrets:** `AI_CONFIG_KEY` env var, same `SecretBox` format, but a **new** value
  (`openssl rand -base64 32`): the one the Supabase function used is lost, so the stored AI and
  search keys cannot be decrypted and are not imported (phase 8).
- CORS stays (scripts and agents call cross-origin).

**Done when:** `tests/api.test.ts`, `auth.test.ts` (rewritten for phase 3), `ai.test.ts`,
`chats.test.ts`, `analytics.test.ts`, `ics.test.ts`, `csv.test.ts`, `core.test.ts` run under Vitest
against `DrizzleStore` on a real temp database. Deno's `assertEquals` → `expect`; the fake `fetch`
and `authenticator.ts` helpers port as-is. The in-memory store is then deleted.

### Phase 5 — App shell, i18n, account and admin

- `(app)/layout.tsx`: Yana's sidebar frame, with Family Planner's left sidebar contents (family
  switcher, Vacation, Finance, Settings, Administration for admins) and the right chat panel slot.
  `Ctrl/⌘+J` and the per-device open state stay client-side.
- **i18n:** a script converts `STRINGS` in `i18n.ts` into `messages/{en,de}.json`; function values
  become ICU `plural`/`select`; strings with `<b>`/`<kbd>` use `t.rich`. Key parity is enforced by
  Yana's `messages.test.ts`. The user's language is stored in `user_settings` (as in Yana) instead
  of per device; the calendar feed keeps `?lang=`.
- **Base UI:** take Yana's `components/ui`, add what Family Planner uses and Yana lacks (`checkbox`,
  `collapsible`, `popover`, `scroll-area`, `switch`, `tabs`, `textarea`) via the Base UI registry;
  every `asChild` becomes `render`. Remember Yana's `<Select items>` rule.
- **From Yana, nearly verbatim:** `/login` (passkey first, `?next=` guard), `/account` (profile,
  password, passkeys, devices) plus a new _API tokens_ section, `/admin/users` (Yana's users CRUD +
  "new setup link" action), `attempt()` for every server action.
- **New on Yana's CRUD kit:** `/admin/families` (list, create, rename, delete, members).

### Phase 6 — Vacation and Finance pages

- Port `features/vacation`, `features/finance`, `features/settings`, `features/family` as client
  components under `src/features/`. Replace React Router (`useNavigate`, `useParams`, `Link`) with
  `next/navigation` and `next/link`; the existing stores (`vacation/store.ts`, `finance/store.ts`)
  keep calling `lib/api.ts`, now on same-origin `/api` with the session cookie (no token in
  `localStorage`; `credentials: "same-origin"`).
- Pages follow Yana's streaming pattern: the page body awaits nothing, calls `connection()`, hands
  the family promise (a **projection**, never a row) to a client section; no `loading.tsx`.
  Membership is checked in the data function, not the page body.
- The localStorage family cache ("instant start") stays as a client concern; signing out clears it
  as today.
- Legacy links: `/f/<id>` is now the real route; `/?s=<id>` and `/#/...` are rewritten by a small
  client component on `/` (the hash never reaches the server).

### Phase 7 — AI chat panel

- Port `layout/ChatPanel.tsx` and `features/chat` (store, transcript, attachments, Markdown, tools
  rendering) onto the SSE routes from phase 4. No protocol change.
- Settings → AI assistant stays per family (base URL, key, model, search provider). It is **not**
  Yana's `/ai` page: Yana's AI config is per user and provider-specific; Family Planner's is per
  family and OpenAI-compatible. Only the credential-card UI kit (`section-kit.tsx`: masked
  placeholder, keep-existing sentinel) is reused.
- Dev mock: `dev/mock_ai.ts` becomes a route under `src/app/dev/mock-ai/v1/...` that answers 404
  unless `NODE_ENV !== "production"` and `MOCK_AI=1`; `npm run seed` replaces `--seed`.

### Phase 8 — Data import from Supabase

`scripts/import-supabase.ts` (run with `tsx`), devDependency `postgres`:

1. Reads every table from the Supabase Postgres (`SUPABASE_DB_URL`, the pooler connection string
   with the DB password) in one read-only transaction.
2. Writes into an **empty** SQLite file (refuses a non-empty one) migrated by `applyMigrations()`,
   in one `writeTransaction()`: families, members, vacation, finance, AI settings (base URL, model,
   search provider, _Allow changes_, context window; the encrypted API and search keys are left
   empty, since the old `AI_CONFIG_KEY` is lost — editors enter them once in _Settings_ → _AI
   assistant_), chats with items/messages, users → Better Auth `users` + `accounts`
   (`providerId = "credential"`, the PBKDF2 hash as `password`), passkeys → Better Auth `passkeys`,
   API tokens → `api_tokens`. Sessions, setup links, challenges and rate-limit rows are not imported
   (everyone signs in once more).
3. Verifies: for every family, `GET /families/{id}/export` on the old API and on a local server over
   the imported file must be **identical JSON** (the export format omits ids and is deterministic —
   it is the acceptance test of the whole port). Also row counts per table.

### Phase 9 — Deployment and cutover

**New pipeline** (`.github/workflows/ci.yml`, Yana's file with names changed):

- `test`: `npm ci`, lint, format check, typecheck, test, dev-boot smoke (`/health` 200, `/login`
  200, `/` 307, no compile errors in the log).
- `build-amd64` / `build-arm64` → `docker.io/sascha384/family-planner:<tags>`; `publish-manifest`;
  `deploy` redeploys the Portainer stack via its API.
- Repository secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `PORTAINER_HOST`, `PORTAINER_TOKEN`,
  `PORTAINER_ENDPOINT_ID`, **`PORTAINER_STACK_ID` of a new stack**.

**Stack** (`docker-compose.production.yml`, set up once in Portainer):

```yaml
services:
  family-planner:
    image: ${DOCKER_USERNAME:-sascha384}/family-planner:latest
    restart: always
    expose: ["3000"]
    environment:
      - NODE_ENV=production
      - DATABASE_PATH=/app/data/family-planner.db
      - HOSTNAME=0.0.0.0
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:?set a random 32+ byte secret}
      - BETTER_AUTH_URL=https://${FP_DOMAIN:-family-planner.fa-krug.de}
      - PUBLIC_URL=https://${FP_DOMAIN:-family-planner.fa-krug.de}
      - PASSKEY_RP_ID=${FP_DOMAIN:-family-planner.fa-krug.de}
      - AI_CONFIG_KEY=${AI_CONFIG_KEY:?32 random bytes, base64 (openssl rand -base64 32)}
      - INITIAL_ADMIN_PASSWORD=${INITIAL_ADMIN_PASSWORD:-}
      - TRUSTED_PROXY_HOPS=1
    volumes:
      - family-planner-data:/app/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
    labels:
      - traefik.enable=true
      - traefik.http.routers.family-planner.rule=Host(`${FP_DOMAIN:-family-planner.fa-krug.de}`)
      - traefik.http.routers.family-planner.entrypoints=websecure # TLS: see below
      - traefik.http.routers.family-planner.tls.certresolver=<resolver>
      - traefik.http.services.family-planner.loadbalancer.server.port=3000
volumes:
  family-planner-data:
```

TLS is not optional: secure cookies and WebAuthn both need HTTPS. Yana's compose file still carries
a TODO about which Traefik entrypoint terminates TLS; settle it for both stacks.

**Backups.** Supabase backed the database up; SQLite on a volume does not. Add a nightly
`VACUUM INTO '/app/data/backups/<date>.db'` (keep 14) as a startup-scheduled in-process task, and
copy the backup directory off the host (Portainer host's existing backup, or `rclone` in a sidecar).
Finance data makes this a launch requirement, not a follow-up.

**Cutover** (one evening, minutes of downtime):

1. Rehearse: deploy the stack on a temporary host (`fp-next.fa-krug.de`), import a copy, run the
   export comparison, click through with a password account (passkeys can't work on that host —
   expected).
2. Put the Supabase function in maintenance: a one-line deploy answering `503` to writes.
3. Final import into the production volume (stop container, copy the file in, start).
4. Point DNS for `family-planner.fa-krug.de` from `saschakrug.github.io` to the Portainer host; wait
   for the TTL (lower it a day before). Sign in with a passkey to confirm the `rp_id` carried over.
5. Replace the Supabase `api` function with a **redirect shim**: every request →
   `308 https://family-planner.fa-krug.de/api/<same path and query>`. This keeps iCloud calendar
   subscriptions (`.../functions/v1/api/families/<feedId>/calendar.ics`) and existing scripts
   working. Verify with a real iCloud subscription that the redirect is followed before relying on
   it; if it is not, the shim proxies `calendar.ics` instead of redirecting.
6. Turn off GitHub Pages; delete the `gh-pages` branch after a week.
7. Keep the Supabase project (shim only) until its logs show no feed traffic for a month, then shut
   it down. The app already shows the new feed URL, so subscriptions can be renewed.

### Phase 10 — Cleanup

Delete `supabase/`, `dev/`, `web/`, `tests/`, `deno.json`, `CNAME`, `deploy.yml`; rewrite the README
(setup is now: set the stack's env vars, push to `main`); the API section's base URL changes.
Optionally publish an npm package with a `bin` like `@fa-krug/yana` — not needed for the production
setup and left out unless asked for.

## Risks and decisions

| # | Item                                                                          | Plan                                                                                                                                            |
| - | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | The old `AI_CONFIG_KEY` is lost.                                              | Decided: a new key; AI and search keys are not imported, editors enter them once (phase 8). Nothing else depends on it.                         |
| 2 | Plain-name accounts (`admin`) vs. Better Auth's email validation.             | Rewrite to `@family-planner.local` on import (decision above); count them in the live data first.                                               |
| 3 | Better Auth's passkey `publicKey` encoding vs. the stored base64url COSE key. | Test with a real imported passkey on the rehearsal → cutover; fallback: affected users add a passkey again after a password/setup-link sign-in. |
| 4 | Whether iCloud follows a 308 for a calendar subscription.                     | Verify in rehearsal; proxying the feed in the shim is the fallback.                                                                             |
| 5 | Hash URLs (`/#/...`) in bookmarks and the home-screen app.                    | Client redirect on `/`; the old SPA's `404.html` fallback goes away with Pages.                                                                 |
| 6 | Language moves from per device to per user.                                   | Matches Yana; first sign-in seeds it from the browser's `Accept-Language`.                                                                      |
| 7 | Long AI turns survive restarts only via lease takeover.                       | Same as today across invocations; a deploy mid-turn resumes when the chat is opened.                                                            |
| 8 | Backups.                                                                      | Launch requirement (phase 9).                                                                                                                   |

## Order and size

| Phase                         | Depends on | Rough size                                      |
| ----------------------------- | ---------- | ----------------------------------------------- |
| 1 Scaffold                    | —          | small                                           |
| 2 Schema + DrizzleStore       | 1          | medium                                          |
| 3 Auth                        | 1, 2       | medium                                          |
| 4 API in Next + tests         | 2, 3       | medium (mostly mechanical)                      |
| 5 Shell, i18n, account, admin | 3          | medium                                          |
| 6 Vacation + Finance UI       | 4, 5       | large (17 k lines of client code, mostly moved) |
| 7 Chat panel                  | 4, 5       | medium                                          |
| 8 Import                      | 2, 3       | small                                           |
| 9 Deploy + cutover            | all        | small, plus a rehearsal                         |
| 10 Cleanup                    | 9          | small                                           |

Phases 5–7 can run in parallel once 4 is green; 8 can be written right after 3.
