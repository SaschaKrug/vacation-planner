// Storage abstraction so the API handler can run against Supabase in
// production and an in-memory store in tests / local development.

export type Role = "none" | "needs_cover" | "covers" | "day_off";
export const ROLES: Role[] = ["none", "needs_cover", "covers", "day_off"];

export interface FamilyRow {
  id: string; // secret edit token (in the share URL)
  read_id: string; // view token: everything, read-only
  feed_id: string; // calendar feed token: only calendar.ics
  /** The view token of a planner from before families: the read-only calendar and its feed. */
  legacy_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
}

/** An entry type belongs to one year; each year of a family has its own set. */
export interface TypeRow {
  family_id: string;
  year: number;
  id: string; // unique within the family's year
  name: string;
  color: string;
  role: Role;
  position: number;
}

export interface EntryRow {
  day: string;
  type_id: string;
}

/** Icon and/or comment on a day; independent of entries (no role, no coverage). */
export interface NoteRow {
  day: string;
  icon: string;
  comment: string;
}

export type CategoryKind = "income" | "expense" | "both";
export const CATEGORY_KINDS: CategoryKind[] = ["income", "expense", "both"];

/** A finance category, e.g. Groceries. */
export interface CategoryRow {
  family_id: string;
  id: string; // unique within the family
  name: string;
  color: string;
  icon: string; // an emoji, or ""
  kind: CategoryKind;
  position: number;
}

/** A finance account (Konto), e.g. the checking account. */
export interface AccountRow {
  family_id: string;
  id: string; // unique within the family
  name: string;
  color: string;
  icon: string; // an emoji, or ""
  opening_cents: number; // the balance before the first transaction
  position: number;
}

export interface TransactionRow {
  family_id: string;
  id: string; // uuid
  day: string;
  amount_cents: number; // negative: money going out
  payee: string;
  description: string;
  category_id: string | null;
  note: string;
  /** Set for imported rows, so the same statement isn't imported twice. */
  import_hash: string | null;
  account_id: string | null;
  /** Transactions sharing one are the legs of a transfer between the family's accounts. */
  transfer_id: string | null;
  created_at: string;
}

export interface FinanceSettingsRow {
  family_id: string;
  currency: string; // ISO 4217, e.g. EUR
  csv_mappings: unknown[];
}

export type SearchProvider = "none" | "tavily" | "brave";
export const SEARCH_PROVIDERS: SearchProvider[] = ["none", "tavily", "brave"];

/** The AI assistant's settings; the keys are encrypted (see secrets.ts). */
export interface AiSettingsRow {
  family_id: string;
  base_url: string;
  model: string;
  api_key_enc: string;
  search_provider: SearchProvider;
  search_key_enc: string;
  allow_writes: boolean;
  updated_at: string;
}

/** Everything of the finances, for an import that replaces them. */
export interface FinanceContents {
  categories: CategoryRow[];
  accounts: AccountRow[];
  transactions: TransactionRow[];
  currency: string;
}

export type FamilyPatch = Partial<Pick<FamilyRow, "name" | "read_id" | "feed_id" | "legacy_id">>;

