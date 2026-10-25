// Storage abstraction so the API handler can run against Supabase in
// production and an in-memory store in tests / local development.

export type Role = "none" | "needs_cover" | "covers" | "day_off";
export const ROLES: Role[] = ["none", "needs_cover", "covers", "day_off"];

export interface FamilyRow {
  id: string; // the family's id (in the app's URLs); access comes from membership
  feed_id: string; // calendar feed token: only calendar.ics, without signing in
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
  kind: CategoryKind; // a subcategory has the kind of its top-level category
  position: number; // among its siblings
  /** The category it is a subcategory of; null for a top-level one. */
  parent_id: string | null;
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
  /** Set on a part of a split booking: the booking's id (see splits in finance.ts). */
  split_of: string | null;
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

export type ChatStatus = "idle" | "running";

/** An AI chat of one user in a family; it runs on the server (see ai/chats.ts). */
export interface ChatRow {
  id: string;
  family_id: string;
  user_id: string;
  title: string;
  status: ChatStatus;
  /** The running turn: the invocation holding the token runs it, until `run_until`. */
  run_token: string | null;
  run_until: string | null;
  /** The user asked to stop the running turn. */
  stop: boolean;
  /** Failed tries of the running step. */
  retries: number;
  /** Page, year, language and day of the latest message. */
  context: Record<string, unknown>;
  /** What the running turn does right now. */
  activity: Record<string, unknown> | null;
  /** Changes the user undid, for the model with the next message. */
  notes: string[];
  /** Counts the changes of the items. */
  rev: number;
  created_at: string;
  updated_at: string;
}

export type ChatPatch = Partial<
  Pick<
    ChatRow,
    | "title"
    | "status"
    | "run_token"
    | "run_until"
    | "stop"
    | "retries"
    | "context"
    | "activity"
    | "notes"
    | "updated_at"
  >
>;

/** What the chat shows at one position; `rev`: the chat's revision it last changed in. */
export interface ChatItemRow {
  seq: number;
  rev: number;
  item: Record<string, unknown>;
}

/** What the model gets back, in order. */
export interface ChatMessageRow {
  seq: number;
  message: Record<string, unknown>;
}

/** Everything of the finances, for an import that replaces them. */
export interface FinanceContents {
  categories: CategoryRow[];
  accounts: AccountRow[];
  transactions: TransactionRow[];
  currency: string;
}

export type FamilyPatch = Partial<Pick<FamilyRow, "name" | "feed_id" | "legacy_id">>;

export interface UserRow {
  id: string;
  /** The sign-in name: an email address, or a plain name like "admin"; lowercase. */
  email: string;
  name: string;
  /** See passwords.ts; null: no password (passkeys only). */
  password_hash: string | null;
  is_admin: boolean;
  /** Set for the initial admin/admin: nothing works until the password is changed. */
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

export type UserPatch = Partial<
  Pick<UserRow, "email" | "name" | "password_hash" | "is_admin" | "must_change_password">
>;

/** A session of the app, a personal API token, or a one-time setup link. */
export type TokenKind = "session" | "api" | "setup";

export interface AuthTokenRow {
  id: string;
  /** SHA-256 of the token (hex); the token itself is never stored. */
  hash: string;
  user_id: string;
  kind: TokenKind;
  name: string;
  /** A session opened with a setup link: may set a new password without the current one. */
  can_reset: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

export type TokenPatch = Partial<Pick<AuthTokenRow, "last_used_at" | "expires_at" | "name">>;

export interface PasskeyRow {
  id: string; // the credential id, base64url
  user_id: string;
  public_key: string; // COSE key, base64url
  counter: number;
  transports: string[];
  /** The host the passkey was made for (the app's domain). */
  rp_id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/** A WebAuthn challenge, used once. user_id: whose passkey is being added (none: sign-in). */
export interface ChallengeRow {
  id: string;
  challenge: string;
  user_id: string | null;
  rp_id: string;
  origin: string;
  expires_at: string;
}

export type MemberRole = "editor" | "viewer";
export const MEMBER_ROLES: MemberRole[] = ["editor", "viewer"];

export interface MemberRow {
  family_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
}

export interface Store {
  createFamily(family: FamilyRow, types: TypeRow[]): Promise<void>;
  /** Looks a family up by its calendar tokens: the feed or legacy id. */
  findFeed(token: string): Promise<FamilyRow | null>;
  /** The families with these ids (all without), by name. */
  listFamilies(ids?: string[]): Promise<FamilyRow[]>;
  updateFamily(id: string, patch: FamilyPatch): Promise<void>;
  /** Deletes the family with everything in it. */
  deleteFamily(id: string): Promise<void>;

