// The assistant's tools: read and change the vacation calendar and the finances (with the same
// validation as the REST API), search the web and read pages. Every change comes with undo
// steps: requests against the family's own API that put things back.

import { dateRange, isValidDate, isWeekend } from "../dates.ts";
import {
  applyTransactionOps,
  financeSummary,
  findTransactions,
  publicCategory,
  publicTransaction,
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
import { checkUrl, htmlToText, type NetOptions, readLimited, safeFetch } from "./net.ts";
import type { ToolSpec } from "./provider.ts";

/** A request against /families/{id} that undoes (part of) a change. */
export interface UndoStep {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}

export interface Change {
  kind: "entries" | "notes" | "types" | "transactions";
  summary: string;
  undo: UndoStep[];
}

export interface ToolResult {
  result: unknown;
  summary: string;
  change?: Change;
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
    transactions: (n: number) => `${n} ${n === 1 ? "transaction" : "transactions"} changed`,
  },
  de: {
    days: (n: number) => `${n} ${n === 1 ? "Tag" : "Tage"} geändert`,
    notes: (n: number) => `${n} ${n === 1 ? "Notiz" : "Notizen"} geändert`,
    typeAdded: (name: string, year: number) => `Art „${name}“ hinzugefügt (${year})`,
    typeChanged: (name: string, year: number) => `Art „${name}“ geändert (${year})`,
    typesCopied: (n: number, from: number, to: number) =>
      `${n} Arten von ${from} nach ${to} kopiert`,
    transactions: (n: number) => `${n} ${n === 1 ? "Buchung" : "Buchungen"} geändert`,
  },
};

/** Changes that need the user's OK first; the model has to call again with confirmed: true. */
const CONFIRM_DAYS = 31;
const CONFIRM_TRANSACTIONS = 20;
const MAX_RANGE_DAYS = 400;
const MAX_PAGE_TEXT = 12000;

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
        'Lists transactions (newest first) with totals. Amounts are integer cents, negative = money out. Filters: from/to (YYYY-MM-DD), category (id, name or "none"), kind (income | expense), q (text in payee, description, note).',
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          category: { type: "string" },
          kind: { type: "string", enum: ["income", "expense"] },
          q: { type: "string" },
          limit: { type: "integer", description: "Default 50, at most 200" },
        },
      },
    },
    async run(args, { store, familyId }) {
      const query = new URLSearchParams();
      for (const k of ["from", "to", "category", "kind", "q"]) {
        if (typeof args[k] === "string" && args[k]) query.set(k, args[k] as string);
      }
      const rows = await findTransactions(store, familyId, query);
      const limit = Math.min(200, Math.max(1, Number(args.limit) || 50));
      let income = 0, expense = 0;
      for (const t of rows) {
        if (t.amount_cents > 0) income += t.amount_cents;
        else expense -= t.amount_cents;
      }
      return {
        result: {
          total: rows.length,
          incomeCents: income,
          expenseCents: expense,
          transactions: rows.slice(0, limit).map(publicTransaction),
        },
        summary: `${rows.length} transactions`,
      };
    },
  },

  finance_summary: {
    spec: {
      name: "finance_summary",
      description:
        "Income and expenses (integer cents) per month and per category between two days, plus the currency and the categories.",
      parameters: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
        required: ["from", "to"],
      },
    },
    async run(args, { store, familyId }) {
      const { from, to } = range(args);
      const [summary, categories] = await Promise.all([
        financeSummary(store, familyId, from, to),
        store.listCategories(familyId),
      ]);
      return {
        result: { ...summary, categoryNames: categories.map(publicCategory) },
        summary: `${from} – ${to}`,
      };
    },
  },

  change_transactions: {
    write: true,
    spec: {
      name: "change_transactions",
      description:
        'Adds, changes or deletes transactions. Ops: {"action": "add", "date", "amountCents" (integer, negative = money out), "payee", "description", "categoryId" (id or name), "note"}, {"action": "update", "id", ...fields}, {"action": "delete", "ids": [...]}.',
      parameters: opsSchema({
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "update", "delete"] },
          id: { type: "string" },
          ids: { type: "array", items: { type: "string" } },
          date: { type: "string" },
          amountCents: { type: "integer" },
          payee: { type: "string" },
          description: { type: "string" },
          categoryId: { type: ["string", "null"] },
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