export interface Store {
  createFamily(family: FamilyRow, types: TypeRow[]): Promise<void>;
  /** Looks a family up by any of its tokens: edit, view, feed or legacy id. */
  findFamily(token: string): Promise<FamilyRow | null>;
  updateFamily(id: string, patch: FamilyPatch): Promise<void>;
  /** Types of all years, ordered by year and position. */
  listTypes(familyId: string): Promise<TypeRow[]>;
  upsertTypes(types: TypeRow[]): Promise<void>;
  /** Deletes the type and all of its day entries (which are all in its year). */
  deleteType(familyId: string, year: number, typeId: string): Promise<void>;
  listEntries(familyId: string, from?: string, to?: string): Promise<EntryRow[]>;
  addEntries(familyId: string, rows: EntryRow[]): Promise<void>;
  /** Removes entries on `days`; only the given types if `typeIds` is set. */
  removeEntries(familyId: string, days: string[], typeIds?: string[]): Promise<void>;
  listNotes(familyId: string, from?: string, to?: string): Promise<NoteRow[]>;
  /** Inserts or replaces the note on each row's day. */
  upsertNotes(familyId: string, rows: NoteRow[]): Promise<void>;
  removeNotes(familyId: string, days: string[]): Promise<void>;
  /** Replaces all types, entries and notes of the family at once, and the finances too if
   *  given: all or nothing. */
  replaceContents(
    familyId: string,
    types: TypeRow[],
    entries: EntryRow[],
    notes: NoteRow[],
    finance?: FinanceContents,
  ): Promise<void>;

  getFinanceSettings(familyId: string): Promise<FinanceSettingsRow | null>;
  saveFinanceSettings(row: FinanceSettingsRow): Promise<void>;
  /** Categories ordered by position. */
  listCategories(familyId: string): Promise<CategoryRow[]>;
  upsertCategories(rows: CategoryRow[]): Promise<void>;
  /** Deletes the category; its transactions become uncategorized. */
  deleteCategory(familyId: string, id: string): Promise<void>;
  /** Accounts ordered by position. */
  listAccounts(familyId: string): Promise<AccountRow[]>;
  upsertAccounts(rows: AccountRow[]): Promise<void>;
  /** Deletes the account and its transactions; returns those transactions. */
  deleteAccount(familyId: string, id: string): Promise<TransactionRow[]>;
  /** Sum of all transactions (all time) per account id, for the balances. */
  accountTotals(familyId: string): Promise<Map<string, number>>;
  /** Transactions in the range (all without one), newest first. */
  listTransactions(familyId: string, from?: string, to?: string): Promise<TransactionRow[]>;
  getTransactions(familyId: string, ids: string[]): Promise<TransactionRow[]>;
  /** All legs of the given transfer groups. */
  listTransfers(familyId: string, transferIds: string[]): Promise<TransactionRow[]>;
  /** Inserts or replaces transactions (by id). */
  upsertTransactions(rows: TransactionRow[]): Promise<void>;
  deleteTransactions(familyId: string, ids: string[]): Promise<void>;
  /** Deletes all transactions, accounts, categories and finance settings of the family. */
  clearFinance(familyId: string): Promise<void>;
  /** Which of the hashes imported transactions already have. */
  existingImportHashes(familyId: string, hashes: string[]): Promise<Set<string>>;

  getAiSettings(familyId: string): Promise<AiSettingsRow | null>;
  saveAiSettings(row: AiSettingsRow): Promise<void>;
}

export class MemoryStore implements Store {
  families = new Map<string, FamilyRow>();
  types = new Map<string, TypeRow[]>();
  entries = new Map<string, Set<string>>(); // familyId -> "day|type"
  notes = new Map<string, Map<string, NoteRow>>(); // familyId -> day -> note
  financeSettings = new Map<string, FinanceSettingsRow>();
  categories = new Map<string, CategoryRow[]>();
  accounts = new Map<string, AccountRow[]>();
  transactions = new Map<string, Map<string, TransactionRow>>(); // familyId -> id -> row
  aiSettings = new Map<string, AiSettingsRow>();

  createFamily(family: FamilyRow, types: TypeRow[]) {
    this.families.set(family.id, { ...family });
    this.types.set(family.id, types.map((t) => ({ ...t })));
    this.entries.set(family.id, new Set());
    this.notes.set(family.id, new Map());
    return Promise.resolve();
  }

  findFamily(token: string) {
    const direct = this.families.get(token);
    if (direct) return Promise.resolve({ ...direct });
    for (const f of this.families.values()) {
      if ([f.read_id, f.feed_id, f.legacy_id].includes(token)) return Promise.resolve({ ...f });
    }
    return Promise.resolve(null);
  }

