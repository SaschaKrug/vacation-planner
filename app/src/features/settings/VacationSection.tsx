import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { confirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePlanner } from "@/features/family/context";
import { setAlwaysWeekdays, useViewPrefs } from "@/features/vacation/view-prefs";
import { type EntryType, type Role, ROLES } from "@/lib/core";
import { t } from "@/lib/i18n";
import { SettingsCard } from "./SettingsPage";

export function VacationSection() {
  const store = usePlanner();
  const prefs = useViewPrefs();
  const [, setParams] = useSearchParams();
  const [focusId, setFocusId] = useState<string | null>(null);
  const year = store.year;
  const setYear = (y: number) => {
    store.setYear(y);
    setParams((p) => {
      p.set("y", String(y));
      return p;
    }, { replace: true });
  };

  async function remove(type: EntryType) {
    const used = store.daysWith(type.id);
    const msg = used
      ? t("types.confirm_delete_used", { name: type.name, n: used, year })
      : t("types.confirm_delete", { name: type.name });
    if (await confirm(msg, t("types.delete"))) store.deleteType(type.id);
  }

  const source = store.copySource();

  return (
    <>
      <SettingsCard
        title={t("types.title_year", { year })}
        scope="family"
        description={t("types.year_note", { year })}
      >
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("top.prev_year")}
            onClick={() => setYear(year - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="w-14 text-center font-semibold tabular-nums">
            {year}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("top.next_year")}
            onClick={() => setYear(year + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
        {store.readOnly && (
          <p className="text-sm text-muted-foreground">
            {t("settings.types_readonly")}
          </p>
        )}
        <div className="space-y-2">
          {store.types.map((type, i) => (
            <TypeRow
              key={type.id}
              type={type}
              first={i === 0}
              last={i === store.types.length - 1}
              autoFocus={type.id === focusId}
              disabled={store.readOnly}
              onChange={(patch) => store.updateType(type.id, patch)}
              onMove={(dir) => store.moveType(i, dir)}
              onDelete={() => remove(type)}
            />
          ))}
        </div>
        {!store.readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                const type = await store.addType();
                if (type) setFocusId(type.id);
              }}
            >
              <Plus /> {t("types.add").replace(/^\+\s*/, "")}
            </Button>
            {!store.types.length && source !== null && (
              <Button onClick={() => store.copyTypes(source)}>
                {t("types.copy_from", { year: source })}
              </Button>
            )}
          </div>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-primary">
            {t("types.roles_summary")}
          </summary>
          <ul className="mt-2 list-disc space-y-1 rounded-lg bg-muted py-2.5 pr-3 pl-7 text-muted-foreground [&_b]:text-foreground">
            {/* Our own strings, with <b> markup. */}
            {["help_needs", "help_covers", "help_day_off", "help_none"].map((
              k,
            ) => (
              <li
                key={k}
                dangerouslySetInnerHTML={{ __html: t(`types.${k}`) }}
              />
            ))}
          </ul>
        </details>
      </SettingsCard>
      <SettingsCard title={t("settings.calendar_view")} scope="device">
        <label
          className="flex items-center justify-between gap-4 text-sm"
          title={t("menu.weekdays_title")}
        >
          <span>{t("menu.weekdays")}</span>
          <Switch
            checked={prefs.alwaysWeekdays}
            onCheckedChange={setAlwaysWeekdays}
          />
        </label>
        <label
          className="flex items-center justify-between gap-4 text-sm"
          title={t("settings.skip_weekends_title")}
        >
          <span>{t("toolbar.skip_weekends")}</span>
          <Switch
            checked={store.skipWeekends}
            onCheckedChange={(v) => store.setSkipWeekends(v)}
          />
        </label>
      </SettingsCard>
    </>
  );
}

function TypeRow(
  { type, first, last, autoFocus, disabled, onChange, onMove, onDelete }: {
    type: EntryType;
    first: boolean;
    last: boolean;
    autoFocus: boolean;
    disabled: boolean;
    onChange: (patch: Partial<EntryType>) => void;
    onMove: (dir: -1 | 1) => void;
    onDelete: () => void;
  },
) {
  const [name, setName] = useState(type.name);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => setName(type.name), [type.name]);
  useEffect(() => {
    if (autoFocus) nameRef.current?.select();
  }, [autoFocus]);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b pb-2 last:border-0 sm:flex-nowrap sm:border-0 sm:pb-0">
      <input
        type="color"
        className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-card p-1 disabled:cursor-default"
        title={t("types.color")}
        value={type.color}
        disabled={disabled}
        onChange={(e) => onChange({ color: e.target.value })}
      />
      <Input
        ref={nameRef}
        className="min-w-0 flex-1 basis-[calc(100%-46px)] sm:basis-auto"
        aria-label={t("types.name")}
        maxLength={80}
        value={name}
        disabled={disabled}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const next = name.trim();
          if (!next) setName(type.name);
          else if (next !== type.name) onChange({ name: next });
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <Select
        value={type.role}
        disabled={disabled}
        onValueChange={(v) => onChange({ role: v as Role })}
      >
        <SelectTrigger
          className="min-w-0 flex-1 sm:w-40 sm:flex-none"
          aria-label={t("types.role")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => <SelectItem key={r} value={r}>{t(`role.${r}`)}</SelectItem>)}
        </SelectContent>
      </Select>
      {!disabled && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title={t("types.up")}
            disabled={first}
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title={t("types.down")}
            disabled={last}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title={t("types.delete")}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </>
      )}
    </div>
  );
}
