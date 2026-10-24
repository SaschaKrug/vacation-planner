// The open family's PlannerStore, for every page under /f/:token.

import { createContext, useContext, useSyncExternalStore } from "react";
import type { FinanceStore } from "@/features/finance/store";
import type { PlannerStore } from "@/features/vacation/store";

export const PlannerContext = createContext<PlannerStore | null>(null);

/** The store; the component re-renders on every change it emits. */
export function usePlanner(): PlannerStore {
  const store = useContext(PlannerContext);
  if (!store) throw new Error("usePlanner outside of a family");
  useSyncExternalStore(store.subscribe, store.getRev);
  return store;
}

/** The store without re-rendering on its changes (for event handlers). */
export function usePlannerStore(): PlannerStore {
  const store = useContext(PlannerContext);
  if (!store) throw new Error("usePlannerStore outside of a family");
  return store;
}

export const FinanceContext = createContext<FinanceStore | null>(null);

/** The family's FinanceStore (loads on first use); re-renders on its changes. */
export function useFinance(): FinanceStore {
  const store = useContext(FinanceContext);
  if (!store) throw new Error("useFinance outside of a family");
  useSyncExternalStore(store.subscribe, store.getRev);
  return store;
}