  updateFamily(id: string, patch: FamilyPatch) {
    const f = this.families.get(id);
    if (f) Object.assign(f, patch, { updated_at: new Date().toISOString() });
    return Promise.resolve();
  }

  listTypes(familyId: string) {
    const list = (this.types.get(familyId) ?? []).map((t) => ({ ...t }));
    return Promise.resolve(list.sort((a, b) => a.year - b.year || a.position - b.position));
  }

  upsertTypes(types: TypeRow[]) {
    for (const type of types) {
      const list = this.types.get(type.family_id) ?? [];
      const i = list.findIndex((t) => t.year === type.year && t.id === type.id);
      if (i >= 0) list[i] = { ...type };
      else list.push({ ...type });
      this.types.set(type.family_id, list);
    }
    return Promise.resolve();
  }

  deleteType(familyId: string, year: number, typeId: string) {
    const list = this.types.get(familyId) ?? [];
    this.types.set(familyId, list.filter((t) => t.year !== year || t.id !== typeId));
    const set = this.entries.get(familyId);
    if (set) {
      for (const key of [...set]) {
        if (key.startsWith(year + "-") && key.endsWith("|" + typeId)) set.delete(key);
      }
    }
    return Promise.resolve();
  }

  listEntries(familyId: string, from?: string, to?: string) {
    const rows: EntryRow[] = [];
    for (const key of this.entries.get(familyId) ?? []) {
      const [day, type_id] = key.split("|");
      if ((from && day < from) || (to && day > to)) continue;
      rows.push({ day, type_id });
    }
    rows.sort((a, b) => a.day.localeCompare(b.day));
    return Promise.resolve(rows);
  }

  addEntries(familyId: string, rows: EntryRow[]) {
    const set = this.entries.get(familyId);
    if (set) { for (const r of rows) set.add(r.day + "|" + r.type_id); }
    return Promise.resolve();
  }

  removeEntries(familyId: string, days: string[], typeIds?: string[]) {
    const set = this.entries.get(familyId);
    if (!set) return Promise.resolve();
    const daySet = new Set(days);
    for (const key of [...set]) {
      const [day, type] = key.split("|");
      if (daySet.has(day) && (!typeIds || typeIds.includes(type))) set.delete(key);
    }
    return Promise.resolve();
  }

  listNotes(familyId: string, from?: string, to?: string) {
    const rows = [...(this.notes.get(familyId)?.values() ?? [])]
      .filter((n) => !(from && n.day < from) && !(to && n.day > to))
      .map((n) => ({ ...n }));
    rows.sort((a, b) => a.day.localeCompare(b.day));
    return Promise.resolve(rows);
  }

  upsertNotes(familyId: string, rows: NoteRow[]) {
    const map = this.notes.get(familyId);
    if (map) { for (const r of rows) map.set(r.day, { ...r }); }
    return Promise.resolve();
  }

  removeNotes(familyId: string, days: string[]) {
    const map = this.notes.get(familyId);
    if (map) { for (const d of days) map.delete(d); }
    return Promise.resolve();
  }

  replaceContents(
    familyId: string,
    types: TypeRow[],
    entries: EntryRow[],
    notes: NoteRow[],
    finance?: FinanceContents,
  ) {
    this.types.set(familyId, types.map((t) => ({ ...t })));
    this.entries.set(familyId, new Set(entries.map((r) => r.day + "|" + r.type_id)));
    this.notes.set(familyId, new Map(notes.map((n) => [n.day, { ...n }])));
    if (finance) {
      this.categories.set(familyId, finance.categories.map((c) => ({ ...c })));
      this.accounts.set(familyId, finance.accounts.map((a) => ({ ...a })));
      this.transactions.set(
        familyId,
        new Map(finance.transactions.map((t) => [t.id, { ...t }])),
      );
      const settings = this.financeSettings.get(familyId);
      this.financeSettings.set(familyId, {
        family_id: familyId,
        csv_mappings: settings?.csv_mappings ?? [],
        currency: finance.currency,
      });
    }
    return this.updateFamily(familyId, {});
  }

