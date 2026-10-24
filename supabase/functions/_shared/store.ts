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
  /** Replaces all types, entries and notes of the family at once: all or nothing. */
  replaceContents(
    familyId: string,
    types: TypeRow[],
    entries: EntryRow[],
    notes: NoteRow[],
  ): Promise<void>;
}

export class MemoryStore implements Store {
  families = new Map<string, FamilyRow>();
  types = new Map<string, TypeRow[]>();
  entries = new Map<string, Set<string>>(); // familyId -> "day|type"
  notes = new Map<string, Map<string, NoteRow>>(); // familyId -> day -> note

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

  replaceContents(familyId: string, types: TypeRow[], entries: EntryRow[], notes: NoteRow[]) {
    this.types.set(familyId, types.map((t) => ({ ...t })));
    this.entries.set(familyId, new Set(entries.map((r) => r.day + "|" + r.type_id)));
    this.notes.set(familyId, new Map(notes.map((n) => [n.day, { ...n }])));
    return this.updateFamily(familyId, {});
  }

  /** Plain-JSON copy of all data, so the dev server can keep it across restarts. */
  snapshot(): MemorySnapshot {
    return [...this.families.values()].map((family) => ({
      family,
      types: this.types.get(family.id) ?? [],
      entries: [...(this.entries.get(family.id) ?? [])],
      notes: [...(this.notes.get(family.id)?.values() ?? [])],
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
    }
  }
}

export type MemorySnapshot = {
  family: FamilyRow;
  types: TypeRow[];
  entries: string[]; // "day|type"
  notes: NoteRow[];
}[];

/** A 32-character alphanumeric id, like the database migration makes them. */
function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
