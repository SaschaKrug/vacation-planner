// Per-device view settings of the calendar: the zoom (how many days fit across the year
// grid) and whether weekday letters show at every zoom.

import { useSyncExternalStore } from "react";
import { readFlag, writeFlag } from "@/lib/storage";

export const ZOOM = { min: 7, max: 31, initial: 31 };
/** From this zoom on, cells are big enough for weekday letters. */
export const SHOW_WEEKDAYS = 16;
const ZOOM_KEY = "fp-days-wide";
const WEEKDAYS_KEY = "fp-show-weekdays";

function readZoom(): number {
  try {
    const n = Number(
      localStorage.getItem(ZOOM_KEY) ?? localStorage.getItem("vp-days-wide"),
    );
    return n >= ZOOM.min && n <= ZOOM.max ? n : ZOOM.initial;
  } catch {
    return ZOOM.initial;
  }
}

let prefs = {
  zoom: readZoom(),
  alwaysWeekdays: readFlag(WEEKDAYS_KEY, "vp-show-weekdays"),
};
const listeners = new Set<() => void>();

function update(next: Partial<typeof prefs>) {
  prefs = { ...prefs, ...next };
  for (const l of listeners) l();
}

export function viewPrefs() {
  return prefs;
}

export function subscribeViewPrefs(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useViewPrefs() {
  return useSyncExternalStore(subscribeViewPrefs, viewPrefs);
}

export function setZoom(n: number) {
  n = Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(n)));
  try {
    localStorage.setItem(ZOOM_KEY, String(n));
  } catch {
    // storage blocked
  }
  update({ zoom: n });
}

/** Ctrl/⌘ + / − steps by about a quarter; 0 resets. */
export function zoomBy(dir: number) {
  const n = prefs.zoom;
  if (!dir) setZoom(ZOOM.initial);
  else if (dir > 0) setZoom(Math.min(n - 1, Math.round(n / 1.25)));
  else setZoom(Math.max(n + 1, Math.round(n * 1.25)));
}

export function setAlwaysWeekdays(on: boolean) {
  writeFlag(WEEKDAYS_KEY, on);
  update({ alwaysWeekdays: on });
}
