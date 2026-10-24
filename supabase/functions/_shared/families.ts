// Families: create, read, rename, clone, export / import, rotate links, and the page for AI
// agents. The calendar itself is in vacation.ts.

import { buildAgentDoc } from "./agent.ts";
import type { Ctx, Loaded } from "./context.ts";
import { formatDate } from "./dates.ts";
import {
  cleanLang,
  cleanName,
  cleanYear,
  CORS,
  currentYear,
  HttpError,
  json,
  NO_STORE,
  randomToken,
  readBody,
  slug,
} from "./http.ts";
import type { Lang } from "./ics.ts";
import type { FamilyPatch, FamilyRow, Store } from "./store.ts";
import {
  groupEntries,
  listVacation,
  newFamilyTypes,
  notesMap,
  parseVacationImport,
  publicType,
  type Range,
  rangeFromQuery,
  type VacationData,
  vacationState,
} from "./vacation.ts";

const DEFAULT_NAME: Record<Lang, string> = { en: "Family", de: "Familie" };

/** Marks the JSON of GET /families/{id}/export, which POST /families/{id}/import reads back. */
const EXPORT_FORMAT = "family-planner";
/** Files exported before the rename; same content. */
const OLD_EXPORT_FORMAT = "vacation-planner";
const EXPORT_VERSION = 1;

/** How often the web app refreshes an open family (web/js/app.js POLL_MS), for the AI page. */
const APP_REFRESH_SECONDS = 15;

/** Links that rotate: the view link, the feed link, and the legacy link (only removed). */
const LINKS = ["view", "feed", "legacy"] as const;

function newFamilyRow(name: string): FamilyRow {
  const now = new Date().toISOString();
  return {
    id: randomToken(20),
    read_id: randomToken(20),
    feed_id: randomToken(20),
    legacy_id: null,
    name,
    created_at: now,
    updated_at: now,
  };
}

/** Default name of a cloned family, kept within the 80 characters of a name. */
function copyName(name: string): string {
  return `${name.slice(0, 73)} (copy)`;
}

/** The family as the app sees it: only the links the token may know about. */
function publicFamily({ family, access }: Loaded) {
  return {
    ...(access === "edit" ? { id: family.id } : {}),
    ...(access === "edit" || access === "view" ? { readId: family.read_id } : {}),
    feedId: family.feed_id,
    ...(access === "edit" && family.legacy_id ? { legacyId: family.legacy_id } : {}),
    name: family.name,
    access,
    readOnly: access !== "edit",
    updatedAt: family.updated_at,
  };
}

/** GET /families/{id}: the family and its calendar in the range. */
function familyState(loaded: Loaded, range: Range, data: VacationData) {
  const family = publicFamily(loaded);
  // "session" is the name from before families, kept for scripts that read it.
  return { family, session: family, ...vacationState(range, data) };
}

/** The whole family as a file: all years, types, entries and notes, but never its ids. */
function exportData(family: FamilyRow, [types, rows, notes]: VacationData) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    name: family.name,
    types: types.map(publicType),
    entries: groupEntries(rows),
    notes: notesMap(notes),
  };
}

function parseImport(body: Record<string, unknown>) {
  if (body.format !== EXPORT_FORMAT && body.format !== OLD_EXPORT_FORMAT) {
    throw new HttpError(400, "Not a Family Planner export");
  }
  if (body.version !== EXPORT_VERSION) {
    throw new HttpError(400, `Unsupported export version ${body.version}`);
  }
  return parseVacationImport(body);
}

/** POST /families: a new family with the presets (or the body's types) in one year. */
export async function createFamily(store: Store, req: Request, url: URL): Promise<Response> {
  rangeFromQuery(url); // validates the query even though a new family has no entries
  const body = await readBody(req);
  const lang = cleanLang(body.lang);
  const year = body.year === undefined ? currentYear() : cleanYear(body.year);
  const name = body.name === undefined ? DEFAULT_NAME[lang] : cleanName(body.name);
  const family = newFamilyRow(name);
  const types = newFamilyTypes(body.types, lang)
    .map((t, i) => ({ ...t, family_id: family.id, year, position: i }));
  await store.createFamily(family, types);
  return json(familyState({ family, access: "edit" }, {}, [types, [], []]), 201);
}

