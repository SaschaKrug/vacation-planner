# Vacation Planner

A shared year calendar for planning vacation, public holidays, sick days and day-care
closures, with a coverage check, a REST API and an iCloud / Apple Calendar feed.

**Live:** https://vacation-planner.fa-krug.de/

- All days of a year as 12 rows × 31 days; pick the year at the top. Phones show one calendar
  per month instead (Monday to Sunday), with the type chips and the actions for the selected
  days in a bar at the bottom.
- **Zoom:** the 🔍 slider below the calendar (or `Ctrl/⌘` + `+` / `−` / `0`) sets how many days
  fit across it, 7 to 31; zoomed in, the cells also show the weekday (or always, with
  *⋯* → *Always show weekdays*). Remembered per device.
- Your own entry types (name + color), **per year**: every year has its own types, so 2027 can
  have different people, colors or day-care closures than 2026. New planners start with
  *Holiday*, *Vacation* and *Sick*; a year without types offers to copy them from the closest
  year that has some.
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
- **Undo / redo:** “Undo” / “Redo” in the ⋯ menu, or `Ctrl/⌘+Z` / `Ctrl/⌘+Y`.
- No login: every planner has a secret **edit link** (`?s=<id>`) and a separate **view-only link**.
  Anyone with the edit link can change it, so only share it with people who should.
- **iCloud:** *Share* → *Calendar & iCloud* → *Subscribe on this device*, or on a Mac: Calendar → File →
  New Calendar Subscription → paste the feed URL → Location **iCloud**. The feed uses the
  view-only id, so it never exposes the edit link.
- **Let an AI agent manage it:** *✨ AI* gives a ready-to-paste prompt with one link for an AI
  agent that can send HTTP requests (Claude Code, Codex, ChatGPT agent mode …). The link returns
  instructions with the planner's types and ready-to-use API URLs; the agent then reads and
  changes the planner through the API, and the open app shows the changes within seconds. The
  link carries the edit id, so it's as powerful as the edit link (the view-only link gives a
  read-only version).
- **Clone:** *⋯* → *Clone planner* copies the planner with all years, types, entries and notes
  into a new one with its own links; the original stays unchanged. Works from a view-only
  link too, which gives you your own editable copy.
- **Export / import:** *⋯* → *Export (JSON)* downloads the whole planner (all years, types,
  entries and notes, but not its links) as a file. *⋯* → *Import from file…* (edit link only)
  replaces all years, types, entries and notes of the open planner with such a file, e.g. to
  restore a backup; the planner keeps its name and links. Importing can't be undone.
- **English and German:** the language follows the browser and can be switched at the top right.
  New planners get default types in that language, and the calendar feed uses it for its texts.

## Architecture

```
GitHub Pages (web/)  ──fetch──▶  Supabase Edge Function "api"  ──▶  Postgres (5 tables)
iCloud / Apple Calendar ──GET calendar.ics──┘
```

| Path | What |
| --- | --- |
| `web/` | Static frontend (plain HTML/CSS/JS, no build step) |
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

3. Run the workflow: *Actions → Deploy → Run workflow* (or push to `main`).

The tables use Row Level Security without policies, so they are not reachable with the public
anon key; all access goes through the Edge Function, which uses the service role key.

### Rate limits

The API counts requests per client address (IPv6: per /64 network) in fixed windows, stored in
the `rate_limits` table as a keyed hash, never the address itself; rows older than a day are
deleted. Over the limit, it answers `429` with a `Retry-After` header.

| What | Limit |
| --- | --- |
| New planners (`POST /sessions`, `…/clone`) per client | 20 per hour |
| New planners of all clients together | 500 per hour |
| Changes (`POST`, `PATCH`, `DELETE`) per client | 300 per 5 minutes |

Reads, including the calendar feed, are not limited: iCloud fetches every subscription from a
few shared addresses. If counting fails, requests go through. The limits are in
`RATE_LIMITS` in `supabase/functions/_shared/handler.ts`; the local dev server has none.

