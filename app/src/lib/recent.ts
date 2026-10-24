// Families opened on this device, newest first: the family switcher and the start page list
// them.

import { useSyncExternalStore } from "react";
import type { Family } from "./api";
import { read, write } from "./storage";

const KEY = "fp-recent";
const OLD_KEY = "vp-recent"; // from before the rename, same shape
const MAX = 10;

export interface RecentFamily {
  token: string;
  name: string;
  readOnly: boolean;
  at: number;
}

const listeners = new Set<() => void>();
let cache: RecentFamily[] | null = null;

function load(): RecentFamily[] {
  const list = read<RecentFamily[] | null>(KEY, null) ??
    read<RecentFamily[]>(OLD_KEY, []);
  return Array.isArray(list) ? list.filter((e) => e && typeof e.token === "string") : [];
}

export function recentFamilies(): RecentFamily[] {
  return (cache ??= load());
}

function save(list: RecentFamily[]) {
  cache = list;
  write(KEY, list);
  for (const l of listeners) l();
}

export function rememberFamily(token: string, family: Family) {
  const entry = {
    token,
    name: family.name,
    readOnly: family.readOnly,
    at: Date.now(),
  };
  save(
    [entry, ...recentFamilies().filter((e) => e.token !== token)].slice(0, MAX),
  );
}

export function forgetFamily(token: string) {
  save(recentFamilies().filter((e) => e.token !== token));
}

export function useRecentFamilies(): RecentFamily[] {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, recentFamilies);
}
