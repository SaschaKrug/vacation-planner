// Instructions for AI agents: GET /families/{id}/agent returns this Markdown page, so a user
// can hand an agent one URL and it knows the family's calendar and the API with ready-to-use
// URLs.

import type { FamilyRow, TypeRow } from "./store.ts";

export interface AgentDocInput {
  /** Public API base, e.g. https://<project>.supabase.co/functions/v1/api */
  base: string;
  /** The token in the URL: the edit id (full access) or a read-only id. */
  token: string;
  readOnly: boolean;
  /** Whether the link may see the finances (not the legacy calendar-only link). */
  finance: boolean;
  family: FamilyRow;
  /** Types of all years. */
  types: TypeRow[];
  /** Today as YYYY-MM-DD. */
  today: string;
  /** Seconds after which an open app shows changes. */
  refreshSeconds: number;
}

const ROLE_HELP: Record<string, string> = {
  needs_cover: "needs cover",
  covers: "covers",
  day_off: "day off",
  none: "normal",
};

function typesTable(types: TypeRow[]): string {
  if (!types.length) return "_No types in this year yet._";
  return [
    "| id | name | role | color |",
    "| --- | --- | --- | --- |",
    ...types.map((t) => `| \`${t.id}\` | ${t.name} | ${t.role} | ${t.color} |`),
  ].join("\n");
}

export function buildAgentDoc(input: AgentDocInput): string {
  const { base, token, readOnly, finance, family, types, today, refreshSeconds } = input;
  const years = [...new Set(types.map((t) => t.year))].sort((a, b) => a - b);
  // Examples use the current year, or the latest year with types if it has none.
  const thisYear = Number(today.slice(0, 4));
  const year = years.includes(thisYear) ? thisYear : (years.at(-1) ?? thisYear);
  const s = `${base}/families/${token}`;
  const example = types.find((t) => t.year === year && t.role === "covers") ??
    types.find((t) => t.year === year) ?? { id: "vacation", name: "Vacation" };
  const json = (v: unknown) => "`" + JSON.stringify(v) + "`";

  const typeSections = years.length
    ? years.map((y) => `### ${y}\n\n${typesTable(types.filter((t) => t.year === y))}`)
      .join("\n\n")
    : "_This calendar has no entry types yet._";

  const read = `## Reading

All responses are JSON. Dates are \`YYYY-MM-DD\`.

- Everything for a year (types, entries, notes): ${s}?year=${year}
- Entries only: ${s}/entries?year=${year} → \`{"${year}-08-03": ["${example.id}"], ...}\`
- Notes only: ${s}/notes?year=${year} → \`{"${year}-12-25": {"icon": "🎄", "comment": "Christmas"}, ...}\`
- Types of a year: ${s}/types?year=${year}
- \`?from=YYYY-MM-DD&to=YYYY-MM-DD\` works instead of \`?year=\`.`;

  if (readOnly) {
    return `# Family Planner “${family.name}” – instructions for AI agents

This URL gives **read-only** access to the family's shared year calendar for vacation, public
holidays, sick days and day-care closures. You can read it and answer questions about it, but
not change it: ask the user for the AI link of the edit link if they want changes. Today is
${today}.

${concepts()}

## Entry types (every year has its own)

${typeSections}

${read}
${finance ? financeDoc(s, year, false) : ""}`;
  }

  const addOp = {
    action: "add",
    type: example.id,
    from: `${year}-08-03`,
    to: `${year}-08-14`,
    skipWeekends: true,
  };
  const noteOp = { action: "set", date: `${year}-12-25`, icon: "🎄", comment: "Christmas" };

  return `# Family Planner “${family.name}” – instructions for AI agents

The user gave you **full edit access** to their family's shared year calendar for vacation,
public holidays, sick days and day-care closures. Help them read and plan it. Today is ${today}.

- This URL contains the family's secret key. Don't repeat it in public places or share it.
- Read the current state before changing anything, and check the result afterwards.
- For bigger changes (many days, deleting types, renaming) say what you'll do first and ask
  the user to confirm; small, clearly requested changes can be made directly.
- Talk to the user in their language. Changes show up in their open app within about
  ${refreshSeconds} seconds.

${concepts()}

## Entry types (every year has its own)

${typeSections}

Types are referenced by id or by name (case-insensitive); a reference is resolved in the year of
each day, so \`"${example.id}"\` works across years as long as the year has such a type.

${read}

## Changing (HTTP requests with a JSON body)

Send \`content-type: application/json\`. Errors come back as \`{"error": "..."}\` with a 4xx status.

### Entries: \`POST ${s}/entries\`

Body: one op, or \`{"ops": [...]}\` to apply several in order. Example:
${json(addOp)}

| action | effect on the given days |
| --- | --- |
| \`add\` | adds \`type\` or \`types\` (keeps other entries) |
| \`remove\` | removes \`type\` or \`types\` |
| \`set\` | replaces all entries with \`types\` |
| \`clear\` | removes all entries |

Days: \`dates\` (array), \`date\`, and/or an inclusive \`from\`/\`to\` range; \`"skipWeekends": true\`
drops Saturdays and Sundays. Up to 4000 days per request.

### Notes: \`POST ${s}/notes\`

${json(noteOp)} – \`set\` replaces a day's note (icon max. 16 characters, comment max. 500),
\`{"action": "clear", "dates": [...]}\` removes it. Days and \`{"ops": [...]}\` work as for entries.

### Types (add \`?year=YYYY\`, default: the current year)

- Add: \`POST ${s}/types?year=${year}\` ${
    json({ name: "Day care closed", color: "#8b5cf6", role: "needs_cover" })
  }
- Change: \`PATCH ${s}/types/{type}?year=${year}\` with any of \`name\`, \`color\` (#rrggbb),
  \`role\`, \`position\`
- Delete (also deletes its entries in that year): \`DELETE ${s}/types/{type}?year=${year}\`
- Copy a year's types into another year: \`POST ${s}/types/copy\` ${
    json({ from: year, to: year + 1 })
  }

### Family name: \`PATCH ${s}\` ${json({ name: family.name })}

## Request format

For example, this would add the vacation from the entries section (only send what the user
asked for):

\`\`\`sh
curl -X POST "${s}/entries" -H "content-type: application/json" \\
  -d '${JSON.stringify(addOp)}'
\`\`\`
${finance ? "\n" + financeDoc(s, year, true) : ""}`;
}

