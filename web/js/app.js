import { api, isConfigured } from "./api.js";
import {
  addDays,
  applyDays,
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
  parseClipboardText,
  pasteTargets,
  patternOf,
  range,
  ROLE_LABELS,
  roleMap,
  stats,
  toClipboardText,
  toggleType,
  toOps,
  weekday,
} from "./core.js";

const $ = (id) => document.getElementById(id);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["S", "M", "T", "W", "T", "F", "S"];
const POLL_MS = 15000;
const RECENT_KEY = "vp-recent";
const CACHE_KEY = "vp-cache";
const CACHE_SIZE = 12;
const MAX_DAYS_PER_REQUEST = 4000; // server limit
const SHORT_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const LONG_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const state = {
  token: null, // id from the URL (edit id or read-only id)
  session: null,
  types: [],
  entries: new Map(),
  year: new Date().getFullYear(),
  readOnly: true,
  selection: new Set(),
  anchor: null,
  focus: null,
  clipboard: null, // { pattern, text }
  undo: [],
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

function setSync(text, error = false) {
  const el = $("sync-status");
  el.textContent = text;
  el.classList.toggle("error", error);
}

function storage(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function fmtDate(d, fmt = SHORT_DATE) {
  return fmt.format(new Date(d + "T00:00:00"));
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
  const { session, types, entries } = state;
  cacheResponse(state.token, state.year, { session, types, entries: Object.fromEntries(entries) });
}

function uncache(token) {
  writeCache(readCache().filter(([key]) => !key.startsWith(token + "|")));
}

// ---------------------------------------------------------------- sync

const queue = [];
let flushing = false;
let retryDelay = 2000;
let wake = null; // ends the retry backoff early
let lastResponse = null; // JSON of the last applied response...
let appliedVersion = -1; // ...and state.version right after applying it
let reloadAfterSave = false; // a load was dropped because of local changes

function enqueue(ops) {
  if (!ops.length) return;
  queue.push(ops);
  flush();
}

async function flush() {
  if (flushing) return;
  flushing = true;
  while (queue.length) {
    setSync("Saving…");
    // Send queued batches as one request; ops are applied in order, so this is equivalent.
    const ops = [];
    let n = 0;
    let days = 0;
    for (; n < queue.length; n++) {
      const size = queue[n].reduce((sum, op) => sum + op.dates.length, 0);
      if (n && days + size > MAX_DAYS_PER_REQUEST) break;
      days += size;
      ops.push(...queue[n]);
    }
    try {
      await api.applyOps(state.token, ops);
      queue.splice(0, n);
      retryDelay = 2000;
    } catch (err) {
      if (err.status && err.status < 500) {
        // The server rejected it (e.g. a type was deleted elsewhere): drop and resync.
        queue.splice(0, n);
        toast("Couldn't save: " + err.message);
        await load();
        continue;
      }
      setSync("Offline – retrying", true);
      await new Promise((r) => {
        wake = r;
        setTimeout(r, retryDelay);
      });
      wake = null;
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  }
  flushing = false;
  setSync("Saved");
  cacheState();
  if (reloadAfterSave) load({ quiet: true });
}

function applyResponse(data, json = JSON.stringify(data)) {
  state.session = data.session;
  state.readOnly = data.session.readOnly;
  state.types = data.types;
  state.entries = new Map(Object.entries(data.entries));
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
    if (!quiet || $("sync-status").classList.contains("error")) setSync("Saved");
  } catch (err) {
    if (err.status === 404) {
      uncache(token);
      showLanding("This planner doesn't exist (anymore). Check the link.");
      return false;
    }
    if (!quiet) toast("Couldn't load: " + err.message);
    setSync("Offline", true);
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
  if (record) {
    state.undo.push({ before, after: changes });
    if (state.undo.length > 200) state.undo.shift();
    state.redo = [];
  }
  enqueue(ops);
  render();
}

function undo() {
  const step = state.undo.pop();
  if (!step) return toast("Nothing to undo");
  commit(step.before, { record: false });
  state.redo.push(step);
}

function redo() {
  const step = state.redo.pop();
  if (!step) return toast("Nothing to redo");
  commit(step.after, { record: false });
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
  if (!days.length) return toast("Select some days first");
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
  toast(`Copied ${span.length} day${span.length > 1 ? "s" : ""}`);
  return text;
}

function pastePattern(pattern) {
  if (state.readOnly) return;
  const days = selectedDays();
  if (!days.length) return toast("Select where to paste first");
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
  if (!gaps.length) return toast("No uncovered days in " + state.year);
  const after = gaps.find((d) => d > (state.focus ?? "")) ?? gaps[0];
  select(after);
  cellFor(after)?.scrollIntoView({ block: "nearest", inline: "center" });
}

// ---------------------------------------------------------------- rendering

let cells = new Map();
let cellSigs = new WeakMap(); // cell -> rendered type ids; new cells are rendered in full
let cellTypesSig = null;
let shownSel = new Set();
let shownFocus = null;
let previewed = new Set();
let chipsSig = null;
const fillHandle = Object.assign(document.createElement("i"), {
  className: "fill-handle",
  title: "Drag to repeat the selected days",
});

function cellFor(date) {
  return cells.get(date);
}

function buildGrid() {
  const grid = $("grid");
  grid.textContent = "";
  cells = new Map();
  shownSel = new Set();
  shownFocus = null;
  previewed = new Set();
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
    label.textContent = MONTHS[m];
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
        wd.textContent = WD[weekday(date)];
        const fills = document.createElement("div");
        fills.className = "fills";
        const overlay = document.createElement("div");
        overlay.className = "sel-overlay";
        cell.append(fills, wd, overlay);
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
    const key = ids.join(",");
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
    const names = ids.map((id) => byId.get(id).name).join(", ");
    cell.title = fmtDate(date, LONG_DATE) + (names ? "\n" + names : "");
  }
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
  if (!days.length) {
    el.textContent = state.readOnly ? "View-only" : "Click or drag over days to select them.";
    return;
  }
  const work = days.filter((d) => !isWeekend(d)).length;
  const span = days.length === 1
    ? fmtDate(days[0])
    : `${fmtDate(days[0])} – ${fmtDate(days[days.length - 1])}`;
  el.textContent = `${days.length} day${
    days.length > 1 ? "s" : ""
  } selected (${work} weekdays): ${span}`;
}

function renderChipsActive(days) {
  for (const chip of document.querySelectorAll(".chip[data-type]")) {
    const id = chip.dataset.type;
    const all = days.length > 0 && days.every((d) => (state.entries.get(d) ?? []).includes(id));
    chip.classList.toggle("active", all);
  }
}

function chipTitle(t, i, st) {
  return `${t.name} – ${
    ROLE_LABELS[t.role]
  }\n${st.days} days in ${state.year}, ${st.workdays} workdays` +
    (state.readOnly ? "" : `\nClick (or press ${i + 1}) to toggle on the selected days`);
}

function renderTypes() {
  const box = $("types");
  const s = stats(state.entries, state.types, state.year);
  const sig = typesSig() + state.readOnly;
  if (sig === chipsSig) {
    // Same chips: update the numbers in place (keeps keyboard focus on them).
    state.types.forEach((t, i) => {
      const chip = box.children[i];
      const st = s.get(t.id);
      chip.title = chipTitle(t, i, st);
      chip.querySelector(".count").textContent = `${st.workdays}d`;
    });
    return;
  }
  chipsSig = sig;
  box.textContent = "";
  state.types.forEach((t, i) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.dataset.type = t.id;
    chip.disabled = state.readOnly;
    const st = s.get(t.id);
    chip.title = chipTitle(t, i, st);
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = t.color;
    if (t.role === "needs_cover") {
      sw.style.backgroundImage =
        "repeating-linear-gradient(135deg, rgba(255,255,255,.55) 0 3px, transparent 3px 7px)";
    }
    const name = document.createElement("span");
    name.textContent = t.name;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `${st.workdays}d`;
    chip.append(sw, name, count);
    if (i < 9 && !state.readOnly) {
      const key = document.createElement("span");
      key.className = "key";
      key.textContent = i + 1;
      chip.append(key);
    }
    chip.addEventListener("click", () => toggleOnSelection(t.id));
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
    msg.textContent = `⚠ ${gaps.length} weekday${
      gaps.length > 1 ? "s" : ""
    } with “${names}” not covered yet`;
    const btn = document.createElement("button");
    btn.className = "btn small";
    btn.textContent = "Next gap →";
    btn.title = "Jump to the next uncovered day (G)";
    btn.addEventListener("click", jumpToNextGap);
    el.append(msg, btn);
  } else {
    msg.className = "ok";
    msg.textContent = `✓ All “${names}” days in ${state.year} are covered`;
    el.append(msg);
  }
}

function render() {
  if (Number($("grid").dataset.year) !== state.year) buildGrid();
  $("planner").classList.toggle("readonly", state.readOnly);
  $("readonly-banner").hidden = !state.readOnly;
  $("btn-edit-types").hidden = state.readOnly;
  const nameInput = $("session-name");
  if (document.activeElement !== nameInput) nameInput.value = state.session?.name ?? "";
  nameInput.readOnly = state.readOnly;
  document.title = (state.session?.name ?? "Vacation Planner") + ` ${state.year}`;
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
  cacheState();
  state.year = y;
  state.selection.clear();
  state.anchor = state.focus = null;
  state.version++;
  if (applyCached()) setSync("Updating…");
  else state.entries = new Map();
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
  const next = new Set(days);
  for (const d of previewed) if (!next.has(d)) cellFor(d)?.classList.remove("fill-preview");
  for (const d of next) if (!previewed.has(d)) cellFor(d)?.classList.add("fill-preview");
  previewed = next;
  if (drag?.mode !== "fill") return;
  const n = days.length;
  $("selection-info").textContent = n
    ? `Fill ${n} day${n > 1 ? "s" : ""}`
    : "Drag past the selection to repeat it";
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
    // Touch: taps select (so the grid can still be scrolled); see onPointerUp.
    drag = { mode: "tap", date, x: e.clientX, y: e.clientY };
    return;
  }

  e.preventDefault();
  if (e.shiftKey && state.anchor) {
    select(state.anchor, date);
    drag = { mode: "select", anchor: state.anchor, base: new Set(), last: date };
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
  if (!drag || drag.mode === "tap") return;
  const date = dateAt(e.clientX, e.clientY);
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
  if ($("planner").hidden || inEditable(e)) return;
  const mod = e.ctrlKey || e.metaKey;
  const arrows = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -31, ArrowDown: 31 };

  if (e.key in arrows) {
    e.preventDefault();
    moveFocus(arrows[e.key], e.shiftKey);
  } else if (e.key === "Escape") {
    if (cancelFill()) return;
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
  if (unknown.length) toast(`Unknown type${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
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
  state.types.forEach((t, i) => {
    const row = document.createElement("div");
    row.className = "type-row";
    const color = Object.assign(document.createElement("input"), { type: "color", value: t.color });
    color.title = "Color";
    const name = Object.assign(document.createElement("input"), {
      type: "text",
      value: t.name,
      maxLength: 80,
    });
    name.setAttribute("aria-label", "Name");
    const role = document.createElement("select");
    role.setAttribute("aria-label", "Role");
    for (const [value, label] of Object.entries(ROLE_LABELS)) {
      role.append(new Option(label, value, false, value === t.role));
    }
    const up = Object.assign(document.createElement("button"), {
      className: "icon-btn",
      textContent: "↑",
      title: "Move up",
    });
    const down = Object.assign(document.createElement("button"), {
      className: "icon-btn",
      textContent: "↓",
      title: "Move down",
    });
    const del = Object.assign(document.createElement("button"), {
      className: "icon-btn",
      textContent: "🗑",
      title: "Delete",
    });
    up.disabled = i === 0;
    down.disabled = i === state.types.length - 1;

    color.addEventListener("change", () => updateType(t, { color: color.value }));
    name.addEventListener(
      "change",
      () => name.value.trim() && updateType(t, { name: name.value.trim() }),
    );
    role.addEventListener("change", () => updateType(t, { role: role.value }));
    up.addEventListener("click", () => moveType(i, -1));
    down.addEventListener("click", () => moveType(i, 1));
    del.addEventListener("click", () => deleteType(t));
    row.append(color, name, role, up, down, del);
    box.append(row);
  });
}

async function updateType(t, patch) {
  // Look the type up again: a refresh may have replaced the objects the editor rows hold.
  const current = typeById(t.id);
  if (current) Object.assign(current, patch);
  state.version++;
  render();
  try {
    await api.updateType(state.token, t.id, patch);
  } catch (err) {
    toast("Couldn't save type: " + err.message);
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
    toast("Couldn't reorder: " + err.message);
  }
}

async function deleteType(t) {
  const used = [...state.entries.values()].filter((ids) => ids.includes(t.id)).length;
  const msg = used
    ? `Delete “${t.name}”? It is used on ${used} day${
      used > 1 ? "s" : ""
    } in ${state.year} (and maybe other years). This can't be undone.`
    : `Delete “${t.name}”?`;
  if (!confirm(msg)) return;
  try {
    await api.deleteType(state.token, t.id);
    state.types = state.types.filter((x) => x.id !== t.id);
    for (const [d, ids] of state.entries) {
      const rest = ids.filter((id) => id !== t.id);
      rest.length ? state.entries.set(d, rest) : state.entries.delete(d);
    }
    state.undo = [];
    state.redo = [];
    state.version++;
    renderTypesEditor();
    render();
  } catch (err) {
    toast("Couldn't delete: " + err.message);
  }
}

async function addType() {
  const n = state.types.length + 1;
  try {
    const t = await api.addType(state.token, {
      name: `New type ${n}`,
      color: nextColor(state.types),
      role: "none",
    });
    state.types.push(t);
    state.version++;
    renderTypesEditor();
    render();
    const inputs = $("types-editor").querySelectorAll('input[type="text"]');
    inputs[inputs.length - 1]?.select();
  } catch (err) {
    toast("Couldn't add type: " + err.message);
  }
}

function feedUrl() {
  const boxes = [...$("feed-types").querySelectorAll("input")];
  const checked = boxes.filter((b) => b.checked).map((b) => b.value);
  const params = {};
  if (checked.length !== boxes.length) params.types = checked.join(",");
  if ($("feed-gaps").checked) params.gaps = "1";
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
  for (const t of state.types) {
    const label = document.createElement("label");
    label.className = "check";
    const cb = Object.assign(document.createElement("input"), {
      type: "checkbox",
      value: t.id,
      checked: true,
    });
    cb.addEventListener("change", updateFeedLinks);
    label.append(cb, " " + t.name);
    box.append(label);
  }
  $("feed-gaps").checked = state.types.some((t) => t.role === "needs_cover");
  updateFeedLinks();
  $("dlg-share").showModal();
}

function openApiDialog() {
  const base = api.calendarUrl("x").replace(/\/sessions\/x\/calendar\.ics$/, "");
  const id = state.readOnly ? "<edit-id>" : state.session.id;
  const t = state.types.find((x) => x.role === "covers") ?? state.types[0];
  const typeRef = t?.id ?? "vacation";
  const y = state.year;
  $("api-docs").textContent = `BASE=${base}
SESSION=${id}

# Read the planner (types + entries of a year)
curl "$BASE/sessions/$SESSION?year=${y}"

# Add "${t?.name ?? "Vacation"}" from Aug 3 to Aug 14, skipping weekends
curl -X POST "$BASE/sessions/$SESSION/entries" \\
  -H "content-type: application/json" \\
  -d '{"action":"add","type":"${typeRef}","from":"${y}-08-03","to":"${y}-08-14","skipWeekends":true}'

# Several operations at once (actions: add | remove | set | clear)
curl -X POST "$BASE/sessions/$SESSION/entries" \\
  -H "content-type: application/json" \\
  -d '{"ops":[
        {"action":"remove","type":"${typeRef}","dates":["${y}-08-07"]},
        {"action":"set","types":["${typeRef}"],"dates":["${y}-12-24","${y}-12-31"]},
        {"action":"clear","from":"${y}-01-01","to":"${y}-01-06"}
      ]}'

# Entry types
curl "$BASE/sessions/$SESSION/types"
curl -X POST "$BASE/sessions/$SESSION/types" -H "content-type: application/json" \\
  -d '{"name":"Day care closed","color":"#8b5cf6","role":"needs_cover"}'
curl -X PATCH "$BASE/sessions/$SESSION/types/${typeRef}" -H "content-type: application/json" \\
  -d '{"name":"Vacation Sascha","color":"#22c55e"}'
curl -X DELETE "$BASE/sessions/$SESSION/types/<type-id>"

# Calendar feed (read-only id works too). Optional: ?types=a,b&gaps=1
curl "$BASE/sessions/${state.session.readId}/calendar.ics"

# New planner
curl -X POST "$BASE/sessions" -H "content-type: application/json" -d '{"name":"Family ${y}"}'`;
  $("dlg-api").showModal();
}

// ---------------------------------------------------------------- landing / boot

function showLanding(message) {
  $("planner").hidden = true;
  $("year-nav").hidden = true;
  $("actions").hidden = true;
  $("session-name").hidden = true;
  $("home-link").hidden = false;
  $("landing").hidden = false;
  document.title = "Vacation Planner";
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
    name.textContent = e.name + (e.readOnly ? " (view only)" : "");
    const when = document.createElement("small");
    when.textContent = new Date(e.at).toLocaleDateString();
    a.append(name, when);
    li.append(a);
    ul.append(li);
  }
}

async function createPlanner() {
  const btn = $("btn-create");
  btn.disabled = true;
  try {
    const data = await api.createSession();
    location.href = pageUrl({ s: data.session.id });
  } catch (err) {
    toast("Couldn't create a planner: " + err.message, 5000);
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
  renderYearSelect();
  buildGrid();
  if (applyCached()) {
    render();
    setSync("Updating…");
  } else setSync("Loading…");
  if (!(await load({ pending }))) return;
  rememberSession();
  if (!state.selection.size && String(state.year) === today.slice(0, 4)) {
    cellFor(today)?.scrollIntoView({ block: "nearest", inline: "center" });
  }
  startPolling();
}

function bind() {
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
    setSync("Saving…");
    try {
      await api.renameSession(state.token, name);
      state.session.name = name;
      document.title = `${name} ${state.year}`;
      rememberSession();
      if (!flushing) setSync("Saved");
    } catch (err) {
      if (input.value.trim() === name) input.value = old;
      toast("Couldn't rename: " + err.message);
      if (!flushing) setSync(err.status ? "Saved" : "Offline", !err.status);
    }
  });
  $("session-name").addEventListener("keydown", (e) => e.key === "Enter" && e.target.blur());

  $("btn-share").addEventListener("click", openShareDialog);
  $("btn-api").addEventListener("click", openApiDialog);
  $("btn-help").addEventListener("click", () => $("dlg-help").showModal());
  $("btn-edit-types").addEventListener("click", openTypesDialog);
  $("btn-add-type").addEventListener("click", addType);
  $("feed-gaps").addEventListener("change", updateFeedLinks);
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
      toast("Copied to clipboard");
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
    if (!cancelFill()) drag = null;
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
  bind();
  const params = new URLSearchParams(location.search);
  const token = params.get("s");
  const year = Number(params.get("y")) || undefined;
  if (token && isConfigured()) openPlanner(token, year);
  else showLanding();
}

boot();
