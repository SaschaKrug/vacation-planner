import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  AccountRow,
  AiSettingsRow,
  AuthTokenRow,
  CategoryRow,
  ChallengeRow,
  EntryRow,
  FamilyPatch,
  FamilyRow,
  FinanceContents,
  FinanceSettingsRow,
  MemberRole,
  MemberRow,
  NoteRow,
  PasskeyRow,
  Store,
  TokenKind,
  TokenPatch,
  TransactionRow,
  TypeRow,
  UserPatch,
  UserRow,
} from "./store.ts";

const PAGE = 1000; // PostgREST default max rows per request
const CHUNK = 200; // keeps `in (...)` filters well below URL length limits

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Supabase returns bigint columns as strings. */
function txRow(r: TransactionRow): TransactionRow {
  return { ...r, amount_cents: Number(r.amount_cents) };
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}

  async createFamily(family: FamilyRow, types: TypeRow[]) {
    check(await this.db.from("families").insert(family));
    if (types.length) check(await this.db.from("entry_types").insert(types));
  }

  async findFeed(token: string) {
    // The token goes into the filter string unescaped. That is only safe because
    // tokens are alphanumeric: the handler validates them, and so does this check.
    if (!/^[A-Za-z0-9]+$/.test(token)) return null;
    const rows = check(
      await this.db.from("families").select("*")
        .or(`feed_id.eq.${token},legacy_id.eq.${token}`).limit(1),
    ) as FamilyRow[] | null;
    return rows?.[0] ?? null;
  }

  async listFamilies(ids?: string[]) {
    if (ids) {
      const out: FamilyRow[] = [];
      for (const part of chunks(ids, CHUNK)) {
        const rows = check(await this.db.from("families").select("*").in("id", part));
        out.push(...(rows ?? []) as FamilyRow[]);
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    }
    return await this.all<FamilyRow>("families", "name");
  }

  async updateFamily(id: string, patch: FamilyPatch) {
    check(
      await this.db.from("families")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id),
    );
  }

  async deleteFamily(id: string) {
    // Everything of the family goes with it (ON DELETE CASCADE).
    check(await this.db.from("families").delete().eq("id", id));
  }

  /** All rows of a small table, page by page. */
  private async all<T>(table: string, order: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0;; offset += PAGE) {
      const rows = check(
        await this.db.from(table).select("*").order(order).range(offset, offset + PAGE - 1),
      ) as T[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async countUsers() {
    const res = await this.db.from("users").select("id", { count: "exact", head: true });
    if (res.error) throw new Error(res.error.message);
    return res.count ?? 0;
  }

  async listUsers() {
    return await this.all<UserRow>("users", "email");
  }

  async getUser(id: string) {
    const rows = check(await this.db.from("users").select("*").eq("id", id).limit(1));
    return (rows?.[0] as UserRow | undefined) ?? null;
  }

  async findUserByEmail(email: string) {
    const rows = check(await this.db.from("users").select("*").eq("email", email).limit(1));
    return (rows?.[0] as UserRow | undefined) ?? null;
  }

  async createUser(row: UserRow) {
    check(await this.db.from("users").insert(row));
  }

  async updateUser(id: string, patch: UserPatch) {
    check(
      await this.db.from("users").update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id),
    );
  }

  async deleteUser(id: string) {
    // Tokens, passkeys and memberships go with it (ON DELETE CASCADE).
    check(await this.db.from("users").delete().eq("id", id));
  }

  async createToken(row: AuthTokenRow) {
    check(await this.db.from("auth_tokens").insert(row));
  }

  async findToken(hash: string) {
    const rows = check(
      await this.db.from("auth_tokens").select("*, users(*)").eq("hash", hash).limit(1),
    ) as (AuthTokenRow & { users: UserRow | null })[] | null;
    const row = rows?.[0];
    if (!row?.users) return null;
    const { users: user, ...token } = row;
    return { token, user };
  }

  async updateToken(id: string, patch: TokenPatch) {
    check(await this.db.from("auth_tokens").update(patch).eq("id", id));
  }

  async listTokens(userId: string, kind: TokenKind) {
    return check(
      await this.db.from("auth_tokens").select("*").eq("user_id", userId).eq("kind", kind)
        .order("created_at", { ascending: false }),
    ) as AuthTokenRow[];
  }

  async deleteTokens(
    userId: string,
    which: { id: string } | { kinds: TokenKind[]; exceptId?: string },
  ) {
    let q = this.db.from("auth_tokens").delete().eq("user_id", userId);
    if ("id" in which) q = q.eq("id", which.id);
    else {
      q = q.in("kind", which.kinds);
      if (which.exceptId) q = q.neq("id", which.exceptId);
    }
    check(await q);
  }

  async listPasskeys(userId: string) {
    const rows = check(
      await this.db.from("passkeys").select("*").eq("user_id", userId).order("created_at"),
    ) as PasskeyRow[];
    return rows.map((r) => ({ ...r, counter: Number(r.counter) }));
  }

  async getPasskey(id: string) {
    const rows = check(
      await this.db.from("passkeys").select("*").eq("id", id).limit(1),
    ) as PasskeyRow[] | null;
    const row = rows?.[0];
    return row ? { ...row, counter: Number(row.counter) } : null;
  }

  async savePasskey(row: PasskeyRow) {
    check(await this.db.from("passkeys").upsert(row, { onConflict: "id" }));
  }

  async deletePasskey(userId: string, id: string) {
    check(await this.db.from("passkeys").delete().eq("user_id", userId).eq("id", id));
  }

  async saveChallenge(row: ChallengeRow) {
    check(
      await this.db.from("auth_challenges").delete().lt("expires_at", new Date().toISOString()),
    );
    check(await this.db.from("auth_challenges").insert(row));
  }

  async takeChallenge(id: string) {
    // Deleting it is what makes it single-use, also between two requests at once.
    const rows = check(
      await this.db.from("auth_challenges").delete().eq("id", id).select("*"),
    ) as ChallengeRow[] | null;
    return rows?.[0] ?? null;
  }

  async findMembership(familyId: string, userId: string) {
    const rows = check(
      await this.db.from("family_members").select("role, families(*)")
        .eq("family_id", familyId).eq("user_id", userId).limit(1),
    ) as unknown as { role: MemberRole; families: FamilyRow | null }[] | null;
    const row = rows?.[0];
    return row?.families ? { family: row.families, role: row.role } : null;
  }

  async listMembers(filter: { familyId?: string; userId?: string }) {
    const out: MemberRow[] = [];
    for (let offset = 0;; offset += PAGE) {
      let q = this.db.from("family_members").select("*");
      if (filter.familyId) q = q.eq("family_id", filter.familyId);
      if (filter.userId) q = q.eq("user_id", filter.userId);
      const rows = check(
        await q.order("created_at").order("family_id").order("user_id")
          .range(offset, offset + PAGE - 1),
      ) as MemberRow[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async setMember(row: MemberRow) {
    // The role changes; created_at stays as it was.
    const { created_at: _, ...rest } = row;
    check(
      await this.db.from("family_members").upsert(rest, { onConflict: "family_id,user_id" }),
    );
  }

  async removeMember(familyId: string, userId: string) {
    check(
      await this.db.from("family_members").delete().eq("family_id", familyId)
        .eq("user_id", userId),
    );
  }

  async listTypes(familyId: string) {
    const rows = check(
      await this.db.from("entry_types").select("*").eq("family_id", familyId)
        .order("year").order("position"),
    );
    return (rows ?? []) as TypeRow[];
  }

  async upsertTypes(types: TypeRow[]) {
    if (!types.length) return;
    check(
      await this.db.from("entry_types").upsert(types, { onConflict: "family_id,year,id" }),
    );
  }

  async deleteType(familyId: string, year: number, typeId: string) {
    // day_entries rows go away through the ON DELETE CASCADE foreign key.
    check(
      await this.db.from("entry_types").delete().eq("family_id", familyId).eq("year", year)
        .eq("id", typeId),
    );
  }

  async listEntries(familyId: string, from?: string, to?: string) {
    const out: EntryRow[] = [];
    for (let offset = 0;; offset += PAGE) {
      let q = this.db.from("day_entries").select("day,type_id").eq("family_id", familyId);
      if (from) q = q.gte("day", from);
      if (to) q = q.lte("day", to);
      const rows = check(
        await q.order("day").order("type_id").range(offset, offset + PAGE - 1),
      ) as EntryRow[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async addEntries(familyId: string, rows: EntryRow[]) {
    for (const part of chunks(rows, 500)) {
      check(
        await this.db.from("day_entries").upsert(
          part.map((r) => ({ family_id: familyId, ...r })),
          { onConflict: "family_id,day,type_id", ignoreDuplicates: true },
        ),
      );
    }
  }

  async removeEntries(familyId: string, days: string[], typeIds?: string[]) {
    for (const part of chunks(days, CHUNK)) {
      let q = this.db.from("day_entries").delete().eq("family_id", familyId).in("day", part);
      if (typeIds) q = q.in("type_id", typeIds);
      check(await q);
    }
  }

  async listNotes(familyId: string, from?: string, to?: string) {
    const out: NoteRow[] = [];
    for (let offset = 0;; offset += PAGE) {
      let q = this.db.from("day_notes").select("day,icon,comment").eq("family_id", familyId);
      if (from) q = q.gte("day", from);
      if (to) q = q.lte("day", to);
      const rows = check(
        await q.order("day").range(offset, offset + PAGE - 1),
      ) as NoteRow[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async upsertNotes(familyId: string, rows: NoteRow[]) {
    // No ignoreDuplicates: setting a note replaces the existing one on that day.
    for (const part of chunks(rows, 500)) {
      check(
        await this.db.from("day_notes").upsert(
          part.map((r) => ({ family_id: familyId, ...r })),
          { onConflict: "family_id,day" },
        ),
      );
    }
  }

  async removeNotes(familyId: string, days: string[]) {
    for (const part of chunks(days, CHUNK)) {
      check(await this.db.from("day_notes").delete().eq("family_id", familyId).in("day", part));
    }
  }

  async replaceContents(
    familyId: string,
    types: TypeRow[],
    entries: EntryRow[],
    notes: NoteRow[],
    finance?: FinanceContents,
  ) {
    // One database function, so a failed import leaves the family as it was.
    check(
      await this.db.rpc("replace_family_contents", {
        p_family_id: familyId,
        p_types: types.map(({ family_id: _, ...t }) => t),
        p_entries: entries,
        p_notes: notes,
        p_finance: finance
          ? {
            currency: finance.currency,
            categories: finance.categories.map(({ family_id: _, ...c }) => c),
            accounts: finance.accounts.map(({ family_id: _, ...a }) => a),
            transactions: finance.transactions.map(({ family_id: _, created_at: __, ...t }) => t),
          }
          : null,
      }),
    );
  }

  async getFinanceSettings(familyId: string) {
    const rows = check(
      await this.db.from("family_settings").select("*").eq("family_id", familyId).limit(1),
    ) as FinanceSettingsRow[] | null;
    return rows?.[0] ?? null;
  }

  async saveFinanceSettings(row: FinanceSettingsRow) {
    check(await this.db.from("family_settings").upsert(row, { onConflict: "family_id" }));
  }

  async listCategories(familyId: string) {
    const rows = check(
      await this.db.from("finance_categories").select("*").eq("family_id", familyId)
        .order("position"),
    );
    return (rows ?? []) as CategoryRow[];
  }

  async upsertCategories(rows: CategoryRow[]) {
    if (!rows.length) return;
    check(
      await this.db.from("finance_categories").upsert(rows, { onConflict: "family_id,id" }),
    );
  }

  async deleteCategory(familyId: string, id: string) {
    // Transactions keep their rows: ON DELETE SET NULL clears their category.
    check(
      await this.db.from("finance_categories").delete().eq("family_id", familyId).eq("id", id),
    );
  }

  async listAccounts(familyId: string) {
    const rows = check(
      await this.db.from("finance_accounts").select("*").eq("family_id", familyId)
        .order("position"),
    ) as AccountRow[] | null;
    return (rows ?? []).map((r) => ({ ...r, opening_cents: Number(r.opening_cents) }));
  }

  async upsertAccounts(rows: AccountRow[]) {
    if (!rows.length) return;
    check(
      await this.db.from("finance_accounts").upsert(rows, { onConflict: "family_id,id" }),
    );
  }

  async deleteAccount(familyId: string, id: string) {
    const gone = check(
      await this.db.from("transactions").delete().eq("family_id", familyId)
        .eq("account_id", id).select("*"),
    ) as TransactionRow[] | null;
    check(
      await this.db.from("finance_accounts").delete().eq("family_id", familyId).eq("id", id),
    );
    return (gone ?? []).map(txRow);
  }

  async accountTotals(familyId: string, until?: string) {
    const rows = check(
      until
        ? await this.db.rpc("finance_account_totals_until", {
          p_family_id: familyId,
          p_day: until,
        })
        : await this.db.from("finance_account_totals").select("account_id,total_cents")
          .eq("family_id", familyId),
    ) as { account_id: string; total_cents: number | string }[] | null;
    return new Map((rows ?? []).map((r) => [r.account_id, Number(r.total_cents)]));
  }

  async listTransactions(familyId: string, from?: string, to?: string) {
    const out: TransactionRow[] = [];
    for (let offset = 0;; offset += PAGE) {
      let q = this.db.from("transactions").select("*").eq("family_id", familyId);
      if (from) q = q.gte("day", from);
      if (to) q = q.lte("day", to);
      const rows = check(
        await q.order("day", { ascending: false }).order("created_at", { ascending: false })
          .order("id").range(offset, offset + PAGE - 1),
      ) as TransactionRow[];
      out.push(...rows.map(txRow));
      if (rows.length < PAGE) return out;
    }
  }

  async getTransactions(familyId: string, ids: string[]) {
    const out: TransactionRow[] = [];
    for (const part of chunks(ids, CHUNK)) {
      const rows = check(
        await this.db.from("transactions").select("*").eq("family_id", familyId).in("id", part),
      ) as TransactionRow[];
      out.push(...rows.map(txRow));
    }
    return out;
  }

  async listTransfers(familyId: string, transferIds: string[]) {
    const out: TransactionRow[] = [];
    for (const part of chunks(transferIds, CHUNK)) {
      // Paged, as a chunk of groups can have more legs than one response holds.
      for (let offset = 0;; offset += PAGE) {
        const rows = check(
          await this.db.from("transactions").select("*").eq("family_id", familyId)
            .in("transfer_id", part).order("id").range(offset, offset + PAGE - 1),
        ) as TransactionRow[];
        out.push(...rows.map(txRow));
        if (rows.length < PAGE) break;
      }
    }
    return out;
  }

  async listSplitParts(familyId: string) {
    const out: TransactionRow[] = [];
    for (let offset = 0;; offset += PAGE) {
      const rows = check(
        await this.db.from("transactions").select("*").eq("family_id", familyId)
          .not("split_of", "is", null).order("id").range(offset, offset + PAGE - 1),
      ) as TransactionRow[];
      out.push(...rows.map(txRow));
      if (rows.length < PAGE) return out;
    }
  }

  async upsertTransactions(rows: TransactionRow[]) {
    // Bookings before their parts, so a part's foreign key never points ahead of its chunk.
    const ordered = [...rows].sort((a, b) => Number(!!a.split_of) - Number(!!b.split_of));
    for (const part of chunks(ordered, 500)) {
      check(await this.db.from("transactions").upsert(part, { onConflict: "family_id,id" }));
    }
  }

  async deleteTransactions(familyId: string, ids: string[]) {
    // Parts of a deleted booking stay: ON DELETE SET NULL clears their split_of.
    for (const part of chunks(ids, CHUNK)) {
      check(await this.db.from("transactions").delete().eq("family_id", familyId).in("id", part));
    }
  }

  async clearFinance(familyId: string) {
    for (
      const table of ["transactions", "finance_accounts", "finance_categories", "family_settings"]
    ) {
      check(await this.db.from(table).delete().eq("family_id", familyId));
    }
  }

  async existingImportHashes(familyId: string, hashes: string[]) {
    const found = new Set<string>();
    for (const part of chunks(hashes, CHUNK)) {
      const rows = check(
        await this.db.from("transactions").select("import_hash").eq("family_id", familyId)
          .in("import_hash", part),
      ) as { import_hash: string }[];
      for (const r of rows) found.add(r.import_hash);
    }
    return found;
  }

  async getAiSettings(familyId: string) {
    const rows = check(
      await this.db.from("ai_settings").select("*").eq("family_id", familyId).limit(1),
    ) as AiSettingsRow[] | null;
    return rows?.[0] ?? null;
  }

  async saveAiSettings(row: AiSettingsRow) {
    check(await this.db.from("ai_settings").upsert(row, { onConflict: "family_id" }));
  }
}
