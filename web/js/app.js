import { api, isConfigured } from "./api.js";
import { applyStatic, lang, LANGS, setLang, t } from "./i18n.js";
import {
  addDays,
  applyDays,
  applyNotes,
  changedNotesOnly,
  changedOnly,
  clearDays,
  contrastText,
  daysInMonth,
  fillWith,
  gapDays,
  isGap,
  iso,
  isWeekend,
  nextColor,
  noteOrNull,
  parseClipboardText,
  pasteTargets,
  patternOf,
  range,
  roleMap,
  ROLES,
  sameNote,
  stats,
  toClipboardText,
  toggleType,
  toNoteOps,
  toOps,
  weekday,
} from "./core.js";

const $ = (id) => document.getElementById(id);
const POLL_MS = 15000;
const RECENT_KEY = "vp-recent";
const CACHE_KEY = "vp-cache";
const HINTED_KEY = "vp-hinted";
const LONG_PRESS_MS = 350;
const CACHE_SIZE = 12;
const MAX_DAYS_PER_REQUEST = 4000; // server limit
const SHORT_DATE = { weekday: "short", day: "numeric", month: "short" };
const LONG_DATE = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
const NOTE_ICONS = [
  "🎄",
  "🎅",
  "🎁",
  "🎆",
  "🐣",
  "🐰",
  "🎃",
  "🎂",
  "🎉",
  "❤️",
  "⭐",
  "📌",
  "✈️",
  "🏖️",
  "⛷️",
  "🏫",
  "🏥",
  "🎓",
  "💼",
  "⚽",
];

const state = {
  token: null, // id from the URL (edit id or read-only id)
  session: null,
  types: [], // the types of `year`; every year has its own
  typeYears: null, // years that have types (null until loaded)
  entries: new Map(),
  notes: new Map(), // date -> { icon, comment }
  year: new Date().getFullYear(),
  readOnly: true,
  selection: new Set(),
  anchor: null,
  focus: null,
  clipboard: null, // { pattern, text, year }
  undo: [], // { kind: "entries" | "notes", before, after }
  redo: [],
  version: 0, // bumps on every local change; stale poll responses are dropped
  rangeMode: false,
  multi: false, // touch: taps add days to the selection or remove them
};

const today = (() => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
})();

// ---------------------------------------------------------------- utilities

function toast(msg, ms = 2600) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), ms);
}

let syncState = ["", false];

/** Shows a "sync.*" status; kept so it can be re-translated on a language switch. */
function setSync(key, error = false) {
  syncState = [key, error];
  const el = $("sync-status");
  const text = key ? t(key) : "";
  el.querySelector(".sync-text").textContent = text;
  el.title = text;
  // saved | saving | loading | updating | error: styles.css draws a colored dot for each.
  el.dataset.state = error ? "error" : key.replace("sync.", "");
}

function storage(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const formatters = new Map(); // Intl.DateTimeFormat is slow to create; reuse per language

function fmtDate(d, opts = SHORT_DATE) {
  const key = lang + JSON.stringify(opts);
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(lang, opts));
  return formatters.get(key).format(new Date(d + "T00:00:00"));
}

function typeById(id) {
  return state.types.find((t) => t.id === id);
}

function pageUrl(params) {
  const url = new URL(location.href);
  url.search = new URLSearchParams(params).toString();
  url.hash = "";
  return url.href;
}

function rememberSession() {
  if (!state.session) return;
  const list = storage(() => JSON.parse(localStorage.getItem(RECENT_KEY)) || [], []);
  const entry = {
    token: state.token,
    name: state.session.name,
    readOnly: state.readOnly,
    at: Date.now(),
  };
  const next = [entry, ...list.filter((e) => e.token !== state.token)].slice(0, 10);
  storage(() => localStorage.setItem(RECENT_KEY, JSON.stringify(next)));
}

// Last responses per planner + year (most recent first), shown instantly while refreshing.
function readCache() {
  const list = storage(() => JSON.parse(localStorage.getItem(CACHE_KEY)), null);
  return Array.isArray(list)
    ? list.filter((e) => Array.isArray(e) && e[1]?.session && e[1].types && e[1].entries)
    : [];
}

function writeCache(list) {
  storage(() => localStorage.setItem(CACHE_KEY, JSON.stringify(list)));
}

function cachedResponse(token, year) {
  return readCache().find(([key]) => key === `${token}|${year}`)?.[1] ?? null;
}

function cacheResponse(token, year, data) {
  const key = `${token}|${year}`;
  writeCache([[key, data], ...readCache().filter(([k]) => k !== key)].slice(0, CACHE_SIZE));
}

/** Caches what is shown now, so local edits appear instantly next time too. */
function cacheState() {
  if (!state.session) return;
  const { session, types, typeYears, entries, notes } = state;
  cacheResponse(state.token, state.year, {
    session,
    types,
    typeYears,
    entries: Object.fromEntries(entries),
    notes: Object.fromEntries(notes),
  });
}

function uncache(token) {
  writeCache(readCache().filter(([key]) => !key.startsWith(token + "|")));
}

// ---------------------------------------------------------------- sync

const queue = []; // { kind: "entries" | "notes", ops }
let flushing = false;
let retryDelay = 2000;
let wake = null; // ends the retry backoff early
let lastResponse = null; // JSON of the last applied response...
let appliedVersion = -1; // ...and state.version right after applying it
let reloadAfterSave = false; // a load was dropped because of local changes

const send = {
  entries: (token, ops) => api.applyOps(token, ops),
  notes: (token, ops) => api.applyNoteOps(token, ops),
};

function enqueue(kind, ops) {
  if (!ops.length) return;
  queue.push({ kind, ops });
  flush();
}