/** Routes /families/{id} and its family-wide sub-paths; null for anything else. */
export function handleFamily(ctx: Ctx): Promise<Response> | null {
  const { rest, method } = ctx;
  if (rest.length === 0) {
    if (method === "GET") return read(ctx);
    if (method === "PATCH") return rename(ctx);
    return Promise.reject(new HttpError(405, "Method not allowed"));
  }
  if (rest.length > 1) return null;
  const route = {
    agent: { GET: agent },
    clone: { POST: clone },
    export: { GET: exportFamily },
    import: { POST: importFamily },
    links: { POST: rotateLink },
  }[rest[0]] as Record<string, (ctx: Ctx) => Promise<Response>> | undefined;
  if (!route) return null;
  const fn = route[method];
  return fn ? fn(ctx) : Promise.reject(new HttpError(405, "Method not allowed"));
}

async function read({ store, url, loadWith }: Ctx): Promise<Response> {
  const range = rangeFromQuery(url);
  const [loaded, data] = await loadWith("calendar", (id) => listVacation(store, id, range));
  return json(familyState(loaded, range, data));
}

async function rename({ store, req, url, loadWith }: Ctx): Promise<Response> {
  const range = rangeFromQuery(url);
  const [loaded, data] = await loadWith("edit", (id) => listVacation(store, id, range));
  const name = cleanName((await readBody(req)).name);
  await store.updateFamily(loaded.family.id, { name });
  const family = { ...loaded.family, name, updated_at: new Date().toISOString() };
  return json(familyState({ ...loaded, family }, range, data));
}

/** POST /families/{id}/links {"link": "view" | "feed" | "legacy"}: a new view or feed id (the
 *  old one stops working), or removes the legacy view link. Answers like GET. */
async function rotateLink({ store, req, url, loadWith }: Ctx): Promise<Response> {
  const range = rangeFromQuery(url);
  const [loaded, data] = await loadWith("edit", (id) => listVacation(store, id, range));
  const link = (await readBody(req)).link;
  if (!LINKS.includes(link as typeof LINKS[number])) {
    throw new HttpError(400, `link must be one of ${LINKS.join(", ")}`);
  }
  const patch: FamilyPatch = link === "view"
    ? { read_id: randomToken(20) }
    : link === "feed"
    ? { feed_id: randomToken(20) }
    : { legacy_id: null };
  await store.updateFamily(loaded.family.id, patch);
  const family = { ...loaded.family, ...patch, updated_at: new Date().toISOString() };
  return json(familyState({ ...loaded, family }, range, data));
}

async function agent({ store, token, publicBase, loadWith }: Ctx): Promise<Response> {
  const [{ family, access }, types] = await loadWith("calendar", (id) => store.listTypes(id));
  const doc = buildAgentDoc({
    base: publicBase,
    token,
    readOnly: access !== "edit",
    family,
    types,
    today: formatDate(new Date()),
    refreshSeconds: APP_REFRESH_SECONDS,
  });
  return new Response(doc, {
    headers: { ...CORS, ...NO_STORE, "content-type": "text/markdown; charset=utf-8" },
  });
}

/** A new family with its own ids and a copy of all types, entries and notes. Read-only links
 *  may clone too: they can read all of that anyway. */
async function clone({ store, req, loadWith }: Ctx): Promise<Response> {
  const body = await readBody(req);
  const [{ family: source }, [types, rows, notes]] = await loadWith(
    "calendar",
    (id) => listVacation(store, id, {}),
  );
  const family = newFamilyRow(
    body.name === undefined ? copyName(source.name) : cleanName(body.name),
  );
  const copies = types.map((t) => ({ ...t, family_id: family.id }));
  await store.createFamily(family, copies);
  await store.addEntries(family.id, rows);
  await store.upsertNotes(family.id, notes);
  return json(familyState({ family, access: "edit" }, {}, [copies, rows, notes]), 201);
}

/** Read-only links may export too: they can read all of that anyway. */
async function exportFamily({ store, loadWith }: Ctx): Promise<Response> {
  const [{ family }, data] = await loadWith("calendar", (id) => listVacation(store, id, {}));
  return json(exportData(family, data), 200, {
    ...NO_STORE,
    "content-disposition": `attachment; filename="${slug(family.name)}.json"`,
  });
}

/** Replaces all years, types, entries and notes with those of an export file; the name and
 *  the links stay. Answers like GET /families/{id} (with ?year= etc.). */
async function importFamily({ store, req, url, load }: Ctx): Promise<Response> {
  const range = rangeFromQuery(url);
  const loaded = await load("edit");
  const { family } = loaded;
  const data = parseImport(await readBody(req));
  const types = data.types.map((t) => ({ ...t, family_id: family.id }));
  await store.replaceContents(family.id, types, data.entries, data.notes);
  const updated = { ...family, updated_at: new Date().toISOString() };
  return json(
    familyState({ ...loaded, family: updated }, range, await listVacation(store, family.id, range)),
  );
}
