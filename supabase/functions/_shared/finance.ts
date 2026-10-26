// Finances: categories, accounts, a transactions log (entered by hand or imported from bank CSV
// files) and summaries per month and category. Amounts are integer cents, negative for money
// going out. Transactions sharing a transfer id are the legs of one transfer between the
// family's own accounts: totals count such a group once, by its net (see netItems). A
// transaction can also be a part of a split booking (the order lines of an Amazon
// "Splitbuchung", say): totals count the parts and what is left of the booking. Reading needs
// the view link, changing the edit link.

import type { Ctx } from "./context.ts";
import { addDays, diffDays, isValidDate } from "./dates.ts";
import { cleanName, HttpError, json, objectOf, readBody, slug } from "./http.ts";
import type { Lang } from "./ics.ts";
import {
  type AccountRow,
  CATEGORY_KINDS,
  type CategoryKind,
  type CategoryRow,
  type FinanceContents,
  type FinanceSettingsRow,
  type Store,
  type TransactionRow,
} from "./store.ts";

export const MAX_CATEGORIES = 100;
export const MAX_ACCOUNTS = 50;
const MAX_OPS = 2000;
const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_TRANSACTIONS = 100_000; // in an export file
const MAX_AMOUNT = 100_000_000_000_000; // cents
const MAX_LIST = 1000;
const MAX_MAPPINGS = 20;
const MAX_SUGGESTIONS = 200;
const TRANSFER_DAYS = 4; // how far apart the two legs of a suggested transfer may be
const SPLIT_TOLERANCE = 0.25; // how far detected parts may add up off their booking
const MAX_SPLIT_SEARCH = 12; // candidates a booking's exact-sum search looks at
const SPLIT_RE = /split/i; // marks a split booking: "Splitbuchung", "Split-Buchung", "split"
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

function cleanAmount(v: unknown, field = "amountCents"): number {
  if (typeof v !== "number" || !Number.isInteger(v) || Math.abs(v) > MAX_AMOUNT) {
    throw new HttpError(400, `${field} must be a whole number of cents`);
  }
  return v;
}