async function flush() {
  if (flushing) return;
  flushing = true;
  while (queue.length) {
    setSync("sync.saving");
    // Send queued batches as one request; ops are applied in order, so this is equivalent.
    // Entries and notes go to different endpoints, so a batch holds only one kind.
    const kind = queue[0].kind;
    const ops = [];
    let n = 0;
    let days = 0;
    for (; n < queue.length && queue[n].kind === kind; n++) {
      const size = queue[n].ops.reduce((sum, op) => sum + op.dates.length, 0);
      if (n && days + size > MAX_DAYS_PER_REQUEST) break;
      days += size;
      ops.push(...queue[n].ops);
    }
    try {
      await send[kind](state.token, ops);
      queue.splice(0, n);
      retryDelay = 2000;
    } catch (err) {
      if (err.status && err.status < 500) {
        // The server rejected it (e.g. a type was deleted elsewhere): drop and resync.
        queue.splice(0, n);
        toast(t("toast.save_failed", { msg: err.message }));
        await load();
        continue;
      }
      setSync("sync.retrying", true);
      await new Promise((r) => {
        wake = r;
        setTimeout(r, retryDelay);
      });
      wake = null;
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  }
  flushing = false;
  setSync("sync.saved");
  cacheState();
  if (reloadAfterSave) load({ quiet: true });
}

function applyResponse(data, json = JSON.stringify(data)) {
  state.session = data.session;
  state.readOnly = data.session.readOnly;
  state.types = data.types;
  state.typeYears = data.typeYears ?? null;
  state.entries = new Map(Object.entries(data.entries));
  state.notes = new Map(Object.entries(data.notes ?? {}));
  lastResponse = json;
  appliedVersion = state.version;
}

/** Shows the cached response for the current year, if any. */
function applyCached() {
  const data = cachedResponse(state.token, state.year);
  if (data) applyResponse(data);
  return !!data;
}

/** Fetches and shows the planner; resolves to false if it doesn't exist. */
async function load({ quiet = false, pending = null } = {}) {
  const version = state.version;
  const year = state.year;
  const token = state.token;
  try {
    const data = await (pending ?? api.getSession(token, year));
    // Ignore if the user changed something meanwhile or switched years.
    if (version !== state.version || year !== state.year || queue.length) {
      reloadAfterSave = true; // catch up once the queued changes are saved
      return true;
    }
    reloadAfterSave = false;
    const json = JSON.stringify(data);
    // Skip identical responses unless something changed locally since the last one.
    const changed = json !== lastResponse || appliedVersion !== state.version;
    if (changed || !quiet) cacheResponse(token, year, data);
    if (changed) {
      applyResponse(data, json);
      render();
    }
    if (!quiet || syncState[1]) setSync("sync.saved");
  } catch (err) {
    if (err.status === 404) {
      uncache(token);
      showLanding(t("toast.not_found"));
      return false;
    }
    if (!quiet) toast(t("toast.load_failed", { msg: err.message }));
    setSync("sync.offline", true);
  }
  return true;
}

// No refresh while a dialog is open, so it can't overwrite edits in progress.
function isIdle() {
  return document.visibilityState === "visible" && !$("planner").hidden && !drag &&
    !queue.length && !document.querySelector("dialog[open]");
}

function startPolling() {
  setInterval(() => isIdle() && load({ quiet: true }), POLL_MS);
  document.addEventListener("visibilitychange", () => isIdle() && load({ quiet: true }));
  window.addEventListener("online", () => {
    if (wake) wake();
    else if (isIdle()) load({ quiet: true });
  });
}

// ---------------------------------------------------------------- editing

/** Applies day changes locally, records undo and sends them to the server. */
function commit(next, { record = true } = {}) {
  if (state.readOnly) return;
  const changes = changedOnly(state.entries, next);
  if (!changes.size) return;
  const before = new Map([...changes.keys()].map((d) => [d, [...(state.entries.get(d) ?? [])]]));
  const ops = toOps(state.entries, changes);
  applyDays(state.entries, changes);
  state.version++;
  if (record) recordStep({ kind: "entries", before, after: changes });
  enqueue("entries", ops);
  render();
}

/** Same as commit() for day notes (next: Map<date, note | null>). */
function commitNotes(next, { record = true } = {}) {
  if (state.readOnly) return;
  const changes = changedNotesOnly(state.notes, next);
  if (!changes.size) return;
  const before = new Map([...changes.keys()].map((d) => [d, state.notes.get(d) ?? null]));
  const ops = toNoteOps(changes);
  applyNotes(state.notes, changes);
  state.version++;
  if (record) recordStep({ kind: "notes", before, after: changes });
  enqueue("notes", ops);
  render();
}

function recordStep(step) {
  state.undo.push(step);
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  renderHistory();
}

function applyStep(step, values) {
  if (step.kind === "notes") commitNotes(values, { record: false });
  else commit(values, { record: false });
}

function undo() {
  const step = state.undo.pop();
  if (!step) return toast(t("toast.nothing_undo"));
  applyStep(step, step.before);
  state.redo.push(step);
  renderHistory();
}

function redo() {
  const step = state.redo.pop();
  if (!step) return toast(t("toast.nothing_redo"));
  applyStep(step, step.after);
  state.undo.push(step);
  renderHistory();
}

function selectedDays() {
  return [...state.selection].sort();
}

/** Selected days honoring the "skip weekends" option. */
function targetDays(days = selectedDays()) {
  const skip = $("skip-weekends").checked && days.length > 1;
  return skip ? days.filter((d) => !isWeekend(d)) : days;
}

function toggleOnSelection(typeId) {
  if (state.readOnly) return;
  const days = targetDays();
  if (!days.length) return toast(t("toast.select_first"));
  commit(toggleType(state.entries, days, typeId));
}

function clearSelection() {
  const days = selectedDays();
  if (days.length) commit(clearDays(days));
}

function copySelection() {
  const days = selectedDays();
  if (!days.length) return null;
  // Copy the whole span so gaps between selected days are kept.
  const span = range(days[0], days[days.length - 1]);
  const pattern = patternOf(state.entries, span);
  const text = toClipboardText(span, pattern, state.types);
  state.clipboard = { pattern, text, year: state.year };
  toast(t("toast.copied_days", { n: span.length }));
  return text;
}

function pastePattern(pattern) {
  if (state.readOnly) return;
  const days = selectedDays();
  if (!days.length) return toast(t("toast.select_paste"));
  if (!pattern.length) return;
  const skip = $("skip-weekends").checked;
  const targets = days.length === 1
    ? pasteTargets(days, pattern.length, `${state.year}-12-31`, skip)
    : targetDays(days);
  commit(fillWith(targets, pattern));
  if (days.length === 1) select(targets[0], targets[targets.length - 1]);
}

// ---------------------------------------------------------------- selection

function select(a, b = a, { add = false } = {}) {
  if (!add) state.selection.clear();
  for (const d of range(a, b)) if (d.startsWith(String(state.year))) state.selection.add(d);
  state.anchor = a;
  state.focus = b;
  renderSelection();
}

/** Adds a single day to the selection, or removes it if it is already selected. */
function toggleDay(date) {
  if (!state.selection.has(date)) return select(date, date, { add: true });
  state.selection.delete(date);
  state.anchor = state.focus = date;
  renderSelection();
}

function setMulti(on) {
  state.multi = on;
  $("btn-multi").setAttribute("aria-pressed", String(on));
}

function isContiguous(days) {
  return days.length > 0 && range(days[0], days[days.length - 1]).length === days.length;
}

function moveFocus(delta, extend) {
  const from = state.focus ?? today;
  let next;
  if (Math.abs(delta) < 31) next = addDays(from, delta); // days, or weeks in the month view
  else {
    // Up/down: same day number in the previous/next month (clamped).
    const [y, m, d] = from.split("-").map(Number);
    const month = m - 1 + Math.sign(delta);
    if (month < 0 || month > 11) return;
    next = iso(y, month, Math.min(d, daysInMonth(y, month)));
  }
  if (!next.startsWith(String(state.year))) return;
  if (extend) select(state.anchor ?? from, next);
  else select(next);
  cellFor(next)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function jumpToNextGap() {
  const gaps = gapDays(state.entries, state.types, state.year);
  if (!gaps.length) return toast(t("toast.no_gaps", { year: state.year }));
  const after = gaps.find((d) => d > (state.focus ?? "")) ?? gaps[0];
  select(after);
  centerInGrid(after);
}

// Scrolls only the calendar (not the page) so the day sits in the middle of the visible
// cells, clear of the sticky day numbers and month names.
function centerInGrid(date) {
  const cell = cellFor(date);
  if (!cell) return;
  if (monthView()) return cell.scrollIntoView({ block: "center" }); // the page scrolls
  const wrap = $("grid-wrap");
  const corner = $("grid").firstElementChild;
  const left = corner.offsetWidth, top = corner.offsetHeight;
  wrap.scrollTo({
    left: cell.offsetLeft - left - (wrap.clientWidth - left - cell.offsetWidth) / 2,
    top: cell.offsetTop - top - (wrap.clientHeight - top - cell.offsetHeight) / 2,
  });
}

// ---------------------------------------------------------------- zoom

// The zoom is the number of days that fit across the year grid, remembered per device.
// All months show in a window that ends at the bottom of the screen (see styles.css).
// Phones show stacked month calendars instead, which don't zoom.
const ZOOM = { min: 7, max: 31, initial: 31, key: "vp-days-wide" };
const SHOW_WEEKDAYS = 16; // from this zoom on, cells are big enough for weekday letters
const narrowScreen = matchMedia("(max-width: 640px)");
const coarsePointer = matchMedia("(pointer: coarse)");

/** Phones show one calendar per month (7 columns) instead of the 12 × 31 year grid. */
function monthView() {
  return narrowScreen.matches;
}

function shownDays() {
  const n = storage(() => Number(localStorage.getItem(ZOOM.key)), 0);
  return n >= ZOOM.min && n <= ZOOM.max ? n : ZOOM.initial;
}

function setShownDays(n) {
  n = Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(n)));
  storage(() => localStorage.setItem(ZOOM.key, String(n)));
  applyZoom();
}