  countUsers(): Promise<number>;
  /** All users, by email. */
  listUsers(): Promise<UserRow[]>;
  getUser(id: string): Promise<UserRow | null>;
  findUserByEmail(email: string): Promise<UserRow | null>;
  /** Fails if the email is taken. */
  createUser(row: UserRow): Promise<void>;
  updateUser(id: string, patch: UserPatch): Promise<void>;
  /** Deletes the user, their tokens, passkeys and memberships. */
  deleteUser(id: string): Promise<void>;

  createToken(row: AuthTokenRow): Promise<void>;
  /** The token with this hash and its user. */
  findToken(hash: string): Promise<{ token: AuthTokenRow; user: UserRow } | null>;
  updateToken(id: string, patch: TokenPatch): Promise<void>;
  /** A user's tokens of one kind, newest first. */
  listTokens(userId: string, kind: TokenKind): Promise<AuthTokenRow[]>;
  /** Deletes a user's tokens: one (`id`), or all of the kinds except `exceptId`. */
  deleteTokens(
    userId: string,
    which: { id: string } | { kinds: TokenKind[]; exceptId?: string },
  ): Promise<void>;

  listPasskeys(userId: string): Promise<PasskeyRow[]>;
  getPasskey(id: string): Promise<PasskeyRow | null>;
  /** Inserts or replaces the passkey (by id). */
  savePasskey(row: PasskeyRow): Promise<void>;
  deletePasskey(userId: string, id: string): Promise<void>;

  /** Saves a challenge (and drops expired ones). */
  saveChallenge(row: ChallengeRow): Promise<void>;
  /** Returns the challenge and deletes it: each one is used once. */
  takeChallenge(id: string): Promise<ChallengeRow | null>;

  /** The family if the user is a member, with their role. */
  findMembership(
    familyId: string,
    userId: string,
  ): Promise<{ family: FamilyRow; role: MemberRole } | null>;
  /** Members of a family, families of a user, or all memberships. */
  listMembers(filter: { familyId?: string; userId?: string }): Promise<MemberRow[]>;
  /** Adds the member or changes their role. */
  setMember(row: MemberRow): Promise<void>;
  removeMember(familyId: string, userId: string): Promise<void>;

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
  /** Deletes the category; its subcategories and transactions move to its parent (top level:
   *  the subcategories become top-level ones, the transactions uncategorized). */
  deleteCategory(familyId: string, id: string): Promise<void>;
  /** Accounts ordered by position. */
  listAccounts(familyId: string): Promise<AccountRow[]>;
  upsertAccounts(rows: AccountRow[]): Promise<void>;
  /** Deletes the account and its transactions; returns those transactions. Parts of a deleted
   *  booking on other accounts become normal transactions. */
  deleteAccount(familyId: string, id: string): Promise<TransactionRow[]>;
  /** Sum of all transactions (all time, or up to and including the day `until`) per account
   *  id, for the balances. Parts of split bookings don't count: their booking does. */
  accountTotals(familyId: string, until?: string): Promise<Map<string, number>>;
  /** Transactions in the range (all without one), newest first. */
  listTransactions(familyId: string, from?: string, to?: string): Promise<TransactionRow[]>;
  getTransactions(familyId: string, ids: string[]): Promise<TransactionRow[]>;
  /** All legs of the given transfer groups. */
  listTransfers(familyId: string, transferIds: string[]): Promise<TransactionRow[]>;
  /** All transactions that are parts of a split booking. */
  listSplitParts(familyId: string): Promise<TransactionRow[]>;
  /** Inserts or replaces transactions (by id). */
  upsertTransactions(rows: TransactionRow[]): Promise<void>;
  /** Deletes the transactions; parts of a deleted booking become normal transactions. */
  deleteTransactions(familyId: string, ids: string[]): Promise<void>;
  /** Deletes all transactions, accounts, categories and finance settings of the family. */
  clearFinance(familyId: string): Promise<void>;
  /** Which of the hashes imported transactions already have. */
  existingImportHashes(familyId: string, hashes: string[]): Promise<Set<string>>;

