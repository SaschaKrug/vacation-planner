// Finances: categories, a transactions log (entered by hand or imported from bank CSV files)
// and summaries per month and category. Amounts are integer cents, negative for money going
// out. Reading needs the view link, changing the edit link.

import type { Ctx } from "./context.ts";
import { isValidDate } from "./dates.ts";
import { cleanName, HttpError, json, objectOf, readBody, slug } from "./http.ts";
import type { Lang } from "./ics.ts";
import {
  CATEGORY_KINDS,
  type CategoryKind,
  type CategoryRow,
  type FinanceContents,
  type FinanceSettingsRow,
  type Store,
  type TransactionRow,
} from "./store.ts";

export const MAX_CATEGORIES = 100;
const MAX_OPS = 2000;
const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_TRANSACTIONS = 100_000; // in an export file
const MAX_AMOUNT = 100_000_000_000_000; // cents
const MAX_LIST = 1000;
const MAX_MAPPINGS = 20;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CATEGORY_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

const DEFAULT_CATEGORIES: {
  id: string;
  icon: string;
  color: string;
  kind: CategoryKind;
  name: Record<Lang, string>;
}[] = [
  {
    id: "salary",
    icon: "💼",
    color: "#22c55e",
    kind: "income",
    name: { en: "Salary", de: "Gehalt" },
  },
  {
    id: "other-income",
    icon: "💰",
    color: "#14b8a6",
    kind: "income",
    name: { en: "Other income", de: "Sonstige Einnahmen" },
  },
  {
    id: "groceries",
    icon: "🛒",
    color: "#f97316",
    kind: "expense",
    name: { en: "Groceries", de: "Lebensmittel" },
  },
  {
    id: "housing",
    icon: "🏠",
    color: "#8b5cf6",
    kind: "expense",
    name: { en: "Housing", de: "Wohnen" },
  },
  {
    id: "utilities",
    icon: "💡",
    color: "#eab308",
    kind: "expense",
    name: { en: "Utilities", de: "Nebenkosten" },
  },
  {
    id: "mobility",
    icon: "🚗",
    color: "#3b82f6",
    kind: "expense",
    name: { en: "Mobility", de: "Mobilität" },
  },
  {
    id: "insurance",
    icon: "🛡️",
    color: "#64748b",
    kind: "expense",
    name: { en: "Insurance", de: "Versicherungen" },
  },
  {
    id: "health",
    icon: "🩺",
    color: "#ef4444",
    kind: "expense",
    name: { en: "Health", de: "Gesundheit" },
  },
  { id: "kids", icon: "🧸", color: "#ec4899", kind: "expense", name: { en: "Kids", de: "Kinder" } },
  {
    id: "leisure",
    icon: "🎉",
    color: "#a855f7",
    kind: "expense",
    name: { en: "Leisure", de: "Freizeit" },
  },
  {
    id: "vacation",
    icon: "🏖️",
    color: "#06b6d4",
    kind: "expense",
    name: { en: "Vacation", de: "Urlaub" },
  },
  {
    id: "shopping",
    icon: "🛍️",
    color: "#84cc16",
    kind: "expense",
    name: { en: "Shopping", de: "Einkäufe" },
  },
  {
    id: "other",
    icon: "📦",
    color: "#94a3b8",
    kind: "both",
    name: { en: "Other", de: "Sonstiges" },
  },
];

export function defaultCategories(familyId: string, lang: Lang): CategoryRow[] {
  return DEFAULT_CATEGORIES.map((c, position) => ({
    family_id: familyId,
    id: c.id,
    name: c.name[lang],
    color: c.color,
    icon: c.icon,
    kind: c.kind,
    position,
  }));
}

// ------------------------------------------------------------------ validation

function text(v: unknown, field: string, max: number): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new HttpError(400, `${field} must be a string`);
  const s = v.trim();
  if (s.length > max) throw new HttpError(400, `${field} is too long (max. ${max})`);
  return s;
}

function cleanColor(v: unknown): string {
  if (typeof v !== "string" || !COLOR_RE.test(v)) {
    throw new HttpError(400, "color must look like #22c55e");
  }
  return v.toLowerCase();
}

function cleanKind(v: unknown): CategoryKind {
  if (v === undefined) return "expense";
  if (!CATEGORY_KINDS.includes(v as CategoryKind)) {
    throw new HttpError(400, `kind must be one of ${CATEGORY_KINDS.join(", ")}`);
  }
  return v as CategoryKind;
}

