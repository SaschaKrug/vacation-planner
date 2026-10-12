// HTTP API for the vacation planner. Mounted as the Supabase Edge Function
// "api" (https://<project>.supabase.co/functions/v1/api/...) and reused by the
// local dev server with an in-memory store.

import { buildAgentDoc } from "./agent.ts";
import { dateRange, formatDate, isValidDate, isWeekend } from "./dates.ts";
import { buildIcs, type Lang } from "./ics.ts";
import {
  type EntryRow,
  type NoteRow,
  type Role,
  ROLES,
  type SessionRow,
  type Store,
  type TypeRow,
} from "./store.ts";

export const PRESET_TYPES: { id: string; name: string; color: string; role: Role }[] = [
  { id: "holiday", name: "Holiday", color: "#f59e0b", role: "day_off" },
  { id: "vacation", name: "Vacation", color: "#22c55e", role: "covers" },
  { id: "sick", name: "Sick", color: "#ef4444", role: "none" },
];

const LANGS: Lang[] = ["en", "de"];
const DEFAULT_SESSION_NAME: Record<Lang, string> = {
  en: "Vacation planner",
  de: "Urlaubsplaner",
};
/** Localized preset names by type id; ids, colors and roles stay the same. */
const PRESET_NAMES: Record<Lang, Record<string, string>> = {
  en: Object.fromEntries(PRESET_TYPES.map((t) => [t.id, t.name])),
  de: { holiday: "Feiertag", vacation: "Urlaub", sick: "Krank" },
};

const MAX_TYPES = 50; // per year
const MAX_DAYS_PER_REQUEST = 4000;
const MAX_RANGE_DAYS = 3 * 366;
const MAX_ICON = 16; // UTF-16 code units: enough for flags and ZWJ emoji
const MAX_COMMENT = 500;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// Tokens come from randomToken(); the Supabase store relies on them being alphanumeric.
const TOKEN_RE = /^[A-Za-z0-9]{10,64}$/;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, apikey, x-client-info",
  "access-control-max-age": "86400",
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function randomToken(length = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object") return body;
  } catch {
    // fall through
  }
  throw new HttpError(400, "Body must be a JSON object");
}

