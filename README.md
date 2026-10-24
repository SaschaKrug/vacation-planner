# Family Planner

One place per family to plan the year: a shared year calendar for vacation, public holidays,
sick days and day-care closures (with a coverage check and an iCloud / Apple Calendar feed), a
transactions log for the family's finances, and a REST API. An AI assistant is next (see
[the plan](docs/family-planner-plan.md)).

**Live:** https://family-planner.fa-krug.de/

### The app

- **Families:** every family is one secret id. The left sidebar switches between the families
  opened on this device (or creates / opens another one) and between the topics: **Vacation**
  and **Finance**. **Settings** holds everything else. The right sidebar (✨, `Ctrl/⌘+J`)
  is where the AI chat will live; phones open both as sheets.
- No login: every family has a secret **edit link** (`/f/<id>`) and a separate **view-only
  link**. Anyone with the edit link can change it, so only share it with people who should. The
  calendar feed has an id of its own (see [Links](#links)). Old links (`/?s=<id>`) still work.

### Vacation

- All days of a year as 12 rows × 31 days; pick the year at the top. Phones show one calendar
  per month instead (Monday to Sunday), with the type chips and the actions for the selected
  days in a bar at the bottom.
- **Zoom:** the 🔍 slider below the calendar (or `Ctrl/⌘` + `+` / `−` / `0`) sets how many days
  fit across it, 7 to 31; zoomed in, the cells also show the weekday (or always: *Settings* →
  *Vacation* → *Always show weekdays*). Remembered per device.
- Your own entry types (name + color + role), **per year**, edited in *Settings* → *Vacation*:
  every year has its own types, so 2027 can have different people, colors or day-care closures
  than 2026. New families start with *Holiday*, *Vacation* and *Sick*; a year without types
  offers to copy them from the closest year that has some.
- A day can hold **several entries**, e.g. *Day care closed* + *Vacation Dad*.
- **Icons & comments on days**, e.g. 🎄 *Christmas* or 🐣 *Easter*: shown in the grid and in
  the tooltip, optionally in the calendar feed. They are independent of entries (no coverage,
  no stats); one note per day.
- **Coverage check:** types with the role *Needs cover* (e.g. “Day care closed”) are flagged on
  every weekday that has no *Covers* (e.g. “Vacation …”) or *Day off* (e.g. “Holiday”) entry.
- Click/drag to select days (also across months), then click a type or press `1`–`9`.
  `Ctrl/⌘+C`, `X`, `V` copy/cut/paste (pasting onto a larger selection repeats the copied days),
  drag the ▪ fill handle to repeat a selection, `Del` clears, `G` jumps to the next uncovered
  day, `?` shows all shortcuts. On touch screens: tap a day, or long-press and drag to select a
  range; *Multi-select* lets taps add or remove single days (and long-press ranges add to the
  selection).
- **Undo / redo:** ↶ / ↷ at the top, or `Ctrl/⌘+Z` / `Ctrl/⌘+Y`.

### Finance

- A **transactions log**: amounts in the family's currency, money in or out, with payee,
  description, note and a **category** (new families get defaults like Groceries, Housing,
  Salary; edit them in *Settings* → *Finance*). Pick a month, a year or all time; search, filter
  by category (or *Uncategorized*) and by in / out; change a category right in the list. Every
  change can be undone from its message.
- **Import bank statements (CSV):** the import guesses the format (UTF-8 or Windows-1252,
  separator, lines before the table, which column is the date, amount or debit / credit,
  payee and description, German or English numbers and dates) and shows a preview to correct
  it. Rows that were imported before are skipped, so overlapping statements can be imported
  again; identical rows on one day (two coffees) stay apart. The format is remembered per bank.
- **Overview:** income, expenses and the balance, a chart per month and the spending (or
  income) per category, also as a table.
- The view-only link shows the finances read-only; the legacy view link and the calendar feed
  never do.

### Settings

- **General:** the family's name; language (English / German) and light / dark per device.
- **Sharing:** the edit and view-only links, a new view-only link when the old one got around,
  and the **calendar feed**: pick what it includes, then *Subscribe on this device*, or on a
  Mac: Calendar → File → New Calendar Subscription → paste the feed URL → Location **iCloud**.
  The feed URL opens nothing but the feed, so it never exposes the edit or view link.
- **Vacation:** the entry types of each year, and the calendar options of this device.
- **Finance:** the currency, the categories (name, color, icon, income / expense / both) and the
  remembered bank formats.
- **Integrations:** a ready-to-paste prompt with one link for an AI agent that can send HTTP
  requests (Claude Code, Codex, ChatGPT agent mode …). The link returns instructions with the
  family's types and ready-to-use API URLs; the agent then reads and changes the calendar
  through the API, and the open app shows the changes within seconds. The link carries the edit
  id, so it's as powerful as the edit link (the view-only link gives a read-only version). Also
  ready-to-run `curl` examples for scripts.
- **Data:** *Export (JSON)* downloads the whole family (all years, types, entries and notes, but
  not its links) as a file; *Import from file…* (edit link only) replaces all of that with such
  a file, e.g. to restore a backup (the family keeps its name and links; can't be undone).
  *Clone family* copies everything into a new family with its own links; it works from a
  view-only link too, which gives you your own editable copy.
- New families get default types in the app's language, and the calendar feed uses it for its
  texts.

## Architecture

```
GitHub Pages (app/)  ──fetch──▶  Supabase Edge Function "api"  ──▶  Postgres (8 tables)
iCloud / Apple Calendar ──GET calendar.ics──┘
```

| Path | What |
| --- | --- |
| `app/` | Frontend: Vite + React + TypeScript, Tailwind + shadcn/ui |
| `supabase/functions/api/` | Edge Function entry point |
| `supabase/functions/_shared/` | API handler, iCalendar builder, storage (Supabase + in-memory), rate limits |
| `supabase/migrations/` | Database schema |
| `dev/server.ts` | Local server: frontend + API with an in-memory store |
| `tests/` | Deno tests (API, iCalendar, calendar logic) |

## Setup / deployment

Deployment runs from GitHub Actions on every push to `main` (`.github/workflows/deploy.yml`):
migrations → Edge Function → frontend to the `gh-pages` branch.

1. **Supabase secrets** – in the repository: *Settings → Secrets and variables → Actions →
   New repository secret*:

   | Secret | Where to find it |
   | --- | --- |
   | `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → [Access Tokens](https://supabase.com/dashboard/account/tokens) → Generate new token |
   | `SUPABASE_PROJECT_REF` | Project → Settings → General → *Project ID* (the `xxxx` in `https://xxxx.supabase.co`) |
   | `SUPABASE_DB_PASSWORD` | The database password chosen when the project was created (Project → Settings → Database → *Reset database password* if lost) |

2. **GitHub Pages** – *Settings → Pages → Build and deployment*: Source **Deploy from a branch**,
   Branch **gh-pages** / **(root)**. (Only needed once, after the first deploy created the branch.)
   The custom domain `family-planner.fa-krug.de` comes from the workflow (`cname:`); its DNS
   needs a `CNAME` record pointing to `saschakrug.github.io`.

3. Run the workflow: *Actions → Deploy → Run workflow* (or push to `main`).

The tables use Row Level Security without policies, so they are not reachable with the public
anon key; all access goes through the Edge Function, which uses the service role key.

### Rate limits

The API counts requests per client address (IPv6: per /64 network) in fixed windows, stored in
the `rate_limits` table as a keyed hash, never the address itself; rows older than a day are
deleted. Over the limit, it answers `429` with a `Retry-After` header.

| What | Limit |
| --- | --- |
| New families (`POST /families`, `…/clone`) per client | 20 per hour |
| New families of all clients together | 500 per hour |
| Changes (`POST`, `PATCH`, `DELETE`) per client | 300 per 5 minutes |

Reads, including the calendar feed, are not limited: iCloud fetches every subscription from a
few shared addresses. If counting fails, requests go through. The limits are in
`RATE_LIMITS` in `supabase/functions/_shared/handler.ts`; the local dev server has none.

## Local development

```sh
(cd app && npm ci && npm run build)   # once, and after changing the app
deno task dev     # http://localhost:8787: the built app + the API (data is kept in memory)
deno task test    # unit + API tests
deno task check   # type-check, lint, format check (backend and app/src)

cd app && npm run dev   # the app with hot reload on http://localhost:5173 (needs `deno task dev`)
```

`npm run build` in `app/` also type-checks the app (`tsc -b`). The app uses Node 22.

No database needed: the dev server runs the real API handler on an in-memory store. Options
(combinable, e.g. `deno task dev --persist --seed`):

| Option | Effect |
| --- | --- |
| `--persist` | Keeps the data in `.dev/data.json` across restarts (delete the file to start over) |
| `--seed` | Adds a *Demo family* with types, entries, notes and uncovered days in this and next year, and six months of transactions, if there are no families yet |
| `--rate-limit` | Low rate limits (3 new families, 30 changes per minute) to try the app's 429 handling |

On start, the server prints the edit and view links of all families it holds.

## API

Base URL: `https://<project-ref>.supabase.co/functions/v1/api` (*Settings* → *Integrations* in the app
shows ready-to-run examples for your family). The family id from the edit link is the access
key; the other links can only read (see [Links](#links)). Types can be referenced by id or by
name (case-insensitive). Dates are `YYYY-MM-DD`.

`/sessions/...` is the name from before families and works as an alias of `/families/...`
everywhere, so existing calendar subscriptions and scripts keep working.

Every year has its own entry types, and a day can only use the types of its year: a reference
like `"type": "vacation"` is resolved in the year of each day. The types endpoints work on one
year, given as `?year=` (default: the current year); copying keeps the ids, so references keep
working across years.

| Method & path | Description |
| --- | --- |
| `POST /families` | Create a family. Body (optional): `{"name": "...", "year": 2026, "types": [{"name","color","role"}]}`; the types go into `year` (default: current year); `"lang": "de"` gives German default types and name |
| `GET /families/{id}?year=2026` | `family` (the links this id may know, `name`, `access`), the year's types, entries and notes, and `typeYears` (all years with types). `?from=&to=` also works; no filter = all. The same object is also in `session`, for scripts from before families |
| `PATCH /families/{id}` | Rename: `{"name": "..."}` |
| `POST /families/{id}/links` | New link: `{"link": "view"}` or `{"link": "feed"}` makes a new view or feed id (the old one stops working); `{"link": "legacy"}` removes the legacy view link. Returns the family like `GET /families/{id}` |
| `POST /families/{id}/clone` | Copy the family (all years, types, entries, notes) into a new one with new ids. Body (optional): `{"name": "..."}`, default *“… (copy)”*. The view-only id works too |
| `GET /families/{id}/export` | The whole family as a file: `{"format": "family-planner", "version": 2, "name", "types": [...], "entries": {...}, "notes": {...}, "finance": {"currency", "categories", "transactions"}}`, all years, without the family's ids. The view-only id works too; the legacy id exports without `finance` |
| `POST /families/{id}/import?year=2026` | Replace all years, types, entries and notes with those of an export file (the body), in one transaction, and the finances if the file has them; name and ids stay. Version 1 files and `"format": "vacation-planner"` (exported before the rename) work too. Returns the family like `GET /families/{id}` |
| `GET /families/{id}/entries?year=2026` | `{"2026-08-03": ["vacation", "day-care-closed"], ...}` |
| `POST /families/{id}/entries` | Change entries (see below) |
| `GET /families/{id}/notes?year=2026` | `{"2026-12-25": {"icon": "🎄", "comment": "Christmas"}, ...}` |
| `POST /families/{id}/notes` | Set or clear day notes (see below) |
| `GET /families/{id}/types?year=2026` | List the year's entry types |
| `POST /families/{id}/types?year=2026` | Add a type to the year: `{"name", "color": "#rrggbb", "role"}` (`"year"` in the body works too) |
| `PATCH /families/{id}/types/{type}?year=2026` | Change `name`, `color`, `role`, `position` |
| `DELETE /families/{id}/types/{type}?year=2026` | Delete a type and all its entries in that year |
| `POST /families/{id}/types/copy` | Copy a year's types into another year: `{"from": 2026, "to": 2027}`; types the target year already has (same id) are kept |
| `GET /families/{id}/calendar.ics` | iCalendar feed. `?types=a,b` filters (by id or name, in every year), `?gaps=1` adds “⚠ Not covered” events, `?notes=1` adds day notes as events, `?name=` overrides the calendar name, `?lang=de` German event texts |

| `GET /families/{id}/agent` | Instructions for AI agents (Markdown) with this family's types and API URLs |

Roles: `none`, `needs_cover`, `covers`, `day_off`.

### Finance

Amounts are integer **cents**, negative for money going out. Reading needs the view or edit id,
changing the edit id.

| Method & path | Description |
| --- | --- |
| `GET /families/{id}/finance` | `{"currency", "csvMappings", "categories": [{"id", "name", "color", "icon", "kind", "position"}]}` |
| `PATCH /families/{id}/finance/settings` | `{"currency": "EUR"}` (ISO 4217) and/or `{"csvMappings": [...]}` |
| `POST /families/{id}/finance/categories` | Add `{"name", "color", "icon", "kind": "income" \| "expense" \| "both"}` |
| `PATCH` / `DELETE /families/{id}/finance/categories/{category}` | Change or delete (its transactions become uncategorized); by id or name |
| `POST /families/{id}/finance/categories/defaults` | Add the default categories the family doesn't have: `{"lang": "de"}` |
| `GET /families/{id}/finance/transactions` | `?from=&to=&category=<id or none>&kind=income\|expense&q=&limit=&offset=` → `{"transactions": [{"id", "date", "amountCents", "payee", "description", "categoryId", "note", "imported"}], "total", "incomeCents", "expenseCents"}`, newest first |
| `POST /families/{id}/finance/transactions` | `{"ops": [...]}`: `{"action": "add", "date", "amountCents", "payee", "description", "categoryId", "note"}`, `{"action": "update", "id", ...fields}`, `{"action": "delete", "ids": [...]}`. Returns `inverse`, the ops that undo the request |
| `POST /families/{id}/finance/import` | `{"rows": [{"date", "amountCents", "payee", "description", "categoryId"}], "dryRun": true}`: adds the rows that weren't imported before; returns `added`, `duplicates` (row indexes) and the new `ids` |
| `GET /families/{id}/finance/summary?from=&to=` | `{"currency", "incomeCents", "expenseCents", "count", "months": [{"month", "incomeCents", "expenseCents"}], "categories": [{"categoryId", "incomeCents", "expenseCents", "count"}]}` |

### Links

Every family has several ids; each one is a link with its own access:

| Id | In `family` | Can |
| --- | --- | --- |
| Edit id | `id` | Everything |
| View id | `readId` | Read everything (finances too), export, clone |
| Feed id | `feedId` | Only `calendar.ics` |
| Legacy id | `legacyId` | Read the calendar, its feed, export, clone. Only planners from before families have one: their old view id, so links and calendar subscriptions shared back then keep working without ever seeing anything that's new in families (like finances) |

`family.access` says which one opened the family (`edit`, `view` or `calendar` for the legacy
id); a response only names the ids that link may know.

### Changing entries

```sh
# Vacation from Aug 3 to Aug 14, weekdays only
curl -X POST "$BASE/families/$FAMILY/entries" -H "content-type: application/json" \
  -d '{"action":"add","type":"vacation","from":"2026-08-03","to":"2026-08-14","skipWeekends":true}'

# Several operations, applied in order
curl -X POST "$BASE/families/$FAMILY/entries" -H "content-type: application/json" \
  -d '{"ops":[
        {"action":"remove","type":"vacation","dates":["2026-08-07"]},
        {"action":"set","types":["holiday"],"dates":["2026-12-24","2026-12-31"]},
        {"action":"clear","from":"2026-01-01","to":"2026-01-06"}
      ]}'
```

| Action | Effect on the given days |
| --- | --- |
| `add` | Adds `type`/`types` (keeps other entries) |
| `remove` | Removes `type`/`types` |
| `set` | Replaces all entries with `types` |
| `clear` | Removes all entries |

Days are given as `dates` (array), `date`, and/or an inclusive `from`/`to` range;
`skipWeekends: true` drops Saturdays and Sundays.

### Day notes

```sh
# 🎄 Christmas on Dec 24–26, and clear a note
curl -X POST "$BASE/families/$FAMILY/notes" -H "content-type: application/json" \
  -d '{"ops":[
        {"action":"set","icon":"🎄","comment":"Christmas","from":"2026-12-24","to":"2026-12-26"},
        {"action":"clear","dates":["2026-12-31"]}
      ]}'
```

| Action | Effect on the given days |
| --- | --- |
| `set` (default) | Replaces the note with `icon` (max. 16 characters) and/or `comment` (max. 500); a missing field is empty, both empty clears |
| `clear` | Removes the note |

Days work as for entries; `{"ops": [...]}` applies several operations in order.