  getFinanceSettings(familyId: string) {
    const row = this.financeSettings.get(familyId);
    return Promise.resolve(row ? structuredClone(row) : null);
  }

  saveFinanceSettings(row: FinanceSettingsRow) {
    this.financeSettings.set(row.family_id, structuredClone(row));
    return Promise.resolve();
  }

  listCategories(familyId: string) {
    const list = (this.categories.get(familyId) ?? []).map((c) => ({ ...c }));
    return Promise.resolve(list.sort((a, b) => a.position - b.position));
  }

  upsertCategories(rows: CategoryRow[]) {
    for (const row of rows) {
      const list = this.categories.get(row.family_id) ?? [];
      const i = list.findIndex((c) => c.id === row.id);
      if (i >= 0) list[i] = { ...row };
      else list.push({ ...row });
      this.categories.set(row.family_id, list);
    }
    return Promise.resolve();
  }

  deleteCategory(familyId: string, id: string) {
    const list = this.categories.get(familyId) ?? [];
    this.categories.set(familyId, list.filter((c) => c.id !== id));
    for (const t of this.transactions.get(familyId)?.values() ?? []) {
      if (t.category_id === id) t.category_id = null;
    }
    return Promise.resolve();
  }

  listAccounts(familyId: string) {
    const list = (this.accounts.get(familyId) ?? []).map((a) => ({ ...a }));
    return Promise.resolve(list.sort((a, b) => a.position - b.position));
  }

  upsertAccounts(rows: AccountRow[]) {
    for (const row of rows) {
      const list = this.accounts.get(row.family_id) ?? [];
      const i = list.findIndex((a) => a.id === row.id);
      if (i >= 0) list[i] = { ...row };
      else list.push({ ...row });
      this.accounts.set(row.family_id, list);
    }
    return Promise.resolve();
  }

  deleteAccount(familyId: string, id: string) {
    const list = this.accounts.get(familyId) ?? [];
    this.accounts.set(familyId, list.filter((a) => a.id !== id));
    const map = this.transactions.get(familyId);
    const gone = [...map?.values() ?? []].filter((t) => t.account_id === id);
    for (const t of gone) map!.delete(t.id);
    return Promise.resolve(gone);
  }

  accountTotals(familyId: string) {
    const totals = new Map<string, number>();
    for (const t of this.transactions.get(familyId)?.values() ?? []) {
      if (t.account_id) totals.set(t.account_id, (totals.get(t.account_id) ?? 0) + t.amount_cents);
    }
    return Promise.resolve(totals);
  }

  listTransactions(familyId: string, from?: string, to?: string) {
    const rows = [...(this.transactions.get(familyId)?.values() ?? [])]
      .filter((t) => !(from && t.day < from) && !(to && t.day > to))
      .map((t) => ({ ...t }));
    rows.sort((a, b) => b.day.localeCompare(a.day) || b.created_at.localeCompare(a.created_at));
    return Promise.resolve(rows);
  }

  getTransactions(familyId: string, ids: string[]) {
    const map = this.transactions.get(familyId);
    return Promise.resolve(
      ids.map((id) => map?.get(id)).filter((t): t is TransactionRow => !!t).map((t) => ({
        ...t,
      })),
    );
  }

  listTransfers(familyId: string, transferIds: string[]) {
    const wanted = new Set(transferIds);
    return Promise.resolve(
      [...(this.transactions.get(familyId)?.values() ?? [])]
        .filter((t) => t.transfer_id && wanted.has(t.transfer_id)).map((t) => ({ ...t })),
    );
  }