function cleanName(v: unknown, field = "name"): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${field} is required`);
  const s = v.trim();
  if (s.length > 80) throw new HttpError(400, `${field} is too long (max. 80)`);
  return s;
}

function cleanColor(v: unknown): string {
  if (typeof v !== "string" || !COLOR_RE.test(v)) {
    throw new HttpError(400, "color must look like #22c55e");
  }
  return v.toLowerCase();
}

function cleanRole(v: unknown): Role {
  if (v === undefined) return "none";
  if (!ROLES.includes(v as Role)) {
    throw new HttpError(400, `role must be one of ${ROLES.join(", ")}`);
  }
  return v as Role;
}

function cleanYear(v: unknown, field = "year"): number {
  const s = typeof v === "number" ? String(v) : v;
  if (typeof s !== "string" || !/^\d{4}$/.test(s)) {
    throw new HttpError(400, `${field} must be YYYY`);
  }
  return Number(s);
}

function currentYear(): number {
  return new Date().getUTCFullYear();
}

/** Year a types request is about: `?year=`, else the body's "year", else the current year. */
function typesYear(url: URL, body: Record<string, unknown> = {}): number {
  const v = url.searchParams.get("year") ?? body.year;
  return v === undefined ? currentYear() : cleanYear(v);
}

function cleanLang(v: unknown): Lang {
  if (v === undefined) return "en";
  if (!LANGS.includes(v as Lang)) throw new HttpError(400, "lang must be en or de");
  return v as Lang;
}

function slug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "type";
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** Resolves a type reference given by id or (case-insensitive) name among a year's types. */
function resolveType(types: TypeRow[], ref: unknown, year: number): TypeRow {
  if (typeof ref !== "string") throw new HttpError(400, "type must be a string");
  const t = types.find((t) => t.year === year && t.id === ref) ??
    types.find((t) => t.year === year && t.name.toLowerCase() === ref.trim().toLowerCase());
  if (!t) throw new HttpError(404, `Unknown entry type "${ref}" in ${year}`);
  return t;
}

const yearOf = (day: string) => Number(day.slice(0, 4));

type Range = { from?: string; to?: string };

/** Range from ?year= or ?from=&to= query parameters. */
function rangeFromQuery(url: URL): Range {
  const year = url.searchParams.get("year");
  if (year) {
    if (!/^\d{4}$/.test(year)) throw new HttpError(400, "year must be YYYY");
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  for (const d of [from, to]) {
    if (d !== undefined && !isValidDate(d)) throw new HttpError(400, "from/to must be YYYY-MM-DD");
  }
  return { from, to };
}

function publicType(t: TypeRow) {
  return {
    id: t.id,
    year: t.year,
    name: t.name,
    color: t.color,
    role: t.role,
    position: t.position,
  };
}

/** Types of the years a range touches (all years without a range). */
function typesIn(types: TypeRow[], { from, to }: Range): TypeRow[] {
  return types.filter((t) => !(from && t.year < yearOf(from)) && !(to && t.year > yearOf(to)));
}

function groupEntries(rows: EntryRow[]): Record<string, string[]> {
  const entries: Record<string, string[]> = {};
  for (const r of rows) (entries[r.day] ??= []).push(r.type_id);
  return entries;
}

function notesMap(rows: NoteRow[]): Record<string, { icon: string; comment: string }> {
  return Object.fromEntries(rows.map((n) => [n.day, { icon: n.icon, comment: n.comment }]));
}

/**
 * The planner as the app loads it. `types` are all types of the session; the state holds
 * those of the range's years, plus `typeYears`: every year that has types of its own.
 */
function sessionState(
  session: SessionRow,
  token: string,
  types: TypeRow[],
  range: Range,
  rows: EntryRow[],
  notes: NoteRow[],
) {
  const readOnly = session.id !== token;
  return {
    session: {
      ...(readOnly ? {} : { id: session.id }),
      readId: session.read_id,
      name: session.name,
      readOnly,
      updatedAt: session.updated_at,
    },
    types: typesIn(types, range).map(publicType),
    typeYears: [...new Set(types.map((t) => t.year))].sort((a, b) => a - b),
    entries: groupEntries(rows),
    notes: notesMap(notes),
  };
}

function opObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") throw new HttpError(400, "Each op must be an object");
  return raw as Record<string, unknown>;
}

/** Days of an entry or note op: `dates`, `date` and/or `from`/`to`, minus weekends if asked. */
function parseDays(o: Record<string, unknown>): string[] {
  const days = new Set<string>();
  const dates = o.dates ?? (o.date !== undefined ? [o.date] : []);
  if (!Array.isArray(dates)) throw new HttpError(400, "dates must be an array");
  for (const d of dates) {
    if (!isValidDate(d)) throw new HttpError(400, `Invalid date "${d}" (use YYYY-MM-DD)`);
    days.add(d);
  }
  if (o.from !== undefined || o.to !== undefined) {
    const from = o.from ?? o.to;
    const to = o.to ?? o.from;
    if (!isValidDate(from) || !isValidDate(to)) {
      throw new HttpError(400, "from/to must be YYYY-MM-DD");
    }
    const range = dateRange(from, to);
    if (range.length > MAX_RANGE_DAYS) throw new HttpError(400, "Range is too long");
    for (const d of range) days.add(d);
  }
  let list = [...days].sort();
  if (o.skipWeekends === true) list = list.filter((d) => !isWeekend(d));
  if (list.length === 0) throw new HttpError(400, 'Op needs "dates" or "from"/"to"');
  return list;
}

type Op = {
  action: "add" | "remove" | "set" | "clear";
  days: string[];
  /** The days split by year, each with the type ids its references resolve to in that year. */
  byYear: { types: string[]; days: string[] }[];
};

function parseOp(raw: unknown, types: TypeRow[]): Op {
  const o = opObject(raw);
  const action = o.action ?? "add";
  if (!["add", "remove", "set", "clear"].includes(action as string)) {
    throw new HttpError(400, "action must be add, remove, set or clear");
  }

  let refs: unknown[] = [];
  if (o.types !== undefined) {
    if (!Array.isArray(o.types)) throw new HttpError(400, "types must be an array");
    refs = o.types;
  } else if (o.type !== undefined) refs = [o.type];
  if ((action === "add" || action === "remove") && refs.length === 0) {
    throw new HttpError(400, `"${action}" needs "type" or "types"`);
  }
  const days = parseDays(o);
  // Every year has its own types, so the same name may stand for a different id per year.
  const years = new Map<number, string[]>();
  for (const day of days) {
    const list = years.get(yearOf(day)) ?? [];
    list.push(day);
    years.set(yearOf(day), list);
  }
  const byYear = [...years].map(([year, days]) => ({
    types: [...new Set(refs.map((r) => resolveType(types, r, year).id))],
    days,
  }));
  return { action: action as Op["action"], days, byYear };
}

type NoteOp = { icon: string; comment: string; days: string[] };

function cleanNoteText(v: unknown, field: string, max: number): string {
  if (v === undefined) return "";
  if (typeof v !== "string") throw new HttpError(400, `${field} must be a string`);
  const s = v.trim();
  if (s.length > max) throw new HttpError(400, `${field} is too long (max. ${max})`);
  return s;
}

/** A note op; "clear" (or a "set" with nothing left after trimming) has empty icon + comment. */
function parseNoteOp(raw: unknown): NoteOp {
  const o = opObject(raw);
  const action = o.action ?? "set";
  if (action !== "set" && action !== "clear") {
    throw new HttpError(400, "action must be set or clear");
  }
  if (action === "clear") return { icon: "", comment: "", days: parseDays(o) };
  if (o.icon === undefined && o.comment === undefined) {
    throw new HttpError(400, '"set" needs "icon" or "comment"');
  }
  return {
    icon: cleanNoteText(o.icon, "icon", MAX_ICON),
    comment: cleanNoteText(o.comment, "comment", MAX_COMMENT),
    days: parseDays(o),
  };
}

/** Parses `{ops: [...]}` or a single op and enforces the per-request day limit. */
function parseOps<T extends { days: string[] }>(
  body: Record<string, unknown>,
  parse: (raw: unknown) => T,
): { ops: T[]; total: number } {
  const rawOps = Array.isArray(body.ops) ? body.ops : [body];
  const ops = rawOps.map(parse);
  const total = ops.reduce((n, o) => n + o.days.length, 0);
  if (total > MAX_DAYS_PER_REQUEST) throw new HttpError(400, "Too many days in one request");
  return { ops, total };
}

const AGENT_METHODS = ["GET", "POST", "PATCH", "DELETE"];
/** How often the web app refreshes an open planner (web/js/app.js POLL_MS), for the AI page. */
const APP_REFRESH_SECONDS = 15;
// Agent responses carry the secret id in links and act on GET: never cache or index them.
const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex" };

export interface HandlerOptions {
  /** Public API base for absolute links, e.g. https://<project>.supabase.co/functions/v1/api.
   * Default: derived from the request URL. */
  publicBase?: string;
}

export function createHandler(store: Store, options: HandlerOptions = {}) {
  function checkToken(token: string) {
    if (!TOKEN_RE.test(token)) throw new HttpError(404, "Session not found");
  }

  async function loadSession(token: string, write: boolean): Promise<SessionRow> {
    checkToken(token);
    const session = await store.findSession(token);
    if (!session) throw new HttpError(404, "Session not found");
    if (write && session.id !== token) {
      throw new HttpError(403, "This is a read-only link");
    }
    return session;
  }

  /**
   * Loads the session and runs `query` for its id. The query starts alongside the
   * lookup on the guess that the token is the edit id (always true for writes); for
   * a read-only id the guess is dropped and the query runs again with the real id.
   */
  async function loadWith<T>(
    token: string,
    write: boolean,
    query: (sessionId: string) => Promise<T>,
  ): Promise<[SessionRow, T]> {
    checkToken(token);
    const guess = query(token);
    guess.catch(() => {}); // a dropped guess must not end up as an unhandled rejection
    const session = await loadSession(token, write);
    return [session, session.id === token ? await guess : await query(session.id)];
  }

  function listAll(sessionId: string, { from, to }: Range) {
    return Promise.all([
      store.listTypes(sessionId),
      store.listEntries(sessionId, from, to),
      store.listNotes(sessionId, from, to),
    ]);
  }

  function publicBase(url: URL): string {
    if (options.publicBase) return options.publicBase.replace(/\/+$/, "");
    const prefix = /^(\/functions\/v1)?\/api(?=\/|$)/.exec(url.pathname)?.[0] ?? "";
    return url.origin + prefix;
  }

  /**
   * GET /sessions/{id}/agent/<path>?method=POST&body=<json> runs <method> /sessions/{id}/<path>
   * with that body, for AI assistants whose tools can only open URLs. Other query parameters
   * are passed on. Writes still need the edit id.
   */
  function agentRequest(url: URL): Request {
    const method = (url.searchParams.get("method") ?? "GET").toUpperCase();
    if (!AGENT_METHODS.includes(method)) {
      throw new HttpError(400, `method must be one of ${AGENT_METHODS.join(", ")}`);
    }
    const body = url.searchParams.get("body") ?? undefined;
    if (body !== undefined && (method === "GET" || method === "DELETE")) {
      throw new HttpError(400, `${method} takes no body`);
    }
    const target = new URL(url);
    target.pathname = url.pathname.replace(/(\/sessions\/[^/]+)\/agent(?=\/|$)/, "$1");
    target.searchParams.delete("method");
    target.searchParams.delete("body");
    return new Request(target, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body,
    });
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Strip the function prefix: /functions/v1/api/... or /api/...
    const path = url.pathname.replace(/^(\/functions\/v1)?\/api(?=\/|$)/, "")
      .replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const method = req.method;

    if (parts.length === 0 && method === "GET") {
      return json({
        name: "vacation-planner API",
        docs: "https://github.com/SaschaKrug/vacation-planner#api",
      });
    }
    if (parts[0] !== "sessions") throw new HttpError(404, "Not found");

    if (parts.length === 1) {
      if (method !== "POST") throw new HttpError(405, "Method not allowed");
      rangeFromQuery(url); // validates the query even though a new session has no entries
      const body = await readBody(req);
      const lang = cleanLang(body.lang);
      const year = body.year === undefined ? currentYear() : cleanYear(body.year);
      const name = body.name === undefined ? DEFAULT_SESSION_NAME[lang] : cleanName(body.name);
      const now = new Date().toISOString();
      const session: SessionRow = {
        id: randomToken(20),
        read_id: randomToken(20),
        name,
        created_at: now,
        updated_at: now,
      };
      let presets = PRESET_TYPES.map((t) => ({ ...t, name: PRESET_NAMES[lang][t.id] }));
      if (body.types !== undefined) {
        if (!Array.isArray(body.types)) throw new HttpError(400, "types must be an array");
        const taken = new Set<string>();
        presets = body.types.slice(0, MAX_TYPES).map((t: Record<string, unknown>) => {
          const n = cleanName(t?.name);
          const id = uniqueId(slug(n), taken);
          taken.add(id);
          return { id, name: n, color: cleanColor(t.color), role: cleanRole(t.role) };
        });
      }
      const types = presets.map((t, i) => ({ ...t, session_id: session.id, year, position: i }));
      await store.createSession(session, types);
      return json(sessionState(session, session.id, types, {}, [], []), 201);
    }

    const token = parts[1];
    const sub = parts[2];

    if (sub === "agent") {
      if (method !== "GET") throw new HttpError(405, "Method not allowed");
      if (parts.length > 3 || url.searchParams.has("method")) {
        const res = await route(agentRequest(url));
        for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
        return res;
      }
      const [session, types] = await loadWith(token, false, (id) => store.listTypes(id));
      const doc = buildAgentDoc({
        base: publicBase(url),
        token,
        session,
        types,
        today: formatDate(new Date()),
        refreshSeconds: APP_REFRESH_SECONDS,
      });
      return new Response(doc, {
        headers: { ...CORS, ...NO_STORE, "content-type": "text/markdown; charset=utf-8" },
      });
    }

    if (parts.length === 2) {
      const range = rangeFromQuery(url);
      if (method === "GET") {
        const [session, [types, rows, notes]] = await loadWith(
          token,
          false,
          (id) => listAll(id, range),
        );
        return json(sessionState(session, token, types, range, rows, notes));
      }
      if (method === "PATCH") {
        const [session, [types, rows, notes]] = await loadWith(
          token,
          true,
          (id) => listAll(id, range),
        );
        const name = cleanName((await readBody(req)).name);
        await store.updateSession(session.id, { name });
        const updated = { ...session, name, updated_at: new Date().toISOString() };
        return json(sessionState(updated, token, types, range, rows, notes));
      }
      throw new HttpError(405, "Method not allowed");
    }

    if (sub === "calendar.ics" && parts.length === 3 && method === "GET") {
      const session = await loadSession(token, false);
      const withNotes = url.searchParams.get("notes") === "1";
      const [types, rows, notes] = await Promise.all([
        store.listTypes(session.id),
        store.listEntries(session.id),
        withNotes ? store.listNotes(session.id) : undefined,
      ]);
      const entries = new Map<string, string[]>();
      for (const r of rows) {
        const list = entries.get(r.day) ?? [];
        list.push(r.type_id);
        entries.set(r.day, list);
      }
      // A filter matches types by id or name in every year.
      const typesParam = url.searchParams.get("types");
      const include = typesParam ? new Set<TypeRow>() : undefined;
      for (const ref of typesParam?.split(",").filter(Boolean) ?? []) {
        const matches = types.filter((t) =>
          t.id === ref || t.name.toLowerCase() === ref.trim().toLowerCase()
        );
        if (!matches.length) throw new HttpError(404, `Unknown entry type "${ref}"`);
        for (const t of matches) include!.add(t);
      }
      const ics = buildIcs({
        calendarName: url.searchParams.get("name") || session.name,
        uidPrefix: session.read_id,
        types,
        entries,
        include,
        gaps: url.searchParams.get("gaps") === "1",
        notes: notes && new Map(notes.map((n) => [n.day, n])),
        lang: url.searchParams.get("lang") === "de" ? "de" : "en",
      });
      return new Response(ics, {
        headers: {
          ...CORS,
          "content-type": "text/calendar; charset=utf-8",
          "content-disposition": 'inline; filename="calendar.ics"',
          "cache-control": "max-age=300",
        },
      });
    }

    if (sub === "types") {
      const write = !(parts.length === 3 && method === "GET");
      const [session, all] = await loadWith(token, write, (id) => store.listTypes(id));
      const body = write ? await readBody(req) : {};

      if (parts.length === 4 && parts[3] === "copy" && method === "POST") {
        // Copies a year's types into another year; types the target already has are kept.
        const from = cleanYear(body.from, "from");
        const to = cleanYear(body.to, "to");
        const source = all.filter((t) => t.year === from);
        if (!source.length) throw new HttpError(404, `${from} has no entry types`);
        const target = all.filter((t) => t.year === to);
        const taken = new Set(target.map((t) => t.id));
        let position = target.reduce((m, t) => Math.max(m, t.position + 1), 0);
        const copies = source.filter((t) => !taken.has(t.id))
          .slice(0, Math.max(0, MAX_TYPES - target.length))
          .map((t) => ({ ...t, year: to, position: position++ }));
        await store.upsertTypes(copies);
        return json([...target, ...copies].map(publicType));
      }

      const year = typesYear(url, body);
      const types = all.filter((t) => t.year === year);
      if (!write) return json(types.map(publicType));

      if (parts.length === 3 && method === "POST") {
        if (types.length >= MAX_TYPES) throw new HttpError(400, "Too many entry types");
        const name = cleanName(body.name);
        const type: TypeRow = {
          session_id: session.id,
          year,
          id: uniqueId(slug(name), new Set(types.map((t) => t.id))),
          name,
          color: cleanColor(body.color),
          role: cleanRole(body.role),
          position: types.reduce((m, t) => Math.max(m, t.position + 1), 0),
        };
        await store.upsertTypes([type]);
        return json(publicType(type), 201);
      }

      if (parts.length === 4) {
        const type = resolveType(types, parts[3], year);
        if (method === "PATCH") {
          const next = { ...type };
          if (body.name !== undefined) next.name = cleanName(body.name);
          if (body.color !== undefined) next.color = cleanColor(body.color);
          if (body.role !== undefined) next.role = cleanRole(body.role);
          if (body.position !== undefined) {
            if (!Number.isInteger(body.position)) {
              throw new HttpError(400, "position must be an integer");
            }
            next.position = body.position as number;
          }
          await store.upsertTypes([next]);
          return json(publicType(next));
        }
        if (method === "DELETE") {
          await store.deleteType(session.id, year, type.id);
          return json({ deleted: type.id, year });
        }
      }
      throw new HttpError(405, "Method not allowed");
    }

    if (sub === "entries" && parts.length === 3) {
      if (method === "GET") {
        const { from, to } = rangeFromQuery(url);
        const [, rows] = await loadWith(token, false, (id) => store.listEntries(id, from, to));
        return json(groupEntries(rows));
      }
      if (method === "POST") {
        const [session, types] = await loadWith(token, true, (id) => store.listTypes(id));
        const { ops, total } = parseOps(await readBody(req), (o) => parseOp(o, types));

        for (const { action, byYear } of ops) {
          for (const { types, days } of byYear) {
            if (action === "clear" || action === "set") {
              await store.removeEntries(session.id, days);
            } else if (action === "remove") {
              await store.removeEntries(session.id, days, types);
            }
            if ((action === "add" || action === "set") && types.length) {
              await store.addEntries(
                session.id,
                days.flatMap((day) => types.map((type_id) => ({ day, type_id }))),
              );
            }
          }
        }
        return json({ ok: true, ops: ops.length, days: total });
      }
    }

    if (sub === "notes" && parts.length === 3) {
      if (method === "GET") {
        const { from, to } = rangeFromQuery(url);
        const [, rows] = await loadWith(token, false, (id) => store.listNotes(id, from, to));
        return json(notesMap(rows));
      }
      if (method === "POST") {
        const session = await loadSession(token, true);
        const { ops, total } = parseOps(await readBody(req), parseNoteOp);
        for (const { icon, comment, days } of ops) {
          if (icon || comment) {
            await store.upsertNotes(session.id, days.map((day) => ({ day, icon, comment })));
          } else {
            await store.removeNotes(session.id, days);
          }
        }
        return json({ ok: true, ops: ops.length, days: total });
      }
    }

    throw new HttpError(404, "Not found");
  }

  return async function handler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      return await route(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Internal error" }, 500);
    }
  };
}
