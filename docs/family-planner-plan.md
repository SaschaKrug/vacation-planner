# Family Planner: rework plan

Turns _Vacation Planner_ into **Family Planner**: one family per secret id, with **Vacation** and
**Finance** as sub-pages, a **Settings** page, a left navigation sidebar and a right (collapsed)
**AI chat** sidebar backed by any OpenAI-compatible endpoint.

## Decisions

| Topic             | Decision                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Name / domain     | **Family Planner**, repo `family-planner`, `family-planner.fa-krug.de`                                                                     |
| Family model      | No login, as today: secret **edit id** + **view id**; a family replaces a "planner/session"                                                |
| Existing planners | Migrated 1:1 to families; old `?s=<id>` links and old iCal feed URLs keep working                                                          |
| Frontend          | **Vite + React + TypeScript**, **Tailwind + shadcn/ui** (replaces the vanilla `web/`)                                                      |
| Navigation        | Left sidebar: family switcher (families opened on this device, + New / Open link), Vacation, Finance, then Settings and Help at the bottom |
| AI config         | **Per family, server-side**: base URL, API key (encrypted at rest, never returned), model picked from the endpoint's `/models` list        |
| AI calls          | Proxied and tool loop run by the Edge Function, streamed to the browser                                                                    |
| Web research      | `web_search` (Tavily or Brave, key in settings) + `fetch_page` (server fetches and extracts text)                                          |
| AI tools          | Calendar read/write, web search/fetch, finance read/write                                                                                  |
| AI changes        | Applied directly, shown as change cards with one-click **Undo**; asks first for big changes                                                |
| Chat history      | Per device (browser storage), list of past chats per family                                                                                |
| AI for viewers    | Edit link only; chat sidebar hidden on the view link                                                                                       |
| View link         | Shows **everything read-only**, finances included (see "Links & feeds" for keeping old feeds safe)                                         |
| Finance v1        | **Transactions log** with **categories**, **CSV import**, **monthly summary + charts**                                                     |
| Entry types       | Move to **Settings → Vacation** (finance categories to **Settings → Finance**)                                                             |

## Target layout

```
┌──────────────┬───────────────────────────────────────────┬──┐
│ ▾ Krug family│  Vacation · 2027  ‹ 2027 ›     ⟳ saved    │✨│  ← right rail (collapsed)
│──────────────│                                           │  │
│ 🏖 Vacation  │   (year grid, type chips, selection bar)  │  │
│ 💶 Finance   │                                           │  │
│              │                                           │  │
│──────────────│                                           │  │
│ ⚙ Settings  │                                           │  │
│ ? Help       │                                           │  │
└──────────────┴───────────────────────────────────────────┴──┘
```

- **Left sidebar** (shadcn `Sidebar`): collapsible to icons on desktop, a sheet behind a ☰ button
  on phones.
- **Right sidebar**: a thin ✨ rail by default; it opens to a ~400px chat panel (full-screen sheet
  on phones). `Ctrl/⌘+J` toggles it; the open/closed state is remembered per device. Hidden on the
  view link and replaced by a "Set up AI" prompt when AI isn't configured.
- Routes (React Router, GitHub Pages SPA fallback via `404.html`): `/` landing · `/f/:id/vacation` ·
  `/f/:id/finance` · `/f/:id/settings/:section?`. `/?s=<id>` (old links) redirects to
  `/f/<id>/vacation`.

## Settings page

Each section says whether it applies to **the whole family** (server) or **this device** (browser).

| Section      | Contents                                                                                                                                                                                                  | Scope           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| General      | Family name, language, theme (system/light/dark), currency                                                                                                                                                | family / device |
| Sharing      | Edit link, view link (notes that it includes finances), **rotate links**, iCal feed builder (types, gaps, notes) + iCloud how-to                                                                          | family          |
| Vacation     | **Entry types per year** (moved from the dialog), roles help, copy types between years, "Always show weekdays", "Skip weekends" default                                                                   | family / device |
| Finance      | **Categories** (name, color, icon, income/expense), saved CSV import mappings                                                                                                                             | family          |
| AI assistant | Base URL, API key (write-only, shows `••••1234`), model dropdown from `GET {base}/models` (free text fallback), **Test connection**, search provider (Tavily / Brave / off) + key, "Allow changes" toggle | family          |
| Integrations | External agent link (today's ✨ prompt) and API docs (today's "API for scripts")                                                                                                                          | family          |
| Data         | Export JSON (v2, includes finance), import, clone family                                                                                                                                                  | family          |

