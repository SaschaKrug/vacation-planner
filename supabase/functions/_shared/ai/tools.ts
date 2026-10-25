// The assistant's tools: read and change the vacation calendar and the finances (with the same
// validation as the REST API), analyze both, calculate, search the web and read pages. Every
// change comes with undo steps: requests against the family's own API that put things back.

import { dateRange, diffDays, isValidDate, isWeekend } from "../dates.ts";
import {
  applyTransactionOps,
  autoCombine,
  changedCategory,
  financeSummary,
  findCategory,
  findTransactions,
  listAccounts,
  netItems,
  newCategory,
  publicCategory,
  publicTransaction,
  transferPairs,
} from "../finance.ts";
import { cleanName, HttpError, objectOf, slug } from "../http.ts";
import type { SearchProvider, Store, TypeRow } from "../store.ts";
import {
  applyEntryOps,
  applyNoteOps,
  cleanColor,
  cleanRole,
  MAX_TYPES,
  parseEntryOps,
  parseNoteOps,
  publicType,
  resolveType,
  uniqueId,
} from "../vacation.ts";
import {
  analyzeCalendar,
  analyzeTransactions,
  CALENDAR_DIMENSIONS,
  TX_DIMENSIONS,
  TX_SORTS,
  TX_STATS,
} from "./analytics.ts";
import { CalcError, calculate, MAX_EXPRESSIONS } from "./calc.ts";
import { checkUrl, htmlToText, type NetOptions, readLimited, safeFetch } from "./net.ts";
import type { ToolSpec } from "./provider.ts";

/** A request against /families/{id} that undoes (part of) a change. */
export interface UndoStep {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}

export interface Change {
  kind: "entries" | "notes" | "types" | "categories" | "transactions";
  summary: string;
  undo: UndoStep[];
}

/** A question for the user (ask_user): the turn stops until they answer. */
export interface Question {
  question: string;
  options: string[];
  /** Several options can be picked (else one); the user can always write their own answer. */
  multiple: boolean;
}

export interface ToolResult {
  result: unknown;
  summary: string;
  change?: Change;
  question?: Question;
}

export interface ToolContext {
  /** The app's language, for the change summaries the user sees. */
  lang: "en" | "de";
  store: Store;
  familyId: string;
  net: NetOptions;
  search: { provider: Exclude<SearchProvider, "none">; key: string } | null;
  signal?: AbortSignal;
}