/** Ctrl/⌘ + / − steps by about a quarter; 0 resets. */
function zoomBy(dir) {
  if (monthView()) return;
  const n = shownDays();
  if (!dir) setShownDays(ZOOM.initial);
  else if (dir > 0) setShownDays(Math.min(n - 1, Math.round(n / 1.25)));
  else setShownDays(Math.max(n + 1, Math.round(n * 1.25)));
}

/** The day in the middle of the visible part of the calendar. */
function centerDate() {
  const wrap = $("grid-wrap");
  const corner = $("grid").firstElementChild;
  if (!corner) return null;
  const r = wrap.getBoundingClientRect();
  const top = Math.max(r.top + corner.offsetHeight, 0);
  const bottom = Math.min(r.bottom, innerHeight);
  const left = r.left + corner.offsetWidth;
  return dateAt((left + r.right) / 2, (top + bottom) / 2);
}

function applyZoom({ keepView = true } = {}) {
  const n = shownDays();
  const wrap = $("grid-wrap");
  const keep = keepView && !$("planner").hidden && !monthView()
    ? state.focus ?? centerDate()
    : null;
  wrap.style.setProperty("--days", n);
  wrap.classList.toggle("show-wd", n <= SHOW_WEEKDAYS);
  const slider = $("zoom");
  slider.min = ZOOM.min;
  slider.max = ZOOM.max;
  slider.value = ZOOM.min + ZOOM.max - n; // to the right = zoom in = fewer days
  $("zoom-value").textContent = t("toolbar.zoom_days", { n });
  if (keep) centerInGrid(keep);
}

/** Wide screens: measures where the calendar starts and what sits below it, so it can end
 *  at the bottom of the screen and keep the day numbers and month names in view. */
function fitGridWindow() {
  const wrap = $("grid-wrap");
  const r = wrap.getBoundingClientRect();
  const below = $("planner").getBoundingClientRect().bottom - r.bottom;
  wrap.style.setProperty("--wrap-top", `${Math.round(r.top + scrollY)}px`);
  wrap.style.setProperty("--wrap-below", `${Math.max(0, Math.round(below))}px`);
}
new ResizeObserver(fitGridWindow).observe($("planner"));

// ---------------------------------------------------------------- rendering

let cells = new Map();
let cellSigs = new WeakMap(); // cell -> rendered type ids + note; new cells are rendered in full
let cellTypesSig = null;
let shownSel = new Set();
let shownFocus = null;
let previewed = new Set();
let chipsSig = null;
const fillHandle = Object.assign(document.createElement("i"), { className: "fill-handle" });

function cellFor(date) {
  return cells.get(date);
}

function buildGrid() {
  const grid = $("grid");
  grid.textContent = "";
  cells = new Map();
  fillHandle.title = t("fill.handle");
  shownSel = new Set();
  shownFocus = null;
  previewed = new Set();
  const months = monthView();
  grid.classList.toggle("yv", !months);
  grid.classList.toggle("mv", months);
  grid.append(months ? buildMonths() : buildYear());
  grid.dataset.year = state.year;
  grid.dataset.layout = layoutName();
}

function layoutName() {
  return monthView() ? "months" : "year";
}

/** A day cell; `label` is its weekday letter (year grid) or day number (month view). */
function makeCell(date, label) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.setAttribute("role", "gridcell");
  cell.dataset.date = date;
  const wd = document.createElement("span");
  wd.className = "wd";
  wd.textContent = label;
  const fills = document.createElement("div");
  fills.className = "fills";
  const icon = document.createElement("span");
  icon.className = "note-icon";
  const mark = document.createElement("span");
  mark.className = "note-mark";
  const overlay = document.createElement("div");
  overlay.className = "sel-overlay";
  cell.append(fills, wd, icon, mark, overlay);
  if (isWeekend(date)) cell.classList.add("weekend");
  if (date === today) cell.classList.add("today");
  cells.set(date, cell);
  return cell;
}

/** Wide screens: 12 month rows × 31 day columns. */
function buildYear() {
  const frag = document.createDocumentFragment();
  const corner = document.createElement("div");
  corner.className = "head corner";
  frag.append(corner);
  const [ty, tm, td] = today.split("-").map(Number);
  const thisYear = ty === state.year;
  for (let d = 1; d <= 31; d++) {
    const h = document.createElement("div");
    h.className = "head";
    h.classList.toggle("is-today", thisYear && d === td);
    h.textContent = d;
    frag.append(h);
  }
  for (let m = 0; m < 12; m++) {
    const label = document.createElement("div");
    label.className = "month";
    label.classList.toggle("is-today", thisYear && m === tm - 1);
    label.textContent = t("months")[m];
    frag.append(label);
    const n = daysInMonth(state.year, m);
    for (let d = 1; d <= 31; d++) {
      if (d > n) {
        const cell = document.createElement("div");
        cell.className = "cell invalid";
        cell.setAttribute("role", "gridcell");
        frag.append(cell);
      } else {
        const date = iso(state.year, m, d);
        frag.append(makeCell(date, t("weekdays")[weekday(date)]));
      }
    }
  }
  return frag;
}

/** Phones: one calendar per month, weeks from Monday to Sunday, scrolling with the page. */
function buildMonths() {
  const frag = document.createDocumentFragment();
  const names = Array.from(
    { length: 7 },
    (_, i) => fmtDate(iso(2024, 0, 1 + i), { weekday: "short" }), // Jan 1, 2024 was a Monday
  );
  for (let m = 0; m < 12; m++) {
    const first = iso(state.year, m, 1);
    const section = document.createElement("section");
    section.className = "mv-month";
    section.classList.toggle("is-today", first.slice(0, 7) === today.slice(0, 7));
    const title = document.createElement("h3");
    title.className = "mv-title";
    title.textContent = fmtDate(first, { month: "long", year: "numeric" });
    const days = document.createElement("div");
    days.className = "mv-days";
    for (const name of names) {
      const h = document.createElement("div");
      h.className = "mv-wd";
      h.textContent = name;
      days.append(h);
    }
    for (let i = (weekday(first) + 6) % 7; i > 0; i--) {
      days.append(Object.assign(document.createElement("div"), { className: "mv-blank" }));
    }
    for (let d = 1; d <= daysInMonth(state.year, m); d++) {
      days.append(makeCell(iso(state.year, m, d), d));
    }
    section.append(title, days);
    frag.append(section);
  }
  return frag;
}

/** Everything about the types that shows up in cells and chips. */
function typesSig() {
  return JSON.stringify(state.types.map((t) => [t.id, t.name, t.color, t.role]));
}

function renderCells() {
  const sig = typesSig();
  if (sig !== cellTypesSig) {
    cellSigs = new WeakMap();
    cellTypesSig = sig;
  }
  const roles = roleMap(state.types);
  const byId = new Map(state.types.map((t) => [t.id, t]));
  const order = new Map(state.types.map((t, i) => [t.id, i]));
  for (const [date, cell] of cells) {
    const ids = (state.entries.get(date) ?? []).filter((id) => order.has(id))
      .sort((a, b) => order.get(a) - order.get(b));
    const note = state.notes.get(date);
    const key = ids.join(",") + (note ? "|" + note.icon + "|" + note.comment : "");
    if (cellSigs.get(cell) === key) continue;
    cellSigs.set(cell, key);
    const fills = cell.firstChild;
    fills.textContent = "";
    for (const id of ids) {
      const t = byId.get(id);
      const s = document.createElement("span");
      s.style.backgroundColor = t.color;
      if (t.role === "needs_cover") s.className = "needs";
      fills.append(s);
    }
    cell.classList.toggle("has-fill", ids.length > 0);
    cell.style.color = ids.length ? contrastText(byId.get(ids[0]).color) : "";
    cell.classList.toggle("gap", isGap(date, ids, roles));
    cell.querySelector(".note-icon").textContent = note?.icon ?? "";
    cell.classList.toggle("has-comment", !!note?.comment);
    const names = ids.map((id) => byId.get(id).name).join(", ");
    cell.title = fmtDate(date, LONG_DATE) + (names ? "\n" + names : "") +
      (note ? "\n" + noteText(note) : "");
  }
}