function cleanDate(v: unknown, field = "date"): string {
  if (!isValidDate(v)) throw new HttpError(400, `${field} must be YYYY-MM-DD`);
  return v as string;
}

function cleanAmount(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || Math.abs(v) > MAX_AMOUNT) {
    throw new HttpError(400, "amountCents must be a whole number of cents");
  }
  return v;
}

function cleanCurrency(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Z]{3}$/.test(v)) {
    throw new HttpError(400, "currency must be an ISO 4217 code like EUR");
  }
  return v;
}

/** A category reference by id or (case-insensitive) name; null / "" clears it. */
function resolveCategory(categories: CategoryRow[], ref: unknown): string | null {
  if (ref === null || ref === "" || ref === undefined) return null;
  if (typeof ref !== "string") throw new HttpError(400, "categoryId must be a string");
  const c = categories.find((c) => c.id === ref) ??
    categories.find((c) => c.name.toLowerCase() === ref.trim().toLowerCase());
  if (!c) throw new HttpError(404, `Unknown category "${ref}"`);
  return c.id;
}

/** A category by id or (case-insensitive) name. */
export function findCategory(categories: CategoryRow[], ref: unknown): CategoryRow {
  const id = resolveCategory(categories, ref);
  const c = categories.find((c) => c.id === id);
  if (!c) throw new HttpError(404, `Unknown category "${ref}"`);
  return c;
}

/** A new category from {name, color, icon, kind}, added after the family's others. */
export function newCategory(
  familyId: string,
  categories: CategoryRow[],
  body: Record<string, unknown>,
): CategoryRow {
  if (categories.length >= MAX_CATEGORIES) throw new HttpError(400, "Too many categories");
  const name = cleanName(body.name);
  return {
    family_id: familyId,
    id: uniqueId(slug(name), new Set(categories.map((c) => c.id))),
    name,
    color: cleanColor(body.color),
    icon: text(body.icon, "icon", 16),
    kind: cleanKind(body.kind),
    position: categories.reduce((m, c) => Math.max(m, c.position + 1), 0),
  };
}