interface Tool {
  spec: ToolSpec["function"];
  write?: boolean;
  needsSearch?: boolean;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

const PHRASES = {
  en: {
    days: (n: number) => `${n} ${n === 1 ? "day" : "days"} changed`,
    notes: (n: number) => `${n} ${n === 1 ? "note" : "notes"} changed`,
    typeAdded: (name: string, year: number) => `Added the type “${name}” (${year})`,
    typeChanged: (name: string, year: number) => `Changed the type “${name}” (${year})`,
    typesCopied: (n: number, from: number, to: number) => `Copied ${n} types from ${from} to ${to}`,
    categoryAdded: (name: string) => `Added the category “${name}”`,
    categoryChanged: (name: string) => `Changed the category “${name}”`,
    transactions: (n: number) => `${n} ${n === 1 ? "transaction" : "transactions"} changed`,
    transfers: (n: number) => `${n} ${n === 1 ? "transfer" : "transfers"} combined`,
    splits: (n: number) => `${n} split ${n === 1 ? "booking" : "bookings"} combined`,
  },
  de: {
    days: (n: number) => `${n} ${n === 1 ? "Tag" : "Tage"} geändert`,
    notes: (n: number) => `${n} ${n === 1 ? "Notiz" : "Notizen"} geändert`,
    typeAdded: (name: string, year: number) => `Art „${name}“ hinzugefügt (${year})`,
    typeChanged: (name: string, year: number) => `Art „${name}“ geändert (${year})`,
    typesCopied: (n: number, from: number, to: number) =>
      `${n} Arten von ${from} nach ${to} kopiert`,
    categoryAdded: (name: string) => `Kategorie „${name}“ hinzugefügt`,
    categoryChanged: (name: string) => `Kategorie „${name}“ geändert`,
    transactions: (n: number) => `${n} ${n === 1 ? "Buchung" : "Buchungen"} geändert`,
    transfers: (n: number) => `${n} ${n === 1 ? "Umbuchung" : "Umbuchungen"} zusammengefasst`,
    splits: (n: number) => `${n} ${n === 1 ? "Aufteilung" : "Aufteilungen"} zusammengefasst`,
  },
};

/** Changes that need the user's OK first; the model has to call again with confirmed: true. */
const CONFIRM_DAYS = 31;
const CONFIRM_TRANSACTIONS = 20;
const MAX_RANGE_DAYS = 400;
const MAX_PAGE_TEXT = 12000;
/** Characters of a tool result the model gets; longer ones are cut off. */
export const MAX_TOOL_RESULT = 16_000;
/** list_transactions: rows per call at most (fewer when they don't fit into MAX_TOOL_RESULT),
 *  and the characters of a description it shows. */
const MAX_TX_ROWS = 500;
const MAX_TX_DESCRIPTION = 100;
/** analyze_transactions: groups per call at most (fewer when they don't fit). */
const MAX_GROUPS = 1000;
const DEFAULT_GROUPS = 100;
/** analyze_calendar: days per call at most (about ten years). */
const MAX_ANALYZE_DAYS = 3700;
/** ask_user: options per question, and characters of the question and of an option. */
const MAX_OPTIONS = 8;
const MAX_QUESTION = 500;
const MAX_OPTION = 150;
const TX_COLUMNS = [
  "id",
  "date",
  "amountCents",
  "payee",
  "description",
  "categoryId",
  "accountId",
  "transferId",
  "splitOf",
  "note",
];

class NeedsConfirmation extends Error {}

function needConfirm(args: Record<string, unknown>, what: string) {
  if (args.confirmed !== true) {
    throw new NeedsConfirmation(
      `${what} Ask the user to confirm first, then call this tool again with "confirmed": true.`,
    );
  }
}

function range(args: Record<string, unknown>) {
  const { from, to } = args;
  if (!isValidDate(from) || !isValidDate(to)) {
    throw new HttpError(400, "from/to must be YYYY-MM-DD");
  }
  if (from > to) throw new HttpError(400, "from must not be after to");
  return { from: from as string, to: to as string };
}

const yearOf = (day: string) => Number(day.slice(0, 4));

/** A list of allowed values (a single string works too), at most `max` of them. */
function choices<T extends string>(
  v: unknown,
  allowed: readonly T[],
  field: string,
  max = allowed.length,
): T[] | undefined {
  if (v === undefined || v === null) return undefined;
  const list = Array.isArray(v) ? v : [v];
  const bad = list.find((x) => !allowed.includes(x as T));
  if (bad !== undefined) {
    throw new HttpError(400, `${field} can only hold ${allowed.join(", ")}`);
  }
  const out = [...new Set(list as T[])];
  if (out.length > max) throw new HttpError(400, `${field} takes at most ${max} values`);
  return out;
}

/** The first elements of `items` whose JSON, with `head`, stays below the tool result limit. */
function fitting<T>(head: unknown, items: T[]): T[] {
  let size = JSON.stringify(head).length + 60;
  const out: T[] = [];
  for (const item of items) {
    size += JSON.stringify(item).length + 1;
    if (size > MAX_TOOL_RESULT && out.length) break;
    out.push(item);
  }
  return out;
}

/** Weekdays with a "needs cover" entry and nothing that covers it. */
function gaps(types: TypeRow[], entries: Map<string, string[]>): string[] {
  const role = new Map(types.map((t) => [`${t.year}|${t.id}`, t.role]));
  const out: string[] = [];
  for (const [day, ids] of entries) {
    if (isWeekend(day)) continue;
    const roles = ids.map((id) => role.get(`${yearOf(day)}|${id}`));
    if (roles.includes("needs_cover") && !roles.some((r) => r === "covers" || r === "day_off")) {
      out.push(day);
    }
  }
  return out.sort();
}

async function entriesOn(store: Store, familyId: string, days: string[]) {
  const map = new Map<string, string[]>(days.map((d) => [d, []]));
  if (!days.length) return map;
  const sorted = [...days].sort();
  for (const r of await store.listEntries(familyId, sorted[0], sorted.at(-1))) {
    map.get(r.day)?.push(r.type_id);
  }
  return map;
}

const opsSchema = (item: Record<string, unknown>) => ({
  type: "object",
  properties: {
    ops: { type: "array", items: item, description: "Applied in order." },
    confirmed: {
      type: "boolean",
      description: "Set only after the user confirmed a big change you described to them.",
    },
  },
  required: ["ops"],
});

const daysProps = {
  dates: { type: "array", items: { type: "string" }, description: "Days as YYYY-MM-DD." },
  from: { type: "string", description: "First day of an inclusive range (YYYY-MM-DD)." },
  to: { type: "string", description: "Last day of the range (YYYY-MM-DD)." },
  skipWeekends: { type: "boolean", description: "Leave out Saturdays and Sundays." },
};

export const TOOLS: Record<string, Tool> = {
  get_calendar: {
    spec: {
      name: "get_calendar",
      description:
        "Reads the vacation calendar between two days: the entry types of those years, the entries per day (type ids), day notes, and gaps (weekdays that need cover but have none).",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD, at most about a year after from" },
        },
        required: ["from", "to"],
      },
    },
    async run(args, { store, familyId }) {
      const { from, to } = range(args);
      if (dateRange(from, to).length > MAX_RANGE_DAYS) {
        throw new HttpError(400, "Read at most about a year at a time");
      }
      const [types, rows, notes] = await Promise.all([
        store.listTypes(familyId),
        store.listEntries(familyId, from, to),
        store.listNotes(familyId, from, to),
      ]);
      const inRange = types.filter((t) => t.year >= yearOf(from) && t.year <= yearOf(to));
      const entries = new Map<string, string[]>();
      for (const r of rows) entries.set(r.day, [...(entries.get(r.day) ?? []), r.type_id]);
      return {
        result: {
          types: inRange.map(publicType),
          entries: Object.fromEntries(entries),
          notes: Object.fromEntries(
            notes.map((n) => [n.day, { icon: n.icon, comment: n.comment }]),
          ),
          gaps: gaps(inRange, entries),
        },
        summary: `${from} – ${to}`,
      };
    },
  },

  analyze_calendar: {
    spec: {
      name: "analyze_calendar",
      description:
        'Counts calendar days instead of you counting them in get_calendar: days per entry type (a day counts once for each of its types), year, month and/or weekday between two days, e.g. vacation days per parent this year. groupBy: up to 2 of type, year, month, weekday (default type; without type a day counts once whatever it holds). types: only these (ids or names). weekdaysOnly: leave out Saturdays and Sundays. skipDaysOff: leave out entries on days that also have a "day off" entry (vacation on a public holiday costs no vacation day).',
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD, at most about ten years after from" },
          groupBy: { type: "array", items: { type: "string", enum: [...CALENDAR_DIMENSIONS] } },
          types: { type: "array", items: { type: "string" } },
          weekdaysOnly: { type: "boolean" },
          skipDaysOff: { type: "boolean" },
        },
        required: ["from", "to"],
      },
    },
    async run(args, { store, familyId }) {
      const { from, to } = range(args);
      if (diffDays(from, to) >= MAX_ANALYZE_DAYS) {
        throw new HttpError(400, "Analyze at most about ten years at a time");
      }
      const asked = choices(args.groupBy, CALENDAR_DIMENSIONS, "groupBy", 2);
      const groupBy = asked?.length ? asked : ["type" as const];
      const [types, entries] = await Promise.all([
        store.listTypes(familyId),
        store.listEntries(familyId, from, to),
      ]);
      let only: Set<string> | undefined;
      if (args.types !== undefined) {
        const refs = Array.isArray(args.types) ? args.types : [args.types];
        only = new Set();
        for (const ref of refs) {
          const name = String(ref).trim().toLowerCase();
          const ids = types.filter((t) => t.id === ref || t.name.toLowerCase() === name);
          if (!ids.length) throw new HttpError(404, `Unknown entry type "${ref}"`);
          for (const t of ids) only.add(t.id);
        }
      }
      const res = analyzeCalendar({
        types,
        entries,
        from,
        to,
        only,
        groupBy,
        weekdaysOnly: args.weekdaysOnly === true,
        skipDaysOff: args.skipDaysOff === true,
      });
      const head = { from, to, groupBy, days: res.days };
      const groups = fitting(head, res.groups);
      return {
        result: {
          ...head,
          groups,
          ...(groups.length < res.groups.length ? { more: res.groups.length - groups.length } : {}),
        },
        summary: `${res.days} days`,
      };
    },
  },

  change_entries: {
    write: true,
    spec: {
      name: "change_entries",
      description:
        'Changes calendar entries. Each op: {"action": "add" | "remove" | "set" | "clear", "type" or "types" (id or name, resolved in each day\'s year), and the days}. "add" keeps other entries, "set" replaces them, "clear" removes all.',
      parameters: opsSchema({
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "remove", "set", "clear"] },
          type: { type: "string" },
          types: { type: "array", items: { type: "string" } },
          ...daysProps,
        },
        required: ["action"],
      }),
    },
    async run(args, { store, familyId, lang }) {
      const types = await store.listTypes(familyId);
      const { ops, total } = parseEntryOps({ ops: args.ops }, types);
      const days = [...new Set(ops.flatMap((o) => o.days))].sort();
      if (days.length > CONFIRM_DAYS) needConfirm(args, `This changes ${days.length} days.`);
      const before = await entriesOn(store, familyId, days);
      await applyEntryOps(store, familyId, ops);
      const after = await entriesOn(store, familyId, days);
      const changed = days.filter((d) =>
        [...before.get(d)!].sort().join() !== [...after.get(d)!].sort().join()
      );
      // Undo: put each changed day back to its old types, grouped by the same set of types.
      const groups = new Map<string, string[]>();
      for (const d of changed) {
        const key = [...before.get(d)!].sort().join(",");
        groups.set(key, [...(groups.get(key) ?? []), d]);
      }
      const undoOps = [...groups].map(([key, dates]) =>
        key ? { action: "set", types: key.split(","), dates } : { action: "clear", dates }
      );
      return {
        result: { ok: true, days: total, changed: changed.length },
        summary: `${changed.length} days changed`,
        change: changed.length
          ? {
            kind: "entries",
            summary: PHRASES[lang].days(changed.length),
            undo: [{ method: "POST", path: "/entries", body: { ops: undoOps } }],
          }
          : undefined,
      };
    },
  },

  set_notes: {
    write: true,
    spec: {
      name: "set_notes",
      description:
        'Sets or clears day notes (one per day: an emoji icon and/or a comment, e.g. 🎄 "Christmas"). Each op: {"action": "set" | "clear", "icon", "comment", and the days}.',
      parameters: opsSchema({
        type: "object",
        properties: {
          action: { type: "string", enum: ["set", "clear"] },
          icon: { type: "string", description: "One emoji" },
          comment: { type: "string", description: "Up to 500 characters" },
          ...daysProps,
        },
        required: ["action"],
      }),
    },
    async run(args, { store, familyId, lang }) {
      const { ops, total } = parseNoteOps({ ops: args.ops });
      const days = [...new Set(ops.flatMap((o) => o.days))].sort();
      if (days.length > CONFIRM_DAYS) {
        needConfirm(args, `This changes the notes of ${days.length} days.`);
      }
      const old = new Map(
        (await store.listNotes(familyId, days[0], days.at(-1))).map((n) => [n.day, n]),
      );
      await applyNoteOps(store, familyId, ops);
      const undoOps = days.map((d) => {
        const n = old.get(d);
        return n
          ? { action: "set", dates: [d], icon: n.icon, comment: n.comment }
          : { action: "clear", dates: [d] };
      });
      return {
        result: { ok: true, days: total },
        summary: `${total} notes changed`,
        change: {
          kind: "notes",
          summary: PHRASES[lang].notes(total),
          undo: [{ method: "POST", path: "/notes", body: { ops: undoOps } }],
        },
      };
    },
  },

  manage_entry_types: {
    write: true,
    spec: {
      name: "manage_entry_types",
      description:
        'Adds, changes, deletes or copies entry types. Every year has its own types. "add": name, color (#rrggbb), role. "update": type (id or name) and any of name, color, role. "delete": type (also deletes its entries in that year; needs confirmed). "copy_year": from and to (years).',
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "update", "delete", "copy_year"] },
          year: { type: "integer" },
          type: { type: "string" },
          name: { type: "string" },
          color: { type: "string" },
          role: { type: "string", enum: ["none", "needs_cover", "covers", "day_off"] },
          from: { type: "integer" },
          to: { type: "integer" },
          confirmed: { type: "boolean" },
        },
        required: ["action"],
      },
    },
    async run(args, { store, familyId, lang }) {
      const all = await store.listTypes(familyId);
      const year = Number(args.year ?? new Date().getUTCFullYear());
      if (!Number.isInteger(year) || year < 1900 || year > 2200) {
        throw new HttpError(400, "Invalid year");
      }
      const types = all.filter((t) => t.year === year);
      const path = (id: string) => `/types/${encodeURIComponent(id)}?year=${year}`;
      switch (args.action) {
        case "add": {
          if (types.length >= MAX_TYPES) throw new HttpError(400, "Too many entry types");
          const name = cleanName(args.name);
          const type: TypeRow = {
            family_id: familyId,
            year,
            id: uniqueId(slug(name), new Set(types.map((t) => t.id))),
            name,
            color: cleanColor(args.color ?? "#64748b"),
            role: cleanRole(args.role),
            position: types.reduce((m, t) => Math.max(m, t.position + 1), 0),
          };
          await store.upsertTypes([type]);
          return {
            result: publicType(type),
            summary: `Added “${name}” (${year})`,
            change: {
              kind: "types",
              summary: PHRASES[lang].typeAdded(name, year),
              undo: [{ method: "DELETE", path: path(type.id) }],
            },
          };
        }
        case "update": {
          const type = resolveType(all, args.type, year);
          const next = { ...type };
          if (args.name !== undefined) next.name = cleanName(args.name);
          if (args.color !== undefined) next.color = cleanColor(args.color);
          if (args.role !== undefined) next.role = cleanRole(args.role);
          await store.upsertTypes([next]);
          return {
            result: publicType(next),
            summary: `Changed “${next.name}” (${year})`,
            change: {
              kind: "types",
              summary: PHRASES[lang].typeChanged(type.name, year),
              undo: [{
                method: "PATCH",
                path: path(type.id),
                body: { name: type.name, color: type.color, role: type.role },
              }],
            },
          };
        }
        case "delete": {
          const type = resolveType(all, args.type, year);
          needConfirm(
            args,
            `Deleting “${type.name}” also deletes its entries in ${year} and can't be undone.`,
          );
          await store.deleteType(familyId, year, type.id);
          return {
            result: { deleted: type.id, year },
            summary: `Deleted “${type.name}” (${year})`,
          };
        }
        case "copy_year": {
          const from = Number(args.from), to = Number(args.to);
          const source = all.filter((t) => t.year === from);
          if (!source.length) throw new HttpError(404, `${from} has no entry types`);
          const target = all.filter((t) => t.year === to);
          const taken = new Set(target.map((t) => t.id));
          let position = target.reduce((m, t) => Math.max(m, t.position + 1), 0);
          const copies = source.filter((t) => !taken.has(t.id))
            .slice(0, Math.max(0, MAX_TYPES - target.length))
            .map((t) => ({ ...t, year: to, position: position++ }));
          await store.upsertTypes(copies);
          return {
            result: [...target, ...copies].map(publicType),
            summary: `Copied ${copies.length} types to ${to}`,
            change: copies.length
              ? {
                kind: "types",
                summary: PHRASES[lang].typesCopied(copies.length, from, to),
                undo: copies.map((t) => ({
                  method: "DELETE" as const,
                  path: `/types/${encodeURIComponent(t.id)}?year=${to}`,
                })),
              }
              : undefined,
          };
        }
      }
      throw new HttpError(400, "action must be add, update, delete or copy_year");
    },
  },

  list_transactions: {
    spec: {
      name: "list_transactions",
      description:
        'Lists transactions (newest first) with totals, as rows of `columns`: as many as fit, long descriptions shortened. If `nextOffset` is set there are more: call again with that offset. For totals per month or category use finance_summary instead. Amounts are integer cents, negative = money out. Legs of a transfer between the family\'s accounts share a transferId; totals count a transfer once by its net (500 moved between two accounts counts 0). A part of a split booking (e.g. an order line of an Amazon "Splitbuchung") has the booking\'s id as splitOf; totals count the parts and only what is left of the booking. Filters: from/to (YYYY-MM-DD), account (id, name or "none"), category (id, name or "none"), kind (income | expense | transfer: legs of transfers), q (text in payee, description, note).',
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          account: { type: "string" },
          category: { type: "string" },
          kind: { type: "string", enum: ["income", "expense", "transfer"] },
          q: { type: "string" },
          offset: { type: "integer", description: "Rows to skip, from nextOffset" },
          limit: { type: "integer", description: "Rows at most; leave out to get as many as fit" },
        },
      },
    },
    async run(args, { store, familyId }) {
      const query = new URLSearchParams();
      for (const k of ["from", "to", "account", "category", "kind", "q"]) {
        if (typeof args[k] === "string" && args[k]) query.set(k, args[k] as string);
      }
      const { rows, links, incomeCents, expenseCents } = await findTransactions(
        store,
        familyId,
        query,
      );
      const offset = Math.max(0, Math.floor(Number(args.offset)) || 0);
      const limit = Math.min(MAX_TX_ROWS, Math.max(1, Number(args.limit) || MAX_TX_ROWS));
      const head = { total: rows.length, incomeCents, expenseCents, columns: TX_COLUMNS };
      // Rows until the result is about to be cut off (room left for offset and nextOffset).
      let size = JSON.stringify(head).length + 60;
      const out: unknown[][] = [];
      for (const t of rows.slice(offset, offset + limit)) {
        const p = publicTransaction(t, links);
        const description = p.description.length > MAX_TX_DESCRIPTION
          ? p.description.slice(0, MAX_TX_DESCRIPTION) + "…"
          : p.description;
        const row = [
          p.id,
          p.date,
          p.amountCents,
          p.payee,
          description,
          p.categoryId,
          p.accountId,
          p.transferId,
          p.splitOf,
          p.note,
        ];
        size += JSON.stringify(row).length + 1;
        if (size > MAX_TOOL_RESULT && out.length) break;
        out.push(row);
      }
      const next = offset + out.length;
      return {
        result: {
          ...head,
          offset,
          rows: out,
          ...(next < rows.length ? { nextOffset: next } : {}),
        },
        summary: `${rows.length} transactions`,
      };
    },
  },

  finance_summary: {
    spec: {
      name: "finance_summary",
      description:
        "Income and expenses (integer cents) per month and per category between two days (a transfer between the family's accounts counts once by its net), plus the currency, the categories and the accounts with their current balances (balanceCents) and their balances at the end of `to` (balanceAtToCents).",
      parameters: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
        required: ["from", "to"],
      },
    },
    async run(args, { store, familyId }) {
      const { from, to } = range(args);
      const [summary, categories, accounts, atTo] = await Promise.all([
        financeSummary(store, familyId, from, to),
        store.listCategories(familyId),
        listAccounts(store, familyId),
        store.accountTotals(familyId, to),
      ]);
      const withAtTo = accounts.map((a) => ({
        ...a,
        balanceAtToCents: a.openingCents + (atTo.get(a.id) ?? 0),
      }));
      return {
        result: { ...summary, categoryNames: categories.map(publicCategory), accounts: withAtTo },
        summary: `${from} – ${to}`,
      };
    },
  },

  analyze_transactions: {
    spec: {
      name: "analyze_transactions",
      description:
        "Totals and statistics of transactions per group, computed exactly (use it instead of adding up list_transactions): up to 2 of groupBy: month, quarter, year, week (ISO), weekday, day, category, account, payee (similar spellings together), kind (income / expense). Each group has count, incomeCents, expenseCents, netCents, and the asked stats of its single amounts (avg, median, min, max, stddev; in cents, negative = out). With one groupBy, perGroup has the average and median group (e.g. the average month; empty months count as 0). Counted like all totals: a transfer between the family's accounts once by its net, a split booking by its parts. Same filters as list_transactions (from, to, account, category, kind, q). Time groups come in order, others largest first; sortBy: key, total (income + expenses), count, income, expense, net; order: asc or desc.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          account: { type: "string" },
          category: { type: "string" },
          kind: { type: "string", enum: ["income", "expense", "transfer"] },
          q: { type: "string" },
          groupBy: {
            type: "array",
            items: { type: "string", enum: [...TX_DIMENSIONS] },
            description: "Default: month",
          },
          stats: { type: "array", items: { type: "string", enum: [...TX_STATS] } },
          sortBy: { type: "string", enum: [...TX_SORTS] },
          order: { type: "string", enum: ["asc", "desc"] },
          limit: { type: "integer", description: `Groups at most, default ${DEFAULT_GROUPS}` },
        },
      },
    },
    async run(args, { store, familyId }) {
      const query = new URLSearchParams();
      for (const k of ["from", "to", "account", "category", "kind", "q"]) {
        if (typeof args[k] === "string" && args[k]) query.set(k, args[k] as string);
      }
      const asked = choices(args.groupBy, TX_DIMENSIONS, "groupBy", 2);
      const groupBy = asked?.length ? asked : ["month" as const];
      const stats = choices(args.stats, TX_STATS, "stats") ?? [];
      const [sortBy] = choices(args.sortBy, TX_SORTS, "sortBy", 1) ?? [];
      const [order] = choices(args.order, ["asc", "desc"] as const, "order", 1) ?? [];
      const [{ rows, links }, categories, accounts] = await Promise.all([
        findTransactions(store, familyId, query),
        store.listCategories(familyId),
        store.listAccounts(familyId),
      ]);
      const res = analyzeTransactions({
        items: netItems(rows, links),
        groupBy,
        stats,
        sortBy,
        order,
        categories,
        accounts,
        from: query.get("from") ?? undefined,
        to: query.get("to") ?? undefined,
      });
      const limit = Math.min(MAX_GROUPS, Math.max(1, Number(args.limit) || DEFAULT_GROUPS));
      const head = { groupBy, total: res.total, perGroup: res.perGroup, groupCount: 0 };
      const groups = fitting(head, res.groups.slice(0, limit));
      return {
        result: {
          groupBy,
          total: res.total,
          ...(res.perGroup ? { perGroup: res.perGroup } : {}),
          groupCount: res.groups.length,
          groups,
          ...(groups.length < res.groups.length ? { more: res.groups.length - groups.length } : {}),
        },
        summary: `${res.groups.length} groups`,
      };
    },
  },

  manage_categories: {
    write: true,
    spec: {
      name: "manage_categories",
      description:
        'Adds, changes or deletes finance categories. "add": name, kind (expense | income | both, default expense), color (#rrggbb), icon (one emoji). "update": category (id or name) and any of name, kind, color, icon. "delete": category (its transactions become uncategorized; needs confirmed).',
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "update", "delete"] },
          category: { type: "string" },
          name: { type: "string" },
          kind: { type: "string", enum: ["expense", "income", "both"] },
          color: { type: "string" },
          icon: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["action"],
      },
    },
    async run(args, { store, familyId, lang }) {
      const categories = await store.listCategories(familyId);
      const path = (id: string) => `/finance/categories/${encodeURIComponent(id)}`;
      switch (args.action) {
        case "add": {
          const row = newCategory(familyId, categories, { color: "#64748b", ...args });
          await store.upsertCategories([row]);
          return {
            result: publicCategory(row),
            summary: `Added “${row.name}”`,
            change: {
              kind: "categories",
              summary: PHRASES[lang].categoryAdded(row.name),
              undo: [{ method: "DELETE", path: path(row.id) }],
            },
          };
        }
        case "update": {
          const current = findCategory(categories, args.category);
          const { name, kind, color, icon } = args;
          const next = changedCategory(current, { name, kind, color, icon });
          await store.upsertCategories([next]);
          return {
            result: publicCategory(next),
            summary: `Changed “${next.name}”`,
            change: {
              kind: "categories",
              summary: PHRASES[lang].categoryChanged(current.name),
              undo: [{
                method: "PATCH",
                path: path(current.id),
                body: {
                  name: current.name,
                  kind: current.kind,
                  color: current.color,
                  icon: current.icon,
                },
              }],
            },
          };
        }
        case "delete": {
          const current = findCategory(categories, args.category);
          needConfirm(
            args,
            `Deleting “${current.name}” leaves its transactions uncategorized and can't be undone.`,
          );
          await store.deleteCategory(familyId, current.id);
          return { result: { deleted: current.id }, summary: `Deleted “${current.name}”` };
        }
      }
      throw new HttpError(400, "action must be add, update or delete");
    },
  },

  change_transactions: {
    write: true,
    spec: {
      name: "change_transactions",
      description:
        'Adds, changes, deletes, links, unlinks, splits or unsplits transactions. Ops: {"action": "add", "date", "amountCents" (integer, negative = money out), "payee", "description", "categoryId" (id or name), "accountId" (id or name), "note"}, {"action": "update", "id", ...fields}, {"action": "delete", "ids": [...]}, {"action": "link", "ids": [at least 2]}: the transactions become the legs of one transfer between the family\'s accounts (e.g. 500 out of checking and 500 into savings), counted once by their net, {"action": "unlink", "ids": [...]}: dissolves the transfers these transactions belong to, {"action": "split", "id": "<booking>", "ids": [parts]}: the transactions become parts of the booking (e.g. the order lines the bank lists next to an Amazon "Splitbuchung"); totals count the parts with their categories and only what is left of the booking, {"action": "unsplit", "ids": [...]}: parts become normal transactions again (for a booking: all of its parts).',
      parameters: opsSchema({
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["add", "update", "delete", "link", "unlink", "split", "unsplit"],
          },
          id: { type: "string" },
          ids: { type: "array", items: { type: "string" } },
          date: { type: "string" },
          amountCents: { type: "integer" },
          payee: { type: "string" },
          description: { type: "string" },
          categoryId: { type: ["string", "null"] },
          accountId: { type: ["string", "null"] },
          transferId: {
            type: ["string", "null"],
            description: "Rarely needed: use link / unlink to combine or split transfers.",
          },
          note: { type: "string" },
        },
        required: ["action"],
      }),
    },
    async run(args, { store, familyId, lang }) {
      if (!Array.isArray(args.ops)) throw new HttpError(400, "ops must be an array");
      const ops = args.ops.map((o) => objectOf(o, "Each op"));
      const deletes = ops.filter((o) => o.action === "delete")
        .reduce((n, o) => n + (Array.isArray(o.ids) ? o.ids.length : 1), 0);
      if (deletes) needConfirm(args, `This deletes ${deletes} transactions.`);
      if (ops.length > CONFIRM_TRANSACTIONS) {
        needConfirm(args, `This changes ${ops.length} transactions.`);
      }
      const res = await applyTransactionOps(store, familyId, ops);
      return {
        result: { ok: true, changed: res.changed, added: res.added },
        summary: `${res.changed} transactions changed`,
        change: res.changed
          ? {
            kind: "transactions",
            summary: PHRASES[lang].transactions(res.changed),
            undo: [{ method: "POST", path: "/finance/transactions", body: { ops: res.inverse } }],
          }
          : undefined,
      };
    },
  },

  combine_transfers: {
    write: true,
    spec: {
      name: "combine_transfers",
      description:
        'Combines what belongs together, like the app\'s Auto-combine: first split bookings (order lines without a payee that name an order, "Bestellnr. 306-…", all become parts of the booking on the same account that names the same order, of the same day or else the closest within 4 days, also a booking already split; a booking marked "Splitbuchung" takes the transactions of the same day, account and merchant as its parts; so they don\'t count twice), then transfers between the family\'s accounts (money out of one account and the same amount into another within 4 days, not yet combined), so each counts once by its net (0). from/to (YYYY-MM-DD) limit the range; without them the whole history.',
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          confirmed: {
            type: "boolean",
            description: "Set only after the user confirmed a big change you described to them.",
          },
        },
      },
    },
    async run(args, { store, familyId, lang }) {
      for (const k of ["from", "to"]) {
        if (args[k] !== undefined && !isValidDate(args[k])) {
          throw new HttpError(400, "from/to must be YYYY-MM-DD");
        }
      }
      const from = args.from as string | undefined, to = args.to as string | undefined;
      const pairs = await transferPairs(store, familyId, from, to);
      if (pairs.length > CONFIRM_TRANSACTIONS / 2) {
        needConfirm(args, `This combines ${pairs.length} transfers.`);
      }
      const res = await autoCombine(store, familyId, from, to);
      const phrases = [
        ...(res.splits ? [PHRASES[lang].splits(res.splits)] : []),
        ...(res.linked || !res.splits ? [PHRASES[lang].transfers(res.linked)] : []),
      ];
      return {
        result: { ok: true, linked: res.linked, splits: res.splits },
        summary: `${res.linked} transfers and ${res.splits} split bookings combined`,
        change: res.changed
          ? {
            kind: "transactions",
            summary: phrases.join(", "),
            undo: [{ method: "POST", path: "/finance/transactions", body: { ops: res.inverse } }],
          }
          : undefined,
      };
    },
  },

  calculate: {
    spec: {
      name: "calculate",
      description:
        'Calculates exactly; use it for any arithmetic instead of working it out yourself. Numbers, lists [1, 2, 3], + - * / % ^ (element by element on lists), parentheses, "name = …" to reuse a result in later expressions, and functions: abs sqrt exp ln log(x, base=10) round(x, digits) floor ceil pow; sum count min max avg median stddev variance percentile(list, p 0–100) product; sort cumsum diff growth (relative change per step) seq(from, to, step); slope(y, x?) intercept(y, x?) correl(x, y) forecast(y, k) (the linear trend k steps after the last value); money, like spreadsheets (rate per period, money paid out negative): pmt(rate, nper, pv, fv?, type?) fv(rate, nper, pmt, pv?, type?) pv(rate, nper, pmt, fv?, type?) nper(rate, pmt, pv, fv?) npv(rate, flows) irr(flows) cagr(start, end, years). Constants pi, e. Each expression gets its value or an error.',
      parameters: {
        type: "object",
        properties: {
          expressions: {
            type: "array",
            items: { type: "string" },
            description: 'Evaluated in order, e.g. ["rate = 0.035 / 12", "pmt(rate, 240, 300000)"]',
          },
          vars: {
            type: "object",
            description:
              'Named numbers or lists of numbers, e.g. {"spent": [412.5, 380, 455.2]} (from other tools\' results)',
          },
        },
        required: ["expressions"],
      },
    },
    run(args) {
      const raw = args.expressions ?? args.expression;
      const expressions = Array.isArray(raw) ? raw : [raw];
      if (!expressions.length || expressions.some((e) => typeof e !== "string")) {
        throw new HttpError(400, "expressions must be a list of strings");
      }
      if (expressions.length > MAX_EXPRESSIONS) {
        throw new HttpError(400, `At most ${MAX_EXPRESSIONS} expressions at a time`);
      }
      let results;
      try {
        results = calculate(expressions as string[], objectOf(args.vars ?? {}, "vars"));
      } catch (err) {
        if (err instanceof CalcError) throw new HttpError(400, err.message);
        throw err;
      }
      const last = results.at(-1)!;
      return Promise.resolve({
        result: { results },
        summary: results.length === 1 && last.value !== undefined && !Array.isArray(last.value)
          ? `${last.expression.slice(0, 60)} = ${last.value}`
          : `${results.length} ${results.length === 1 ? "result" : "results"}`,
      });
    },
  },

  ask_user: {
    spec: {
      name: "ask_user",
      description:
        'Asks the user a question with answers to pick from, when you need their decision or a detail to go on (which of several matches, which option they prefer, their OK for a bigger change). Give 2 to 8 short, distinct options; multiple: true lets them pick several. They can always write their own answer instead, so don\'t add an "Other" option. The answer comes back as this tool\'s result: {"selected": [...]} and/or {"ownAnswer": "..."}, or {"skipped": true} when they wrote a new message instead. Ask one question at a time; call no other tools after it in the same step.',
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          multiple: { type: "boolean", description: "Several answers can be picked" },
        },
        required: ["question", "options"],
      },
    },
    run(args) {
      const question = String(args.question ?? "").trim();
      if (!question) throw new HttpError(400, "question is required");
      if (question.length > MAX_QUESTION) {
        throw new HttpError(400, `question takes at most ${MAX_QUESTION} characters`);
      }
      if (!Array.isArray(args.options)) throw new HttpError(400, "options must be a list");
      const options = [...new Set(args.options.map((o) => String(o ?? "").trim()))]
        .filter(Boolean);
      if (options.length < 2 || options.length > MAX_OPTIONS) {
        throw new HttpError(400, `Give 2 to ${MAX_OPTIONS} different options`);
      }
      if (options.some((o) => o.length > MAX_OPTION)) {
        throw new HttpError(400, `An option takes at most ${MAX_OPTION} characters`);
      }
      const multiple = args.multiple === true;
      return Promise.resolve({
        result: { asked: true },
        summary: question,
        question: { question, options, multiple },
      });
    },
  },

  web_search: {
    needsSearch: true,
    spec: {
      name: "web_search",
      description:
        "Searches the web. Returns titles, URLs and snippets; read promising results with fetch_page before relying on them.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          count: { type: "integer", description: "Results, default 5, at most 10" },
        },
        required: ["query"],
      },
    },
    async run(args, { net, search, signal }) {
      if (!search) throw new HttpError(400, "Web search isn't set up");
      const query = String(args.query ?? "").trim().slice(0, 400);
      if (!query) throw new HttpError(400, "query is required");
      const count = Math.min(10, Math.max(1, Number(args.count) || 5));
      let results: { title: string; url: string; snippet: string }[];
      if (search.provider === "tavily") {
        const res = await safeFetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${search.key}` },
          body: JSON.stringify({ api_key: search.key, query, max_results: count }),
          signal,
        }, { ...net, allowPrivate: false });
        if (!res.ok) throw new HttpError(502, `Search failed: ${res.status}`);
        const data = JSON.parse(await readLimited(res, 1_000_000));
        results = (data.results ?? []).map((r: Record<string, string>) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: (r.content ?? "").slice(0, 500),
        }));
      } else {
        const url = `https://api.search.brave.com/res/v1/web/search?count=${count}&q=${
          encodeURIComponent(query)
        }`;
        const res = await safeFetch(url, {
          headers: { accept: "application/json", "x-subscription-token": search.key },
          signal,
        }, { ...net, allowPrivate: false });
        if (!res.ok) throw new HttpError(502, `Search failed: ${res.status}`);
        const data = JSON.parse(await readLimited(res, 1_000_000));
        results = (data.web?.results ?? []).map((r: Record<string, string>) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: (r.description ?? "").replace(/<[^>]+>/g, "").slice(0, 500),
        }));
      }
      return { result: { query, results: results.slice(0, count) }, summary: query };
    },
  },

  fetch_page: {
    spec: {
      name: "fetch_page",
      description: "Reads a web page (http or https) and returns its title and text.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
    async run(args, { net, signal }) {
      const url = (await checkUrl(String(args.url ?? ""), net)).href;
      const res = await safeFetch(url, {
        headers: {
          accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
          "user-agent": "FamilyPlanner/1.0 (+https://family-planner.fa-krug.de)",
        },
        signal,
        timeoutMs: 10000,
      }, net);
      if (!res.ok) throw new HttpError(502, `The page answered ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (!/text\/|json|xml/.test(type)) {
        await res.body?.cancel();
        throw new HttpError(415, `Can't read ${type.split(";")[0] || "this kind of file"}`);
      }
      const raw = await readLimited(res, 2_000_000);
      const { title, text } = type.includes("html") ? htmlToText(raw) : { title: "", text: raw };
      return {
        result: {
          url: res.url || url,
          title,
          text: text.slice(0, MAX_PAGE_TEXT),
          truncated: text.length > MAX_PAGE_TEXT,
        },
        summary: new URL(url).hostname,
      };
    },
  },
};

