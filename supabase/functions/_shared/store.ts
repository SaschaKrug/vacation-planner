// Storage abstraction so the API handler can run against Supabase in
// production and an in-memory store in tests / local development.

export type Role = "none" | "needs_cover" | "covers" | "day_off";
export const ROLES: Role[] = ["none", "needs_cover", "covers", "day_off"];

export interface SessionRow {
  id: string; // secret edit token (in the share URL)
  read_id: string; // read-only token (view link + calendar feed)
  name: string;
  created_at: string;
  updated_at: string;
}

/** An entry type belongs to one year; each year of a session has its own set. */
export interface TypeRow {
  session_id: string;
  year: number;
  id: string; // unique within the session's year
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

export interface Store {
  createSession(session: SessionRow, types: TypeRow[]): Promise<void>;
  /** Looks a session up by its edit id or its read-only id. */
  findSession(token: string): Promise<SessionRow | null>;
  updateSession(id: string, patch: { name?: string }): Promise<void>;
  /** Types of all years, ordered by year and position. */
  listTypes(sessionId: string): Promise<TypeRow[]>;
  upsertTypes(types: TypeRow[]): Promise<void>;
  /** Deletes the type and all of its day entries (which are all in its year). */
  deleteType(sessionId: string, year: number, typeId: string): Promise<void>;
  listEntries(sessionId: string, from?: string, to?: string): Promise<EntryRow[]>;
  addEntries(sessionId: string, rows: EntryRow[]): Promise<void>;
  /** Removes entries on `days`; only the given types if `typeIds` is set. */
  removeEntries(sessionId: string, days: string[], typeIds?: string[]): Promise<void>;
  listNotes(sessionId: string, from?: string, to?: string): Promise<NoteRow[]>;
  /** Inserts or replaces the note on each row's day. */
  upsertNotes(sessionId: string, rows: NoteRow[]): Promise<void>;
  removeNotes(sessionId: string, days: string[]): Promise<void>;
  /** Replaces all types, entries and notes of the session at once: all or nothing. */
  replaceContents(
    sessionId: string,
    types: TypeRow[],
    entries: EntryRow[],
    notes: NoteRow[],
  ): Promise<void>;
}

export class MemoryStore implements Store {
  sessions = new Map<string, SessionRow>();
  types = new Map<string, TypeRow[]>();
  entries = new Map<string, Set<string>>(); // sessionId -> "day|type"
  notes = new Map<string, Map<string, NoteRow>>(); // sessionId -> day -> note

  createSession(session: SessionRow, types: TypeRow[]) {
    this.sessions.set(session.id, { ...session });
    this.types.set(session.id, types.map((t) => ({ ...t })));
    this.entries.set(session.id, new Set());
    this.notes.set(session.id, new Map());
    return Promise.resolve();
  }

  findSession(token: string) {
    const direct = this.sessions.get(token);
    if (direct) return Promise.resolve({ ...direct });
    for (const s of this.sessions.values()) {
      if (s.read_id === token) return Promise.resolve({ ...s });
    }
    return Promise.resolve(null);
  }

  updateSession(id: string, patch: { name?: string }) {
    const s = this.sessions.get(id);
    if (s) Object.assign(s, patch, { updated_at: new Date().toISOString() });
    return Promise.resolve();
  }

  listTypes(sessionId: string) {
    const list = (this.types.get(sessionId) ?? []).map((t) => ({ ...t }));
    return Promise.resolve(list.sort((a, b) => a.year - b.year || a.position - b.position));
  }

  upsertTypes(types: TypeRow[]) {
    for (const type of types) {
      const list = this.types.get(type.session_id) ?? [];
      const i = list.findIndex((t) => t.year === type.year && t.id === type.id);
      if (i >= 0) list[i] = { ...type };
      else list.push({ ...type });
      this.types.set(type.session_id, list);
    }
    return Promise.resolve();
  }

  deleteType(sessionId: string, year: number, typeId: string) {
    const list = this.types.get(sessionId) ?? [];
    this.types.set(sessionId, list.filter((t) => t.year !== year || t.id !== typeId));
    const set = this.entries.get(sessionId);
    if (set) {
      for (const key of [...set]) {
        if (key.startsWith(year + "-") && key.endsWith("|" + typeId)) set.delete(key);
      }
    }
    return Promise.resolve();
  }

  listEntries(sessionId: string, from?: string, to?: string) {
    const rows: EntryRow[] = [];
    for (const key of this.entries.get(sessionId) ?? []) {
      const [day, type_id] = key.split("|");
      if ((from && day < from) || (to && day > to)) continue;
      rows.push({ day, type_id });
    }
    rows.sort((a, b) => a.day.localeCompare(b.day));
    return Promise.resolve(rows);
  }

  addEntries(sessionId: string, rows: EntryRow[]) {
    const set = this.entries.get(sessionId);
    if (set) { for (const r of rows) set.add(r.day + "|" + r.type_id); }
    return Promise.resolve();
  }

  removeEntries(sessionId: string, days: string[], typeIds?: string[]) {
    const set = this.entries.get(sessionId);
    if (!set) return Promise.resolve();
    const daySet = new Set(days);
    for (const key of [...set]) {
      const [day, type] = key.split("|");
      if (daySet.has(day) && (!typeIds || typeIds.includes(type))) set.delete(key);
    }
    return Promise.resolve();
  }

  listNotes(sessionId: string, from?: string, to?: string) {
    const rows = [...(this.notes.get(sessionId)?.values() ?? [])]
      .filter((n) => !(from && n.day < from) && !(to && n.day > to))
      .map((n) => ({ ...n }));
    rows.sort((a, b) => a.day.localeCompare(b.day));
    return Promise.resolve(rows);
  }

  upsertNotes(sessionId: string, rows: NoteRow[]) {
    const map = this.notes.get(sessionId);
    if (map) { for (const r of rows) map.set(r.day, { ...r }); }
    return Promise.resolve();
  }

  removeNotes(sessionId: string, days: string[]) {
    const map = this.notes.get(sessionId);
    if (map) { for (const d of days) map.delete(d); }
    return Promise.resolve();
  }

  replaceContents(sessionId: string, types: TypeRow[], entries: EntryRow[], notes: NoteRow[]) {
    this.types.set(sessionId, types.map((t) => ({ ...t })));
    this.entries.set(sessionId, new Set(entries.map((r) => r.day + "|" + r.type_id)));
    this.notes.set(sessionId, new Map(notes.map((n) => [n.day, { ...n }])));
    return this.updateSession(sessionId, {});
  }

  /** Plain-JSON copy of all data, so the dev server can keep it across restarts. */
  snapshot(): MemorySnapshot {
    return [...this.sessions.values()].map((session) => ({
      session,
      types: this.types.get(session.id) ?? [],
      entries: [...(this.entries.get(session.id) ?? [])],
      notes: [...(this.notes.get(session.id)?.values() ?? [])],
    }));
  }

  restore(snapshot: MemorySnapshot) {
    for (const { session, types, entries, notes } of snapshot) {
      this.sessions.set(session.id, { ...session });
      this.types.set(session.id, types.map((t) => ({ ...t })));
      this.entries.set(session.id, new Set(entries));
      this.notes.set(session.id, new Map(notes.map((n) => [n.day, { ...n }])));
    }
  }
}

export type MemorySnapshot = {
  session: SessionRow;
  types: TypeRow[];
  entries: string[]; // "day|type"
  notes: NoteRow[];
}[];
