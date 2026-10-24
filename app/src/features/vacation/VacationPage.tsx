import { ChevronLeft, ChevronRight, Redo2, Share2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlanner } from "@/features/family/context";
import { t, useLang } from "@/lib/i18n";
import { setHelpOpen } from "@/lib/ui";
import { PageHeader } from "@/layout/PageHeader";
import { Coverage } from "./Coverage";
import { type GridView, monthView, narrowScreen } from "./grid";
import { NoteDialog } from "./NoteDialog";
import { SelectionBar } from "./SelectionBar";
import { today } from "./store";
import { TypeChips } from "./TypeChips";
import { zoomBy } from "./view-prefs";
import { YearGrid } from "./YearGrid";

function useNarrow() {
  return useSyncExternalStore((fn) => {
    narrowScreen.addEventListener("change", fn);
    return () => narrowScreen.removeEventListener("change", fn);
  }, () => narrowScreen.matches);
}

function inEditable(e: Event) {
  const el = e.target;
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable) ||
    !!document.querySelector('[role="dialog"], [role="alertdialog"]');
}

export function VacationPage() {
  const store = usePlanner();
  const lang = useLang();
  const narrow = useNarrow();
  const [, setParams] = useSearchParams();
  const plannerRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<GridView | null>(null);
  const [fill, setFill] = useState<number | null>(null);
  const [noteDays, setNoteDays] = useState<string[] | null>(null);
  const centered = useRef(false);

  const openNote = useCallback(() => {
    if (store.readOnly) return;
    const days = store.targetDays();
    if (!days.length) return void toast(t("toast.select_first"));
    setNoteDays(days);
  }, [store]);

  const jumpToGap = useCallback(() => {
    const day = store.nextGap();
    if (day) gridRef.current?.centerOn(day);
  }, [store]);

  const setYear = (y: number) => {
    store.setYear(y);
    setParams((p) => {
      p.set("y", String(y));
      return p;
    }, { replace: true });
  };

  // Rebuild the cells in the new language (month and weekday names).
  useEffect(() => gridRef.current?.rebuild(), [lang]);

  // Once the family has loaded, show today in the middle.
  useEffect(() => {
    if (centered.current || !store.family || !gridRef.current) return;
    centered.current = true;
    if (String(store.year) === today.slice(0, 4)) {
      gridRef.current.centerOn(today);
    }
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const dialog = document.querySelector(
        '[role="dialog"], [role="alertdialog"]',
      );
      // Zooms the calendar instead of the page, also while a field has the focus.
      const zoom = ({ "+": 1, "=": 1, "-": -1, "0": 0 } as Record<string, number>)[e.key];
      if (mod && !e.altKey && zoom !== undefined && !dialog) {
        if (monthView()) return;
        e.preventDefault();
        zoomBy(zoom);
        return;
      }
      if (inEditable(e)) return;
      const week = monthView() ? 7 : 31; // up/down: a week in the month view, else a month
      const arrows: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -week,
        ArrowDown: week,
      };
      const key = e.key.toLowerCase();
      if (e.key in arrows) {
        e.preventDefault();
        const day = store.moveFocus(arrows[e.key], e.shiftKey);
        if (day) gridRef.current?.scrollTo(day);
      } else if (e.key === "Escape") {
        if (gridRef.current?.cancelFill()) return;
        store.deselect();
      } else if (e.key === "PageUp") {
        e.preventDefault();
        setYear(store.year - 1);
      } else if (e.key === "PageDown") {
        e.preventDefault();
        setYear(store.year + 1);
      } else if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        store.redo();
      } else if (mod && key === "a") {
        e.preventDefault();
        store.select(`${store.year}-01-01`, `${store.year}-12-31`);
      } else if (mod || e.altKey) {
        return; // copy / cut / paste are handled by the clipboard events
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        store.clearSelectedDays();
      } else if (/^[1-9]$/.test(e.key)) {
        const type = store.types[Number(e.key) - 1];
        if (type) store.toggleOnSelection(type.id);
      } else if (e.key === "?") {
        setHelpOpen(true);
      } else if (key === "g") {
        jumpToGap();
      } else if (key === "n" && !e.shiftKey) {
        e.preventDefault();
        openNote();
      }
    };
    const onCopy = (e: ClipboardEvent, cut = false) => {
      if (inEditable(e) || !store.selection.size) return;
      const text = store.copySelection();
      if (!text) return;
      e.clipboardData?.setData("text/plain", text);
      e.preventDefault();
      if (cut) store.clearSelectedDays();
    };
    const copy = (e: ClipboardEvent) => onCopy(e);
    const cut = (e: ClipboardEvent) => !store.readOnly && onCopy(e, true);
    const paste = (e: ClipboardEvent) => {
      if (inEditable(e) || store.readOnly) return;
      e.preventDefault();
      store.pasteText(e.clipboardData?.getData("text/plain") ?? "");
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", paste);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", paste);
    };
  });

  const callbacks = {
    onNote: openNote,
    onFill: setFill,
    dockTop: () => dockRef.current?.getBoundingClientRect().top ?? innerHeight,
  };
  const onReady = useCallback(
    (g: GridView | null) => (gridRef.current = g),
    [],
  );

  return (
    <>
      <PageHeader title={t("nav.vacation")}>
        <YearNav year={store.year} onChange={setYear} />
        <div className="flex-1" />
        {!store.readOnly && (
          <>
            <Button
              variant="ghost"
              size="icon"
              title={t("page.undo")}
              aria-label={t("toolbar.undo")}
              disabled={!store.undoStack.length}
              onClick={() => store.undo()}
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title={t("page.redo")}
              aria-label={t("toolbar.redo")}
              disabled={!store.redoStack.length}
              onClick={() => store.redo()}
            >
              <Redo2 />
            </Button>
          </>
        )}
        <Button size="sm" asChild title={t("top.share_title")}>
          <Link to={`/f/${store.token}/settings/sharing`}>
            <Share2 /> <span className="max-sm:sr-only">{t("page.share")}</span>
          </Link>
        </Button>
      </PageHeader>
      <div
        ref={plannerRef}
        className="planner flex min-w-0 flex-col pt-1 sm:p-5 sm:pt-3.5"
        style={{ "--mv-top": "3.5rem" } as React.CSSProperties}
      >
        {!narrow && (
          <div className="mb-3 flex items-start gap-3">
            <TypeChips className="flex-1 flex-wrap" />
            <Coverage onJump={jumpToGap} />
          </div>
        )}
        {narrow && <Coverage onJump={jumpToGap} className="mx-3 mt-1 mb-2 self-start" />}
        {store.readOnly && store.family && (
          <p className="mx-3 mb-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm sm:mx-0">
            {t("readonly.banner")}
          </p>
        )}
        <YearGrid
          plannerRef={plannerRef}
          callbacks={callbacks}
          onReady={onReady}
        />
        {!narrow && (
          <div className="mt-2.5">
            <SelectionBar fill={fill} onNote={openNote} />
          </div>
        )}
      </div>
      {narrow && (
        <div
          ref={dockRef}
          className="sticky bottom-0 z-10 border-t bg-card/90 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.1)] backdrop-blur-lg"
        >
          <div className="mb-2">
            <SelectionBar fill={fill} onNote={openNote} compact />
          </div>
          <TypeChips className="overflow-x-auto px-3 py-0.5 [scrollbar-width:none]" />
        </div>
      )}
      {noteDays && (
        <NoteDialog
          days={noteDays}
          onClose={() => setNoteDays(null)}
        />
      )}
    </>
  );
}

function YearNav(
  { year, onChange }: { year: number; onChange: (y: number) => void },
) {
  const now = new Date().getFullYear();
  const years = new Set<number>();
  for (let y = now - 5; y <= now + 5; y++) years.add(y);
  years.add(year);
  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        title={t("top.prev_year_title")}
        aria-label={t("top.prev_year")}
        onClick={() => onChange(year - 1)}
      >
        <ChevronLeft />
      </Button>
      <Select value={String(year)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger
          className="h-8 w-[88px] font-semibold"
          aria-label={t("top.year")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...years].sort().map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon"
        title={t("top.next_year_title")}
        aria-label={t("top.next_year")}
        onClick={() => onChange(year + 1)}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