/** The tools for a chat: without writes if they're off, without search if it isn't set up. */
export function toolsFor(opts: { writes: boolean; search: boolean }): ToolSpec[] {
  return Object.values(TOOLS)
    .filter((t) => (opts.writes || !t.write) && (opts.search || !t.needsSearch))
    .map((t) => ({ type: "function", function: t.spec }));
}

/** Runs a tool call; errors come back to the model as {"error": "..."} so it can react. */
export async function runTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
  allowed: Set<string>,
): Promise<ToolResult & { ok: boolean }> {
  const tool = TOOLS[name];
  if (!tool || !allowed.has(name)) {
    return { ok: false, result: { error: `Unknown tool "${name}"` }, summary: name };
  }
  let args: Record<string, unknown>;
  try {
    args = rawArgs.trim() ? objectOf(JSON.parse(rawArgs), "arguments") : {};
  } catch {
    return { ok: false, result: { error: "The arguments must be a JSON object" }, summary: name };
  }
  try {
    return { ok: true, ...(await tool.run(args, ctx)) };
  } catch (err) {
    const message = err instanceof HttpError || err instanceof NeedsConfirmation
      ? err.message
      : "The tool failed";
    if (!(err instanceof HttpError || err instanceof NeedsConfirmation)) console.error(err);
    return {
      ok: false,
      result: {
        error: message,
        ...(err instanceof NeedsConfirmation ? { needsConfirmation: true } : {}),
      },
      summary: message,
    };
  }
}