/** A transfer id or booking id: a uuid; null / "" clears it. */
function cleanUuid(v: unknown, field: string): string | null {
  if (v === null || v === "" || v === undefined) return null;
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    throw new HttpError(400, `${field} must be a uuid`);
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

/** An account reference by id or (case-insensitive) name; null / "" clears it. */
function resolveAccount(accounts: AccountRow[], ref: unknown): string | null {
  if (ref === null || ref === "" || ref === undefined) return null;
  if (typeof ref !== "string") throw new HttpError(400, "accountId must be a string");
  const a = accounts.find((a) => a.id === ref) ??
    accounts.find((a) => a.name.toLowerCase() === ref.trim().toLowerCase());
  if (!a) throw new HttpError(404, `Unknown account "${ref}"`);
  return a.id;
}

function uniqueId(base: string, taken: Set<string>, fallback = "category"): string {
  base ||= fallback;
  let id = base;
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

/** An account with its balance: the opening balance plus all of its transactions. */
export function publicAccount(a: AccountRow, totals: Map<string, number>) {
  return {
    id: a.id,
    name: a.name,
    color: a.color,
    icon: a.icon,
    openingCents: a.opening_cents,
    position: a.position,
    balanceCents: a.opening_cents + (totals.get(a.id) ?? 0),
  };
}

/** The accounts with their balances. */
export async function listAccounts(store: Store, familyId: string) {
  const [accounts, totals] = await Promise.all([
    store.listAccounts(familyId),
    store.accountTotals(familyId),
  ]);
  return accounts.map((a) => publicAccount(a, totals));
}

/** With `groups`, transferId is only set for legs of groups with at least two legs; without
 *  it (export), it is the stored one. With `splits`, a booking with parts gets `split`: how
 *  many and what is left of it. */
export function publicTransaction(t: TransactionRow, groups?: Groups, splits?: Splits) {
  const parts = splits?.get(t.id);
  return {
    id: t.id,
    date: t.day,
    amountCents: t.amount_cents,
    payee: t.payee,
    description: t.description,
    categoryId: t.category_id,
    accountId: t.account_id,
    transferId: groups && !groupOf(t, groups) ? null : t.transfer_id,
    splitOf: t.split_of,
    split: parts ? { parts: parts.length, remainderCents: remainderOf(t, parts) } : null,
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
  const [settings, categories, accounts, transactions] = await Promise.all([
    store.getFinanceSettings(familyId),
    store.listCategories(familyId),
    store.listAccounts(familyId),
    store.listTransactions(familyId),
  ]);
  return {
    currency: settingsOf(familyId, settings).currency,
    categories: categories.map(publicCategory),
    accounts: accounts.map(({ family_id: _, opening_cents, ...a }) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      icon: a.icon,
      openingCents: opening_cents,
      position: a.position,
    })),
    transactions: transactions.map((t) => ({
      ...publicTransaction(t),
      importHash: t.import_hash,
    })),
  };
}

/** Validates the finances of an export file; the rows get `familyId`. Files from before
 *  accounts have none. */
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
  const accountsRaw = f.accounts ?? [];
  if (!Array.isArray(accountsRaw)) throw new HttpError(400, "finance.accounts must be an array");
  if (accountsRaw.length > MAX_ACCOUNTS) throw new HttpError(400, "Too many accounts");
  const accountIds = new Set<string>();
  const accounts = accountsRaw.map((raw: unknown, i: number): AccountRow => {
    const a = objectOf(raw, "Each account");
    if (typeof a.id !== "string" || !CATEGORY_ID_RE.test(a.id) || accountIds.has(a.id)) {
      throw new HttpError(400, `Invalid account id "${a.id}"`);
    }
    accountIds.add(a.id);
    return {
      family_id: familyId,
      id: a.id,
      name: cleanName(a.name),
      color: cleanColor(a.color),
      icon: text(a.icon, "icon", 16),
      opening_cents: a.openingCents === undefined ? 0 : cleanAmount(a.openingCents, "openingCents"),
      position: Number.isInteger(a.position) ? a.position as number : i,
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
    const account = t.accountId ?? null;
    if (account !== null && (typeof account !== "string" || !accountIds.has(account))) {
      throw new HttpError(400, `Unknown account "${account}"`);
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
      account_id: account as string | null,
      transfer_id: cleanUuid(t.transferId, "transferId"),
      split_of: cleanUuid(t.splitOf, "splitOf"),
      created_at: now,
    };
  });
  // A part's booking must be in the file and not a part itself.
  const byId = new Map(transactions.map((t: TransactionRow) => [t.id, t]));
  for (const t of transactions) {
    if (t.split_of && (t.split_of === t.id || byId.get(t.split_of)?.split_of !== null)) {
      t.split_of = null;
    }
  }
  return {
    currency: f.currency === undefined ? "EUR" : cleanCurrency(f.currency),
    categories,
    accounts,
    transactions,
  };
}

/** Copies the finances of one family into another (clone). */
export async function copyFinance(store: Store, from: string, to: string) {
  const [settings, categories, accounts, transactions] = await Promise.all([
    store.getFinanceSettings(from),
    store.listCategories(from),
    store.listAccounts(from),
    store.listTransactions(from),
  ]);
  if (settings) await store.saveFinanceSettings({ ...settings, family_id: to });
  await store.upsertCategories(categories.map((c) => ({ ...c, family_id: to })));
  await store.upsertAccounts(accounts.map((a) => ({ ...a, family_id: to })));
  // The copies get new ids, and their transfer groups too; parts point at their booking's copy.
  const fresh = new Map<string, string>();
  const newId = (id: string | null) => {
    if (!id) return null;
    if (!fresh.has(id)) fresh.set(id, crypto.randomUUID());
    return fresh.get(id)!;
  };
  await store.upsertTransactions(
    transactions.map((t) => ({
      ...t,
      family_id: to,
      id: newId(t.id)!,
      transfer_id: newId(t.transfer_id),
      split_of: newId(t.split_of),
    })),
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
 * an overlapping statement again skips exactly the rows that are already there. Statements of
 * an account include it, so the same booking on two accounts' statements (both legs of a
 * transfer, say) isn't taken for a duplicate.
 */
export async function importHashes(
  rows: { day: string; amount_cents: number; payee: string; description: string }[],
  accountId?: string | null,
): Promise<string[]> {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const r of rows) {
    let key = `${r.day}|${r.amount_cents}|${normalize(r.payee)}|${normalize(r.description)}`;
    if (accountId) key += `|${accountId}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    out.push(await sha256(`${key}|${n}`));
  }
  return out;
}

// ------------------------------------------------------------------ transfers and net counting

/** Transfer groups by transfer id, each with its legs in lead order. Only groups with at least
 *  two legs: a lone leg counts as a normal transaction. */
export type Groups = Map<string, TransactionRow[]>;

/** Lead order: the earliest day first, ties by id. */
function byLead(a: TransactionRow, b: TransactionRow): number {
  return a.day.localeCompare(b.day) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** All legs of the transfer groups the rows touch: a range can cut a group apart, but it
 *  always counts as a whole. */
export async function loadGroups(
  store: Store,
  familyId: string,
  rows: TransactionRow[],
): Promise<Groups> {
  const groups: Groups = new Map();
  const ids = [...new Set(rows.flatMap((t) => t.transfer_id ? [t.transfer_id] : []))];
  if (!ids.length) return groups;
  for (const t of await store.listTransfers(familyId, ids)) {
    const legs = groups.get(t.transfer_id!) ?? [];
    legs.push(t);
    groups.set(t.transfer_id!, legs);
  }
  for (const [id, legs] of groups) {
    if (legs.length < 2) groups.delete(id);
    else legs.sort(byLead);
  }
  return groups;
}

/** The legs of the transaction's transfer group, if it is a leg of one. */
function groupOf(t: TransactionRow, groups: Groups): TransactionRow[] | undefined {
  return t.transfer_id ? groups.get(t.transfer_id) : undefined;
}

/** Split bookings by id, each with its parts. A part (split_of set) counts on its own, with
 *  its category; its booking only counts what is left of it. Splits are rare, so all of a
 *  family's are loaded at once, and a range never cuts one apart. */
export type Splits = Map<string, TransactionRow[]>;

export async function loadSplits(store: Store, familyId: string): Promise<Splits> {
  const splits: Splits = new Map();
  for (const t of await store.listSplitParts(familyId)) {
    splits.set(t.split_of!, [...(splits.get(t.split_of!) ?? []), t]);
  }
  return splits;
}

/** What is left of a booking after its parts (shipping, rounding): often 0. */
function remainderOf(booking: TransactionRow, parts: TransactionRow[]): number {
  return parts.reduce((rest, p) => rest - p.amount_cents, booking.amount_cents);
}

/** Whether the transaction is a part or a booking of a split. */
function inSplit(t: TransactionRow, splits: Splits): boolean {
  return !!t.split_of || splits.has(t.id);
}

/** What a transaction counts as: its amount, the net (sum of the legs) of its group, or what is
 *  left of it when it is a split booking. */
function netOf(t: TransactionRow, groups: Groups, splits: Splits): number {
  const parts = splits.get(t.id);
  if (parts) return remainderOf(t, parts);
  const legs = groupOf(t, groups);
  return legs ? legs.reduce((sum, l) => sum + l.amount_cents, 0) : t.amount_cents;
}

/**
 * Net counting, used by every income / expense total. A transaction counts with its amount; a
 * transfer group counts once, by its net: on its lead leg's day, with the first category of
 * its legs (lead first), and only if the lead leg is among the rows. So moving 500 from one
 * account to another counts nothing (net 0), and only money that leaves the family (or comes
 * in) counts. A split booking counts what is left of it after its parts (if anything), the
 * parts count like normal transactions: together exactly the booking, by the parts' categories.
 */
export function netItems(rows: TransactionRow[], groups: Groups, splits: Splits) {
  const out: { day: string; amountCents: number; categoryId: string | null }[] = [];
  for (const t of rows) {
    const legs = groupOf(t, groups);
    const parts = splits.get(t.id);
    if (parts) {
      const rest = remainderOf(t, parts);
      if (rest) out.push({ day: t.day, amountCents: rest, categoryId: t.category_id });
    } else if (!legs) {
      out.push({ day: t.day, amountCents: t.amount_cents, categoryId: t.category_id });
    } else if (legs[0].id === t.id) {
      const net = netOf(t, groups, splits);
      if (net === 0) continue;
      const categoryId = legs.find((l) => l.category_id)?.category_id ?? null;
      out.push({ day: t.day, amountCents: net, categoryId });
    }
  }
  return out;
}

function netTotals(items: { amountCents: number }[]) {
  let incomeCents = 0, expenseCents = 0;
  for (const it of items) {
    if (it.amountCents > 0) incomeCents += it.amountCents;
    else expenseCents -= it.amountCents;
  }
  return { incomeCents, expenseCents };
}

type TransferPair = { out: TransactionRow; in: TransactionRow };

/**
 * Candidate transfers among transactions that aren't in a group: money out of one account
 * and the same amount into another (not both without an account), at most TRANSFER_DAYS
 * apart. Greedy one-to-one matching, closest days first; newest first.
 */
export function matchTransfers(rows: TransactionRow[]): TransferPair[] {
  const ins = new Map<number, TransactionRow[]>();
  for (const t of rows) {
    if (t.amount_cents > 0) ins.set(t.amount_cents, [...(ins.get(t.amount_cents) ?? []), t]);
  }
  const candidates: (TransferPair & { gap: number })[] = [];
  for (const out of rows) {
    if (out.amount_cents >= 0) continue;
    for (const into of ins.get(-out.amount_cents) ?? []) {
      if (out.account_id === into.account_id) continue;
      const gap = Math.abs(diffDays(out.day, into.day));
      if (gap <= TRANSFER_DAYS) candidates.push({ out, in: into, gap });
    }
  }
  candidates.sort((a, b) =>
    a.gap - b.gap || b.out.day.localeCompare(a.out.day) || byLead(a.out, b.out) ||
    byLead(a.in, b.in)
  );
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const { out, in: into } of candidates) {
    if (used.has(out.id) || used.has(into.id)) continue;
    used.add(out.id);
    used.add(into.id);
    pairs.push({ out, in: into });
  }
  const latest = (p: TransferPair) => p.out.day > p.in.day ? p.out.day : p.in.day;
  return pairs.sort((a, b) =>
    latest(b).localeCompare(latest(a)) || b.out.day.localeCompare(a.out.day)
  );
}

/** Transactions in the range (all without one) that are neither legs of a group nor in a
 *  split. */
async function ungrouped(store: Store, familyId: string, from?: string, to?: string) {
  const rows = await store.listTransactions(familyId, from, to);
  const [groups, splits] = await Promise.all([
    loadGroups(store, familyId, rows),
    loadSplits(store, familyId),
  ]);
  return rows.filter((t) => !groupOf(t, groups) && !inSplit(t, splits));
}

/** The pairs that look like transfers in the range (all without one), newest first. */
export async function transferPairs(store: Store, familyId: string, from?: string, to?: string) {
  return matchTransfers(await ungrouped(store, familyId, from, to));
}

// ------------------------------------------------------------------ split detection

type SplitMatch = { booking: TransactionRow; parts: TransactionRow[] };

function wordsOf(t: TransactionRow): string[] {
  return `${t.payee} ${t.description}`.toLowerCase().split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3 && !SPLIT_RE.test(w));
}

/** The first word (3+ letters, no split marker) of the payee, else of the description, in
 *  lower case: "AMAZON PAYMENTS" and "Amazon.de" both name "amazon". */
function merchantOf(t: TransactionRow): string {
  return wordsOf({ ...t, description: "" })[0] ?? wordsOf(t)[0] ?? "";
}

function sumOf(rows: TransactionRow[]): number {
  return rows.reduce((sum, t) => sum + t.amount_cents, 0);
}

/** The fewest of `rows` (the first MAX_SPLIT_SEARCH) that add up to `cents` exactly. */
function exactParts(rows: TransactionRow[], cents: number): TransactionRow[] | null {
  const pool = rows.slice(0, MAX_SPLIT_SEARCH);
  let best: TransactionRow[] | null = null;
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    const pick = pool.filter((_, i) => mask & (1 << i));
    if ((!best || pick.length < best.length) && sumOf(pick) === cents) best = pick;
  }
  return best;
}

/**
 * Split bookings among transactions that are neither in a transfer nor in a split: a booking
 * whose payee or description says "split" (the "Splitbuchung" of an Amazon order, say) gets the
 * other transactions of its account and day that name its merchant as parts: the bank lists
 * the order lines next to the booking, though the statement counts only the booking. With
 * several such bookings, each first takes the fewest parts that add up to it exactly; what is
 * left goes to the last booking standing. The parts must add up to their booking within
 * SPLIT_TOLERANCE (shipping, vouchers): the booking keeps the difference.
 */
export function matchSplits(rows: TransactionRow[]): SplitMatch[] {
  const days = new Map<string, TransactionRow[]>();
  for (const t of rows) {
    const key = `${t.account_id ?? ""}|${t.day}`;
    days.set(key, [...(days.get(key) ?? []), t]);
  }
  const used = new Set<string>();
  const out: SplitMatch[] = [];
  for (const day of days.values()) {
    const isBooking = (t: TransactionRow) => SPLIT_RE.test(`${t.payee} ${t.description}`);
    const merchants = new Map<string, TransactionRow[]>();
    for (const b of day.filter(isBooking).sort(byLead)) {
      const merchant = merchantOf(b);
      if (merchant) merchants.set(merchant, [...(merchants.get(merchant) ?? []), b]);
    }
    for (const [merchant, bookings] of merchants) {
      const free = () =>
        day.filter((t) => !isBooking(t) && !used.has(t.id) && wordsOf(t).includes(merchant));
      const take = (booking: TransactionRow, parts: TransactionRow[]) => {
        out.push({ booking, parts });
        for (const p of parts) used.add(p.id);
      };
      let open = bookings;
      if (open.length > 1) {
        for (const b of bookings) {
          const parts = exactParts(free(), b.amount_cents);
          if (parts) take(b, parts);
        }
        open = bookings.filter((b) => !out.some((m) => m.booking === b));
      }
      const parts = free();
      const sum = sumOf(parts);
      if (
        open.length === 1 && parts.length && Math.sign(sum) === Math.sign(open[0].amount_cents) &&
        Math.abs(sum - open[0].amount_cents) <= Math.abs(open[0].amount_cents) * SPLIT_TOLERANCE
      ) take(open[0], parts);
    }
  }
  return out;
}

/** Makes each match's transactions the parts of its booking; `inverse` undoes it. */
async function linkSplits(store: Store, matches: SplitMatch[]) {
  const parts = matches.flatMap((m) => m.parts.map((p) => ({ ...p, split_of: m.booking.id })));
  await store.upsertTransactions(parts);
  return {
    changed: parts.length,
    inverse: parts.length ? [{ action: "unsplit", ids: parts.map((p) => p.id) }] : [],
    splits: matches.length,
  };
}

/**
 * Combines what belongs together among the range's transactions (all without one): first
 * split bookings and their parts (see matchSplits), then transfers among the rest (see
 * matchTransfers). `preview` only counts; `apply` links them in one undoable step.
 */
export async function autoCombine(store: Store, familyId: string, from?: string, to?: string) {
  const rows = await ungrouped(store, familyId, from, to);
  const matches = matchSplits(rows);
  const taken = new Set(matches.flatMap((m) => [m.booking.id, ...m.parts.map((p) => p.id)]));
  const pairs = matchTransfers(rows.filter((t) => !taken.has(t.id)));
  return {
    splits: matches.length,
    transfers: Math.min(pairs.length, MAX_OPS),
    apply: async () => {
      const split = await linkSplits(store, matches);
      const linked = await linkTransferPairs(store, pairs);
      return {
        ok: true,
        changed: split.changed + linked.changed,
        added: [] as string[],
        inverse: [...linked.inverse, ...split.inverse],
        linked: linked.linked,
        splits: split.splits,
      };
    },
  };
}

/** Links each pair (of ungrouped transactions) as its own group; `inverse` undoes it: one
 *  "unlink" op (so it stays within MAX_OPS), then puts back the transfer ids of lone legs. */
export async function linkTransferPairs(store: Store, pairs: TransferPair[]) {
  const pick = pairs.slice(0, MAX_OPS);
  const before = pick.flatMap((p) => [p.out, p.in]);
  const linked = pick.flatMap((p) => {
    const transferId = crypto.randomUUID();
    return [{ ...p.out, transfer_id: transferId }, { ...p.in, transfer_id: transferId }];
  });
  await store.upsertTransactions(linked);
  return {
    ok: true,
    changed: linked.length,
    added: [] as string[],
    inverse: before.length
      ? [
        { action: "unlink", ids: before.map((t) => t.id) },
        ...before.filter((t) => t.transfer_id).map(restoreOp),
      ]
      : [],
    linked: pick.length,
  };
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
  if (sub === "accounts") return accountsRoute(ctx, id);
  if (sub === "transactions" && id === undefined) {
    if (method === "GET") return listRoute(ctx);
    if (method === "POST") return changeTransactions(ctx);
  }
  if (sub === "transfers" && id === "suggestions" && method === "GET") {
    return suggestionsRoute(ctx);
  }
  if (sub === "transfers" && id === "auto" && method === "POST") return autoTransfersRoute(ctx);
  if (sub === "import" && id === undefined && method === "POST") return importRoute(ctx);
  if (sub === "summary" && id === undefined && method === "GET") return summaryRoute(ctx);
  return Promise.reject(new HttpError(404, "Not found"));
}

async function overviewData(store: Store, familyId: string) {
  const [settings, categories, accounts] = await Promise.all([
    store.getFinanceSettings(familyId),
    store.listCategories(familyId),
    listAccounts(store, familyId),
  ]);
  const s = settingsOf(familyId, settings);
  return {
    currency: s.currency,
    csvMappings: s.csv_mappings,
    categories: categories.map(publicCategory),
    accounts,
  };
}

/** GET /finance: currency, saved CSV mappings, the categories and the accounts. */
async function overview({ store, load }: Ctx): Promise<Response> {
  const { family } = await load("view");
  return json(await overviewData(store, family.id));
}

/** DELETE /finance: deletes all transactions, accounts, categories and settings. */
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

async function accountsRoute(ctx: Ctx, id: string | undefined): Promise<Response> {
  const { store, req, method, load } = ctx;
  const { family } = await load("edit");
  const accounts = await store.listAccounts(family.id);
  const body = await readBody(req);

  if (id === undefined && method === "POST") {
    if (accounts.length >= MAX_ACCOUNTS) throw new HttpError(400, "Too many accounts");
    const name = cleanName(body.name);
    const row: AccountRow = {
      family_id: family.id,
      id: uniqueId(slug(name), new Set(accounts.map((a) => a.id)), "account"),
      name,
      color: cleanColor(body.color),
      icon: text(body.icon, "icon", 16),
      opening_cents: body.openingCents === undefined
        ? 0
        : cleanAmount(body.openingCents, "openingCents"),
      position: accounts.reduce((m, a) => Math.max(m, a.position + 1), 0),
    };
    await store.upsertAccounts([row]);
    return json(publicAccount(row, new Map()), 201);
  }

  if (id !== undefined) {
    const current = accounts.find((a) => a.id === resolveAccount(accounts, id));
    if (!current) throw new HttpError(404, `Unknown account "${id}"`);
    if (method === "PATCH") {
      const next = { ...current };
      if (body.name !== undefined) next.name = cleanName(body.name);
      if (body.color !== undefined) next.color = cleanColor(body.color);
      if (body.icon !== undefined) next.icon = text(body.icon, "icon", 16);
      if (body.openingCents !== undefined) {
        next.opening_cents = cleanAmount(body.openingCents, "openingCents");
      }
      if (body.position !== undefined) {
        if (!Number.isInteger(body.position)) {
          throw new HttpError(400, "position must be an integer");
        }
        next.position = body.position as number;
      }
      await store.upsertAccounts([next]);
      return json(publicAccount(next, await store.accountTotals(family.id)));
    }
    if (method === "DELETE") {
      await store.deleteAccount(family.id, current.id);
      return json({ deleted: current.id });
    }
  }
  throw new HttpError(405, "Method not allowed");
}

/** A validated range; without from or to it is open on that side. */
function cleanRange(from: unknown, to: unknown) {
  for (const d of [from, to]) {
    if (d !== undefined && !isValidDate(d)) throw new HttpError(400, "from/to must be YYYY-MM-DD");
  }
  return { from: from as string | undefined, to: to as string | undefined };
}

/** ?from&to */
function rangeOf(query: URLSearchParams) {
  return cleanRange(query.get("from") ?? undefined, query.get("to") ?? undefined);
}

/**
 * Transactions matching ?from&to&account&category&q&kind (newest first), their transfer
 * groups and splits, and the income and expense totals of the rows (net counting).
 */
export async function findTransactions(store: Store, familyId: string, query: URLSearchParams) {
  const { from, to } = rangeOf(query);
  let rows = await store.listTransactions(familyId, from, to);
  const account = query.get("account");
  if (account === "none") rows = rows.filter((t) => !t.account_id);
  else if (account) {
    const id = resolveAccount(await store.listAccounts(familyId), account);
    rows = rows.filter((t) => t.account_id === id);
  }
  const category = query.get("category");
  if (category === "none") rows = rows.filter((t) => !t.category_id);
  else if (category) {
    const id = resolveCategory(await store.listCategories(familyId), category);
    rows = rows.filter((t) => t.category_id === id);
  }
  const q = query.get("q")?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((t) =>
      t.payee.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) ||
      t.note.toLowerCase().includes(q)
    );
  }
  const [groups, splits] = await Promise.all([
    loadGroups(store, familyId, rows),
    loadSplits(store, familyId),
  ]);
  // Legs of a group go by the group's net: a net-0 transfer is neither income nor expense. A
  // split booking goes by what is left of it.
  const kind = query.get("kind");
  if (kind === "transfer") rows = rows.filter((t) => !!groupOf(t, groups));
  else if (kind === "income") rows = rows.filter((t) => netOf(t, groups, splits) > 0);
  else if (kind === "expense") rows = rows.filter((t) => netOf(t, groups, splits) < 0);
  return { rows, groups, splits, ...netTotals(netItems(rows, groups, splits)) };
}

/** GET /finance/transactions?from&to&account=<id|none>&category=<id|none>&q
 *  &kind=income|expense|transfer&limit&offset */
async function listRoute({ store, url, load }: Ctx): Promise<Response> {
  const { family } = await load("view");
  const { rows, groups, splits, incomeCents, expenseCents } = await findTransactions(
    store,
    family.id,
    url.searchParams,
  );
  const limit = Math.min(MAX_LIST, Math.max(1, Number(url.searchParams.get("limit")) || 200));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  return json({
    transactions: rows.slice(offset, offset + limit).map((t) =>
      publicTransaction(t, groups, splits)
    ),
    total: rows.length,
    incomeCents,
    expenseCents,
  });
}

type TxOp =
  | { action: "add"; row: TransactionRow }
  | { action: "update"; id: string; patch: Partial<TransactionRow> }
  | { action: "delete" | "unlink" | "unsplit"; ids: string[] }
  | { action: "link"; ids: string[] }
  | { action: "split"; id: string; ids: string[] };

/** The op's "ids" (or "id"), at least `min` distinct uuids. */
function idsOf(o: Record<string, unknown>, action: string, min: number): string[] {
  const ids = o.ids ?? (o.id !== undefined ? [o.id] : []);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !UUID_RE.test(id))) {
    throw new HttpError(400, `"${action}" needs "id" or "ids" (uuids)`);
  }
  const unique = [...new Set(ids as string[])];
  if (unique.length < min) {
    throw new HttpError(
      400,
      min > 1 ? `"${action}" needs at least ${min} "ids"` : `"${action}" needs "id" or "ids"`,
    );
  }
  return unique;
}

function parseTxOp(
  raw: unknown,
  categories: CategoryRow[],
  accounts: AccountRow[],
  familyId: string,
): TxOp {
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
        account_id: resolveAccount(accounts, o.accountId),
        transfer_id: cleanUuid(o.transferId, "transferId"),
        split_of: cleanUuid(o.splitOf, "splitOf"),
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
    if (o.accountId !== undefined) patch.account_id = resolveAccount(accounts, o.accountId);
    if (o.transferId !== undefined) patch.transfer_id = cleanUuid(o.transferId, "transferId");
    if (o.splitOf !== undefined) patch.split_of = cleanUuid(o.splitOf, "splitOf");
    if (o.note !== undefined) patch.note = text(o.note, "note", 500);
    return { action, id: o.id, patch };
  }
  if (action === "delete" || action === "unlink" || action === "unsplit") {
    return { action, ids: idsOf(o, action, 1) };
  }
  if (action === "link") return { action, ids: idsOf(o, action, 2) };
  if (action === "split") {
    if (typeof o.id !== "string" || !UUID_RE.test(o.id)) {
      throw new HttpError(400, `"split" needs the booking's "id" (a uuid)`);
    }
    const ids = idsOf({ ids: o.ids ?? [] }, action, 1);
    if (ids.includes(o.id)) throw new HttpError(400, "A booking can't be a part of itself");
    return { action, id: o.id, ids };
  }
  throw new HttpError(400, "action must be add, update, delete, link, unlink, split or unsplit");
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
    accountId: t.account_id,
    transferId: t.transfer_id,
    splitOf: t.split_of,
    note: t.note,
  };
}