function noteText(note) {
  return [note.icon, note.comment].filter(Boolean).join(" ");
}

function renderSelection() {
  // Only touch cells whose state changed since the last call.
  const sel = state.selection;
  for (const d of shownSel) if (!sel.has(d)) cellFor(d)?.classList.remove("sel");
  for (const d of sel) if (!shownSel.has(d)) cellFor(d)?.classList.add("sel");
  const focus = sel.has(state.focus) ? state.focus : null;
  if (focus !== shownFocus) {
    cellFor(shownFocus)?.classList.remove("focus");
    cellFor(focus)?.classList.add("focus");
  }
  shownSel = new Set(sel);
  shownFocus = focus;
  const days = selectedDays();
  const last = !state.readOnly && isContiguous(days) && cellFor(days[days.length - 1]);
  if (last) last.append(fillHandle);
  else fillHandle.remove();
  renderSelectionInfo(days);
  renderChipsActive(days);
}

function renderSelectionInfo(days) {
  const el = $("selection-info");
  $("selbar").classList.toggle("has-sel", days.length > 0);
  if (!days.length) {
    el.textContent = state.readOnly
      ? t("sel.view_only")
      : t(coarsePointer.matches ? "sel.none_touch" : "sel.none");
    return;
  }
  // Phones show the "how to select" hint only until the first selection.
  if (!$("planner").classList.contains("hinted")) {
    $("planner").classList.add("hinted");
    storage(() => localStorage.setItem(HINTED_KEY, "1"));
  }
  const work = days.filter((d) => !isWeekend(d)).length;
  const span = days.length === 1
    ? fmtDate(days[0])
    : `${fmtDate(days[0])} – ${fmtDate(days[days.length - 1])}`;
  // Touch devices have no tooltips, so a single day's note is shown here.
  const note = days.length === 1 && state.notes.get(days[0]);
  el.textContent = t("sel.info", { n: days.length, work, span }) +
    (note ? " · " + noteText(note) : "");
}

function renderHistory() {
  $("btn-undo").disabled = !state.undo.length;
  $("btn-redo").disabled = !state.redo.length;
}

function renderChipsActive(days) {
  for (const chip of document.querySelectorAll(".chip[data-type]")) {
    const id = chip.dataset.type;
    const all = days.length > 0 && days.every((d) => (state.entries.get(d) ?? []).includes(id));
    chip.classList.toggle("active", all);
  }
}

function chipTitle(type, i, st) {
  return t("chip.title", {
    name: type.name,
    role: t("role." + type.role),
    days: st.days,
    workdays: st.workdays,
    year: state.year,
  }) + (state.readOnly ? "" : t("chip.toggle_hint", { key: i + 1 }));
}

/** The year to copy types from when this year has none: the closest earlier one, else later. */
function copySource() {
  const years = (state.typeYears ?? []).filter((y) => y !== state.year);
  return years.filter((y) => y < state.year).pop() ?? years[0] ?? null;
}

function renderNoTypes(box) {
  const source = copySource();
  const sig = ["none", state.year, state.typeYears === null, source, state.readOnly, lang]
    .join("|");
  if (sig === chipsSig) return;
  chipsSig = sig;
  box.textContent = "";
  if (state.typeYears === null) return; // not loaded yet
  const empty = document.createElement("div");
  empty.className = "types-empty";
  const msg = document.createElement("span");
  msg.textContent = state.readOnly
    ? t("types.empty_readonly", { year: state.year })
    : t("types.empty", { year: state.year });
  empty.append(msg);
  if (source && !state.readOnly) {
    const btn = document.createElement("button");
    btn.className = "btn small primary";
    btn.textContent = t("types.copy_from", { year: source });
    btn.title = t("types.copy_from_title", { from: source, to: state.year });
    btn.addEventListener("click", () => copyTypes(source, btn));
    empty.append(btn);
  } else if (!state.readOnly) {
    const btn = document.createElement("button");
    btn.className = "btn small primary";
    btn.textContent = t("types.add_first");
    btn.addEventListener("click", openTypesDialog);
    empty.append(btn);
  }
  box.append(empty);
}

function renderTypes() {
  const box = $("types");
  if (!state.types.length) return renderNoTypes(box);
  const s = stats(state.entries, state.types, state.year);
  const sig = typesSig() + state.readOnly + lang;
  if (sig === chipsSig) {
    // Same chips: update the numbers in place (keeps keyboard focus on them).
    state.types.forEach((type, i) => {
      const chip = box.children[i];
      const st = s.get(type.id);
      chip.title = chipTitle(type, i, st);
      chip.querySelector(".count").textContent = t("chip.count", { n: st.workdays });
    });
    return;
  }
  chipsSig = sig;
  box.textContent = "";
  state.types.forEach((type, i) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.dataset.type = type.id;
    chip.style.setProperty("--c", type.color);
    chip.disabled = state.readOnly;
    const st = s.get(type.id);
    chip.title = chipTitle(type, i, st);
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = type.color;
    if (type.role === "needs_cover") {
      sw.style.backgroundImage =
        "repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 3px, transparent 3px 7px)";
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = type.name;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = t("chip.count", { n: st.workdays });
    chip.append(sw, name, count);
    chip.addEventListener("click", () => toggleOnSelection(type.id));
    box.append(chip);
  });
}

function renderCoverage() {
  const el = $("coverage");
  const needs = state.types.filter((t) => t.role === "needs_cover");
  if (!needs.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const gaps = gapDays(state.entries, state.types, state.year);
  el.classList.toggle("has-gaps", gaps.length > 0);
  el.textContent = "";
  const msg = document.createElement("span");
  const names = needs.map((t) => t.name).join(" / ");
  if (gaps.length) {
    msg.className = "bad";
    msg.textContent = t("coverage.gaps", { n: gaps.length });
    el.title = t("coverage.gaps_title", { n: gaps.length, names });
    const btn = document.createElement("button");
    btn.className = "btn small";
    btn.textContent = t("coverage.next");
    btn.title = t("coverage.next_title");
    btn.addEventListener("click", jumpToNextGap);
    el.append(msg, btn);
  } else {
    msg.className = "ok";
    msg.textContent = t("coverage.ok");
    el.title = t("coverage.ok_title", { names, year: state.year });
    el.append(msg);
  }
}

function render() {
  const grid = $("grid");
  if (Number(grid.dataset.year) !== state.year || grid.dataset.layout !== layoutName()) {
    buildGrid();
  }
  $("planner").classList.toggle("readonly", state.readOnly);
  $("readonly-banner").hidden = !state.readOnly;
  $("btn-edit-types").hidden = state.readOnly;
  $("history").hidden = state.readOnly;
  $("sel-actions").hidden = state.readOnly;
  const nameInput = $("session-name");
  if (document.activeElement !== nameInput) nameInput.value = state.session?.name ?? "";
  nameInput.readOnly = state.readOnly;
  document.title = (state.session?.name ?? t("app.title")) + ` ${state.year}`;
  renderTypes();
  renderCells();
  renderSelection();
  renderCoverage();
  renderHistory();
}

function renderYearSelect() {
  const sel = $("year");
  const now = new Date().getFullYear();
  const years = new Set();
  for (let y = now - 5; y <= now + 5; y++) years.add(y);
  years.add(state.year);
  sel.textContent = "";
  for (const y of [...years].sort()) {
    const o = document.createElement("option");
    o.value = y;
    o.textContent = y;
    o.selected = y === state.year;
    sel.append(o);
  }
}

function setYear(y) {
  if (y < 1900 || y > 2200 || y === state.year) return;
  cacheState();
  state.year = y;
  state.selection.clear();
  state.anchor = state.focus = null;
  // Undo steps hold type ids of the year they were made in.
  state.undo = [];
  state.redo = [];
  state.version++;
  if (applyCached()) setSync("sync.updating");
  else {
    state.types = [];
    state.typeYears = null;
    state.entries = new Map();
    state.notes = new Map();
  }
  history.replaceState(null, "", pageUrl({ s: state.token, y }));
  renderYearSelect();
  render();
  load();
}

// ---------------------------------------------------------------- pointer input

let drag = null; // { mode: "tap" | "select" | "fill", ... }
let lastPointer = "mouse";
let edgeScrolling = false;

function dateAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest?.(".cell[data-date]");
  return el?.dataset.date ?? null;
}

