import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { EntryRow, SessionRow, Store, TypeRow } from "./store.ts";

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

  async createSession(session: SessionRow, types: TypeRow[]) {
    check(await this.db.from("sessions").insert(session));
    if (types.length) check(await this.db.from("entry_types").insert(types));
  }

  async findSession(token: string) {
    for (const column of ["id", "read_id"]) {
      const row = check(
        await this.db.from("sessions").select("*").eq(column, token).maybeSingle(),
      );
      if (row) return row as SessionRow;
    }
    return null;
  }

  async updateSession(id: string, patch: { name?: string }) {
    check(
      await this.db.from("sessions")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id),
    );
  }

  async listTypes(sessionId: string) {
    const rows = check(
      await this.db.from("entry_types").select("*").eq("session_id", sessionId)
        .order("position"),
    );
    return (rows ?? []) as TypeRow[];
  }

  async upsertType(type: TypeRow) {
    check(await this.db.from("entry_types").upsert(type, { onConflict: "session_id,id" }));
  }

  async deleteType(sessionId: string, typeId: string) {
    // day_entries rows go away through the ON DELETE CASCADE foreign key.
    check(
      await this.db.from("entry_types").delete().eq("session_id", sessionId).eq("id", typeId),
    );
  }

  async listEntries(sessionId: string, from?: string, to?: string) {
    const out: EntryRow[] = [];
    for (let offset = 0;; offset += PAGE) {
      let q = this.db.from("day_entries").select("day,type_id").eq("session_id", sessionId);
      if (from) q = q.gte("day", from);
      if (to) q = q.lte("day", to);
      const rows = check(
        await q.order("day").order("type_id").range(offset, offset + PAGE - 1),
      ) as EntryRow[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async addEntries(sessionId: string, rows: EntryRow[]) {
    for (const part of chunks(rows, 500)) {
      check(
        await this.db.from("day_entries").upsert(
          part.map((r) => ({ session_id: sessionId, ...r })),
          { onConflict: "session_id,day,type_id", ignoreDuplicates: true },
        ),
      );
    }
  }

  async removeEntries(sessionId: string, days: string[], typeIds?: string[]) {
    for (const part of chunks(days, CHUNK)) {
      let q = this.db.from("day_entries").delete().eq("session_id", sessionId).in("day", part);
      if (typeIds) q = q.in("type_id", typeIds);
      check(await q);
    }
  }
}