## Local development

```sh
deno task dev     # http://localhost:8787 (data is kept in memory)
deno task test    # unit + API tests
deno task check   # type-check, lint, format check
```

## API

Base URL: `https://<project-ref>.supabase.co/functions/v1/api` (*⋯* → *API for scripts* in the app
shows ready-to-run examples for your planner). The session id from the edit link is the access
key; the view-only id can only read. Types can be referenced by id or by name
(case-insensitive). Dates are `YYYY-MM-DD`.

Every year has its own entry types, and a day can only use the types of its year: a reference
like `"type": "vacation"` is resolved in the year of each day. The types endpoints work on one
year, given as `?year=` (default: the current year); copying keeps the ids, so references keep
working across years.

| Method & path | Description |
| --- | --- |
| `POST /sessions` | Create a planner. Body (optional): `{"name": "...", "year": 2026, "types": [{"name","color","role"}]}`; the types go into `year` (default: current year); `"lang": "de"` gives German default types and name |
| `GET /sessions/{id}?year=2026` | Planner, the year's types, entries and notes, and `typeYears` (all years with types). `?from=&to=` also works; no filter = all |
| `PATCH /sessions/{id}` | Rename: `{"name": "..."}` |
| `POST /sessions/{id}/clone` | Copy the planner (all years, types, entries, notes) into a new one with new ids. Body (optional): `{"name": "..."}`, default *“… (copy)”*. The view-only id works too |
| `GET /sessions/{id}/export` | The whole planner as a file: `{"format": "vacation-planner", "version": 1, "name", "types": [...], "entries": {...}, "notes": {...}}`, all years, without the planner's ids. The view-only id works too |
| `POST /sessions/{id}/import?year=2026` | Replace all years, types, entries and notes with those of an export file (the body), in one transaction; name and ids stay. Returns the planner like `GET /sessions/{id}` |
| `GET /sessions/{id}/entries?year=2026` | `{"2026-08-03": ["vacation", "day-care-closed"], ...}` |
| `POST /sessions/{id}/entries` | Change entries (see below) |
| `GET /sessions/{id}/notes?year=2026` | `{"2026-12-25": {"icon": "🎄", "comment": "Christmas"}, ...}` |
| `POST /sessions/{id}/notes` | Set or clear day notes (see below) |
| `GET /sessions/{id}/types?year=2026` | List the year's entry types |
| `POST /sessions/{id}/types?year=2026` | Add a type to the year: `{"name", "color": "#rrggbb", "role"}` (`"year"` in the body works too) |
| `PATCH /sessions/{id}/types/{type}?year=2026` | Change `name`, `color`, `role`, `position` |
| `DELETE /sessions/{id}/types/{type}?year=2026` | Delete a type and all its entries in that year |
| `POST /sessions/{id}/types/copy` | Copy a year's types into another year: `{"from": 2026, "to": 2027}`; types the target year already has (same id) are kept |
| `GET /sessions/{id}/calendar.ics` | iCalendar feed. `?types=a,b` filters (by id or name, in every year), `?gaps=1` adds “⚠ Not covered” events, `?notes=1` adds day notes as events, `?name=` overrides the calendar name, `?lang=de` German event texts |

| `GET /sessions/{id}/agent` | Instructions for AI agents (Markdown) with this planner's types and API URLs |

Roles: `none`, `needs_cover`, `covers`, `day_off`.

### Changing entries

```sh
# Vacation from Aug 3 to Aug 14, weekdays only
curl -X POST "$BASE/sessions/$SESSION/entries" -H "content-type: application/json" \
  -d '{"action":"add","type":"vacation","from":"2026-08-03","to":"2026-08-14","skipWeekends":true}'

# Several operations, applied in order
curl -X POST "$BASE/sessions/$SESSION/entries" -H "content-type: application/json" \
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
curl -X POST "$BASE/sessions/$SESSION/notes" -H "content-type: application/json" \
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