function fillTargets(src, hover) {
  const start = src[0];
  const end = src[src.length - 1];
  if (hover > end) return { days: range(addDays(end, 1), hover), backwards: false };
  if (hover < start) return { days: range(hover, addDays(start, -1)), backwards: true };
  return { days: [], backwards: false };
}

function showFillPreview(days) {
  const next = new Set(days);
  for (const d of previewed) if (!next.has(d)) cellFor(d)?.classList.remove("fill-preview");
  for (const d of next) if (!previewed.has(d)) cellFor(d)?.classList.add("fill-preview");
  previewed = next;
  if (drag?.mode !== "fill") return;
  const n = days.length;
  $("selection-info").textContent = n ? t("fill.count", { n }) : t("fill.drag_past");
}

/** Aborts a fill drag in progress; returns whether there was one. */
function cancelFill() {
  if (drag?.mode !== "fill") return false;
  const grid = $("grid");
  if (grid.hasPointerCapture(drag.pointerId)) grid.releasePointerCapture(drag.pointerId);
  drag = null;
  showFillPreview([]);
  renderSelectionInfo(selectedDays());
  return true;
}

function onPointerDown(e) {
  lastPointer = e.pointerType;
  if (e.button !== 0) return;
  const handle = e.target.closest(".fill-handle");
  const date = e.target.closest(".cell[data-date]")?.dataset.date;
  if (!date) return;
  $("grid").focus({ preventScroll: true });

  if (handle && !state.readOnly) {
    e.preventDefault();
    drag = { mode: "fill", src: selectedDays(), targets: [], pointerId: e.pointerId };
    $("grid").setPointerCapture(e.pointerId);
    showFillPreview([]);
    return;
  }

  if (e.pointerType === "touch") {
    // Touch: a tap selects a day (see onPointerUp) and a long press starts selecting a
    // range, so a swipe still scrolls; the touchmove listener in bind() stops the scrolling
    // once a range selection runs. In multi-select mode both add to the selection.
    const timer = setTimeout(() => {
      if (drag?.mode !== "tap" || drag.date !== date) return;
      const base = new Set(state.multi ? state.selection : []);
      drag = { mode: "select", anchor: date, base, last: date, touch: true };
      state.selection = new Set(base);
      select(date, date, { add: true });
      navigator.vibrate?.(10);
    }, LONG_PRESS_MS);
    drag = { mode: "tap", date, x: e.clientX, y: e.clientY, timer };
    return;
  }

  e.preventDefault();
  if (e.shiftKey && state.anchor) {
    select(state.anchor, date);
    drag = { mode: "select", anchor: state.anchor, base: new Set(), last: date };
  } else if (e.ctrlKey || e.metaKey) {
    const base = new Set(state.selection);
    if (base.has(date)) {
      toggleDay(date);
      drag = null;
      return;
    }
    drag = { mode: "select", anchor: date, base, last: date };
    state.selection = new Set(base);
    select(date, date, { add: true });
  } else {
    drag = { mode: "select", anchor: date, base: new Set(), last: date };
    select(date);
  }
  $("grid").setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!drag) return;
  if (drag.mode === "tap") {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 10) endDrag(); // a scroll
    return;
  }
  if (drag.touch) {
    drag.x = e.clientX;
    drag.y = e.clientY;
    edgeScroll();
  }
  extendDrag(dateAt(e.clientX, e.clientY));
}

function extendDrag(date) {
  if (!date || date === drag.last) return;
  drag.last = date;
  if (drag.mode === "select") {
    state.selection = new Set(drag.base);
    select(drag.anchor, date, { add: true });
  } else if (drag.mode === "fill") {
    const { days, backwards } = fillTargets(drag.src, date);
    drag.targets = targetDays(days);
    drag.backwards = backwards;
    showFillPreview(drag.targets);
  }
}

function endDrag() {
  clearTimeout(drag?.timer);
  drag = null;
}

/** Touch range selection in the month view: scrolls the page while the finger is near the
 *  top of the screen or the bottom dock, so a range can span several months. */
function edgeScroll() {
  if (edgeScrolling || !monthView()) return;
  edgeScrolling = true;
  const step = () => {
    const d = drag;
    const bottom = $("dock").getBoundingClientRect().top;
    const dir = !d?.touch ? 0 : d.y < 64 ? -1 : d.y > bottom - 32 ? 1 : 0;
    if (!dir) {
      edgeScrolling = false;
      return;
    }
    scrollBy(0, dir * 6);
    extendDrag(dateAt(d.x, d.y));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function onPointerUp(e) {
  if (!drag) return;
  const d = drag;
  endDrag();
  if (d.mode === "tap") {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return; // it was a scroll
    if (state.rangeMode && state.anchor) {
      select(state.anchor, d.date, { add: state.multi });
      state.rangeMode = false;
      $("btn-range").setAttribute("aria-pressed", "false");
    } else if (state.multi) {
      toggleDay(d.date);
    } else {
      select(d.date);
    }
    return;
  }
  if (d.mode === "fill") {
    showFillPreview([]);
    if (!d.targets.length) return renderSelectionInfo(selectedDays());
    let pattern = patternOf(state.entries, targetDays(d.src));
    if (d.backwards) {
      // Align the repeating pattern so that it ends right before the source.
      const n = pattern.length;
      const shift = (n - (d.targets.length % n)) % n;
      pattern = pattern.slice(shift).concat(pattern.slice(0, shift));
    }
    commit(fillWith(d.targets, pattern));
    const all = [...d.src, ...d.targets].sort();
    select(d.backwards ? all[all.length - 1] : all[0], d.backwards ? all[0] : all[all.length - 1]);
  }
}

// ---------------------------------------------------------------- keyboard + clipboard

function inEditable(e) {
  const t = e.target;
  return t instanceof HTMLInputElement || t instanceof HTMLSelectElement ||
    t instanceof HTMLTextAreaElement || document.querySelector("dialog[open]");
}

function onKeyDown(e) {
  if ($("planner").hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  // Zooms the calendar instead of the page, also while a field has the focus.
  const zoom = { "+": 1, "=": 1, "-": -1, "0": 0 }[e.key];
  if (mod && !e.altKey && zoom !== undefined && !document.querySelector("dialog[open]")) {
    e.preventDefault();
    zoomBy(zoom);
    return;
  }
  if (inEditable(e)) return;
  const week = monthView() ? 7 : 31; // up/down: a week in the month view, else a month
  const arrows = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -week, ArrowDown: week };

  if (e.key in arrows) {
    e.preventDefault();
    moveFocus(arrows[e.key], e.shiftKey);
  } else if (e.key === "Escape") {
    if (cancelFill()) return;
    state.selection.clear();
    setMulti(false);
    renderSelection();
  } else if (e.key === "PageUp") {
    e.preventDefault();
    setYear(state.year - 1);
  } else if (e.key === "PageDown") {
    e.preventDefault();
    setYear(state.year + 1);
  } else if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
  } else if (mod && e.key.toLowerCase() === "a") {
    e.preventDefault();
    select(`${state.year}-01-01`, `${state.year}-12-31`);
  } else if (mod) {
    return; // copy / cut / paste are handled by the clipboard events
  } else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    clearSelection();
  } else if (/^[1-9]$/.test(e.key)) {
    const t = state.types[Number(e.key) - 1];
    if (t) toggleOnSelection(t.id);
  } else if (e.key === "?") {
    $("dlg-help").showModal();
  } else if (e.key.toLowerCase() === "g") {
    jumpToNextGap();
  } else if (e.key.toLowerCase() === "n" && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    openNoteDialog();
  }
}

