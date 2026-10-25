# Family Planner

One place per family to plan the year: a shared year calendar for vacation, public holidays,
sick days and day-care closures (with a coverage check and an iCloud / Apple Calendar feed), a
transactions log for the family's finances, an AI assistant that researches on the web and plans
in both, and a REST API (see [the plan](docs/family-planner-plan.md) for how it came about).

**Live:** https://family-planner.fa-krug.de/

### The app

- **Families:** the left sidebar switches between your families (or creates a new one) and
  between the topics: **Vacation** and **Finance**. **Settings** holds everything else. The
  right sidebar (✨, `Ctrl/⌘+J`) is the AI chat; phones open both as sheets.
- **Sign in** with a **passkey** (fingerprint, face or device PIN) or with your email and a
  **password**. You see the families you are a member of: as **editor** (change everything,
  add people) or **viewer** (only look). Only the calendar feed works without signing in (see
  [Links](#links)). Old links (`/f/<id>`, `/?s=<id>`) still open the family, after signing in.

### Accounts & administration

- A new installation starts with one account, **`admin` / `admin`**. Its first sign-in asks
  for a new password before anything else (the initial one can be set with the
  `INITIAL_ADMIN_PASSWORD` secret instead). The admin gets every family that exists then, so
  families from before accounts can be handed out.
- **Administration** (admins only, in the sidebar and the account menu): *Users* creates
  accounts and makes other admins; a new account comes with a **one-time setup link** (7 days)
  that signs the person in and asks for a passkey or a password. A new setup link also helps
  with a forgotten password: it sets a new one without the old one. *Families* creates
  families, renames and deletes them, and decides who is a member with which role. Being an
  admin doesn't open a family: admins add themselves as members for that.
- **Account** (the menu at the bottom of the sidebar): name and email, passkeys (add one per
  device, rename, delete), the password (change it, or remove it to use passkeys only), and
  personal **API tokens** for scripts and AI agents. Changing the password signs out the other
  devices. Signing out forgets the family data this device kept (cached calendars).
- In a family, *Settings* → *Members*: editors add people by the email of their account and
  change roles; everyone can leave. A family keeps at least one editor. Any user can create a
  family, and is its editor.

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
  order (“Bestellnr. 306-…”) all become parts of the booking on the same account that names that
  order too (of the same day, or else the closest day at most 4 days away; a booking already
  split takes the lines it is still missing), and a booking marked “Splitbuchung” takes the transactions of the same day,
  account and merchant as its parts.
- **Import bank statements (CSV):** the import guesses the format (UTF-8 or Windows-1252,
  separator, lines before the table, which column is the date, amount or debit / credit,
  payee and description, German or English numbers and dates) and shows a preview to correct
  it. Rows that were imported before are skipped, so overlapping statements can be imported
  again; identical rows on one day (two coffees) stay apart. Pick the account the statement
  belongs to; transfers to and from the family's other accounts can be combined right away.
  The format, account and that choice are remembered per bank.
- **Overview:** for the chosen month, year or all time: income, expenses and the balance, the
  spending (or income) per category and, for a year or all time, a chart per month, also as a
  table.
- Viewers see the finances read-only; the calendar feed never shows them.

### AI assistant

- Chat with any **OpenAI-compatible** model (OpenAI, OpenRouter, Mistral, Groq, a local Ollama /
  LM Studio …), set up per family in *Settings* → *AI assistant*: API URL, key, and a model
  picked from the API's list. Keys are stored encrypted and never shown again; all editors of
  the family use the setup (viewers have no chat).
- It **looks things up** in the calendar and the finances, **changes** them (entries, notes,
  types, categories, transactions), **searches the web** (Tavily or Brave, with their own key)
  and **reads pages**. Every change shows up in the chat with **Undo**; bigger changes (more than
  31 days, deleting types, categories or transactions) need the user's OK first. *Allow changes*
  off makes it read-only.
- **Calculations and analytics:** the assistant doesn't add up numbers itself. *Analyze
  transactions* gives exact totals and statistics (count, income, expenses, net, average,
  median, min, max, standard deviation) per month, quarter, year, week, weekday, day, category,
  account, payee (similar spellings together) or income / expense, up to two at once (e.g. per
  month and category), counted like all totals (transfers by their net, split bookings by
  their parts); grouped by one, also the average and median group (e.g. the average month,
  empty months counting as 0). *Count calendar
  days* gives days per entry type, year, month or weekday, optionally only weekdays and without
  vacation days on public holidays. *Calculate* evaluates expressions (no code is run):
  arithmetic, lists, percentiles, trends and forecasts, and loans and savings like a
  spreadsheet (`pmt`, `fv`, `pv`, `nper`, `npv`, `irr`, `cagr`).
- **Questions:** when it needs a decision or a detail it can't look up, the assistant asks with
  answers to pick (one, or several), and you can always write your own answer instead or as
  well. It goes on with the answer; writing a new message instead leaves the question
  unanswered.
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
- **Chats live on the server**, per account and family (the last 100): every device shows the
  same chats, and an answer goes on when the app is closed or the phone locks. Open the chat
  again, here or elsewhere, and it shows what happened meanwhile, or follows the answer live
  while it is still being written; *Stop* ends it from any device. Chats a device kept from
  before move to the server when the chat is first opened there.
- The server runs the whole turn: the Edge Function talks to the model and runs the tools in the
  background, saves every step, and hands the turn on to a new invocation of itself before the
  platform's time limit (a turn whose invocation died is taken over when someone looks at the
  chat). A failed model call is tried again up to 5 times. Requests to private networks are
  refused (also after redirects), pages are size- and time-limited.

### Settings

- **General:** the family's name; language (English / German) and light / dark per device.
- **Members:** who belongs to the family, as editor or viewer (see above).
- **Calendar feed:** pick what it includes, then *Subscribe on this device*, or on a Mac:
  Calendar → File → New Calendar Subscription → paste the feed URL → Location **iCloud**. The
  feed URL opens nothing but the feed, and works without signing in (calendar apps can't); *New
  link* replaces it when it got around.
- **Vacation:** the entry types of each year, and the calendar options of this device.
- **Finance:** the currency, the accounts (name, color, icon, opening balance), the categories
  (name, color, icon, income / expense / both) and the remembered bank formats.
- **AI assistant:** the model, web search and whether the assistant may change things.
- **Data:** *Export (JSON)* downloads the whole family (all years, types, entries, notes and
  finances, but not its ids) as a file; *Import from file…* (editors only) replaces all of that
  with such a file, e.g. to restore a backup (the family keeps its name and members; can't be
  undone). *Clone family* copies everything into a new family with you as its editor; viewers
  can clone too, which gives them their own editable copy.
- New families get default types in the app's language, and the calendar feed uses it for its
  texts.

## Architecture

```
GitHub Pages (app/)  ──fetch──▶  Supabase Edge Function "api"  ──▶  Postgres (16 tables)
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

5. **Sign in** as `admin` / `admin` and choose a new password right away: until then, anyone
   who knows the default could take the account. To start with another password, add the
   repository secret `INITIAL_ADMIN_PASSWORD` before the first deploy (it is only used while
   there are no accounts). The deploy also sets `APP_ORIGIN` (the app's address, from the
   custom domain): passkeys only work from there.

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
| Sign-ins (password, passkey, setup link) per client | 30 per 5 minutes |
| Password attempts per account, from all clients | 50 per hour |

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
| `--seed` | Adds a *Demo family* with types, entries, notes and uncovered days in this and next year, and six months of transactions, if there are no families yet; `admin` is its editor |
| `--rate-limit` | Low rate limits (3 new families, 30 changes per minute) to try the app's 429 handling |
| `--mock-ai` | A scripted OpenAI-compatible endpoint at `/mock-ai/v1`, set up for every family without AI settings, so the chat and its tools can be tried without a key (see `dev/mock_ai.ts` for what it reacts to) |

The dev server lets the assistant reach localhost, e.g. a local model at
`http://localhost:11434/v1` (Ollama); production refuses private addresses.

On start, the server prints the links of all families it holds. A new store starts with
`admin` / `admin` like production (the password is changed at the first sign-in; with
`--persist`, delete `.dev/data.json` to start over). Passkeys work on `localhost`.

## API

Base URL: `https://<project-ref>.supabase.co/functions/v1/api`. Every request (but the calendar
feed) needs a personal **API token** (*Account* → *API tokens*) as
`Authorization: Bearer <token>`: it acts as you, so it opens the families you are a member of,
and changes them where you are an editor. Others' families answer `404`. Types can be referenced
by id or by name (case-insensitive). Dates are `YYYY-MM-DD`.

`/sessions/...` is the name from before families and works as an alias of `/families/...`
everywhere, so existing calendar subscriptions and scripts keep working.

Every year has its own entry types, and a day can only use the types of its year: a reference
like `"type": "vacation"` is resolved in the year of each day. The types endpoints work on one
year, given as `?year=` (default: the current year); copying keeps the ids, so references keep
working across years.

| Method & path | Description |
| --- | --- |
| `POST /families` | Create a family, with you as its editor. Body (optional): `{"name": "...", "year": 2026, "types": [{"name","color","role"}]}`; the types go into `year` (default: current year); `"lang": "de"` gives German default types and name |
| `GET /families/{id}?year=2026` | `family` (`id`, `feedId`, `legacyId` for editors, `name`, `access`: `edit` or `view`), the year's types, entries and notes, and `typeYears` (all years with types). `?from=&to=` also works; no filter = all. The same object is also in `session`, for scripts from before families |
| `PATCH /families/{id}` | Rename: `{"name": "..."}` |
| `POST /families/{id}/links` | `{"link": "feed"}` makes a new feed id (the old one stops working); `{"link": "legacy"}` removes the legacy link. Returns the family like `GET /families/{id}` |
| `GET /families/{id}/members` | `[{"userId", "email", "name", "role": "editor" \| "viewer", "you"}]` |
| `POST /families/{id}/members` | Editors: `{"email", "role"}` adds the account with that email (`404` if there is none) |
| `PATCH /families/{id}/members/{userId}` | Editors: `{"role"}`. A family keeps at least one editor |
| `DELETE /families/{id}/members/{userId}` | Editors remove members; everyone can remove themselves (leave) |
| `POST /families/{id}/clone` | Copy the family (all years, types, entries, notes, finances) into a new one with new ids and you as its editor. Body (optional): `{"name": "..."}`, default *“… (copy)”*. Viewers can clone too |
| `GET /families/{id}/export` | The whole family as a file: `{"format": "family-planner", "version": 2, "name", "types": [...], "entries": {...}, "notes": {...}, "finance": {"currency", "accounts", "categories", "transactions"}}`, all years, without the family's ids. Viewers can export too |
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

Amounts are integer **cents**, negative for money going out. Viewers and editors read, editors
change.

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

All are for editors only.

| Method & path | Description |
| --- | --- |
| `GET /families/{id}/ai/settings` | `{"configured", "baseUrl", "model", "hasKey", "keyHint", "searchProvider", "hasSearchKey", "searchKeyHint", "allowWrites", "serverReady"}` (keys are never returned, only their last 4 characters) |
| `PUT /families/{id}/ai/settings` | Any of `{"baseUrl", "apiKey", "model", "searchProvider": "none" \| "tavily" \| "brave", "searchKey", "allowWrites"}`; `""` removes a key |
| `POST /families/{id}/ai/models` | The API's models: `{"models": [...]}`; `{"baseUrl", "apiKey"}` in the body try values before saving them |
| `POST /families/{id}/ai/test` | One short completion with the saved settings |
| `POST /families/{id}/ai/categorize` | `{"ids": [...]}` or `{"from", "to", "skip"}`, and `"lang"`: sorts uncategorized transactions (the given ones, at most 200, or those in the range after the first `skip`, at most 200 per request) into categories: like similar earlier transactions where those agree, the rest by the model (with web search if set up; without AI settings this step is skipped) → `{"changed", "matched" (of these, like similar ones), "considered", "remaining", "ai", "inverse", "assignments": [{"id", "categoryId", "source": "similar" \| "ai"}]}`; `remaining` are the range's uncategorized rows not looked at yet (call again with `skip` + the ones left open), `inverse` undoes it via `/finance/transactions` |
| `GET /families/{id}/ai/chats` | Your chats in the family, the latest first: `{"chats": [{"id", "title", "status": "idle" \| "running", "activity", "updatedAt"}]}` |
| `POST /families/{id}/ai/chats` | Starts a chat: `{"text", "attachments": [{"kind": "file", "name", "text"} \| {"kind": "image", "name", "url": "data:image/…"}], "lang", "today", "year", "page"}` (up to 4 attachments) → `text/event-stream` like `events` below, starting with `chat`. The answer runs on the server: closing the connection doesn't stop it |
| `GET /families/{id}/ai/chats/{chat}` | `{"chat", "rev", "items": [...]}`: what the chat shows (`user`, `assistant`, `tool`, `change` with `undo`: requests against the family that undo it, `question`, `error`) |
| `GET /families/{id}/ai/chats/{chat}/events?since=` | Follows the chat (`text/event-stream`): `items` `{"rev"?, "items": [{"seq", "item"}]}` (what changed since revision `since`, by position), `delta` `{"seq", "text"}` (text being written), `chat` (status and activity), then `end` once no answer runs, or `reconnect` (call again with the latest `rev`) |
| `POST /families/{id}/ai/chats/{chat}/messages` | The next message, like starting a chat (409 while an answer runs); a question waiting for its answer stays unanswered |
| `POST /families/{id}/ai/chats/{chat}/answer` | `{"id", "selected": [...], "text", "lang", "today", "year", "page"}`: answers the assistant's question `id` (options and/or an own answer); the answer goes on |
| `POST /families/{id}/ai/chats/{chat}/stop` | Stops the running answer; it ends with what it did so far |
| `POST /families/{id}/ai/chats/{chat}/undone` | `{"id"}`: the change `id` of the chat was undone (the assistant hears it with the next message) |
| `DELETE /families/{id}/ai/chats/{chat}` | Deletes the chat |
| `POST /families/{id}/ai/chat` | One answer without a stored chat (the caller keeps the history): `{"messages": [...], "lang", "today", "year", "page"}` (OpenAI format, the last one the user's; a user message's `content` may be parts: `{"type": "text", "text"}` and up to 4 `{"type": "image_url", "image_url": {"url": "data:image/png;base64,…"}}`, the newest 8 images are sent) → `text/event-stream` with `text`, `tool`, `tool_result`, `change` (with `undo`: requests against the family that undo it), `messages` (to append to the history), `done` / `error` |

### Links

Only one link works without signing in: the **calendar feed**, as calendar apps can't sign in.

| Id | In `family` | Opens |
| --- | --- | --- |
| Family id | `id` | Nothing by itself: `/families/{id}/...` needs a member's token |
| Feed id | `feedId` | Only `calendar.ics`, without a token |
| Legacy id | `legacyId` | Only `calendar.ics`, without a token. Only planners from before families have one: their old view id, so calendar subscriptions made back then keep working |

The family's old edit and view links stopped granting access with accounts: `/f/<id>` still
opens the family in the app, for its members. Calendar subscriptions made with the edit id (from
before the feed id) need to be made again with the feed link.

### Account and administration

Signing in answers `{"token", "user", "families"}` like `GET /auth/me` plus a session token for
the app. API tokens can only read `GET /auth/me`; the rest of `/auth` and all of `/admin` need
a session.

| Method & path | Description |
| --- | --- |
| `POST /auth/login` | `{"email", "password"}` |
| `POST /auth/passkey/start` → `/auth/passkey/finish` | Passkey sign-in: options for `navigator.credentials.get`, then `{"challengeId", "response"}` |
| `POST /auth/setup` | `{"token"}` from a setup link (`/setup/<token>`); works once |
| `GET /auth/me` | `{"user": {"id", "email", "name", "isAdmin", "mustChangePassword", "hasPassword", "passkeys"}, "families": [{"id", "name", "role"}]}` |
| `PATCH /auth/me` | `{"name", "email"}` |
| `PUT /auth/password` | `{"password", "current"}` (`current` isn't needed without a password, or after a setup link); signs out the other sessions |
| `DELETE /auth/password` | Passkeys only (needs one) |
| `GET /auth/passkeys`, `POST /auth/passkeys/start` → `/auth/passkeys/finish`, `PATCH`/`DELETE /auth/passkeys/{id}` | List, add (`{"challengeId", "response", "name"}`), rename, delete (not the last way to sign in) |
| `GET /auth/tokens`, `POST /auth/tokens`, `DELETE /auth/tokens/{id}` | API tokens; `POST {"name"}` answers the token once |
| `POST /auth/logout` | Ends the session |
| `GET /admin/users`, `POST /admin/users` | All users (with their families and how they sign in); `{"email", "name", "isAdmin"}` creates one and answers its `setupToken` |
| `PATCH`/`DELETE /admin/users/{id}` | `{"email", "name", "isAdmin"}`; admins can't remove their own admin rights or account |
| `POST /admin/users/{id}/setup` | A new setup link token (older ones stop working) |
| `GET /admin/families`, `POST /admin/families` | All families with their members; `{"name", "lang", "members": [{"userId", "role"}]}` creates one |
| `PATCH`/`DELETE /admin/families/{id}` | Rename `{"name"}`, or delete with everything in it |
| `PUT`/`DELETE /admin/families/{id}/members/{userId}` | Add a member or change the role `{"role"}`, or remove them |

### Changing entries

```sh
# Vacation from Aug 3 to Aug 14, weekdays only
curl -X POST "$BASE/families/$FAMILY/entries" -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"action":"add","type":"vacation","from":"2026-08-03","to":"2026-08-14","skipWeekends":true}'

# Several operations, applied in order
curl -X POST "$BASE/families/$FAMILY/entries" -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
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
curl -X POST "$BASE/families/$FAMILY/notes" -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
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