/** The category with any of {name, color, icon, kind, position} changed. */
export function changedCategory(current: CategoryRow, body: Record<string, unknown>): CategoryRow {
  const next = { ...current };
  if (body.name !== undefined) next.name = cleanName(body.name);
  if (body.color !== undefined) next.color = cleanColor(body.color);
  if (body.icon !== undefined) next.icon = text(body.icon, "icon", 16);
  if (body.kind !== undefined) next.kind = cleanKind(body.kind);
  if (body.position !== undefined) {
    if (!Number.isInteger(body.position)) {
      throw new HttpError(400, "position must be an integer");
    }
    next.position = body.position as number;
  }
  return next;
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base || "category";
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

// ------------------------------------------------------------------ public shapes

export function publicCategory(c: CategoryRow) {
  return {
    id: c.id,
    name: c.name,
    color: c.color,
    icon: c.icon,
    kind: c.kind,
    position: c.position,
  };
}

export function publicTransaction(t: TransactionRow) {
  return {
    id: t.id,
    date: t.day,
    amountCents: t.amount_cents,
    payee: t.payee,
    description: t.description,
    categoryId: t.category_id,
    note: t.note,
    imported: !!t.import_hash,
  };
}

function settingsOf(familyId: string, row: FinanceSettingsRow | null): FinanceSettingsRow {
  return row ?? { family_id: familyId, currency: "EUR", csv_mappings: [] };
}

// ------------------------------------------------------------------ export / import

/** The finances for an export file. */
export async function exportFinance(store: Store, familyId: string) {
  const [settings, categories, transactions] = await Promise.all([
    store.getFinanceSettings(familyId),
    store.listCategories(familyId),
    store.listTransactions(familyId),
  ]);
  return {
    currency: settingsOf(familyId, settings).currency,
    categories: categories.map(publicCategory),
    transactions: transactions.map((t) => ({
      ...publicTransaction(t),
      importHash: t.import_hash,
    })),
  };
}

/** Validates the finances of an export file; the rows get `familyId`. */
export function parseFinanceImport(raw: unknown, familyId: string): FinanceContents {
  const f = objectOf(raw, "finance");
  if (!Array.isArray(f.categories)) throw new HttpError(400, "finance.categories must be an array");
  if (!Array.isArray(f.transactions)) {
    throw new HttpError(400, "finance.transactions must be an array");
  }
  if (f.categories.length > MAX_CATEGORIES) throw new HttpError(400, "Too many categories");
  if (f.transactions.length > MAX_IMPORT_TRANSACTIONS) {
    throw new HttpError(400, "Too many transactions");
  }
  const ids = new Set<string>();
  const categories = f.categories.map((raw: unknown, i: number): CategoryRow => {
    const c = objectOf(raw, "Each category");
    if (typeof c.id !== "string" || !CATEGORY_ID_RE.test(c.id) || ids.has(c.id)) {
      throw new HttpError(400, `Invalid category id "${c.id}"`);
    }
    ids.add(c.id);
    return {
      family_id: familyId,
      id: c.id,
      name: cleanName(c.name),
      color: cleanColor(c.color),
      icon: text(c.icon, "icon", 16),
      kind: cleanKind(c.kind),
      position: Number.isInteger(c.position) ? c.position as number : i,
    };
  });
  const txIds = new Set<string>();
  const hashes = new Set<string>();
  const now = new Date().toISOString();
  const transactions = f.transactions.map((raw: unknown): TransactionRow => {
    const t = objectOf(raw, "Each transaction");
    const id = typeof t.id === "string" && UUID_RE.test(t.id) ? t.id : crypto.randomUUID();
    if (txIds.has(id)) throw new HttpError(400, `Duplicate transaction id "${id}"`);
    txIds.add(id);
    const category = t.categoryId ?? null;
    if (category !== null && (typeof category !== "string" || !ids.has(category))) {
      throw new HttpError(400, `Unknown category "${category}"`);
    }
    let hash = typeof t.importHash === "string" ? t.importHash.slice(0, 80) : null;
    if (hash && hashes.has(hash)) hash = null;
    if (hash) hashes.add(hash);
    return {
      family_id: familyId,
      id,
      day: cleanDate(t.date),
      amount_cents: cleanAmount(t.amountCents),
      payee: text(t.payee, "payee", 200),
      description: text(t.description, "description", 500),
      category_id: category as string | null,
      note: text(t.note, "note", 500),
      import_hash: hash,
      created_at: now,
    };
  });
  return {
    currency: f.currency === undefined ? "EUR" : cleanCurrency(f.currency),
    categories,
    transactions,
  };
}

/** Copies the finances of one family into another (clone). */
export async function copyFinance(store: Store, from: string, to: string) {
  const [settings, categories, transactions] = await Promise.all([
    store.getFinanceSettings(from),
    store.listCategories(from),
    store.listTransactions(from),
  ]);
  if (settings) await store.saveFinanceSettings({ ...settings, family_id: to });
  await store.upsertCategories(categories.map((c) => ({ ...c, family_id: to })));
  await store.upsertTransactions(
    transactions.map((t) => ({ ...t, family_id: to, id: crypto.randomUUID() })),
  );
}

// ------------------------------------------------------------------ import hashes

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Import hashes for statement rows. Identical rows (two coffees for the same price on one
 * day) are told apart by how often they occurred before in the file, so importing the same or
 * an overlapping statement again skips exactly the rows that are already there.
 */
export async function importHashes(
  rows: { day: string; amount_cents: number; payee: string; description: string }[],
): Promise<string[]> {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const r of rows) {
    const key = `${r.day}|${r.amount_cents}|${normalize(r.payee)}|${normalize(r.description)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    out.push(await sha256(`${key}|${n}`));
  }
  return out;
}

// ------------------------------------------------------------------ routes

/** Routes /families/{id}/finance/...; null for anything else. */
export function handleFinance(ctx: Ctx): Promise<Response> | null {
  if (ctx.rest[0] !== "finance") return null;
  const [, sub, id] = ctx.rest;
  const { method } = ctx;
  if (sub === undefined && method === "GET") return overview(ctx);
  if (sub === undefined && method === "DELETE") return clearRoute(ctx);
  if (sub === "settings" && id === undefined && method === "PATCH") return updateSettings(ctx);
  if (sub === "categories") return categoriesRoute(ctx, id);
  if (sub === "transactions" && id === undefined) {
    if (method === "GET") return listRoute(ctx);
    if (method === "POST") return changeTransactions(ctx);
  }
  if (sub === "import" && id === undefined && method === "POST") return importRoute(ctx);
  if (sub === "summary" && id === undefined && method === "GET") return summaryRoute(ctx);
  return Promise.reject(new HttpError(404, "Not found"));
}

async function overviewData(store: Store, familyId: string) {
  const [settings, categories] = await Promise.all([
    store.getFinanceSettings(familyId),
    store.listCategories(familyId),
  ]);
  const s = settingsOf(familyId, settings);
  return {
    currency: s.currency,
    csvMappings: s.csv_mappings,
    categories: categories.map(publicCategory),
  };
}

/** GET /finance: currency, saved CSV mappings and the categories. */
async function overview({ store, load }: Ctx): Promise<Response> {
  const { family } = await load("view");
  return json(await overviewData(store, family.id));
}

/** DELETE /finance: deletes all transactions, categories and settings. */
async function clearRoute({ store, load }: Ctx): Promise<Response> {
  const { family } = await load("edit");
  await store.clearFinance(family.id);
  return json(await overviewData(store, family.id));
}

/** PATCH /finance/settings {"currency": "EUR", "csvMappings": [...]} */
async function updateSettings({ store, req, load }: Ctx): Promise<Response> {
  const { family } = await load("edit");
  const body = await readBody(req);
  const row = settingsOf(family.id, await store.getFinanceSettings(family.id));
  if (body.currency !== undefined) row.currency = cleanCurrency(body.currency);
  if (body.csvMappings !== undefined) {
    if (!Array.isArray(body.csvMappings) || body.csvMappings.length > MAX_MAPPINGS) {
      throw new HttpError(400, `csvMappings must be an array of at most ${MAX_MAPPINGS}`);
    }
    if (JSON.stringify(body.csvMappings).length > 20_000) {
      throw new HttpError(400, "csvMappings is too large");
    }
    row.csv_mappings = body.csvMappings;
  }
  await store.saveFinanceSettings(row);
  return json(await overviewData(store, family.id));
}

async function categoriesRoute(ctx: Ctx, id: string | undefined): Promise<Response> {
  const { store, req, method, load } = ctx;
  const { family } = await load("edit");
  const categories = await store.listCategories(family.id);
  const body = await readBody(req);

  if (id === "defaults" && method === "POST") {
    // Adds the default categories the family doesn't have yet (by id).
    const lang: Lang = body.lang === "de" ? "de" : "en";
    const taken = new Set(categories.map((c) => c.id));
    let position = categories.reduce((m, c) => Math.max(m, c.position + 1), 0);
    const add = defaultCategories(family.id, lang).filter((c) => !taken.has(c.id))
      .slice(0, Math.max(0, MAX_CATEGORIES - categories.length))
      .map((c) => ({ ...c, position: position++ }));
    await store.upsertCategories(add);
    return json([...categories, ...add].map(publicCategory));
  }

  if (id === undefined && method === "POST") {
    const row = newCategory(family.id, categories, body);
    await store.upsertCategories([row]);
    return json(publicCategory(row), 201);
  }

  if (id !== undefined) {
    const current = findCategory(categories, id);
    if (method === "PATCH") {
      const next = changedCategory(current, body);
      await store.upsertCategories([next]);
      return json(publicCategory(next));
    }
    if (method === "DELETE") {
      await store.deleteCategory(family.id, current.id);
      return json({ deleted: current.id });
    }
  }
  throw new HttpError(405, "Method not allowed");
}

/** Transactions matching ?from&to&category&q&kind, newest first. */
export async function findTransactions(store: Store, familyId: string, query: URLSearchParams) {
  const from = query.get("from") ?? undefined;
  const to = query.get("to") ?? undefined;
  for (const d of [from, to]) {
    if (d !== undefined && !isValidDate(d)) throw new HttpError(400, "from/to must be YYYY-MM-DD");
  }
  let rows = await store.listTransactions(familyId, from, to);
  const category = query.get("category");
  if (category === "none") rows = rows.filter((t) => !t.category_id);
  else if (category) {
    const id = resolveCategory(await store.listCategories(familyId), category);
    rows = rows.filter((t) => t.category_id === id);
  }
  const kind = query.get("kind");
  if (kind === "income") rows = rows.filter((t) => t.amount_cents > 0);
  else if (kind === "expense") rows = rows.filter((t) => t.amount_cents < 0);
  const q = query.get("q")?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((t) =>
      t.payee.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) ||
      t.note.toLowerCase().includes(q)
    );
  }
  return rows;
}

/** GET /finance/transactions?from&to&category=<id|none>&q&kind=income|expense&limit&offset */
async function listRoute({ store, url, load }: Ctx): Promise<Response> {
  const { family } = await load("view");
  const rows = await findTransactions(store, family.id, url.searchParams);
  const limit = Math.min(MAX_LIST, Math.max(1, Number(url.searchParams.get("limit")) || 200));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  let income = 0, expense = 0;
  for (const t of rows) {
    if (t.amount_cents > 0) income += t.amount_cents;
    else expense -= t.amount_cents;
  }
  return json({
    transactions: rows.slice(offset, offset + limit).map(publicTransaction),
    total: rows.length,
    incomeCents: income,
    expenseCents: expense,
  });
}

type TxOp =
  | { action: "add"; row: TransactionRow }
  | { action: "update"; id: string; patch: Partial<TransactionRow> }
  | { action: "delete"; ids: string[] };

function parseTxOp(raw: unknown, categories: CategoryRow[], familyId: string): TxOp {
  const o = objectOf(raw, "Each op");
  const action = o.action ?? "add";
  if (action === "add") {
    if (o.id !== undefined && (typeof o.id !== "string" || !UUID_RE.test(o.id))) {
      throw new HttpError(400, "id must be a uuid");
    }
    return {
      action,
      row: {
        family_id: familyId,
        id: (o.id as string) ?? crypto.randomUUID(),
        day: cleanDate(o.date),
        amount_cents: cleanAmount(o.amountCents),
        payee: text(o.payee, "payee", 200),
        description: text(o.description, "description", 500),
        category_id: resolveCategory(categories, o.categoryId),
        note: text(o.note, "note", 500),
        import_hash: null,
        created_at: new Date().toISOString(),
      },
    };
  }
  if (action === "update") {
    if (typeof o.id !== "string" || !UUID_RE.test(o.id)) {
      throw new HttpError(400, "id must be a uuid");
    }
    const patch: Partial<TransactionRow> = {};
    if (o.date !== undefined) patch.day = cleanDate(o.date);
    if (o.amountCents !== undefined) patch.amount_cents = cleanAmount(o.amountCents);
    if (o.payee !== undefined) patch.payee = text(o.payee, "payee", 200);
    if (o.description !== undefined) patch.description = text(o.description, "description", 500);
    if (o.categoryId !== undefined) patch.category_id = resolveCategory(categories, o.categoryId);
    if (o.note !== undefined) patch.note = text(o.note, "note", 500);
    return { action, id: o.id, patch };
  }
  if (action === "delete") {
    const ids = o.ids ?? (o.id !== undefined ? [o.id] : []);
    if (
      !Array.isArray(ids) || !ids.length ||
      ids.some((id) => typeof id !== "string" || !UUID_RE.test(id))
    ) {
      throw new HttpError(400, '"delete" needs "id" or "ids" (uuids)');
    }
    return { action, ids: ids as string[] };
  }
  throw new HttpError(400, "action must be add, update or delete");
}

/** The op that puts a transaction back the way it was (for undo). */
function restoreOp(t: TransactionRow) {
  return {
    action: "add",
    id: t.id,
    date: t.day,
    amountCents: t.amount_cents,
    payee: t.payee,
    description: t.description,
    categoryId: t.category_id,
    note: t.note,
  };
}

/**
 * Applies transaction ops in order and returns `inverse`: the ops that undo them (send them
 * to the same endpoint). Shared with the AI assistant's tools.
 */
export async function applyTransactionOps(store: Store, familyId: string, rawOps: unknown[]) {
  if (rawOps.length > MAX_OPS) throw new HttpError(400, "Too many ops in one request");
  const categories = await store.listCategories(familyId);
  const ops = rawOps.map((o) => parseTxOp(o, categories, familyId));
  const inverse: Record<string, unknown>[] = [];
  const added: string[] = [];
  let changed = 0;
  for (const op of ops) {
    if (op.action === "add") {
      const [before] = await store.getTransactions(familyId, [op.row.id]);
      await store.upsertTransactions([{ ...op.row, import_hash: before?.import_hash ?? null }]);
      inverse.unshift(before ? restoreOp(before) : { action: "delete", ids: [op.row.id] });
      added.push(op.row.id);
      changed++;
    } else if (op.action === "update") {
      const [before] = await store.getTransactions(familyId, [op.id]);
      if (!before) throw new HttpError(404, `Unknown transaction "${op.id}"`);
      await store.upsertTransactions([{ ...before, ...op.patch }]);
      inverse.unshift(restoreOp(before));
      changed++;
    } else {
      const before = await store.getTransactions(familyId, op.ids);
      await store.deleteTransactions(familyId, op.ids);
      inverse.unshift(...before.map(restoreOp));
      changed += before.length;
    }
  }
  return { ok: true, changed, added, inverse };
}

/** POST /finance/transactions {"ops": [...]} or a single op. */
async function changeTransactions({ store, req, load }: Ctx): Promise<Response> {
  const { family } = await load("edit");
  const body = await readBody(req);
  const ops = Array.isArray(body.ops) ? body.ops : [body];
  return json(await applyTransactionOps(store, family.id, ops));
}

/** POST /finance/import {"rows": [{date, amountCents, payee, description, categoryId}],
 *  "dryRun": true}: adds the rows that aren't imported yet. */
async function importRoute({ store, req, load }: Ctx): Promise<Response> {
  const { family } = await load("edit");
  const body = await readBody(req);
  if (!Array.isArray(body.rows)) throw new HttpError(400, "rows must be an array");
  if (body.rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, "Too many rows");
  const categories = await store.listCategories(family.id);
  const now = new Date().toISOString();
  const rows = body.rows.map((raw: unknown): TransactionRow => {
    const o = objectOf(raw, "Each row");
    return {
      family_id: family.id,
      id: crypto.randomUUID(),
      day: cleanDate(o.date),
      amount_cents: cleanAmount(o.amountCents),
      payee: text(o.payee, "payee", 200),
      description: text(o.description, "description", 500),
      category_id: resolveCategory(categories, o.categoryId),
      note: "",
      import_hash: null,
      created_at: now,
    };
  });
  const hashes = await importHashes(rows);
  const existing = await store.existingImportHashes(family.id, hashes);
  const duplicates: number[] = [];
  const fresh: TransactionRow[] = [];
  rows.forEach((row: TransactionRow, i: number) => {
    if (existing.has(hashes[i])) duplicates.push(i);
    else fresh.push({ ...row, import_hash: hashes[i] });
  });
  if (body.dryRun !== true) await store.upsertTransactions(fresh);
  return json({
    added: body.dryRun === true ? 0 : fresh.length,
    duplicates,
    ids: body.dryRun === true ? [] : fresh.map((t) => t.id),
  });
}

/** Income and expenses per month and per category in the range. */
export async function financeSummary(store: Store, familyId: string, from?: string, to?: string) {
  const [settings, rows] = await Promise.all([
    store.getFinanceSettings(familyId),
    store.listTransactions(familyId, from, to),
  ]);
  const months = new Map<string, { month: string; incomeCents: number; expenseCents: number }>();
  const cats = new Map<
    string | null,
    { categoryId: string | null; incomeCents: number; expenseCents: number; count: number }
  >();
  let income = 0, expense = 0;
  for (const t of rows) {
    const month = t.day.slice(0, 7);
    const m = months.get(month) ?? { month, incomeCents: 0, expenseCents: 0 };
    const c = cats.get(t.category_id) ??
      { categoryId: t.category_id, incomeCents: 0, expenseCents: 0, count: 0 };
    if (t.amount_cents > 0) {
      m.incomeCents += t.amount_cents;
      c.incomeCents += t.amount_cents;
      income += t.amount_cents;
    } else {
      m.expenseCents -= t.amount_cents;
      c.expenseCents -= t.amount_cents;
      expense -= t.amount_cents;
    }
    c.count++;
    months.set(month, m);
    cats.set(t.category_id, c);
  }
  return {
    currency: settingsOf(familyId, settings).currency,
    incomeCents: income,
    expenseCents: expense,
    count: rows.length,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    categories: [...cats.values()].sort((a, b) => b.expenseCents - a.expenseCents),
  };
}

/** GET /finance/summary?from&to */
async function summaryRoute({ store, url, load }: Ctx): Promise<Response> {
  const { family } = await load("view");
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  for (const d of [from, to]) {
    if (d !== undefined && !isValidDate(d)) throw new HttpError(400, "from/to must be YYYY-MM-DD");
  }
  return json(await financeSummary(store, family.id, from, to));
}