function onCopy(e, cut = false) {
  if ($("planner").hidden || inEditable(e) || !state.selection.size) return;
  const text = copySelection();
  if (!text) return;
  e.clipboardData?.setData("text/plain", text);
  e.preventDefault();
  if (cut) clearSelection();
}

function onPaste(e) {
  if ($("planner").hidden || inEditable(e) || state.readOnly) return;
  e.preventDefault();
  let text = e.clipboardData?.getData("text/plain") ?? "";
  const own = state.clipboard && (text === state.clipboard.text || !text.trim());
  // Prefer our own copy (keeps type ids even if names are duplicated). Ids belong to the
  // year they were copied in, so in another year the types are matched by name instead.
  if (own && state.clipboard.year === state.year) return pastePattern(state.clipboard.pattern);
  if (own) text = state.clipboard.text;
  if (!text.trim()) return;
  const { pattern, unknown } = parseClipboardText(text, state.types);
  if (unknown.length) {
    toast(t("toast.unknown_types", { n: unknown.length, names: unknown.join(", ") }));
  }
  pastePattern(pattern);
}

// ---------------------------------------------------------------- dialogs

function openTypesDialog() {
  $("dlg-types").querySelector("h2").textContent = t("types.title_year", { year: state.year });
  $("types-year-note").textContent = t("types.year_note", { year: state.year });
  renderTypesEditor();
  $("dlg-types").showModal();
}

function renderTypesEditor() {
  const box = $("types-editor");
  box.textContent = "";
  state.types.forEach((type, i) => {
    const row = document.createElement("div");
    row.className = "type-row";
    const color = Object.assign(document.createElement("input"), {
      type: "color",
      value: type.color,
    });
    color.title = t("types.color");
    const name = Object.assign(document.createElement("input"), {
      type: "text",
      value: type.name,
      maxLength: 80,
    });
    name.setAttribute("aria-label", t("types.name"));
    const role = document.createElement("select");
    role.setAttribute("aria-label", t("types.role"));
    for (const value of ROLES) {
      role.append(new Option(t("role." + value), value, false, value === type.role));
    }
    const up = Object.assign(document.createElement("button"), {
      className: "icon-btn",
      textContent: "↑",
      title: t("types.up"),
    });
    const down = Object.assign(document.createElement("button"), {
      className: "icon-btn",
      textContent: "↓",
      title: t("types.down"),
    });
    const del = Object.assign(document.createElement("button"), {
      className: "icon-btn",
      textContent: "🗑",
      title: t("types.delete"),
    });
    up.disabled = i === 0;
    down.disabled = i === state.types.length - 1;

    color.addEventListener("change", () => updateType(type, { color: color.value }));
    name.addEventListener(
      "change",
      () => name.value.trim() && updateType(type, { name: name.value.trim() }),
    );
    role.addEventListener("change", () => updateType(type, { role: role.value }));
    up.addEventListener("click", () => moveType(i, -1));
    down.addEventListener("click", () => moveType(i, 1));
    del.addEventListener("click", () => deleteType(type));
    row.append(color, name, role, up, down, del);
    box.append(row);
  });
}

async function updateType(type, patch) {
  // Look the type up again: a refresh may have replaced the objects the editor rows hold.
  const current = typeById(type.id);
  if (current) Object.assign(current, patch);
  state.version++;
  render();
  try {
    await api.updateType(state.token, state.year, type.id, patch);
  } catch (err) {
    toast(t("toast.type_save_failed", { msg: err.message }));
    await load();
    renderTypesEditor();
  }
}

async function moveType(i, dir) {
  const j = i + dir;
  [state.types[i], state.types[j]] = [state.types[j], state.types[i]];
  state.types.forEach((t, k) => (t.position = k));
  state.version++;
  renderTypesEditor();
  render();
  try {
    await Promise.all([
      api.updateType(state.token, state.year, state.types[i].id, { position: i }),
      api.updateType(state.token, state.year, state.types[j].id, { position: j }),
    ]);
  } catch (err) {
    toast(t("toast.reorder_failed", { msg: err.message }));
  }
}

async function deleteType(type) {
  const used = [...state.entries.values()].filter((ids) => ids.includes(type.id)).length;
  const msg = used
    ? t("types.confirm_delete_used", { name: type.name, n: used, year: state.year })
    : t("types.confirm_delete", { name: type.name });
  if (!confirm(msg)) return;
  try {
    await api.deleteType(state.token, state.year, type.id);
    state.types = state.types.filter((x) => x.id !== type.id);
    for (const [d, ids] of state.entries) {
      const rest = ids.filter((id) => id !== type.id);
      rest.length ? state.entries.set(d, rest) : state.entries.delete(d);
    }
    state.undo = [];
    state.redo = [];
    state.version++;
    renderTypesEditor();
    render();
  } catch (err) {
    toast(t("toast.delete_failed", { msg: err.message }));
  }
}

async function addType() {
  const n = state.types.length + 1;
  try {
    const type = await api.addType(state.token, state.year, {
      name: t("types.new_name", { n }),
      color: nextColor(state.types),
      role: "none",
    });
    state.types.push(type);
    addTypeYear(state.year);
    state.version++;
    renderTypesEditor();
    render();
    const inputs = $("types-editor").querySelectorAll('input[type="text"]');
    inputs[inputs.length - 1]?.select();
  } catch (err) {
    toast(t("toast.add_type_failed", { msg: err.message }));
  }
}

function addTypeYear(year) {
  const years = new Set(state.typeYears ?? []);
  state.typeYears = [...years.add(year)].sort((a, b) => a - b);
}

async function copyTypes(from, btn) {
  const year = state.year;
  btn.disabled = true;
  try {
    const types = await api.copyTypes(state.token, from, year);
    if (year !== state.year) return;
    state.types = types;
    addTypeYear(year);
    state.version++;
    render();
    cacheState();
  } catch (err) {
    btn.disabled = false;
    toast(t("toast.copy_types_failed", { msg: err.message }));
  }
}

let noteDays = []; // the days the open note dialog edits