/** Ops that put the transactions back, bookings before parts (a part needs its booking). */
function restoreOps(rows: TransactionRow[]) {
  return [...rows].sort((a, b) => Number(!!a.split_of) - Number(!!b.split_of)).map(restoreOp);
}

/** The transactions with these ids; 404 if one is missing. */
async function existing(store: Store, familyId: string, ids: string[]) {
  const rows = await store.getTransactions(familyId, ids);
  const found = new Set(rows.map((t) => t.id));
  const missing = ids.find((id) => !found.has(id));
  if (missing) throw new HttpError(404, `Unknown transaction "${missing}"`);
  return rows;
}

/** After `rows` left their groups: clears the transfer id of a leg left alone in one, and
 *  returns those legs as they were. */
async function clearLoneLegs(store: Store, familyId: string, rows: TransactionRow[]) {
  const ids = [...new Set(rows.flatMap((t) => t.transfer_id ? [t.transfer_id] : []))];
  if (!ids.length) return [];
  const legs = new Map<string, TransactionRow[]>();
  for (const t of await store.listTransfers(familyId, ids)) {
    legs.set(t.transfer_id!, [...(legs.get(t.transfer_id!) ?? []), t]);
  }
  const lone = [...legs.values()].filter((l) => l.length === 1).map(([t]) => t);
  await store.upsertTransactions(lone.map((t) => ({ ...t, transfer_id: null })));
  return lone;
}