  getAiSettings(familyId: string): Promise<AiSettingsRow | null>;
  saveAiSettings(row: AiSettingsRow): Promise<void>;

  /** The user's chats in the family, the latest first. */
  listChats(familyId: string, userId: string): Promise<ChatRow[]>;
  getChat(id: string): Promise<ChatRow | null>;
  createChat(row: ChatRow): Promise<void>;
  /** Changes the chat (with `token`: only while that run holds it); the chat after, or null. */
  updateChat(id: string, patch: ChatPatch, token?: string): Promise<ChatRow | null>;
  /** Takes the chat's turn for `token` until `until`: `start` an idle chat's turn, or `resume`
   *  a running one that the token holds or nobody holds any more. The chat after, or null. */
  claimChat(
    id: string,
    token: string,
    until: string,
    mode: "start" | "resume",
  ): Promise<ChatRow | null>;
  /** Deletes the chat with its items and messages. */
  deleteChat(id: string): Promise<void>;
  /** The items changed after revision `since` (all without), by position. */
  listChatItems(chatId: string, since?: number): Promise<ChatItemRow[]>;
  /** Inserts or replaces items (by position); they get the chat's next revision, returned
   *  (null if the chat is gone). */
  putChatItems(chatId: string, items: Omit<ChatItemRow, "rev">[]): Promise<number | null>;
  listChatMessages(chatId: string): Promise<ChatMessageRow[]>;
  addChatMessages(chatId: string, rows: ChatMessageRow[]): Promise<void>;
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
  users = new Map<string, UserRow>();
  tokens = new Map<string, AuthTokenRow>(); // id -> row
  passkeys = new Map<string, PasskeyRow>();
  challenges = new Map<string, ChallengeRow>();
  members = new Map<string, MemberRow>(); // "family|user" -> row
  chats = new Map<string, ChatRow>();
  chatItems = new Map<string, Map<number, ChatItemRow>>(); // chatId -> seq -> row
  chatMessages = new Map<string, ChatMessageRow[]>();

  createFamily(family: FamilyRow, types: TypeRow[]) {
    this.families.set(family.id, { ...family });
    this.types.set(family.id, types.map((t) => ({ ...t })));
    this.entries.set(family.id, new Set());
    this.notes.set(family.id, new Map());
    return Promise.resolve();
  }

  findFeed(token: string) {
    for (const f of this.families.values()) {
      if (f.feed_id === token || f.legacy_id === token) return Promise.resolve({ ...f });
    }
    return Promise.resolve(null);
  }