What stays on the vacation page: year navigation, grid, type chips, selection bar, zoom, undo/redo
buttons, sync status, keyboard shortcuts.

## Backend

### Renames (data kept)

- Migration: `sessions` → `families`, `session_id` → `family_id` everywhere, default name "Family".
  `ALTER … RENAME` keeps all rows; the SQL functions (`replace_session_contents` →
  `replace_family_contents`) get recreated.
- API: `/families/{id}/…` is canonical; `/sessions/{id}/…` stays as an **alias** forever (iCal
  subscriptions and scripts point there).
- `handler.ts` (843 lines) is split into `router.ts`, `families.ts`, `vacation.ts`, `finance.ts`,
  `ai/*.ts`; `Store` grows finance and settings methods (Memory + Supabase).

### Links & feeds

Because the view link now exposes finances, the **feed** and **view** tokens are separated:

- New column `feed_id`: calendar feeds use it (it can only read `calendar.ics`).
- **Migrated families**: the old `read_id` becomes a _legacy_ token limited to the vacation view +
  feed, so every link and subscription already shared keeps working **without** exposing finances. A
  fresh `read_id` is minted as the new full view link.
- Settings → Sharing can rotate the view id and the feed id separately.

### Finance

Tables (RLS on, no policies, as today):

- `finance_categories(family_id, id, name, color, icon, kind: income|expense|both, position)`
- `transactions(family_id, id uuid, day date, amount_cents bigint /* signed */, payee, description, category_id null, note, import_hash null, created_at)`
- `family_settings(family_id, currency default 'EUR', csv_mappings jsonb, …)`

Endpoints:

