import { Button } from "@/components/ui/button";
import { usePlanner } from "@/features/family/context";
import { gapDays } from "@/lib/core";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Coverage status as a compact pill; the full sentence is its tooltip. */
export function Coverage(
  { onJump, className }: { onJump: () => void; className?: string },
) {
  const { types, entries, year } = usePlanner();
  const needs = types.filter((x) => x.role === "needs_cover");
  if (!needs.length) return null;
  const gaps = gapDays(entries, types, year);
  const names = needs.map((x) => x.name).join(" / ");
  return (
    <div
      className={cn(
        "flex h-[34px] shrink-0 items-center gap-2.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap",
        gaps.length ? "border-gap/35 bg-gap/10 pr-[3px]" : "border-ok/30 bg-ok/10",
        className,
      )}
      title={gaps.length
        ? t("coverage.gaps_title", { n: gaps.length, names })
        : t("coverage.ok_title", { names, year })}
    >
      {gaps.length
        ? (
          <>
            <span className="font-semibold text-gap">
              {t("coverage.gaps", { n: gaps.length })}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-full"
              title={t("coverage.next_title")}
              onClick={onJump}
            >
              {t("coverage.next")}
            </Button>
          </>
        )
        : <span className="text-ok">{t("coverage.ok")}</span>}
    </div>
  );
}
