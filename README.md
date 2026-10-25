# Family Planner

One place per family to plan the year: a shared year calendar for vacation, public holidays,
sick days and day-care closures (with a coverage check and an iCloud / Apple Calendar feed), a
transactions log for the family's finances, an AI assistant that researches on the web and plans
in both, and a REST API (see [the plan](docs/family-planner-plan.md) for how it came about).

**Live:** https://family-planner.fa-krug.de/

### The app

- **Families:** every family is one secret id. The left sidebar switches between the families
  opened on this device (or creates / opens another one) and between the topics: **Vacation**
  and **Finance**. **Settings** holds everything else. The right sidebar (✨, `Ctrl/⌘+J`) is
  the AI chat; phones open both as sheets.
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
- **Accounts:** bank accounts, cash or cards, each with an opening balance; a transaction can
  belong to one. The balances show above the list (click one to see only its transactions):
  for a past month or year the balances at its end, with today's below them; for the running
  one today's.
- **Transfers between your own accounts count as 0:** combine related transactions (tick them,
  *Combine as transfer*) and they count once, by their sum: 500 out of one account and 500 into
  another is nothing, 500 out and 480 in is a 20 expense. *Find transfers* suggests pairs (the
  same amount out of one account and into another, at most 4 days apart); *Auto-combine*
  combines them all at once.
- **Split bookings:** some banks list a booking (an Amazon *Splitbuchung*, say) and its order
  lines too. Tick them and *Combine as split booking* (the largest becomes the booking): the
  parts count with their own categories, the booking only with what they leave over (shipping),
  so nothing counts twice and the totals match the statement; balances count the booking.
  *Auto-combine* (and the import) first finds them: order lines without a payee that name an
  order (“Bestellnr. 306-…”) become parts of the booking of the same day and account that names
  that order too, and a booking marked “Splitbuchung” takes the transactions of the same day,
  account and merchant as its parts.
- **Import bank statements (CSV):** the import guesses the format (UTF-8 or Windows-1252,
  separator, lines before the table, which column is the date, amount or debit / credit,
  payee and description, German or English numbers and dates) and shows a preview to correct
  it. Rows that were imported before are skipped, so overlapping statements can be imported
  again; identical rows on one day (two coffees) stay apart. Pick the account the statement
  belongs to; transfers to and from the family's other accounts can be combined right away.
  The format, account and that choice are remembered per bank.
- **Overview:** income, expenses and the balance, a chart per month and the spending (or
  income) per category, also as a table.
- The view-only link shows the finances read-only; the legacy view link and the calendar feed
  never do.

### AI assistant

- Chat with any **OpenAI-compatible** model (OpenAI, OpenRouter, Mistral, Groq, a local Ollama /
  LM Studio …), set up per family in *Settings* → *AI assistant*: API URL, key, and a model
  picked from the API's list. Keys are stored encrypted and never shown again; everyone with
  the edit link uses the setup (the view-only link has no chat).
- It **looks things up** in the calendar and the finances, **changes** them (entries, notes,
  types, categories, transactions), **searches the web** (Tavily or Brave, with their own key)
  and **reads pages**. Every change shows up in the chat with **Undo**; bigger changes (more than
  31 days, deleting types, categories or transactions) need the user's OK first. *Allow changes*
  off makes it read-only.
- **Attach** images (screenshots, photos) and text files (e.g. CSV) to a message; images need a
  model with vision support.
