import { Pencil } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { usePlanner } from "@/features/family/context";
import { stats } from "@/lib/core";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** The year's entry types as toggle chips (1–9 on the keyboard), with their day counts. */
export function TypeChips({ className }: { className?: string }) {
  const store = usePlanner();
  const { types, readOnly, year } = store;
  const settings = `/f/${store.token}/settings/vacation`;

  if (!types.length) {
    if (store.typeYears === null) {
      return <div className={cn("min-h-[34px]", className)} />;
    }
    const source = store.copySource();
    return (
      <div
        className={cn(
          "flex min-h-[34px] flex-wrap items-center gap-2.5 text-sm text-muted-foreground",
          className,
        )}
      >
        <span>
          {t(readOnly ? "types.empty_readonly" : "types.empty", { year })}
        </span>
        {!readOnly && source !== null && (
          <Button
            size="sm"
            title={t("types.copy_from_title", { from: source, to: year })}
            onClick={() => store.copyTypes(source)}
          >
            {t("types.copy_from", { year: source })}
          </Button>
        )}
        {!readOnly && source === null && (
          <Button size="sm" asChild>
            <Link to={settings}>{t("types.add_first")}</Link>
          </Button>
        )}
      </div>
    );
  }

  const days = store.selectedDays();
  const s = stats(store.entries, types, year);
  return (
    <div
      className={cn("flex min-w-0 items-center gap-1.5", className)}
      role="toolbar"
      aria-label={t("toolbar.label")}
    >
      {types.map((type, i) => {
        const st = s.get(type.id)!;
        const active = days.length > 0 &&
          days.every((d) => (store.entries.get(d) ?? []).includes(type.id));
        const title = t("chip.title", {
          name: type.name,
          role: t("role." + type.role),
          days: st.days,
          workdays: st.workdays,
          year,
        }) + (readOnly ? "" : t("chip.toggle_hint", { key: i + 1 }));
        return (
          <button
            key={type.id}
            type="button"
            className={cn("chip", active && "active")}
            style={{ "--c": type.color } as React.CSSProperties}
            disabled={readOnly}
            title={title}
            aria-pressed={active}
            onClick={() => store.toggleOnSelection(type.id)}
          >
            <span
              className={cn("swatch", type.role === "needs_cover" && "needs")}
              style={{ backgroundColor: type.color }}
            />
            <span className="name">{type.name}</span>
            <span className="count">{t("chip.count", { n: st.workdays })}</span>
          </button>
        );
      })}
      {!readOnly && (
        <Button
          variant="outline"
          size="icon"
          className="size-[34px] shrink-0 rounded-full"
          title={t("toolbar.edit_types")}
          aria-label={t("toolbar.edit_types")}
          asChild
        >
          <Link to={settings}>
            <Pencil />
          </Link>
        </Button>
      )}
    </div>
  );
}
