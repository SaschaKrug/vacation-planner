import { CalendarRange, Eraser, MessageCircle, MousePointerClick, Search, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { usePlanner } from "@/features/family/context";
import { isWeekend } from "@/lib/core";
import { t } from "@/lib/i18n";
import { readFlag, writeFlag } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { fmtDate, noteText } from "./grid";
import { setZoom, useViewPrefs, ZOOM } from "./view-prefs";

const HINTED_KEY = "fp-hinted";
const coarse = matchMedia("(pointer: coarse)");

/** A hint while nothing is selected; the selection and its actions otherwise. On phones it
 *  sits in the dock at the bottom. */
export function SelectionBar(
  { fill, onNote, compact }: {
    fill: number | null;
    onNote: () => void;
    compact?: boolean;
  },
) {
  const store = usePlanner();
  const { readOnly } = store;
  const days = store.selectedDays();
  const has = days.length > 0;
  // Phones show the "how to select" hint only until the first selection.
  const [hinted, setHinted] = useState(() => readFlag(HINTED_KEY, "vp-hinted"));
  if (has && !hinted) {
    writeFlag(HINTED_KEY, true);
    setHinted(true);
  }

  let info: string;
  if (fill !== null) {
    info = fill ? t("fill.count", { n: fill }) : t("fill.drag_past");
  } else if (!has) {
    info = readOnly ? t("sel.view_only") : t(coarse.matches ? "sel.none_touch" : "sel.none");
  } else {
    const work = days.filter((d) => !isWeekend(d)).length;
    const span = days.length === 1
      ? fmtDate(days[0])
      : `${fmtDate(days[0])} – ${fmtDate(days[days.length - 1])}`;
    // Touch devices have no tooltips, so a single day's note is shown here.
    const note = days.length === 1 && store.notes.get(days[0]);
    info = t("sel.info", { n: days.length, work, span }) +
      (note ? " · " + noteText(note) : "");
  }

  if (compact && !has && fill === null && (hinted || readOnly)) return null;

  return (
    <div
      className={cn(
        "flex min-h-[46px] items-center gap-2.5 rounded-lg border border-transparent py-1.5 pr-1.5 pl-3.5 text-[13px] text-muted-foreground max-sm:text-sm",
        has && !compact && "border-border bg-card shadow-xs",
        compact && "min-h-0 flex-wrap gap-x-2 gap-y-1.5 py-0 pr-2",
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          has && "font-medium text-foreground",
        )}
      >
        {info}
      </span>
      {has && !readOnly && (
        <div
          className={cn(
            "flex items-center gap-2 text-foreground",
            compact &&
              "order-3 -mr-2 -ml-3.5 basis-full overflow-x-auto px-3 [scrollbar-width:none]",
          )}
        >
          <Button
            size="sm"
            variant="outline"
            title={t("toolbar.note_title")}
            onClick={onNote}
          >
            <MessageCircle /> {t("toolbar.note")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            title={t("sel.clear_title")}
            onClick={() => store.clearSelectedDays()}
          >
            <Eraser /> {t("sel.clear")}
          </Button>
          <label
            className="mx-1.5 inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap select-none"
            title={t("toolbar.skip_weekends_title")}
          >
            <Checkbox
              checked={store.skipWeekends}
              onCheckedChange={(v) => store.setSkipWeekends(!!v)}
            />
            {t("toolbar.skip_weekends")}
          </label>
          {coarse.matches && (
            <>
              <Button
                size="sm"
                variant={store.rangeMode ? "secondary" : "outline"}
                aria-pressed={store.rangeMode}
                title={t("toolbar.range_title")}
                onClick={() => store.setRangeMode(!store.rangeMode)}
              >
                <CalendarRange /> {t("toolbar.range")}
              </Button>
              <Button
                size="sm"
                variant={store.multi ? "secondary" : "outline"}
                aria-pressed={store.multi}
                title={t("toolbar.multi_title")}
                onClick={() => store.setMulti(!store.multi)}
              >
                <MousePointerClick /> {t("toolbar.multi")}
              </Button>
            </>
          )}
        </div>
      )}
      {has && (
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          title={t("sel.deselect_title")}
          aria-label={t("sel.deselect")}
          onClick={() => store.deselect()}
        >
          <X />
        </Button>
      )}
      {!compact && <ZoomSlider />}
    </div>
  );
}

function ZoomSlider() {
  const { zoom } = useViewPrefs();
  return (
    <label
      className="ml-2 inline-flex items-center gap-1.5 select-none"
      title={t("toolbar.zoom_title")}
    >
      <Search className="size-3.5 opacity-70" aria-hidden />
      <input
        type="range"
        className="w-24 cursor-pointer accent-primary"
        aria-label={t("toolbar.zoom")}
        min={ZOOM.min}
        max={ZOOM.max}
        // To the right = zoom in = fewer days.
        value={ZOOM.min + ZOOM.max - zoom}
        onChange={(e) => setZoom(ZOOM.min + ZOOM.max - Number(e.target.value))}
      />
      <output className="min-w-[4.2em] tabular-nums">
        {t("toolbar.zoom_days", { n: zoom })}
      </output>
    </label>
  );
}
