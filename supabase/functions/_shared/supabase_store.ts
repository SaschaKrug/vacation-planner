import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { EntryRow, FamilyPatch, FamilyRow, NoteRow, Store, TypeRow } from "./store.ts";

const PAGE = 1000; // PostgREST default max rows per request
const CHUNK = 200; // keeps `in (...)` filters well below URL length limits

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
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
  ) {
    // One database function, so a failed import leaves the family as it was.
    check(
      await this.db.rpc("replace_family_contents", {
        p_family_id: familyId,
        p_types: types.map(({ family_id: _, ...t }) => t),
        p_entries: entries,
        p_notes: notes,
      }),
    );
  }
}
