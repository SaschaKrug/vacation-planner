import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { EntryRow, NoteRow, SessionRow, Store, TypeRow } from "./store.ts";

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
    // The token goes into the filter string unescaped. That is only safe because
    // tokens are alphanumeric: the handler validates them, and so does this check.
    if (!/^[A-Za-z0-9]+$/.test(token)) return null;
    const rows = check(
      await this.db.from("sessions").select("*").or(`id.eq.${token},read_id.eq.${token}`)
        .limit(2),
    ) as SessionRow[] | null;
    return rows?.find((r) => r.id === token) ?? rows?.[0] ?? null;
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
        .order("year").order("position"),
    );
    return (rows ?? []) as TypeRow[];
  }

  async upsertTypes(types: TypeRow[]) {
    if (!types.length) return;
    check(
      await this.db.from("entry_types").upsert(types, { onConflict: "session_id,year,id" }),
    );
  }

  async deleteType(sessionId: string, year: number, typeId: string) {
    // day_entries rows go away through the ON DELETE CASCADE foreign key.
    check(
      await this.db.from("entry_types").delete().eq("session_id", sessionId).eq("year", year)
        .eq("id", typeId),
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

  async listNotes(sessionId: string, from?: string, to?: string) {
    const out: NoteRow[] = [];
    for (let offset = 0;; offset += PAGE) {
      let q = this.db.from("day_notes").select("day,icon,comment").eq("session_id", sessionId);
      if (from) q = q.gte("day", from);
      if (to) q = q.lte("day", to);
      const rows = check(
        await q.order("day").range(offset, offset + PAGE - 1),
      ) as NoteRow[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async upsertNotes(sessionId: string, rows: NoteRow[]) {
    // No ignoreDuplicates: setting a note replaces the existing one on that day.
    for (const part of chunks(rows, 500)) {
      check(
        await this.db.from("day_notes").upsert(
          part.map((r) => ({ session_id: sessionId, ...r })),
          { onConflict: "session_id,day" },
        ),
      );
    }
  }

  async removeNotes(sessionId: string, days: string[]) {
    for (const part of chunks(days, CHUNK)) {
      check(await this.db.from("day_notes").delete().eq("session_id", sessionId).in("day", part));
    }
  }

  async replaceContents(
    sessionId: string,
    types: TypeRow[],
    entries: EntryRow[],
    notes: NoteRow[],
  ) {
    // One database function, so a failed import leaves the planner as it was.
    check(
      await this.db.rpc("replace_session_contents", {
        p_session_id: sessionId,
        p_types: types.map(({ session_id: _, ...t }) => t),
        p_entries: entries,
        p_notes: notes,
      }),
    );
  }
}