- **Auto-categorize** on the finance page sorts the period's uncategorized transactions into
  categories. First without AI: a transaction gets the category that earlier ones of the same
  payee mostly have (numbers and case don't matter, so "REWE Markt 1234" matches "Rewe Markt
  99"). The rest goes to the model, which sees the categories and how payees were sorted before,
  and looks up payees it doesn't know on the web when web search is set up. Only categories
  that fit income / expense are used, unsure rows stay open. After a CSV import it can sort the
  new rows right away. *Undo* in the toast puts them back. Without the AI assistant, only the
  similar-transactions step runs.
- Chats are kept on the device (the last 20 per family).
- The server runs the tool loop: the app streams the answer from the Edge Function, which talks
  to the model. Requests to private networks are refused (also after redirects), pages are
  size- and time-limited.

### Settings

- **General:** the family's name; language (English / German) and light / dark per device.
- **Sharing:** the edit and view-only links, a new view-only link when the old one got around,
  and the **calendar feed**: pick what it includes, then *Subscribe on this device*, or on a
  Mac: Calendar → File → New Calendar Subscription → paste the feed URL → Location **iCloud**.
  The feed URL opens nothing but the feed, so it never exposes the edit or view link.
- **Vacation:** the entry types of each year, and the calendar options of this device.
- **Finance:** the currency, the accounts (name, color, icon, opening balance), the categories
  (name, color, icon, income / expense / both) and the remembered bank formats.
- **AI assistant:** the model, web search and whether the assistant may change things.
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

3. **AI assistant** (optional) – add the repository secret `AI_CONFIG_KEY` with 32 random
   bytes (`openssl rand -base64 32`). The deploy sets it as an Edge Function secret; it
   encrypts the families' AI and search keys. Changing it makes the stored keys unreadable
   (families enter them again).

4. Run the workflow: *Actions → Deploy → Run workflow* (or push to `main`).

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
| AI requests (chat, model list, test, categorize) per client | 60 per 5 minutes |
| AI requests per family | 300 per hour |
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
| `--mock-ai` | A scripted OpenAI-compatible endpoint at `/mock-ai/v1`, set up for every family without AI settings, so the chat and its tools can be tried without a key (see `dev/mock_ai.ts` for what it reacts to) |

The dev server lets the assistant reach localhost, e.g. a local model at
`http://localhost:11434/v1` (Ollama); production refuses private addresses.

On start, the server prints the edit and view links of all families it holds.

## API

Base URL: `https://<project-ref>.supabase.co/functions/v1/api`. The family id from the edit link
is the access key; the other links can only read (see [Links](#links)). Types can be referenced
by id or by name (case-insensitive). Dates are `YYYY-MM-DD`.

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
| `GET /families/{id}/export` | The whole family as a file: `{"format": "family-planner", "version": 2, "name", "types": [...], "entries": {...}, "notes": {...}, "finance": {"currency", "accounts", "categories", "transactions"}}`, all years, without the family's ids. The view-only id works too; the legacy id exports without `finance` |
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
| `GET /families/{id}/finance` | `{"currency", "csvMappings", "accounts": [{"id", "name", "color", "icon", "openingCents", "position", "balanceCents"}], "categories": [{"id", "name", "color", "icon", "kind", "position"}]}` |
| `DELETE /families/{id}/finance` | Delete all transactions, accounts, categories, saved CSV mappings and the currency; returns the (empty) overview |
| `PATCH /families/{id}/finance/settings` | `{"currency": "EUR"}` (ISO 4217) and/or `{"csvMappings": [...]}` |
| `GET /families/{id}/finance/accounts?at=YYYY-MM-DD` | `{"at", "accounts": [...]}`: the accounts with their balances at the end of that day (opening balance plus the transactions up to it); without `at`, now |
| `POST /families/{id}/finance/accounts` | Add `{"name", "color", "icon", "openingCents"}` |
| `PATCH` / `DELETE /families/{id}/finance/accounts/{account}` | Change or delete (deletes its transactions too; the response has their count); by id or name |
| `POST /families/{id}/finance/categories` | Add `{"name", "color", "icon", "kind": "income" \| "expense" \| "both"}` |
| `PATCH` / `DELETE /families/{id}/finance/categories/{category}` | Change or delete (its transactions become uncategorized); by id or name |
| `POST /families/{id}/finance/categories/defaults` | Add the default categories the family doesn't have: `{"lang": "de"}` |
| `GET /families/{id}/finance/transactions` | `?from=&to=&category=<id or none>&account=<id or none>&kind=income\|expense\|transfer&q=&limit=&offset=` → `{"transactions": [{"id", "date", "amountCents", "payee", "description", "categoryId", "accountId", "transferId", "note", "imported"}], "total", "incomeCents", "expenseCents"}`, newest first. Transactions sharing a `transferId` (a transfer) count once in the totals, by their sum |
| `POST /families/{id}/finance/transactions` | `{"ops": [...]}`: `{"action": "add", "date", "amountCents", "payee", "description", "categoryId", "note"}`, `{"action": "update", "id", ...fields}`, `{"action": "delete", "ids": [...]}`, `{"action": "link", "ids": [...]}` (combine into one transfer), `{"action": "unlink", "ids": [...]}`; add / update also take `accountId` and `transferId`. Returns `inverse`, the ops that undo the request |
| `POST /families/{id}/finance/import` | `{"rows": [{"date", "amountCents", "payee", "description", "categoryId"}], "dryRun": true, "accountId", "autoTransfers": true}`: adds the rows that weren't imported before (to the account) and, with `autoTransfers`, combines them with matching bookings on other accounts; returns `added`, `duplicates` (row indexes), the new `ids` and `transfers` (pairs combined) |
| `GET /families/{id}/finance/transfers/suggestions?from=&to=` | `{"pairs": [{"out", "in"}]}`: transactions that look like a transfer between two accounts (same amount out and in, at most 4 days apart, not combined yet) |
| `POST /families/{id}/finance/transfers/auto` | `{"from", "to"}` (optional): combines all those pairs; returns `linked` and `inverse` like the transactions endpoint |
| `GET /families/{id}/finance/summary?from=&to=` | `{"currency", "incomeCents", "expenseCents", "count", "months": [{"month", "incomeCents", "expenseCents"}], "categories": [{"categoryId", "incomeCents", "expenseCents", "count"}]}` |

### AI assistant

All need the edit id.

| Method & path | Description |
| --- | --- |
| `GET /families/{id}/ai/settings` | `{"configured", "baseUrl", "model", "hasKey", "keyHint", "searchProvider", "hasSearchKey", "searchKeyHint", "allowWrites", "serverReady"}` (keys are never returned, only their last 4 characters) |
| `PUT /families/{id}/ai/settings` | Any of `{"baseUrl", "apiKey", "model", "searchProvider": "none" \| "tavily" \| "brave", "searchKey", "allowWrites"}`; `""` removes a key |
| `POST /families/{id}/ai/models` | The API's models: `{"models": [...]}`; `{"baseUrl", "apiKey"}` in the body try values before saving them |
| `POST /families/{id}/ai/test` | One short completion with the saved settings |
| `POST /families/{id}/ai/categorize` | `{"ids": [...]}` or `{"from", "to", "skip"}`, and `"lang"`: sorts uncategorized transactions (the given ones, at most 200, or those in the range after the first `skip`, at most 200 per request) into categories: like similar earlier transactions where those agree, the rest by the model (with web search if set up; without AI settings this step is skipped) → `{"changed", "matched" (of these, like similar ones), "considered", "remaining", "ai", "inverse", "assignments": [{"id", "categoryId", "source": "similar" \| "ai"}]}`; `remaining` are the range's uncategorized rows not looked at yet (call again with `skip` + the ones left open), `inverse` undoes it via `/finance/transactions` |
| `POST /families/{id}/ai/chat` | `{"messages": [...], "lang", "today", "year", "page"}` (OpenAI format, the last one the user's; a user message's `content` may be parts: `{"type": "text", "text"}` and up to 4 `{"type": "image_url", "image_url": {"url": "data:image/png;base64,…"}}`, the newest 8 images are sent) → `text/event-stream` with `text`, `tool`, `tool_result`, `change` (with `undo`: requests against the family that undo it), `messages` (to append to the history), `done` / `error` |

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
