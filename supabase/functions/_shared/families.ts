// Families: create, read, rename, clone, export / import, rotate links, members, and the page
// for AI agents. The calendar itself is in vacation.ts.

import { buildAgentDoc } from "./agent.ts";
import { cleanEmail, publicUser } from "./auth.ts";
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
import { copyFinance, defaultCategories, exportFinance, parseFinanceImport } from "./finance.ts";
import {
  type FamilyPatch,
  type FamilyRow,
  MEMBER_ROLES,
  type MemberRole,
  type Store,
  type TypeRow,
} from "./store.ts";
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
/** 2 adds the finances; files of version 1 only have the calendar. */
const EXPORT_VERSION = 2;

/** How often the app refreshes an open family (POLL_MS in app/src/features/vacation/store.ts),
 *  for the AI page. */
const APP_REFRESH_SECONDS = 15;

/** Links that rotate: the feed link, and the legacy link (only removed). */
const LINKS = ["feed", "legacy"] as const;

function newFamilyRow(name: string): FamilyRow {
  const now = new Date().toISOString();
  return {
    id: randomToken(20),
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

/** The family as the app sees it. */
function publicFamily({ family, access }: Loaded) {
  return {
    id: family.id,
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

/** The whole family as a file: all years, types, entries and notes, and the finances, but
 *  never its ids. */
function exportData(
  family: FamilyRow,
  [types, rows, notes]: VacationData,
  finance: Awaited<ReturnType<typeof exportFinance>>,
) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    name: family.name,
    types: types.map(publicType),
    entries: groupEntries(rows),
    notes: notesMap(notes),
    finance,
  };
}

/** A file without finances (version 1, or exported with the legacy link of old) leaves them
 *  as they are. */
function parseImport(body: Record<string, unknown>, familyId: string) {
  if (body.format !== EXPORT_FORMAT && body.format !== OLD_EXPORT_FORMAT) {
    throw new HttpError(400, "Not a Family Planner export");
  }
  if (body.version !== 1 && body.version !== EXPORT_VERSION) {
    throw new HttpError(400, `Unsupported export version ${body.version}`);
  }
  return {
    ...parseVacationImport(body),
    finance: body.finance === undefined ? undefined : parseFinanceImport(body.finance, familyId),
  };
}

/** A new family with the presets (or the given types) in one year, and the default finance
 *  categories; `editor` becomes its first member. Body: {name, lang, year, types}. */
export async function makeFamily(
  store: Store,
  body: Record<string, unknown>,
  editor?: string,
): Promise<[FamilyRow, TypeRow[]]> {
  const lang = cleanLang(body.lang);
  const year = body.year === undefined ? currentYear() : cleanYear(body.year);
  const name = body.name === undefined ? DEFAULT_NAME[lang] : cleanName(body.name);
  const family = newFamilyRow(name);
  const types = newFamilyTypes(body.types, lang)
    .map((t, i) => ({ ...t, family_id: family.id, year, position: i }));
  await store.createFamily(family, types);
  await store.upsertCategories(defaultCategories(family.id, lang));
  if (editor) await addMember(store, family.id, editor, "editor");
  return [family, types];
}

export function addMember(store: Store, familyId: string, userId: string, role: MemberRole) {
  return store.setMember({
    family_id: familyId,
    user_id: userId,
    role,
    created_at: new Date().toISOString(),
  });
}

/** POST /families: a new family with the signed-in user as its editor. */
export async function createFamily(ctx: Ctx): Promise<Response> {
  const { user } = ctx.requireUser();
  rangeFromQuery(ctx.url); // validates the query even though a new family has no entries
  const [family, types] = await makeFamily(ctx.store, await readBody(ctx.req), user.id);
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
  if (rest[0] === "members") return members(ctx);
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
  const [loaded, data] = await loadWith("view", (id) => listVacation(store, id, range));
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

/** POST /families/{id}/links {"link": "feed" | "legacy"}: a new feed id (the old one stops
 *  working), or removes the legacy link (the calendar feed of a planner from before families).
 *  Answers like GET. */
async function rotateLink({ store, req, url, loadWith }: Ctx): Promise<Response> {
  const range = rangeFromQuery(url);
  const [loaded, data] = await loadWith("edit", (id) => listVacation(store, id, range));
  const link = (await readBody(req)).link;
  if (!LINKS.includes(link as typeof LINKS[number])) {
    throw new HttpError(400, `link must be one of ${LINKS.join(", ")}`);
  }
  const patch: FamilyPatch = link === "feed" ? { feed_id: randomToken(20) } : { legacy_id: null };
  await store.updateFamily(loaded.family.id, patch);
  const family = { ...loaded.family, ...patch, updated_at: new Date().toISOString() };
  return json(familyState({ ...loaded, family }, range, data));
}

async function agent({ store, publicBase, loadWith }: Ctx): Promise<Response> {
  const [{ family, access }, types] = await loadWith("view", (id) => store.listTypes(id));
  const doc = buildAgentDoc({
    base: publicBase,
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

/** A new family with its own ids and a copy of everything, with the user as its editor.
 *  Viewers may clone too: they can read all of that anyway. */
async function clone({ store, req, loadWith, requireUser }: Ctx): Promise<Response> {
  const { user } = requireUser();
  const body = await readBody(req);
  const [loaded, [types, rows, notes]] = await loadWith(
    "view",
    (id) => listVacation(store, id, {}),
  );
  const source = loaded.family;
  const family = newFamilyRow(
    body.name === undefined ? copyName(source.name) : cleanName(body.name),
  );
  const copies = types.map((t) => ({ ...t, family_id: family.id }));
  await store.createFamily(family, copies);
  await store.addEntries(family.id, rows);
  await store.upsertNotes(family.id, notes);
  await copyFinance(store, source.id, family.id);
  await addMember(store, family.id, user.id, "editor");
  return json(familyState({ family, access: "edit" }, {}, [copies, rows, notes]), 201);
}

/** Viewers may export too: they can read all of that anyway. */
async function exportFamily({ store, loadWith }: Ctx): Promise<Response> {
  const [{ family }, data] = await loadWith("view", (id) => listVacation(store, id, {}));
  return json(exportData(family, data, await exportFinance(store, family.id)), 200, {
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
  const data = parseImport(await readBody(req), family.id);
  const types = data.types.map((t) => ({ ...t, family_id: family.id }));
  await store.replaceContents(family.id, types, data.entries, data.notes, data.finance);
  const updated = { ...family, updated_at: new Date().toISOString() };
  return json(
    familyState({ ...loaded, family: updated }, range, await listVacation(store, family.id, range)),
  );
}

/** The members of a family, editors first, with who is asking marked. */
export async function memberList(store: Store, familyId: string, you?: string) {
  const members = await store.listMembers({ familyId });
  const users = await Promise.all(members.map((m) => store.getUser(m.user_id)));
  return members.flatMap((m, i) => {
    const user = users[i];
    if (!user) return [];
    const { id, email, name } = publicUser(user);
    return [{ userId: id, email, name, role: m.role, ...(you ? { you: id === you } : {}) }];
  }).sort((a, b) =>
    Number(a.role !== "editor") - Number(b.role !== "editor") || a.email.localeCompare(b.email)
  );
}

export function cleanRole(v: unknown): MemberRole {
  if (!MEMBER_ROLES.includes(v as MemberRole)) {
    throw new HttpError(400, `role must be one of ${MEMBER_ROLES.join(", ")}`);
  }
  return v as MemberRole;
}

/**
 * /families/{id}/members: everyone sees the members; editors add people (by the email of their
 * account), change roles and remove members; everyone may leave. A family keeps at least one
 * editor (an admin can still change that in the administration).
 *
 * - GET  /members
 * - POST /members {email, role}
 * - PATCH /members/{userId} {role}
 * - DELETE /members/{userId}
 */
async function members(ctx: Ctx): Promise<Response> {
  const { store, req, method, rest } = ctx;
  const { user } = ctx.requireUser();
  if (rest.length === 1 && method === "GET") {
    const { family } = await ctx.load("view");
    return json(await memberList(store, family.id, user.id));
  }
  const target = rest[1];
  if (rest.length === 2 && method === "DELETE" && target === user.id) {
    // Leaving: no editor rights needed.
    const { family, access } = await ctx.load("view");
    if (access === "edit") await keepAnEditor(store, family.id, user.id);
    await store.removeMember(family.id, user.id);
    return json(await memberList(store, family.id, user.id));
  }
  const { family } = await ctx.load("edit");
  if (rest.length === 1 && method === "POST") {
    const body = await readBody(req);
    const email = cleanEmail(body.email);
    const role = body.role === undefined ? "editor" : cleanRole(body.role);
    const other = await store.findUserByEmail(email);
    if (!other) throw new HttpError(404, "There is no account with this email: ask an admin");
    await addMember(store, family.id, other.id, role);
    return json(await memberList(store, family.id, user.id), 201);
  }
  if (rest.length !== 2) throw new HttpError(404, "Not found");
  const current = (await store.listMembers({ familyId: family.id }))
    .find((m) => m.user_id === target);
  if (!current) throw new HttpError(404, "Not a member of this family");
  if (method === "PATCH") {
    const role = cleanRole((await readBody(req)).role);
    if (role !== "editor") await keepAnEditor(store, family.id, target);
    await store.setMember({ ...current, role });
  } else if (method === "DELETE") {
    await keepAnEditor(store, family.id, target);
    await store.removeMember(family.id, target);
  } else throw new HttpError(405, "Method not allowed");
  return json(await memberList(store, family.id, user.id));
}

/** 400 if `userId` is the family's only editor. */
async function keepAnEditor(store: Store, familyId: string, userId: string) {
  const editors = (await store.listMembers({ familyId })).filter((m) => m.role === "editor");
  if (editors.length === 1 && editors[0].user_id === userId) {
    throw new HttpError(400, "A family needs at least one editor");
  }
}
