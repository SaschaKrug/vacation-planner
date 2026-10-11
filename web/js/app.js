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
  types: [],
  entries: new Map(),
  notes: new Map(), // date -> { icon, comment }
  year: new Date().getFullYear(),
  readOnly: true,
  selection: new Set(),
  anchor: null,
  focus: null,
  clipboard: null, // { pattern, text }
  undo: [], // { kind: "entries" | "notes", before, after }
  redo: [],
  version: 0, // bumps on every local change; stale poll responses are dropped
  rangeMode: false,
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
  el.textContent = key ? t(key) : "";
  el.classList.toggle("error", error);
}

function storage(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function fmtDate(d, opts = { weekday: "short", day: "numeric", month: "short" }) {
  return new Date(d + "T00:00:00").toLocaleDateString(lang, opts);
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

// ---------------------------------------------------------------- sync

const queue = []; // { kind: "entries" | "notes", ops }
let flushing = false;
let retryDelay = 2000;

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
    try {
      await send[queue[0].kind](state.token, queue[0].ops);
      queue.shift();
      retryDelay = 2000;
    } catch (err) {
      if (err.status && err.status < 500) {
        // The server rejected it (e.g. a type was deleted elsewhere): drop and resync.
        queue.shift();
        toast(t("toast.save_failed", { msg: err.message }));
        await load();
        continue;
      }
      setSync("sync.retrying", true);
      await new Promise((r) => setTimeout(r, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  }
  flushing = false;
  setSync("sync.saved");
}

async function load({ quiet = false } = {}) {
  const version = state.version;
  const year = state.year;
  try {
    const data = await api.getSession(state.token, year);
    // Ignore if the user changed something meanwhile or switched years.
    if (version !== state.version || year !== state.year || queue.length) return;
    state.session = data.session;
    state.readOnly = data.session.readOnly;
    state.types = data.types;
    state.entries = new Map(Object.entries(data.entries));
    state.notes = new Map(Object.entries(data.notes ?? {}));
    render();
    if (!quiet) setSync("sync.saved");
  } catch (err) {
    if (err.status === 404) {
      showLanding(t("toast.not_found"));
      return;
    }
    if (!quiet) toast(t("toast.load_failed", { msg: err.message }));
    setSync("sync.offline", true);
  }
}

function startPolling() {
  // No refresh while a dialog is open, so it can't overwrite edits in progress.
  const idle = () =>
    document.visibilityState === "visible" && !drag && !queue.length &&
    !document.querySelector("dialog[open]");
  setInterval(() => idle() && load({ quiet: true }), POLL_MS);
  document.addEventListener("visibilitychange", () => idle() && load({ quiet: true }));
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
}

function redo() {
  const step = state.redo.pop();
  if (!step) return toast(t("toast.nothing_redo"));
  applyStep(step, step.after);
  state.undo.push(step);
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
  state.clipboard = { pattern, text };
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

function isContiguous(days) {
  return days.length > 0 && range(days[0], days[days.length - 1]).length === days.length;
}

function moveFocus(delta, extend) {
  const from = state.focus ?? today;
  let next;
  if (Math.abs(delta) === 1) next = addDays(from, delta);
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
  cellFor(after)?.scrollIntoView({ block: "nearest", inline: "center" });
}

// ---------------------------------------------------------------- rendering

let cells = new Map();

function cellFor(date) {
  return cells.get(date);
}

function buildGrid() {
  const grid = $("grid");
  grid.textContent = "";
  cells = new Map();
  const frag = document.createDocumentFragment();
  const corner = document.createElement("div");
  corner.className = "head corner";
  frag.append(corner);
  for (let d = 1; d <= 31; d++) {
    const h = document.createElement("div");
    h.className = "head";
    h.textContent = d;
    frag.append(h);
  }
  for (let m = 0; m < 12; m++) {
    const label = document.createElement("div");
    label.className = "month";
    label.textContent = t("months")[m];
    frag.append(label);
    const n = daysInMonth(state.year, m);
    for (let d = 1; d <= 31; d++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.setAttribute("role", "gridcell");
      if (d > n) {
        cell.classList.add("invalid");
      } else {
        const date = iso(state.year, m, d);
        cell.dataset.date = date;
        const wd = document.createElement("span");
        wd.className = "wd";
        wd.textContent = t("weekdays")[weekday(date)];
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
      }
      frag.append(cell);
    }
  }
  grid.append(frag);
  grid.dataset.year = state.year;
}

function renderCells() {
  const roles = roleMap(state.types);
  const order = new Map(state.types.map((t, i) => [t.id, i]));
  for (const [date, cell] of cells) {
    const ids = (state.entries.get(date) ?? []).filter((id) => order.has(id))
      .sort((a, b) => order.get(a) - order.get(b));
    const fills = cell.firstChild;
    fills.textContent = "";
    for (const id of ids) {
      const t = typeById(id);
      const s = document.createElement("span");
      s.style.backgroundColor = t.color;
      if (t.role === "needs_cover") s.className = "needs";
      fills.append(s);
    }
    cell.classList.toggle("has-fill", ids.length > 0);
    cell.style.color = ids.length ? contrastText(typeById(ids[0]).color) : "";
    cell.classList.toggle("gap", isGap(date, ids, roles));
    const note = state.notes.get(date);
    cell.querySelector(".note-icon").textContent = note?.icon ?? "";
    cell.classList.toggle("has-comment", !!note?.comment);
    const names = ids.map((id) => typeById(id).name).join(", ");
    cell.title =
      fmtDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) +
      (names ? "\n" + names : "") + (note ? "\n" + noteText(note) : "");
  }
}

function noteText(note) {
  return [note.icon, note.comment].filter(Boolean).join(" ");
}

function renderSelection() {
  document.querySelectorAll(".fill-handle").forEach((h) => h.remove());
  for (const [date, cell] of cells) {
    cell.classList.toggle("sel", state.selection.has(date));
    cell.classList.toggle("focus", date === state.focus && state.selection.has(date));
  }
  const days = selectedDays();
  if (!state.readOnly && isContiguous(days)) {
    const handle = document.createElement("i");
    handle.className = "fill-handle";
    handle.title = t("fill.handle");
    cellFor(days[days.length - 1])?.append(handle);
  }
  renderSelectionInfo(days);
  renderChipsActive(days);
}

function renderSelectionInfo(days) {
  const el = $("selection-info");
  if (!days.length) {
    el.textContent = state.readOnly ? t("sel.view_only") : t("sel.none");
    return;
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

function renderChipsActive(days) {
  for (const chip of document.querySelectorAll(".chip[data-type]")) {
    const id = chip.dataset.type;
    const all = days.length > 0 && days.every((d) => (state.entries.get(d) ?? []).includes(id));
    chip.classList.toggle("active", all);
  }
}

function renderTypes() {
  const box = $("types");
  box.textContent = "";
  const s = stats(state.entries, state.types, state.year);
  state.types.forEach((type, i) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.dataset.type = type.id;
    chip.disabled = state.readOnly;
    const st = s.get(type.id);
    chip.title = t("chip.title", {
      name: type.name,
      role: t("role." + type.role),
      days: st.days,
      workdays: st.workdays,
      year: state.year,
    }) + (state.readOnly ? "" : t("chip.toggle_hint", { key: i + 1 }));
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = type.color;
    if (type.role === "needs_cover") {
      sw.style.backgroundImage =
        "repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 3px, transparent 3px 7px)";
    }
    const name = document.createElement("span");
    name.textContent = type.name;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = t("chip.count", { n: st.workdays });
    chip.append(sw, name, count);
    if (i < 9 && !state.readOnly) {
      const key = document.createElement("span");
      key.className = "key";
      key.textContent = i + 1;
      chip.append(key);
    }
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
    msg.textContent = t("coverage.gaps", { n: gaps.length, names });
    const btn = document.createElement("button");
    btn.className = "btn small";
    btn.textContent = t("coverage.next");
    btn.title = t("coverage.next_title");
    btn.addEventListener("click", jumpToNextGap);
    el.append(msg, btn);
  } else {
    msg.className = "ok";
    msg.textContent = t("coverage.ok", { names, year: state.year });
    el.append(msg);
  }
}

function render() {
  if (Number($("grid").dataset.year) !== state.year) buildGrid();
  $("planner").classList.toggle("readonly", state.readOnly);
  $("readonly-banner").hidden = !state.readOnly;
  $("btn-edit-types").hidden = state.readOnly;
  $("btn-note").hidden = state.readOnly;
  const nameInput = $("session-name");
  if (document.activeElement !== nameInput) nameInput.value = state.session?.name ?? "";
  nameInput.readOnly = state.readOnly;
  document.title = (state.session?.name ?? t("app.title")) + ` ${state.year}`;
  renderTypes();
  renderCells();
  renderSelection();
  renderCoverage();
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
  state.year = y;
  state.selection.clear();
  state.anchor = state.focus = null;
  state.version++;
  history.replaceState(null, "", pageUrl({ s: state.token, y }));
  renderYearSelect();
  render();
  load();
}

// ---------------------------------------------------------------- pointer input

let drag = null; // { mode: "select" | "fill", ... }

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
  for (const [date, cell] of cells) cell.classList.toggle("fill-preview", days.includes(date));
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  const handle = e.target.closest(".fill-handle");
  const date = e.target.closest(".cell[data-date]")?.dataset.date;
  if (!date) return;
  $("grid").focus({ preventScroll: true });

  if (handle && !state.readOnly) {
    e.preventDefault();
    drag = { mode: "fill", src: selectedDays(), targets: [] };
    $("grid").setPointerCapture(e.pointerId);
    return;
  }

  if (e.pointerType === "touch") {
    // Touch: taps select (so the grid can still be scrolled); see onPointerUp.
    drag = { mode: "tap", date, x: e.clientX, y: e.clientY };
    return;
  }

  e.preventDefault();
  if (e.shiftKey && state.anchor) {
    select(state.anchor, date);
    drag = { mode: "select", anchor: state.anchor, base: new Set() };
  } else if (e.ctrlKey || e.metaKey) {
    const base = new Set(state.selection);
    if (base.has(date)) {
      base.delete(date);
      state.selection = new Set(base);
      state.anchor = state.focus = date;
      renderSelection();
      drag = null;
      return;
    }
    drag = { mode: "select", anchor: date, base };
    state.selection = new Set(base);
    select(date, date, { add: true });
  } else {
    drag = { mode: "select", anchor: date, base: new Set() };
    select(date);
  }
  $("grid").setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!drag || drag.mode === "tap") return;
  const date = dateAt(e.clientX, e.clientY);
  if (!date) return;
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

function onPointerUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.mode === "tap") {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return; // it was a scroll
    if (state.rangeMode && state.anchor) {
      select(state.anchor, d.date);
      state.rangeMode = false;
      $("btn-range").setAttribute("aria-pressed", "false");
    } else {
      select(d.date);
    }
    return;
  }
  if (d.mode === "fill") {
    showFillPreview([]);
    if (!d.targets.length) return;
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
  if ($("planner").hidden || inEditable(e)) return;
  const mod = e.ctrlKey || e.metaKey;
  const arrows = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -31, ArrowDown: 31 };

  if (e.key in arrows) {
    e.preventDefault();
    moveFocus(arrows[e.key], e.shiftKey);
  } else if (e.key === "Escape") {
    state.selection.clear();
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
  const text = e.clipboardData?.getData("text/plain") ?? "";
  // Prefer our own copy (keeps type ids even if names are duplicated).
  if (state.clipboard && text === state.clipboard.text) {
    return pastePattern(state.clipboard.pattern);
  }
  if (!text.trim()) {
    if (state.clipboard) pastePattern(state.clipboard.pattern);
    return;
  }
  const { pattern, unknown } = parseClipboardText(text, state.types);
  if (unknown.length) {
    toast(t("toast.unknown_types", { n: unknown.length, names: unknown.join(", ") }));
  }
  pastePattern(pattern);
}

// ---------------------------------------------------------------- dialogs

function openTypesDialog() {
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
    await api.updateType(state.token, type.id, patch);
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
      api.updateType(state.token, state.types[i].id, { position: i }),
      api.updateType(state.token, state.types[j].id, { position: j }),
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
    await api.deleteType(state.token, type.id);
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
    const type = await api.addType(state.token, {
      name: t("types.new_name", { n }),
      color: nextColor(state.types),
      role: "none",
    });
    state.types.push(type);
    state.version++;
    renderTypesEditor();
    render();
    const inputs = $("types-editor").querySelectorAll('input[type="text"]');
    inputs[inputs.length - 1]?.select();
  } catch (err) {
    toast(t("toast.add_type_failed", { msg: err.message }));
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
  $("dlg-share").showModal();
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
curl "$BASE/sessions/$SESSION/types"
curl -X POST "$BASE/sessions/$SESSION/types" -H "content-type: application/json" \\
  -d '{"name":"${t("api.ex_needs")}","color":"#8b5cf6","role":"needs_cover"}'
curl -X PATCH "$BASE/sessions/$SESSION/types/${typeRef}" -H "content-type: application/json" \\
  -d '{"name":"${t("api.ex_rename")}","color":"#22c55e"}'
curl -X DELETE "$BASE/sessions/$SESSION/types/<type-id>"

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
  for (const [code, name] of Object.entries(LANGS)) {
    sel.append(new Option(name, code, false, code === lang));
  }
}

/** Re-translates everything on screen after a language switch. */
function relocalize() {
  applyStatic();
  setSync(...syncState);
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
    const data = await api.createSession({ lang });
    location.href = pageUrl({ s: data.session.id });
  } catch (err) {
    toast(t("toast.create_failed", { msg: err.message }), 5000);
    btn.disabled = false;
  }
}

async function openPlanner(token, year) {
  state.token = token;
  if (year) state.year = year;
  $("landing").hidden = true;
  $("planner").hidden = false;
  $("year-nav").hidden = false;
  $("actions").hidden = false;
  $("session-name").hidden = false;
  $("home-link").hidden = true;
  renderYearSelect();
  buildGrid();
  setSync("sync.loading");
  await load();
  if (!state.session) return;
  rememberSession();
  if (!state.selection.size && String(state.year) === today.slice(0, 4)) {
    cellFor(today)?.scrollIntoView({ block: "nearest", inline: "center" });
  }
  startPolling();
}

function bind() {
  renderLangSelect();
  $("lang").addEventListener("change", (e) => {
    setLang(e.target.value);
    relocalize();
  });
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
    const name = e.target.value.trim();
    if (!name || state.readOnly) return;
    try {
      await api.renameSession(state.token, name);
      state.session.name = name;
      document.title = `${name} ${state.year}`;
      rememberSession();
    } catch (err) {
      toast(t("toast.rename_failed", { msg: err.message }));
    }
  });
  $("session-name").addEventListener("keydown", (e) => e.key === "Enter" && e.target.blur());

  $("btn-share").addEventListener("click", openShareDialog);
  $("btn-api").addEventListener("click", openApiDialog);
  $("btn-help").addEventListener("click", () => $("dlg-help").showModal());
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

  const grid = $("grid");
  grid.addEventListener("pointerdown", onPointerDown);
  grid.addEventListener("pointermove", onPointerMove);
  grid.addEventListener("pointerup", onPointerUp);
  grid.addEventListener("pointercancel", () => {
    drag = null;
    showFillPreview([]);
  });
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