  upsertTransactions(rows: TransactionRow[]) {
    for (const row of rows) {
      const map = this.transactions.get(row.family_id) ?? new Map();
      map.set(row.id, { ...row });
      this.transactions.set(row.family_id, map);
    }
    return Promise.resolve();
  }

  deleteTransactions(familyId: string, ids: string[]) {
    const map = this.transactions.get(familyId);
    if (map) { for (const id of ids) map.delete(id); }
    return Promise.resolve();
  }

  clearFinance(familyId: string) {
    this.transactions.delete(familyId);
    this.accounts.delete(familyId);
    this.categories.delete(familyId);
    this.financeSettings.delete(familyId);
    return Promise.resolve();
  }

  getAiSettings(familyId: string) {
    const row = this.aiSettings.get(familyId);
    return Promise.resolve(row ? { ...row } : null);
  }

  saveAiSettings(row: AiSettingsRow) {
    this.aiSettings.set(row.family_id, { ...row });
    return Promise.resolve();
  }

  existingImportHashes(familyId: string, hashes: string[]) {
    const wanted = new Set(hashes);
    const found = new Set<string>();
    for (const t of this.transactions.get(familyId)?.values() ?? []) {
      if (t.import_hash && wanted.has(t.import_hash)) found.add(t.import_hash);
    }
    return Promise.resolve(found);
  }

  /** Plain-JSON copy of all data, so the dev server can keep it across restarts. */
  snapshot(): MemorySnapshot {
    return [...this.families.values()].map((family) => ({
      family,
      types: this.types.get(family.id) ?? [],
      entries: [...(this.entries.get(family.id) ?? [])],
      notes: [...(this.notes.get(family.id)?.values() ?? [])],
      financeSettings: this.financeSettings.get(family.id) ?? null,
      categories: this.categories.get(family.id) ?? [],
      accounts: this.accounts.get(family.id) ?? [],
      transactions: [...(this.transactions.get(family.id)?.values() ?? [])],
      aiSettings: this.aiSettings.get(family.id) ?? null,
    }));
  }

  restore(snapshot: MemorySnapshot) {
    for (const item of snapshot) {
      const { types, entries, notes } = item;
      // Snapshots from before families hold a "session": its view id becomes the legacy id,
      // like the database migration does it.
      const old = (item as { session?: FamilyRow }).session;
      const family = item.family ??
        { ...old!, legacy_id: old!.read_id, read_id: randomId(), feed_id: randomId() };
      this.families.set(family.id, { ...family });
      this.types.set(family.id, types.map((t) => ({ ...t, family_id: family.id })));
      this.entries.set(family.id, new Set(entries));
      this.notes.set(family.id, new Map(notes.map((n) => [n.day, { ...n }])));
      if (item.financeSettings) this.financeSettings.set(family.id, item.financeSettings);
      this.categories.set(family.id, (item.categories ?? []).map((c) => ({ ...c })));
      this.accounts.set(family.id, (item.accounts ?? []).map((a) => ({ ...a })));
      // Transactions from before accounts have neither an account nor a transfer.
      this.transactions.set(
        family.id,
        new Map(
          (item.transactions ?? []).map((t) => [t.id, {
            ...t,
            account_id: t.account_id ?? null,
            transfer_id: t.transfer_id ?? null,
          }]),
        ),
      );
      if (item.aiSettings) this.aiSettings.set(family.id, item.aiSettings);
    }
  }
}

export type MemorySnapshot = {
  family: FamilyRow;
  types: TypeRow[];
  entries: string[]; // "day|type"
  notes: NoteRow[];
  // Snapshots from before finances have none of these.
  financeSettings?: FinanceSettingsRow | null;
  categories?: CategoryRow[];
  accounts?: AccountRow[]; // not in snapshots from before accounts
  transactions?: TransactionRow[];
  aiSettings?: AiSettingsRow | null;
}[];

/** A 32-character alphanumeric id, like the database migration makes them. */
function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
