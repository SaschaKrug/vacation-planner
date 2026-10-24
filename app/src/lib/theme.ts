// Light / dark / like the system, per device. The .dark class on <html> switches the colors.

import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";
const KEY = "fp-theme";
const dark = matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let theme: Theme = stored();

function apply() {
  const isDark = theme === "dark" || (theme === "system" && dark.matches);
  document.documentElement.classList.toggle("dark", isDark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    isDark ? "#0b0d12" : "#2563eb",
  );
}

export function initTheme() {
  apply();
  dark.addEventListener("change", apply);
}

export function getTheme(): Theme {
  return theme;
}

export function setTheme(next: Theme) {
  theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // storage blocked
  }
  apply();
  for (const l of listeners) l();
}

export function useTheme(): Theme {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, getTheme);
}
