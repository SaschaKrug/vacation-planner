import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  AccountRow,
  AiSettingsRow,
  CategoryRow,
  EntryRow,
  FamilyPatch,
  FamilyRow,
  FinanceContents,
  FinanceSettingsRow,
  NoteRow,
  Store,
  TransactionRow,
  TypeRow,
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

  async findFamily(token: string) {
    // The token goes into the filter string unescaped. That is only safe because
    // tokens are alphanumeric: the handler validates them, and so does this check.
    if (!/^[A-Za-z0-9]+$/.test(token)) return null;
    const rows = check(
      await this.db.from("families").select("*")
        .or(`id.eq.${token},read_id.eq.${token},feed_id.eq.${token},legacy_id.eq.${token}`)
        .limit(2),
    ) as FamilyRow[] | null;
    return rows?.find((r) => r.id === token) ?? rows?.[0] ?? null;
  }

  async updateFamily(id: string, patch: FamilyPatch) {
    check(
      await this.db.from("families")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id),
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
    // Transactions keep their rows: ON DELETE SET NULL clears their account.
    check(
      await this.db.from("finance_accounts").delete().eq("family_id", familyId).eq("id", id),
    );
  }

  async accountTotals(familyId: string) {
    const rows = check(
      await this.db.from("finance_account_totals").select("account_id,total_cents")
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

  async upsertTransactions(rows: TransactionRow[]) {
    for (const part of chunks(rows, 500)) {
      check(await this.db.from("transactions").upsert(part, { onConflict: "family_id,id" }));
    }
  }

  async deleteTransactions(familyId: string, ids: string[]) {
    for (const part of chunks(ids, CHUNK)) {
      check(await this.db.from("transactions").delete().eq("family_id", familyId).in("id", part));
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