function openNoteDialog() {
  if (state.readOnly) return;
  const days = targetDays();
  if (!days.length) return toast(t("toast.select_first"));
  noteDays = days;
  const notes = days.map((d) => state.notes.get(d) ?? null);
  // Prefill only if every day has the same note; otherwise saving replaces them.
  const same = notes.every((n) => sameNote(n, notes[0]));
  const note = same ? noteOrNull(notes[0]) : null;
  $("note-days").textContent = days.length === 1
    ? fmtDate(days[0], { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : t("note.days", {
      n: days.length,
      span: `${fmtDate(days[0])} – ${fmtDate(days[days.length - 1])}`,
    });
  $("note-icon").value = note?.icon ?? "";
  $("note-comment").value = note?.comment ?? "";
  $("note-replace").hidden = same;
  $("note-remove").hidden = !notes.some(Boolean);
  renderNotePresets();
  $("dlg-note").showModal();
  // On touch screens the keyboard would cover the icons, so only focus with a mouse.
  if (matchMedia("(pointer: fine)").matches) $("note-comment").focus();
}

function renderNotePresets() {
  const box = $("note-presets");
  if (!box.childElementCount) {
    for (const icon of NOTE_ICONS) {
      const btn = Object.assign(document.createElement("button"), {
        type: "button",
        className: "emoji-btn",
        textContent: icon,
      });
      btn.addEventListener("click", () => {
        // Clicking the picked icon again unpicks it.
        $("note-icon").value = $("note-icon").value === icon ? "" : icon;
        renderNotePresets();
      });
      box.append(btn);
    }
  }
  const picked = $("note-icon").value.trim();
  for (const btn of box.children) {
    btn.setAttribute("aria-pressed", String(btn.textContent === picked));
  }
}

function saveNote() {
  const icon = $("note-icon").value.trim();
  const comment = $("note-comment").value.trim();
  commitNotes(new Map(noteDays.map((d) => [d, icon || comment ? { icon, comment } : null])));
  $("dlg-note").close();
}

function removeNote() {
  commitNotes(new Map(noteDays.map((d) => [d, null])));
  $("dlg-note").close();
}

function feedUrl() {
  const boxes = [...$("feed-types").querySelectorAll("input")];
  const checked = boxes.filter((b) => b.checked).map((b) => b.value);
  const params = {};
  if (checked.length !== boxes.length) params.types = checked.join(",");
  if ($("feed-gaps").checked) params.gaps = "1";
  if ($("feed-notes").checked) params.notes = "1";
  if (lang !== "en") params.lang = lang;
  return api.calendarUrl(state.session.readId, params);
}

function updateFeedLinks() {
  const url = feedUrl();
  $("link-feed").value = url;
  $("link-webcal").href = url.replace(/^https?:/, "webcal:");
}

function openShareDialog() {
  const s = state.session;
  $("share-edit").hidden = state.readOnly;
  if (!state.readOnly) $("link-edit").value = pageUrl({ s: s.id });
  $("link-view").value = pageUrl({ s: s.readId });
  const box = $("feed-types");
  box.textContent = "";
  for (const type of state.types) {
    const label = document.createElement("label");
    label.className = "check";
    const cb = Object.assign(document.createElement("input"), {
      type: "checkbox",
      value: type.id,
      checked: true,
    });
    cb.addEventListener("change", updateFeedLinks);
    label.append(cb, " " + type.name);
    box.append(label);
  }
  $("feed-gaps").checked = state.types.some((t) => t.role === "needs_cover");
  $("feed-notes").checked = true;
  updateFeedLinks();
  showShareTab("links");
  $("dlg-share").showModal();
}

const SHARE_TABS = ["links", "calendar"];

function showShareTab(name) {
  for (const tab of SHARE_TABS) {
    const on = tab === name;
    const btn = $("tab-" + tab);
    btn.setAttribute("aria-selected", String(on));
    btn.tabIndex = on ? 0 : -1;
    $("panel-" + tab).hidden = !on;
  }
}

function openAiDialog() {
  const url = api.agentUrl(state.token);
  const prompt = t(state.readOnly ? "ai.prompt_text_readonly" : "ai.prompt_text", { url });
  $("ai-readonly").hidden = !state.readOnly;
  $("ai-warning").hidden = state.readOnly;
  const box = $("ai-prompt");
  box.value = prompt;
  $("dlg-ai").showModal();
  // Show the whole prompt: grow the box to its text (needs layout, so after showModal).
  box.style.height = "auto";
  box.style.height = box.scrollHeight + 2 + "px";
}

function openApiDialog() {
  const base = api.calendarUrl("x").replace(/\/sessions\/x\/calendar\.ics$/, "");
  const id = state.readOnly ? "<edit-id>" : state.session.id;
  const type = state.types.find((x) => x.role === "covers") ?? state.types[0];
  const typeRef = type?.id ?? "vacation";
  const y = state.year;
  $("api-docs").textContent = `BASE=${base}
SESSION=${id}

# ${t("api.read")}
curl "$BASE/sessions/$SESSION?year=${y}"

# ${t("api.add", { name: type?.name ?? t("api.ex_vacation") })}
curl -X POST "$BASE/sessions/$SESSION/entries" \\
  -H "content-type: application/json" \\
  -d '{"action":"add","type":"${typeRef}","from":"${y}-08-03","to":"${y}-08-14","skipWeekends":true}'

# ${t("api.ops")}
curl -X POST "$BASE/sessions/$SESSION/entries" \\
  -H "content-type: application/json" \\
  -d '{"ops":[
        {"action":"remove","type":"${typeRef}","dates":["${y}-08-07"]},
        {"action":"set","types":["${typeRef}"],"dates":["${y}-12-24","${y}-12-31"]},
        {"action":"clear","from":"${y}-01-01","to":"${y}-01-06"}
      ]}'

# ${t("api.notes")}
curl -X POST "$BASE/sessions/$SESSION/notes" \\
  -H "content-type: application/json" \\
  -d '{"ops":[
        {"action":"set","dates":["${y}-12-25"],"icon":"🎄","comment":"${t("api.ex_note")}"},
        {"action":"clear","dates":["${y}-12-31"]}
      ]}'

# ${t("api.types")}
curl "$BASE/sessions/$SESSION/types?year=${y}"
curl -X POST "$BASE/sessions/$SESSION/types?year=${y}" -H "content-type: application/json" \\
  -d '{"name":"${t("api.ex_needs")}","color":"#8b5cf6","role":"needs_cover"}'
curl -X PATCH "$BASE/sessions/$SESSION/types/${typeRef}?year=${y}" \\
  -H "content-type: application/json" -d '{"name":"${t("api.ex_rename")}","color":"#22c55e"}'
curl -X DELETE "$BASE/sessions/$SESSION/types/<type-id>?year=${y}"
curl -X POST "$BASE/sessions/$SESSION/types/copy" -H "content-type: application/json" \\
  -d '{"from":${y},"to":${y + 1}}'

# ${t("api.feed")}
curl "$BASE/sessions/${state.session.readId}/calendar.ics"

# ${t("api.new")}
curl -X POST "$BASE/sessions" -H "content-type: application/json" \\
  -d '{"name":"${t("api.ex_planner", { year: y })}"${lang === "en" ? "" : `,"lang":"${lang}"`}}'`;
  $("dlg-api").showModal();
}

// ---------------------------------------------------------------- language

function renderLangSelect() {
  const sel = $("lang");
  sel.textContent = "";
  const items = $("menu-lang");
  items.textContent = "";
  for (const [code, name] of Object.entries(LANGS)) {
    sel.append(new Option(name, code, false, code === lang));
    const item = document.createElement("button");
    item.className = "menu-item";
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", String(code === lang));
    const icon = document.createElement("span");
    icon.className = "menu-icon";
    const label = document.createElement("span");
    label.textContent = name;
    item.append(icon, label);
    item.addEventListener("click", () => switchLang(code));
    items.append(item);
  }
}

function switchLang(code) {
  setLang(code);
  renderLangSelect();
  relocalize();
}

/** Places the menu under its button (fixed, so it works the same with and without the
 *  popover API; without it, .open shows the menu). */
function positionMenu() {
  const r = $("btn-menu").getBoundingClientRect();
  const menu = $("menu");
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  menu.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
}

function closeMenu() {
  const menu = $("menu");
  if (menu.hidePopover && menu.matches(":popover-open")) menu.hidePopover();
  menu.classList.remove("open");
}

/** Re-translates everything on screen after a language switch. */
function relocalize() {
  applyStatic();
  setSync(...syncState);
  applyZoom({ keepView: false });
  if (!$("planner").hidden) {
    buildGrid();
    render();
  } else if (!$("landing").hidden) {
    showLanding();
  }
}

// ---------------------------------------------------------------- landing / boot

function showLanding(message) {
  $("planner").hidden = true;
  $("year-nav").hidden = true;
  $("actions").hidden = true;
  $("session-name").hidden = true;
  $("home-link").hidden = false;
  $("lang").hidden = false;
  $("landing").hidden = false;
  document.title = t("app.title");
  if (message) toast(message, 5000);
  $("config-warning").hidden = isConfigured();

  const list = storage(() => JSON.parse(localStorage.getItem(RECENT_KEY)) || [], []);
  $("recent").hidden = !list.length;
  const ul = $("recent-list");
  ul.textContent = "";
  for (const e of list) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = pageUrl({ s: e.token });
    const name = document.createElement("span");
    name.textContent = e.name + (e.readOnly ? t("landing.view_only") : "");
    const when = document.createElement("small");
    when.textContent = new Date(e.at).toLocaleDateString(lang);
    a.append(name, when);
    li.append(a);
    ul.append(li);
  }
}

async function createPlanner() {
  const btn = $("btn-create");
  btn.disabled = true;
  try {
    const data = await api.createSession({ lang, year: state.year });
    location.href = pageUrl({ s: data.session.id });
  } catch (err) {
    toast(t("toast.create_failed", { msg: err.message }), 5000);
    btn.disabled = false;
  }
}

async function openPlanner(token, year) {
  state.token = token;
  if (year) state.year = year;
  const pending = api.getSession(token, state.year); // start fetching before building the grid
  $("landing").hidden = true;
  $("planner").hidden = false;
  $("year-nav").hidden = false;
  $("actions").hidden = false;
  $("session-name").hidden = false;
  $("home-link").hidden = true;
  $("lang").hidden = true;
  $("planner").classList.toggle(
    "hinted",
    storage(() => localStorage.getItem(HINTED_KEY) === "1", false),
  );
  renderYearSelect();
  buildGrid();
  if (applyCached()) {
    render();
    setSync("sync.updating");
  } else setSync("sync.loading");
  if (!(await load({ pending }))) return;
  rememberSession();
  if (!state.selection.size && String(state.year) === today.slice(0, 4)) centerInGrid(today);
  startPolling();
}

function bind() {
  renderLangSelect();
  $("lang").addEventListener("change", (e) => switchLang(e.target.value));
  const menu = $("menu");
  if (menu.showPopover) {
    menu.addEventListener("beforetoggle", (e) => e.newState === "open" && positionMenu());
  } else {
    // No popover API: toggle it by hand and close it on any click outside.
    $("btn-menu").addEventListener("click", (e) => {
      e.stopPropagation();
      positionMenu();
      menu.classList.toggle("open");
    });
    document.addEventListener("click", (e) => !menu.contains(e.target) && closeMenu());
  }
  for (const item of menu.querySelectorAll("button")) item.addEventListener("click", closeMenu);
  $("btn-create").addEventListener("click", createPlanner);
  $("open-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("open-input").value.trim();
    if (!v) return;
    let token = v;
    try {
      token = new URL(v).searchParams.get("s") ?? v;
    } catch {
      // not a URL, use as id
    }
    location.href = pageUrl({ s: token });
  });

  $("year").addEventListener("change", (e) => setYear(Number(e.target.value)));
  $("prev-year").addEventListener("click", () => setYear(state.year - 1));
  $("next-year").addEventListener("click", () => setYear(state.year + 1));

  $("session-name").addEventListener("change", async (e) => {
    const input = e.target;
    const name = input.value.trim();
    if (state.readOnly || !state.session) return;
    const old = state.session.name;
    if (!name) {
      input.value = old;
      return;
    }
    setSync("sync.saving");
    try {
      await api.renameSession(state.token, name);
      state.session.name = name;
      document.title = `${name} ${state.year}`;
      rememberSession();
      if (!flushing) setSync("sync.saved");
    } catch (err) {
      if (input.value.trim() === name) input.value = old;
      toast(t("toast.rename_failed", { msg: err.message }));
      if (!flushing) setSync(err.status ? "sync.saved" : "sync.offline", !err.status);
    }
  });
  $("session-name").addEventListener("keydown", (e) => e.key === "Enter" && e.target.blur());

  $("btn-share").addEventListener("click", openShareDialog);
  $("btn-ai").addEventListener("click", openAiDialog);
  $("btn-api").addEventListener("click", openApiDialog);
  $("btn-help").addEventListener("click", () => $("dlg-help").showModal());
  $("btn-clear").addEventListener("click", clearSelection);
  $("btn-deselect").addEventListener("click", () => {
    state.selection.clear();
    setMulti(false);
    renderSelection();
  });
  $("btn-undo").addEventListener("click", undo);
  $("btn-redo").addEventListener("click", redo);
  for (const tab of SHARE_TABS) {
    $("tab-" + tab).addEventListener("click", () => showShareTab(tab));
    $("tab-" + tab).addEventListener("keydown", (e) => {
      const dir = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!dir) return;
      const next =
        SHARE_TABS[(SHARE_TABS.indexOf(tab) + dir + SHARE_TABS.length) % SHARE_TABS.length];
      showShareTab(next);
      $("tab-" + next).focus();
    });
  }
  $("btn-edit-types").addEventListener("click", openTypesDialog);
  $("btn-note").addEventListener("click", openNoteDialog);
  $("note-save").addEventListener("click", saveNote);
  $("note-remove").addEventListener("click", removeNote);
  $("note-cancel").addEventListener("click", () => $("dlg-note").close());
  $("note-icon").addEventListener("input", renderNotePresets);
  $("note-icon").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      saveNote();
    }
  });
  $("note-comment").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      saveNote();
    }
  });
  $("btn-add-type").addEventListener("click", addType);
  $("feed-gaps").addEventListener("change", updateFeedLinks);
  $("feed-notes").addEventListener("change", updateFeedLinks);
  $("btn-range").addEventListener("click", (e) => {
    state.rangeMode = !state.rangeMode;
    e.currentTarget.setAttribute("aria-pressed", String(state.rangeMode));
  });
  $("btn-multi").addEventListener("click", () => setMulti(!state.multi));
  $("dlg-types").addEventListener("close", () => render());

  for (const btn of document.querySelectorAll("[data-copy]")) {
    btn.addEventListener("click", async () => {
      const input = $(btn.dataset.copy);
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand("copy");
      }
      toast(t("toast.copied"));
    });
  }

  const skip = $("skip-weekends");
  skip.checked = storage(() => localStorage.getItem("vp-skip-weekends") === "1", false);
  skip.addEventListener(
    "change",
    () => storage(() => localStorage.setItem("vp-skip-weekends", skip.checked ? "1" : "0")),
  );

  const zoom = $("zoom");
  zoom.addEventListener(
    "input",
    () => setShownDays(Number(zoom.min) + Number(zoom.max) - zoom.value),
  );
  narrowScreen.addEventListener("change", () => {
    applyZoom({ keepView: false });
    if ($("planner").hidden) return;
    render(); // switches between the year grid and the month view
    centerInGrid(state.focus ?? today);
  });
  applyZoom({ keepView: false });

  const grid = $("grid");
  grid.addEventListener("pointerdown", onPointerDown);
  grid.addEventListener("pointermove", onPointerMove);
  grid.addEventListener("pointerup", onPointerUp);
  grid.addEventListener("pointercancel", () => {
    if (!cancelFill()) endDrag();
  });
  // A range selection by touch must not scroll the page or the calendar.
  grid.addEventListener("touchmove", (e) => {
    if (drag && drag.mode !== "tap") e.preventDefault();
  }, { passive: false });
  grid.addEventListener("contextmenu", (e) => lastPointer === "touch" && e.preventDefault());
  grid.addEventListener("dblclick", (e) => {
    // The target is the grid itself after a pointer capture, so look the day up by position.
    const date = dateAt(e.clientX, e.clientY);
    if (!date || state.readOnly) return;
    select(date);
    openNoteDialog();
  });
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("copy", (e) => onCopy(e));
  document.addEventListener("cut", (e) => !state.readOnly && onCopy(e, true));
  document.addEventListener("paste", onPaste);
  window.addEventListener("beforeunload", (e) => {
    if (queue.length) e.preventDefault();
  });
}

function boot() {
  applyStatic();
  bind();
  const params = new URLSearchParams(location.search);
  const token = params.get("s");
  const year = Number(params.get("y")) || undefined;
  if (token && isConfigured()) openPlanner(token, year);
  else showLanding();
}

boot();