| Method & path                                                              | What                                                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET/POST/PATCH/DELETE /families/{id}/finance/categories[/{cat}]`          | Categories CRUD                                                                                                        |
| `GET /families/{id}/finance/transactions?from&to&category&q&uncategorized` | List with paging                                                                                                       |
| `POST /families/{id}/finance/transactions`                                 | `{ops:[{action:add                                                                                                     |
| `POST /families/{id}/finance/import`                                       | Rows already mapped by the client; dedupes via `import_hash` (date+amount+text); returns counts and skipped duplicates |
| `GET /families/{id}/finance/summary?from&to`                               | Income/expense per month, totals per category                                                                          |

New default categories in EN/DE (Groceries, Rent, Utilities, Mobility, Leisure, Salary, …).

### AI

- `ai_settings(family_id, base_url, model, api_key_enc, search_provider, search_key_enc, allow_writes)`.
  Keys are encrypted with AES-GCM using a new Supabase secret **`AI_CONFIG_KEY`** (GitHub secret →
  `supabase secrets set` in the deploy workflow). The API only ever returns `hasKey` and the last 4
  characters.
- `GET/PUT /families/{id}/ai/settings`, `GET /families/{id}/ai/models` (proxy to `{base}/models`),
  `POST /families/{id}/ai/test`.
- `POST /families/{id}/ai/chat`: the client sends its local history, and the server runs the
  OpenAI-compatible `/chat/completions` tool loop (max 30 steps per turn, the last without tools so
  the model wraps up) and streams **SSE** events: `text`, `tool_start`, `tool_result`, `change`
  (summary + inverse ops for undo), `messages` (what the app appends to its history, tool results in
  full), then `done`, `error` or `continue`. After `continue` the app sends the history again with
  `continue: true` (it then ends with tool results) and the same turn goes on; the steps used are
  counted from the history. Once a turn is over, the app shortens its tool results to 2,000
  characters.
- System prompt: today's date, language, family name, the current year's types and finance
  categories, rules (read before writing, confirm before >31 days, deleting types or bulk finance
  edits).
- Tools:

| Tool                                                     | Notes                                                                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_calendar(from,to)`                                  | Entries + notes + gaps                                                                                                                          |
| `get_types(year)` / `manage_types(...)`                  | Add/rename/recolor/delete/copy                                                                                                                  |
| `change_entries(ops)` / `set_notes(ops)`                 | Same op format as the REST API                                                                                                                  |
| `web_search(query)`                                      | Tavily or Brave                                                                                                                                 |
| `fetch_page(url)`                                        | http(s) only, SSRF guard (no private/loopback/link-local hosts, re-checked on redirects), 10s timeout, 2MB cap, HTML → readable text, truncated |
| `list_transactions(filter)` / `finance_summary(from,to)` | Read                                                                                                                                            |
| `change_transactions(ops)` / `manage_categories(...)`    | Write                                                                                                                                           |

- **Undo**: every write tool snapshots the affected days/rows first and emits the inverse ops; the
  chat's Undo button sends them through the normal endpoints (and the calendar's own undo stack sees
  them).
- Rate limits: new `ai_chat` bucket (e.g. 60 requests per 5 min per client), plus a per-family cap;
  `fetch_page` and `web_search` count per tool call.
- The edge function's wall-clock limit (150s on the free plan) bounds a request, not a turn: after
  90s a request ends with `continue` before its next model call (each request takes at least one
  step), and the app picks the turn up with a new request. A model call still running at 130s is
  cut off with an `error`, so the request reports back before the platform stops it.
- A turn never ends blank: a model that stops without a word (no text, no tool calls) gets one more
  call without tools to answer, else the chat says it gave no answer; and if a request's stream
  closes without `done`, `error` or `continue`, the app shows that the answer broke off.

### Export v2 / agent doc

- Export format `{"format":"family-planner","version":2,…, finance:{categories, transactions}}`; v1
  files (`vacation-planner`) still import.
- `/agent` doc renamed and extended with the finance endpoints.

## Frontend structure

```
app/                         (replaces web/; Vite root, npm)
  index.html, 404.html, public/favicon.svg, public/CNAME
  src/
    main.tsx, router.tsx
    components/ui/           shadcn components
    layout/                  AppShell, LeftSidebar, FamilySwitcher, ChatSidebar
    features/vacation/       YearGrid (ported imperative grid in a ref'd component), TypeChips,
                             SelectionBar, useSync (queue/poll/cache from app.js), undo stack
    features/finance/        TransactionsTable, TransactionDialog, CsvImportWizard, Summary (Recharts)
    features/chat/           ChatPanel, MessageList, ChangeCard, useChatStream (SSE), chat storage
    features/settings/       one component per section
    lib/                     api.ts (typed client), i18n.ts (current EN/DE dictionaries ported), core.ts (from core.js), storage.ts
```

- The grid stays **imperative** inside one React component (pointer drag, fill handle, keyboard,
  copy/paste are performance-sensitive); React owns the surrounding UI.
- CSV import: Papaparse; detects `;`/`,`, German number and date formats, debit/credit columns,
  ISO-8859-1. Steps: upload → map columns (saved per family) → preview with duplicates flagged →
  import.
- Charts: Recharts (monthly income vs. expenses bars, spending by category).
- localStorage keys move from `vp-*` to `fp-*`.

## Tooling, CI, deploy

- `deno task dev` keeps the API on the in-memory store; `npm run dev` (in `app/`) runs Vite with
  `/api` proxied to it. New dev flag `--mock-ai` serves a scripted fake OpenAI endpoint so chat and
  tools can be tried without a key.
- Tests: Deno for the backend (families, aliases, legacy token limits, finance, AI tool loop against
  a fake provider, SSRF guard), **Vitest** for frontend logic (core, CSV parsing, undo inverses),
  Playwright smoke tests (shell, vacation select/toggle, settings, chat with mock AI).
- CI: adds `setup-node`, `npm ci`, typecheck, lint, Vitest, `vite build`. Deploy publishes
  `app/dist` to `gh-pages` with `cname: family-planner.fa-krug.de`; sets `AI_CONFIG_KEY` as a
  function secret.

## Delivery: four PRs, each deployable

1. **Rename + backend groundwork**: name, domain, README, workflows, `CNAME`; DB rename +
   `/sessions` alias; feed/view token split; settings tables; handler split. No UI change besides
   the name.
2. **New frontend**: Vite/React/TS/Tailwind/shadcn app shell with both sidebars (chat placeholder),
   router, family switcher, the vacation page at parity with today's features, and the settings page
   with everything moved there (types included). `web/` is removed.
3. **Finance**: tables, endpoints, categories, transactions page, CSV import, summary charts, export
   v2.
4. **AI assistant**: encrypted settings, models list, test, chat streaming endpoint with all tools,
   chat sidebar with history and undo cards, `--mock-ai`, rate limits, docs.

## What you'll need to do

- Rename the repo on GitHub: **Settings → General → Repository name** → `family-planner`.
- DNS: `CNAME family-planner.fa-krug.de → saschakrug.github.io`.
- Old domain: GitHub Pages serves one domain per repo, so for `vacation-planner.fa-krug.de` either
  set a redirect at your DNS provider, or keep a tiny repo with a redirect page (I can write it; it
  can also forward the "recently opened" list, since browser storage doesn't cross domains).
- Add the GitHub secret `AI_CONFIG_KEY` (`openssl rand -base64 32`).
- Optional: a Tavily or Brave Search API key, entered in the app's settings.
