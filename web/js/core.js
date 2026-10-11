// Pure calendar logic (no DOM) – shared by the UI and the unit tests.
// Dates are ISO strings "YYYY-MM-DD"; entries are Map<date, string[] typeIds>,
// notes are Map<date, { icon, comment }>.

const DAY_MS = 86_400_000;

export const ROLES = ["none", "needs_cover", "covers", "day_off"];

export const PALETTE = [
  "#3b82f6",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#84cc16",
  "#06b6d4",
  "#a855f7",
  "#eab308",
  "#64748b",
];

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function iso(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function toUtc(date) {
  return new Date(date + "T00:00:00Z");
}

export function addDays(date, n) {
  return new Date(toUtc(date).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function weekday(date) {
  return toUtc(date).getUTCDay();
}

export function isWeekend(date) {
  const w = weekday(date);
  return w === 0 || w === 6;
}

/** All dates of a year in order. */
export function yearDays(year) {
  const out = [];
  for (let d = `${year}-01-01`; d.startsWith(String(year)); d = addDays(d, 1)) out.push(d);
  return out;
}

/** Inclusive date range, order-independent. */
export function range(a, b) {
  if (a > b) [a, b] = [b, a];
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

export function roleMap(types) {
  return new Map(types.map((t) => [t.id, t.role]));
}

/** A weekday that has a "needs cover" entry but no covering entry. */
export function isGap(date, ids, roles) {
  if (!ids || ids.length === 0 || isWeekend(date)) return false;
  let needs = false;
  for (const id of ids) {
    const r = roles.get(id);
    if (r === "covers" || r === "day_off") return false;
    if (r === "needs_cover") needs = true;
  }
  return needs;
}

export function gapDays(entries, types, year) {
  const roles = roleMap(types);
  const prefix = year === undefined ? "" : String(year);
  return [...entries]
    .filter(([d, ids]) => d.startsWith(prefix) && isGap(d, ids, roles))
    .map(([d]) => d)
    .sort();
}

/** Per type: total days and workdays (Mon–Fri that are not a day off). */
export function stats(entries, types, year) {
  const roles = roleMap(types);
  const out = new Map(types.map((t) => [t.id, { days: 0, workdays: 0 }]));
  for (const [date, ids] of entries) {
    if (year !== undefined && !date.startsWith(String(year))) continue;
    const weekend = isWeekend(date);
    const holiday = ids.some((id) => roles.get(id) === "day_off");
    for (const id of ids) {
      const s = out.get(id);
      if (!s) continue;
      s.days++;
      // A vacation day on a public holiday doesn't use up a vacation day.
      if (!weekend && (!holiday || roles.get(id) === "day_off")) s.workdays++;
    }
  }
  return out;
}

/** Clicking a type on a selection: remove it if every day has it, else add it everywhere. */
export function toggleType(entries, days, typeId) {
  const allHave = days.length > 0 && days.every((d) => (entries.get(d) ?? []).includes(typeId));
  const next = new Map();
  for (const d of days) {
    const cur = entries.get(d) ?? [];
    next.set(d, allHave ? cur.filter((id) => id !== typeId) : [...new Set([...cur, typeId])]);
  }
  return next;
}

export function clearDays(days) {
  return new Map(days.map((d) => [d, []]));
}

/** Entries of the given days as a copy pattern (array of type id arrays). */
export function patternOf(entries, days) {
  return days.map((d) => [...(entries.get(d) ?? [])]);
}

/** Repeats `pattern` over `days` (cyclically) and returns the new day values. */
export function fillWith(days, pattern) {
  const next = new Map();
  if (pattern.length === 0) return next;
  days.forEach((d, i) => next.set(d, [...pattern[i % pattern.length]]));
  return next;
}

/**
 * Days that a paste starting at `selection` should write to. A single selected
 * day receives the whole pattern; a larger selection is filled (repeating the
 * pattern) and nothing outside of it changes.
 */
export function pasteTargets(selection, patternLength, maxDate, skipWeekends) {
  if (selection.length !== 1) return selection;
  const out = [];
  for (let d = selection[0]; out.length < patternLength && d <= maxDate; d = addDays(d, 1)) {
    if (skipWeekends && isWeekend(d)) continue;
    out.push(d);
  }
  return out;
}

/** Only keeps days whose value actually changes. */
export function changedOnly(entries, next) {
  const out = new Map();
  for (const [d, ids] of next) {
    const cur = entries.get(d) ?? [];
    const same = cur.length === ids.length && cur.every((id) => ids.includes(id));
    if (!same) out.set(d, ids);
  }
  return out;
}

/**
 * Converts day changes into add/remove API ops grouped per type. Add/remove
 * (rather than "set") merges nicely with concurrent edits by other people.
 */
export function toOps(entries, next) {
  const add = new Map();
  const remove = new Map();
  for (const [d, ids] of next) {
    const cur = entries.get(d) ?? [];
    for (const id of ids) {
      if (!cur.includes(id)) (add.get(id) ?? add.set(id, []).get(id)).push(d);
    }
    for (const id of cur) {
      if (!ids.includes(id)) (remove.get(id) ?? remove.set(id, []).get(id)).push(d);
    }
  }
  const ops = [];
  for (const [type, dates] of remove) ops.push({ action: "remove", type, dates: dates.sort() });
  for (const [type, dates] of add) ops.push({ action: "add", type, dates: dates.sort() });
  return ops;
}

/** Applies day values to an entries map (in place). */
export function applyDays(entries, next) {
  for (const [d, ids] of next) {
    if (ids.length) entries.set(d, [...ids]);
    else entries.delete(d);
  }
}

// Day notes: Map<date, { icon, comment }>, at most one per day. A change map
// uses null (or a note with neither icon nor comment) to remove a day's note.

/** The note itself, or null if it has neither icon nor comment. */
export function noteOrNull(note) {
  if (!note || !(note.icon || note.comment)) return null;
  return { icon: note.icon ?? "", comment: note.comment ?? "" };
}

export function sameNote(a, b) {
  a = noteOrNull(a);
  b = noteOrNull(b);
  return a === b || (!!a && !!b && a.icon === b.icon && a.comment === b.comment);
}

/** Only keeps days whose note actually changes. */
export function changedNotesOnly(notes, next) {
  const out = new Map();
  for (const [d, note] of next) {
    if (!sameNote(notes.get(d), note)) out.set(d, noteOrNull(note));
  }
  return out;
}

/** Converts note changes into API ops: one "set" per distinct note, one "clear" for removals. */
export function toNoteOps(next) {
  const sets = new Map();
  const clear = [];
  for (const [d, note] of next) {
    const n = noteOrNull(note);
    if (!n) {
      clear.push(d);
      continue;
    }
    const key = JSON.stringify([n.icon, n.comment]);
    (sets.get(key) ?? sets.set(key, { ...n, dates: [] }).get(key)).dates.push(d);
  }
  const ops = [];
  if (clear.length) ops.push({ action: "clear", dates: clear.sort() });
  for (const { icon, comment, dates } of sets.values()) {
    ops.push({ action: "set", dates: dates.sort(), icon, comment });
  }
  return ops;
}

/** Applies note changes to a notes map (in place). */
export function applyNotes(notes, next) {
  for (const [d, note] of next) {
    const n = noteOrNull(note);
    if (n) notes.set(d, n);
    else notes.delete(d);
  }
}

/** Clipboard text: one line per day, "YYYY-MM-DD<TAB>Type A, Type B". */
export function toClipboardText(days, pattern, types) {
  const names = new Map(types.map((t) => [t.id, t.name]));
  return days.map((d, i) => `${d}\t${pattern[i].map((id) => names.get(id) ?? id).join(", ")}`)
    .join("\n");
}

/**
 * Parses clipboard text into a pattern. Accepts our own format as well as a
 * plain column of type names (e.g. pasted from a spreadsheet).
 */
export function parseClipboardText(text, types) {
  const byName = new Map(types.map((t) => [t.name.toLowerCase(), t.id]));
  const ids = new Set(types.map((t) => t.id));
  const unknown = new Set();
  const lines = text.replace(/\r/g, "").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const pattern = lines.map((line) => {
    const cells = line.split("\t");
    if (cells.length > 1 && /^\d{4}-\d{2}-\d{2}$/.test(cells[0].trim())) cells.shift();
    return cells.join(",").split(/[,;+]/).map((s) => s.trim()).filter(Boolean)
      .map((name) => {
        const id = byName.get(name.toLowerCase()) ?? (ids.has(name) ? name : null);
        if (!id) unknown.add(name);
        return id;
      })
      .filter(Boolean);
  });
  return { pattern, unknown: [...unknown] };
}

/** Text color (black/white) that reads well on the given background. */
export function contrastText(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111827" : "#ffffff";
}

export function nextColor(types) {
  const used = new Set(types.map((t) => t.color.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[types.length % PALETTE.length];
}
