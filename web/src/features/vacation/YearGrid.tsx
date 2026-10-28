import { useEffect, useRef } from "react";
import { usePlannerStore } from "@/features/family/context";
import { t } from "@/lib/i18n";
import { type GridCallbacks, GridView } from "./grid";

/** Mounts the imperative calendar (grid.ts) and hands its GridView to the page. */
export function YearGrid(
  { plannerRef, callbacks, onReady }: {
    plannerRef: React.RefObject<HTMLElement | null>;
    callbacks: GridCallbacks;
    onReady: (grid: GridView | null) => void;
  },
) {
  const store = usePlannerStore();
  const wrapRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cb = useRef(callbacks);
  cb.current = callbacks;

  useEffect(() => {
    const view = new GridView(
      store,
      wrapRef.current!,
      gridRef.current!,
      plannerRef.current!,
      {
        onNote: () => cb.current.onNote(),
        onFill: (n) => cb.current.onFill(n),
        dockTop: () => cb.current.dockTop(),
      },
    );
    onReady(view);
    return () => {
      view.destroy();
      onReady(null);
    };
    // The view lives as long as the store; callbacks go through the ref.
  }, [store, plannerRef, onReady]);

  return (
    <div ref={wrapRef} className="grid-wrap">
      <div
        ref={gridRef}
        className="grid"
        role="grid"
        tabIndex={0}
        aria-label={t("grid.label")}
      />
    </div>
  );
}