/**
 * Applies transaction ops in order and returns `inverse`: the ops that undo them (send them
 * to the same endpoint). Shared with the AI assistant's tools.
 */
export async function applyTransactionOps(store: Store, familyId: string, rawOps: unknown[]) {
  if (rawOps.length > MAX_OPS) throw new HttpError(400, "Too many ops in one request");
  const [categories, accounts] = await Promise.all([
    store.listCategories(familyId),
    store.listAccounts(familyId),
  ]);
  const ops = rawOps.map((o) => parseTxOp(o, categories, accounts, familyId));
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
    } else if (op.action === "delete") {
      // Parts of a deleted booking become normal transactions (undo makes them parts again).
      const before = await store.getTransactions(familyId, op.ids);
      const gone = new Set(op.ids);
      const freed = (await store.listSplitParts(familyId))
        .filter((t) => gone.has(t.split_of!) && !gone.has(t.id));
      await store.deleteTransactions(familyId, op.ids);
      const lone = await clearLoneLegs(store, familyId, before);
      inverse.unshift(...restoreOps([...before, ...lone, ...freed]));
      changed += before.length;
    } else if (op.action === "link") {
      // The transactions leave the groups they were in and form a new one.
      const before = await existing(store, familyId, op.ids);
      const splits = await loadSplits(store, familyId);
      const split = before.find((t) => inSplit(t, splits));
      if (split) {
        throw new HttpError(400, `"${split.id}" belongs to a split booking: unsplit it first`);
      }
      const transferId = crypto.randomUUID();
      await store.upsertTransactions(before.map((t) => ({ ...t, transfer_id: transferId })));
      const lone = await clearLoneLegs(store, familyId, before);
      inverse.unshift(...[...before, ...lone].map(restoreOp));
      changed += before.length;
    } else if (op.action === "split") {
      // The parts leave the transfers and splits they were in; a booking may get more parts.
      const [booking] = await existing(store, familyId, [op.id]);
      const parts = await existing(store, familyId, op.ids);
      const splits = await loadSplits(store, familyId);
      if (booking.split_of) throw new HttpError(400, "The booking is a part of a split itself");
      if (booking.transfer_id) {
        throw new HttpError(400, "The booking is a leg of a transfer: unlink it first");
      }
      const nested = parts.find((t) => splits.has(t.id));
      if (nested) throw new HttpError(400, `"${nested.id}" is a split booking itself`);
      await store.upsertTransactions(
        parts.map((t) => ({ ...t, split_of: booking.id, transfer_id: null })),
      );
      const lone = await clearLoneLegs(store, familyId, parts);
      inverse.unshift(...restoreOps([...parts, ...lone]));
      changed += parts.length;
    } else if (op.action === "unsplit") {
      // Unsplitting a booking frees all of its parts.
      await existing(store, familyId, op.ids);
      const ids = new Set(op.ids);
      const parts = (await store.listSplitParts(familyId))
        .filter((t) => ids.has(t.id) || ids.has(t.split_of!));
      await store.upsertTransactions(parts.map((t) => ({ ...t, split_of: null })));
      inverse.unshift(...parts.map(restoreOp));
      changed += parts.length;
    } else {
      // Unlinking a leg dissolves its whole group.
      const rows = await existing(store, familyId, op.ids);
      const ids = [...new Set(rows.flatMap((t) => t.transfer_id ? [t.transfer_id] : []))];
      const legs = ids.length ? await store.listTransfers(familyId, ids) : [];
      await store.upsertTransactions(legs.map((t) => ({ ...t, transfer_id: null })));
      inverse.unshift(...legs.map(restoreOp));
      changed += legs.length;
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

/** GET /finance/transfers/suggestions?from&to: transaction pairs that look like transfers
 *  between two accounts, to be linked with "link" ops. */
async function suggestionsRoute({ store, url, load }: Ctx): Promise<Response> {
  const { family } = await load("view");
  const { from, to } = rangeOf(url.searchParams);
  const pairs = await transferPairs(store, family.id, from, to);
  return json({
    pairs: pairs.slice(0, MAX_SUGGESTIONS).map((p) => ({
      out: publicTransaction(p.out, new Map()),
      in: publicTransaction(p.in, new Map()),
    })),
  });
}

/** POST /finance/transfers/auto {"from", "to"} (both optional: all of the history): gives
 *  split bookings in the range their parts and links every suggested pair (see autoCombine);
 *  `splits` and `linked` count them, `inverse` undoes it. */
async function autoTransfersRoute({ store, req, load }: Ctx): Promise<Response> {
  const { family } = await load("edit");
  const body = await readBody(req);
  const { from, to } = cleanRange(body.from ?? undefined, body.to ?? undefined);
  return json(await (await autoCombine(store, family.id, from, to)).apply());
}

/** POST /finance/import {"rows": [{date, amountCents, payee, description, categoryId}],
 *  "accountId", "autoTransfers": true, "dryRun": true}: adds the rows that aren't imported
 *  yet, all to the account if given. With autoTransfers, fresh split bookings get their parts
 *  (see matchSplits; `splits` counts them), then fresh rows that look like one leg of a
 *  transfer (see matchTransfers) get linked to the other leg; `transfers` counts them. */
async function importRoute({ store, req, load }: Ctx): Promise<Response> {
  const { family } = await load("edit");
  const body = await readBody(req);
  if (!Array.isArray(body.rows)) throw new HttpError(400, "rows must be an array");
  if (body.rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, "Too many rows");
  const [categories, accounts] = await Promise.all([
    store.listCategories(family.id),
    store.listAccounts(family.id),
  ]);
  const accountId = resolveAccount(accounts, body.accountId);
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
      account_id: accountId,
      transfer_id: null,
      split_of: null,
      created_at: now,
    };
  });
  const hashes = await importHashes(rows, accountId);
  const existingHashes = await store.existingImportHashes(family.id, hashes);
  const duplicates: number[] = [];
  const fresh: TransactionRow[] = [];
  rows.forEach((row: TransactionRow, i: number) => {
    if (existingHashes.has(hashes[i])) duplicates.push(i);
    else fresh.push({ ...row, import_hash: hashes[i] });
  });
  const dryRun = body.dryRun === true;
  if (!dryRun) await store.upsertTransactions(fresh);
  let transfers = 0, splits = 0;
  if (body.autoTransfers === true && fresh.length) {
    // Splits and pairs among the ungrouped transactions around the fresh rows, with a fresh
    // transaction. Splits go first, so an order line isn't taken for a transfer leg. A dry run
    // adds the fresh rows in memory.
    const days = fresh.map((t) => t.day).sort();
    const from = addDays(days[0], -TRANSFER_DAYS);
    const to = addDays(days.at(-1)!, TRANSFER_DAYS);
    const around = await ungrouped(store, family.id, from, to);
    const pool = dryRun ? [...fresh, ...around] : around;
    const ids = new Set(fresh.map((t) => t.id));
    const matches = matchSplits(pool)
      .filter((m) => ids.has(m.booking.id) || m.parts.some((p) => ids.has(p.id)));
    const taken = new Set(matches.flatMap((m) => [m.booking.id, ...m.parts.map((p) => p.id)]));
    const pairs = matchTransfers(pool.filter((t) => !taken.has(t.id)))
      .filter((p) => ids.has(p.out.id) || ids.has(p.in.id));
    if (dryRun) {
      splits = matches.length;
      transfers = Math.min(pairs.length, MAX_OPS);
    } else {
      splits = (await linkSplits(store, matches)).splits;
      transfers = (await linkTransferPairs(store, pairs)).linked;
    }
  }
  return json({
    added: dryRun ? 0 : fresh.length,
    duplicates,
    ids: dryRun ? [] : fresh.map((t) => t.id),
    transfers,
    splits,
  });
}