function concepts(): string {
  return `## How the calendar works

- A year calendar. Each day can hold **several entries**, each of an **entry type** (name,
  color, role). Every year has its own set of types.
- Roles drive the **coverage check**: a weekday with a *${ROLE_HELP.needs_cover}* entry
  (e.g. “Day care closed”) is a gap unless it also has a *${ROLE_HELP.covers}* entry
  (e.g. “Vacation Dad”) or a *${ROLE_HELP.day_off}* entry (e.g. “Holiday”). Role
  *${ROLE_HELP.none}* is just a color. Role ids: \`needs_cover\`, \`covers\`, \`day_off\`,
  \`none\`. Day-off entries don't count as used vacation days.
- A day can also have one **note**: an icon (emoji) and/or a comment, e.g. 🎄 Christmas.
  Notes are independent of entries.`;
}

/** The finances: transactions (integer cents, negative = money out), categories, accounts,
 *  transfers, summary. */
function financeDoc(s: string, year: number, edit: boolean): string {
  const f = `${s}/finance`;
  const read = `## Finances

The family also keeps a transactions log. Amounts are integer **cents**, negative for money
going out (\`-4599\` = −45.99 in the family's currency). A transaction can belong to one of
the family's **accounts** (\`accountId\`). Transactions sharing a \`transferId\` are the legs of
one **transfer** between the family's own accounts (e.g. 500 out of checking, 500 into
savings): every income / expense total counts a transfer once by its net (here 0), in the
month of its earliest leg, so only money leaving or reaching the family counts. A transaction
with a \`splitOf\` is a **part** of that split booking (e.g. an order line the bank lists next
to an Amazon "Splitbuchung"); a booking has \`split\` (\`parts\`, \`remainderCents\`). Totals
count the parts with their own categories and only the remainder of the booking.

- Currency, categories and accounts (with \`balanceCents\`): ${f}
- The accounts' balances at the end of a day: ${f}/accounts?at=${year}-06-30 –
  \`{"at", "accounts": [...]}\`
- Transactions (newest first): ${f}/transactions?from=${year}-01-01&to=${year}-12-31 –
  also \`account=<id>\` (or \`none\`), \`category=<id>\` (or \`none\`),
  \`kind=income|expense|transfer\`, \`q=<text>\`, \`limit\`, \`offset\`.
  Returns \`{"transactions": [...], "total", "incomeCents", "expenseCents"}\`.
- Per month and category: ${f}/summary?from=${year}-01-01&to=${year}-12-31
- Likely transfers not combined yet (same amount out of one account and into another, at most
  4 days apart): ${f}/transfers/suggestions?from=${year}-01-01&to=${year}-12-31 –
  \`{"pairs": [{"out": {...}, "in": {...}}]}\`
`;
  if (!edit) return read;
  return `${read}
Changing: \`POST ${f}/transactions\` with \`{"ops": [...]}\` (applied in order):

- \`{"action": "add", "date": "${year}-03-02", "amountCents": -4599, "payee": "Supermarket", "description": "", "categoryId": "groceries", "accountId": "checking", "note": ""}\`
- \`{"action": "update", "id": "<uuid>", "categoryId": "groceries"}\` (any of the fields above)
- \`{"action": "delete", "ids": ["<uuid>", ...]}\`
- \`{"action": "link", "ids": ["<uuid>", "<uuid>", ...]}\`: combines the transactions into one
  transfer
- \`{"action": "unlink", "ids": ["<uuid>"]}\`: dissolves the transfers they belong to
- \`{"action": "split", "id": "<booking uuid>", "ids": ["<uuid>", ...]}\`: makes the
  transactions parts of the booking
- \`{"action": "unsplit", "ids": ["<uuid>"]}\`: parts become normal transactions again (for a
  booking: all of its parts)

The response has \`inverse\`: ops that undo the request (send them to the same endpoint).
Categories and accounts are referenced by id or name. Ask before deleting or changing many
transactions.

\`POST ${f}/transfers/auto\` with \`{"from": "${year}-01-01", "to": "${year}-12-31"}\` (both
optional) combines the split bookings (order lines without a payee and the booking of the same
day and account naming the same order number; "Splitbuchung" and the transactions of the same
day, account and merchant) and then every suggested transfer in the range; the response has
\`splits\`, \`linked\` and \`inverse\` like above.

Accounts: \`POST ${f}/accounts\` \`{"name", "color": "#22c55e", "icon", "openingCents"}\`,
\`PATCH ${f}/accounts/<id>\` with any of these and \`position\`, \`DELETE ${f}/accounts/<id>\`
(its transactions are deleted too).
`;
}
