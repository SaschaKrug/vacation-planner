# Vacation Planner

A shared year calendar for planning vacation, public holidays, sick days and day-care
closures, with a coverage check, a REST API and an iCloud / Apple Calendar feed.

**Live:** https://vacation-planner.fa-krug.de/

- All days of a year as 12 rows × 31 days; pick the year at the top.
- Your own entry types (name + color). New planners start with *Holiday*, *Vacation* and *Sick*.
- A day can hold **several entries**, e.g. *Day care closed* + *Vacation Dad*.
- **Icons & comments on days**, e.g. 🎄 *Christmas* or 🐣 *Easter*: shown in the grid and in
  the tooltip, optionally in the calendar feed. They are independent of entries (no coverage,
  no stats); one note per day.
- **Coverage check:** types with the role *Needs cover* (e.g. “Day care closed”) are flagged on
  every weekday that has no *Covers* (e.g. “Vacation …”) or *Day off* (e.g. “Holiday”) entry.
- Click/drag to select days (also across months), then click a type or press `1`–`9`.
  `Ctrl/⌘+C`, `X`, `V` copy/cut/paste (pasting onto a larger selection repeats the copied days),
  drag the ▪ fill handle to repeat a selection, `Del` clears, `Ctrl+Z`/`Ctrl+Y` undo/redo,
  `G` jumps to the next uncovered day.
- No login: every planner has a secret **edit link** (`?s=<id>`) and a separate **view-only link**.
  Anyone with the edit link can change it, so only share it with people who should.
- **iCloud:** *Share & iCloud* → *Subscribe on this device*, or on a Mac: Calendar → File →
  New Calendar Subscription → paste the feed URL → Location **iCloud**. The feed uses the
  view-only id, so it never exposes the edit link.
- **English and German:** the language follows the browser and can be switched at the top right.
  New planners get default types in that language, and the calendar feed uses it for its texts.

## Architecture

```
GitHub Pages (web/)  ──fetch──▶  Supabase Edge Function "api"  ──▶  Postgres (4 tables)
iCloud / Apple Calendar ──GET calendar.ics──┘
```

| Path | What |
| --- | --- |
| `web/` | Static frontend (plain HTML/CSS/JS, no build step) |
| `supabase/functions/api/` | Edge Function entry point |
| `supabase/functions/_shared/` | API handler, iCalendar builder, storage (Supabase + in-memory) |
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

## Local development

```sh
deno task dev     # http://localhost:8787 (data is kept in memory)
deno task test    # unit + API tests
deno task check   # type-check, lint, format check
```

## API

Base URL: `https://<project-ref>.supabase.co/functions/v1/api` (the *API* button in the app
shows ready-to-run examples for your planner). The session id from the edit link is the access
key; the view-only id can only read. Types can be referenced by id or by name
(case-insensitive). Dates are `YYYY-MM-DD`.

| Method & path | Description |
| --- | --- |
| `POST /sessions` | Create a planner. Body (optional): `{"name": "...", "types": [{"name","color","role"}]}`; `"lang": "de"` gives German default types and name |
| `GET /sessions/{id}?year=2026` | Planner, types, entries and notes (`?from=&to=` also works; no filter = all) |
| `PATCH /sessions/{id}` | Rename: `{"name": "..."}` |
| `GET /sessions/{id}/entries?year=2026` | `{"2026-08-03": ["vacation", "day-care-closed"], ...}` |
| `POST /sessions/{id}/entries` | Change entries (see below) |
| `GET /sessions/{id}/notes?year=2026` | `{"2026-12-25": {"icon": "🎄", "comment": "Christmas"}, ...}` |
| `POST /sessions/{id}/notes` | Set or clear day notes (see below) |
| `GET /sessions/{id}/types` | List entry types |
| `POST /sessions/{id}/types` | Add a type: `{"name", "color": "#rrggbb", "role"}` |
| `PATCH /sessions/{id}/types/{type}` | Change `name`, `color`, `role`, `position` |
| `DELETE /sessions/{id}/types/{type}` | Delete a type and all its entries |
| `GET /sessions/{id}/calendar.ics` | iCalendar feed. `?types=a,b` filters, `?gaps=1` adds “⚠ Not covered” events, `?notes=1` adds day notes as events, `?name=` overrides the calendar name, `?lang=de` German event texts |

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