  listFamilies(ids?: string[]) {
    const list = ids
      ? ids.map((id) => this.families.get(id)).filter((f): f is FamilyRow => !!f)
      : [...this.families.values()];
    return Promise.resolve(
      list.map((f) => ({ ...f })).sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  updateFamily(id: string, patch: FamilyPatch) {
    const f = this.families.get(id);
    if (f) Object.assign(f, patch, { updated_at: new Date().toISOString() });
    return Promise.resolve();
  }

  deleteFamily(id: string) {
    this.families.delete(id);
    for (
      const map of [
        this.types,
        this.entries,
        this.notes,
        this.financeSettings,
        this.categories,
        this.accounts,
        this.transactions,
        this.aiSettings,
      ] as Map<string, unknown>[]
    ) map.delete(id);
    for (const [key, m] of this.members) if (m.family_id === id) this.members.delete(key);
    for (const c of this.chats.values()) if (c.family_id === id) this.deleteChat(c.id);
    return Promise.resolve();
  }

  countUsers() {
    return Promise.resolve(this.users.size);
  }

  listUsers() {
    return Promise.resolve(
      [...this.users.values()].map((u) => ({ ...u })).sort((a, b) =>
        a.email.localeCompare(b.email)
      ),
    );
  }

  getUser(id: string) {
    const u = this.users.get(id);
    return Promise.resolve(u ? { ...u } : null);
  }

  findUserByEmail(email: string) {
    for (const u of this.users.values()) if (u.email === email) return Promise.resolve({ ...u });
    return Promise.resolve(null);
  }

  createUser(row: UserRow) {
    for (const u of this.users.values()) {
      if (u.email === row.email) return Promise.reject(new Error("email taken"));
    }
    this.users.set(row.id, { ...row });
    return Promise.resolve();
  }

  updateUser(id: string, patch: UserPatch) {
    const u = this.users.get(id);
    if (u) {
      if (patch.email !== undefined) {
        for (const other of this.users.values()) {
          if (other.id !== id && other.email === patch.email) {
            return Promise.reject(new Error("email taken"));
          }
        }
      }
      Object.assign(u, patch, { updated_at: new Date().toISOString() });
    }
    return Promise.resolve();
  }

  deleteUser(id: string) {
    this.users.delete(id);
    for (const [key, t] of this.tokens) if (t.user_id === id) this.tokens.delete(key);
    for (const [key, p] of this.passkeys) if (p.user_id === id) this.passkeys.delete(key);
    for (const [key, c] of this.challenges) if (c.user_id === id) this.challenges.delete(key);
    for (const [key, m] of this.members) if (m.user_id === id) this.members.delete(key);
    for (const c of this.chats.values()) if (c.user_id === id) this.deleteChat(c.id);
    return Promise.resolve();
  }

  createToken(row: AuthTokenRow) {
    this.tokens.set(row.id, { ...row });
    return Promise.resolve();
  }

  findToken(hash: string) {
    for (const t of this.tokens.values()) {
      if (t.hash !== hash) continue;
      const user = this.users.get(t.user_id);
      return Promise.resolve(user ? { token: { ...t }, user: { ...user } } : null);
    }
    return Promise.resolve(null);
  }

  updateToken(id: string, patch: TokenPatch) {
    const t = this.tokens.get(id);
    if (t) Object.assign(t, patch);
    return Promise.resolve();
  }

  listTokens(userId: string, kind: TokenKind) {
    return Promise.resolve(
      [...this.tokens.values()].filter((t) => t.user_id === userId && t.kind === kind)
        .map((t) => ({ ...t })).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }

  deleteTokens(
    userId: string,
    which: { id: string } | { kinds: TokenKind[]; exceptId?: string },
  ) {
    for (const [key, t] of this.tokens) {
      if (t.user_id !== userId) continue;
      const hit = "id" in which
        ? t.id === which.id
        : which.kinds.includes(t.kind) && t.id !== which.exceptId;
      if (hit) this.tokens.delete(key);
    }
    return Promise.resolve();
  }

  listPasskeys(userId: string) {
    return Promise.resolve(
      [...this.passkeys.values()].filter((p) => p.user_id === userId)
        .map((p) => ({ ...p, transports: [...p.transports] }))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    );
  }

  getPasskey(id: string) {
    const p = this.passkeys.get(id);
    return Promise.resolve(p ? { ...p, transports: [...p.transports] } : null);
  }

  savePasskey(row: PasskeyRow) {
    this.passkeys.set(row.id, { ...row, transports: [...row.transports] });
    return Promise.resolve();
  }

  deletePasskey(userId: string, id: string) {
    if (this.passkeys.get(id)?.user_id === userId) this.passkeys.delete(id);
    return Promise.resolve();
  }

  saveChallenge(row: ChallengeRow) {
    const now = new Date().toISOString();
    for (const [key, c] of this.challenges) if (c.expires_at < now) this.challenges.delete(key);
    this.challenges.set(row.id, { ...row });
    return Promise.resolve();
  }

  takeChallenge(id: string) {
    const c = this.challenges.get(id);
    this.challenges.delete(id);
    return Promise.resolve(c ? { ...c } : null);
  }

  findMembership(familyId: string, userId: string) {
    const m = this.members.get(`${familyId}|${userId}`);
    const family = m && this.families.get(familyId);
    return Promise.resolve(family ? { family: { ...family }, role: m.role } : null);
  }

  listMembers(filter: { familyId?: string; userId?: string }) {
    return Promise.resolve(
      [...this.members.values()].filter((m) =>
        (!filter.familyId || m.family_id === filter.familyId) &&
        (!filter.userId || m.user_id === filter.userId)
      ).map((m) => ({ ...m })).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    );
  }

  setMember(row: MemberRow) {
    const key = `${row.family_id}|${row.user_id}`;
    const old = this.members.get(key);
    this.members.set(key, { ...row, created_at: old?.created_at ?? row.created_at });
    return Promise.resolve();
  }

  removeMember(familyId: string, userId: string) {
    this.members.delete(`${familyId}|${userId}`);
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
    const parent = list.find((c) => c.id === id)?.parent_id ?? null;
    this.categories.set(familyId, list.filter((c) => c.id !== id));
    for (const c of list) if (c.parent_id === id) c.parent_id = parent;
    for (const t of this.transactions.get(familyId)?.values() ?? []) {
      if (t.category_id === id) t.category_id = parent;
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
    this.orphanParts(familyId, gone.map((t) => t.id));
    return Promise.resolve(gone);
  }

  accountTotals(familyId: string, until?: string) {
    const totals = new Map<string, number>();
    for (const t of this.transactions.get(familyId)?.values() ?? []) {
      if (t.account_id && !t.split_of && !(until && t.day > until)) {
        totals.set(t.account_id, (totals.get(t.account_id) ?? 0) + t.amount_cents);
      }
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

  listSplitParts(familyId: string) {
    return Promise.resolve(
      [...(this.transactions.get(familyId)?.values() ?? [])].filter((t) => t.split_of)
        .map((t) => ({ ...t })),
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
    this.orphanParts(familyId, ids);
    return Promise.resolve();
  }

  /** Like ON DELETE SET NULL in the database: parts of deleted bookings become normal. */
  private orphanParts(familyId: string, ids: string[]) {
    const gone = new Set(ids);
    for (const t of this.transactions.get(familyId)?.values() ?? []) {
      if (t.split_of && gone.has(t.split_of)) t.split_of = null;
    }
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

  listChats(familyId: string, userId: string) {
    return Promise.resolve(
      [...this.chats.values()].filter((c) => c.family_id === familyId && c.user_id === userId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((c) => structuredClone(c)),
    );
  }

  getChat(id: string) {
    const c = this.chats.get(id);
    return Promise.resolve(c ? structuredClone(c) : null);
  }

  createChat(row: ChatRow) {
    this.chats.set(row.id, structuredClone(row));
    this.chatItems.set(row.id, new Map());
    this.chatMessages.set(row.id, []);
    return Promise.resolve();
  }

  updateChat(id: string, patch: ChatPatch, token?: string) {
    const c = this.chats.get(id);
    if (!c || (token !== undefined && c.run_token !== token)) return Promise.resolve(null);
    Object.assign(c, structuredClone(patch));
    return Promise.resolve(structuredClone(c));
  }

  claimChat(id: string, token: string, until: string, mode: "start" | "resume") {
    const c = this.chats.get(id);
    const now = new Date().toISOString();
    if (mode === "start" && c?.status === "idle") {
      Object.assign(c, { status: "running", run_token: token, run_until: until, stop: false });
      c.retries = 0;
    } else if (
      mode === "resume" && c?.status === "running" &&
      (c.run_token === token || !c.run_until || c.run_until < now)
    ) {
      Object.assign(c, { run_token: token, run_until: until });
    } else return Promise.resolve(null);
    return Promise.resolve(structuredClone(c));
  }

  deleteChat(id: string) {
    this.chats.delete(id);
    this.chatItems.delete(id);
    this.chatMessages.delete(id);
    return Promise.resolve();
  }

  listChatItems(chatId: string, since = 0) {
    return Promise.resolve(
      [...(this.chatItems.get(chatId)?.values() ?? [])].filter((r) => r.rev > since)
        .sort((a, b) => a.seq - b.seq).map((r) => structuredClone(r)),
    );
  }

  putChatItems(chatId: string, items: Omit<ChatItemRow, "rev">[]) {
    const c = this.chats.get(chatId);
    const rows = this.chatItems.get(chatId);
    if (!c || !rows) return Promise.resolve(null);
    c.rev++;
    c.updated_at = new Date().toISOString();
    for (const { seq, item } of items) {
      rows.set(seq, { seq, rev: c.rev, item: structuredClone(item) });
    }
    return Promise.resolve(c.rev);
  }

  listChatMessages(chatId: string) {
    return Promise.resolve(structuredClone(this.chatMessages.get(chatId) ?? []));
  }

  addChatMessages(chatId: string, rows: ChatMessageRow[]) {
    const list = this.chatMessages.get(chatId);
    if (list) {
      for (const r of rows) {
        if (list.some((m) => m.seq === r.seq)) {
          return Promise.reject(new Error("duplicate message seq"));
        }
      }
      list.push(...structuredClone(rows));
      list.sort((a, b) => a.seq - b.seq);
    }
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
    const families = [...this.families.values()].map((family) => ({
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
    return {
      families,
      users: [...this.users.values()],
      tokens: [...this.tokens.values()],
      passkeys: [...this.passkeys.values()],
      members: [...this.members.values()],
      chats: [...this.chats.values()].map((chat) => ({
        chat,
        items: [...(this.chatItems.get(chat.id)?.values() ?? [])],
        messages: this.chatMessages.get(chat.id) ?? [],
      })),
    };
  }

  restore(snapshot: MemorySnapshot | MemorySnapshot["families"]) {
    // Snapshots from before accounts are only the list of families (nobody is a member yet:
    // the handler gives them to the admin it creates, like on the database).
    const all = Array.isArray(snapshot) ? { families: snapshot } : snapshot;
    for (const u of all.users ?? []) this.users.set(u.id, { ...u });
    for (const t of all.tokens ?? []) this.tokens.set(t.id, { ...t });
    for (const p of all.passkeys ?? []) this.passkeys.set(p.id, { ...p });
    for (const m of all.members ?? []) this.members.set(`${m.family_id}|${m.user_id}`, { ...m });
    for (const { chat, items, messages } of all.chats ?? []) {
      this.chats.set(chat.id, { ...chat });
      this.chatItems.set(chat.id, new Map(items.map((r) => [r.seq, r])));
      this.chatMessages.set(chat.id, messages);
    }
    for (const item of all.families) {
      const { types, entries, notes } = item;
      // Snapshots from before families hold a "session": its view id becomes the legacy id,
      // like the database migration does it. The view id is gone since accounts.
      const old = (item as { session?: FamilyRow & { read_id: string } }).session;
      const { read_id: _, ...family } = (item.family as FamilyRow & { read_id?: string }) ??
        { ...old!, legacy_id: old!.read_id, feed_id: randomId() };
      this.families.set(family.id, { ...family });
      this.types.set(family.id, types.map((t) => ({ ...t, family_id: family.id })));
      this.entries.set(family.id, new Set(entries));
      this.notes.set(family.id, new Map(notes.map((n) => [n.day, { ...n }])));
      if (item.financeSettings) this.financeSettings.set(family.id, item.financeSettings);
      this.categories.set(family.id, (item.categories ?? []).map((c) => ({ ...c })));
      this.accounts.set(family.id, (item.accounts ?? []).map((a) => ({ ...a })));
      // Transactions from before accounts have neither an account nor a transfer, and ones
      // from before splits no booking.
      this.transactions.set(
        family.id,
        new Map(
          (item.transactions ?? []).map((t) => [t.id, {
            ...t,
            account_id: t.account_id ?? null,
            transfer_id: t.transfer_id ?? null,
            split_of: t.split_of ?? null,
          }]),
        ),
      );
      if (item.aiSettings) this.aiSettings.set(family.id, item.aiSettings);
    }
  }
}

export interface MemorySnapshot {
  families: FamilySnapshot[];
  users?: UserRow[];
  tokens?: AuthTokenRow[];
  passkeys?: PasskeyRow[];
  members?: MemberRow[];
  chats?: { chat: ChatRow; items: ChatItemRow[]; messages: ChatMessageRow[] }[];
}

type FamilySnapshot = {
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
};

/** A 32-character alphanumeric id, like the database migration makes them. */
function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