/** Income and expenses per month and per category in the range (net counting: a transfer
 *  group is one item, in its lead leg's month; a split booking counts its parts). */
export async function financeSummary(store: Store, familyId: string, from?: string, to?: string) {
  const [settings, rows] = await Promise.all([
    store.getFinanceSettings(familyId),
    store.listTransactions(familyId, from, to),
  ]);
  const [groups, splits] = await Promise.all([
    loadGroups(store, familyId, rows),
    loadSplits(store, familyId),
  ]);
  const items = netItems(rows, groups, splits);
  const months = new Map<string, { month: string; incomeCents: number; expenseCents: number }>();
  const cats = new Map<
    string | null,
    { categoryId: string | null; incomeCents: number; expenseCents: number; count: number }
  >();
  let income = 0, expense = 0;
  for (const t of items) {
    const month = t.day.slice(0, 7);
    const m = months.get(month) ?? { month, incomeCents: 0, expenseCents: 0 };
    const c = cats.get(t.categoryId) ??
      { categoryId: t.categoryId, incomeCents: 0, expenseCents: 0, count: 0 };
    if (t.amountCents > 0) {
      m.incomeCents += t.amountCents;
      c.incomeCents += t.amountCents;
      income += t.amountCents;
    } else {
      m.expenseCents -= t.amountCents;
      c.expenseCents -= t.amountCents;
      expense -= t.amountCents;
    }
    c.count++;
    months.set(month, m);
    cats.set(t.categoryId, c);
  }
  return {
    currency: settingsOf(familyId, settings).currency,
    incomeCents: income,
    expenseCents: expense,
    count: items.length,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    categories: [...cats.values()].sort((a, b) => b.expenseCents - a.expenseCents),
  };
}

/** GET /finance/summary?from&to */
async function summaryRoute({ store, url, load }: Ctx): Promise<Response> {
  const { family } = await load("view");
  const { from, to } = rangeOf(url.searchParams);
  return json(await financeSummary(store, family.id, from, to));
}
