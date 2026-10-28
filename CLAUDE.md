# Family Planner

Family Planner is moving from **Deno + Supabase + a Vite SPA on GitHub Pages** to the stack
`fa-krug/yana-server` runs on: **Next.js 16 / React 19 / TypeScript, SQLite via Drizzle +
better-sqlite3**, deployed as one Docker image. The plan, its phases and its decisions are
`docs/nextjs-migration-plan.md`; read it before starting a phase.

This is the only agent-instruction file in the repository.

## Two apps in one tree, until the cutover

| Path | What | Checked by |
| --- | --- | --- |
| `src/`, `messages/`, `drizzle/`, root `package.json` | The Next.js app (the target) | `npm run lint/format:check/typecheck/test`, `.github/workflows/next.yml` |
| `supabase/`, `dev/`, `tests/`, `deno.json` | The Supabase backend (production today) | `deno task check/test`, `.github/workflows/ci.yml` |
| `web/` | The Vite frontend (production today; was `app/`) | `npm run build` in `web/`, `ci.yml` |

- **The old frontend lives in `web/`, not `app/`, and must stay there.** Next.js prefers a root
  `app/` directory over `src/app/`, so with the Vite app at `app/` the build found no routes at
  all (the route table showed only `/404`).
- **`deno.json` sets `"nodeModulesDir": "none"`.** With a root `package.json`, Deno otherwise
  switches to a manual `node_modules` and `deno check` fails on every `npm:` specifier in
  `supabase/`. Its `fmt`/`lint` are scoped with `include` to the old trees, and ESLint,
  Prettier, `tsconfig.json` and `.dockerignore` ignore those trees in turn.
- **Migration work happens on the `next` branch** (phase branches PR into it). `main` keeps
  deploying the Supabase version through `deploy.yml` until phase 9; do not merge `next` into
  `main` before then. Fixes to the running app go to `main` as before.
- Port from the old code, don't reinvent: the API handler in `supabase/functions/_shared/` sits
  behind a `Store` interface and is moved, not rewritten (phase 4).

## Commands

```bash
npm install                  # Node 26.12.1 (see .nvmrc)
npm run dev                  # http://localhost:3000
npm run build                # production build (standalone output)
npm run lint && npm run format:check && npm run typecheck && npm test   # what CI runs

npx drizzle-kit generate     # a migration from src/lib/db/schema.ts into drizzle/
                             # Applying migrations is not a step you run: the server
                             # does it at startup, in every shape.
docker compose up --build    # the production image, locally
```

Run all four checks before pushing; an unformatted file fails CI. When touching the old trees,
`deno task check && deno task test` too.

## Conventions (Yana's, and why)

These are taken from Yana's `CLAUDE.md`, where each one has its measurement or incident behind
it. Read the matching bullet there before changing one of them.

- **Style:** Prettier (line length 100, double quotes, semicolons, trailing commas); ESLint owns
  everything else, `eslint-config-prettier` last.
- **`@/*` maps to `src/*`** in both `tsconfig.json` and `vitest.config.ts`.
- **Dependencies are pinned exactly** (no `^`/`~`); regenerate `package-lock.json` with
  `npm install` when a pin changes. Node is pinned three times and all three must agree:
  `.nvmrc` (26.12.1), `engines.node` (`>=26.12.1 <27`), the Dockerfile's `node:26-alpine` (plus
  its version check). 26.12.1 is a security floor (CVE-2026-111497, Brotli decoder).
- **Database access is centralized.** `getDb()` (`src/lib/db/client.ts`) is the only place a
  connection is opened; every write goes through `writeTransaction()` (`BEGIN IMMEDIATE`), whose
  callback **must be synchronous** — better-sqlite3 has no async driver, and `NotPromise<T>` plus
  a runtime check reject an `async` callback. PRAGMAs are Yana's (`applyPragmas()`).
- **JSON columns get a `json_valid(...)` CHECK, added with the column.** Without it a malformed
  write is accepted and every later read of the row throws inside Drizzle. Adding a CHECK to an
  existing SQLite table needs a table rebuild.
- **A table that gains and loses columns in one `drizzle-kit generate` prompts interactively and
  fails without a TTY** — generate the additions and the drop as two migrations.
- **`updatedAt` columns carry `$onUpdate(() => new Date())`.**
- **Migrations run at startup only:** `register()` in `src/instrumentation.ts` →
  `runStartupTasks()` in `src/lib/startup.ts`. `instrumentation.ts` imports exactly one module
  (`@/lib/startup`), because webpack compiles it for the edge runtime too and `next.config.ts`
  cuts exactly that specifier out (`IgnorePlugin`); a second import makes `next dev` answer 500
  on every route. Add startup steps inside `runStartupTasks()`. `src/instrumentation.test.ts` is
  the tripwire. A failed startup exits the process.
- **Every route that can reach the database calls `connection()` from `next/server` first.** A
  layout's call does not cover its pages. Called, not awaited, in a synchronous page body;
  awaited where the function is async anyway. The check that matters:
  `rm -rf data && npm run build && ls data` must report no `data/`, and the route table must show
  `ƒ` beside every route.
- **The streaming pattern:** page bodies await nothing and there is no `loading.tsx` anywhere; a
  page hands an unawaited promise (of a **projection**, never a whole row) to a client section
  that `use()`s it inside a `<Suspense>` whose fallback is the same form in a `pending` state.
- **shadcn here is Base UI, not Radix:** compose with `render`, never `asChild`.
- **Every user-facing string comes from `messages/en.json` + `messages/de.json`**, which must
  define identical keys (`src/i18n/messages.test.ts`). Keys are compiler-checked through the
  `AppConfig` augmentation in `src/i18n/next-intl.d.ts`. Server actions return a catalog
  `errorKey`, never an English validator message. The brand name "Family Planner" is the one
  accepted literal.
- **Catch blocks around Next APIs call `unstable_rethrow(error)` first**, so a `redirect()`,
  `notFound()` or the build's prerender bail-out is not logged or swallowed as a failure (see
  `src/i18n/request.ts`).
- **Tests: the file extension picks the vitest project** — `.test.ts` runs in `node` against
  real SQLite (temp `DATABASE_PATH`, schema from `src/lib/db/test-support.ts`, which goes through
  the same `applyMigrations()` as startup; no driver mocks), `.test.tsx` runs in `jsdom` with
  `renderWithProviders()` and the real catalogs. Stub request-scope modules (`next/server`,
  `next/headers`, `next/navigation`) with the modules in `src/test/`, never inline factories.

## Deployment

The image is Yana's Dockerfile, renamed: standalone build, `tini`, uid 1001, SQLite at
`/app/data/family-planner.db` on a volume, migrations applied by the app at startup.
`docker-compose.production.yml` documents the Portainer stack behind Traefik. Until phase 9, CI
only builds the image and boots it; publishing to Docker Hub and redeploying Portainer arrive
with the cutover.

## Commit messages

```
<type>(<scope>): <description>

Types: feat, fix, docs, style, refactor, test, chore
```
