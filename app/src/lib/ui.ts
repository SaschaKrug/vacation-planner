// Small bits of UI state shared across components: the help dialog.

import { useSyncExternalStore } from "react";

let helpOpen = false;
const listeners = new Set<() => void>();

export function setHelpOpen(open: boolean) {
  helpOpen = open;
  for (const l of listeners) l();
}

export function useHelpOpen(): boolean {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, () => helpOpen);
}
