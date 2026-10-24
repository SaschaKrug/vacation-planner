import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { useFinance, usePlanner } from "@/features/family/context";
import type { Category, CategoryKind } from "@/lib/api";
import { nextColor } from "@/lib/core";
import { t } from "@/lib/i18n";
import { SettingsCard } from "./SettingsPage";

const CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "JPY",
  "CAD",
  "AUD",
];
const KINDS: CategoryKind[] = ["expense", "income", "both"];

export function FinanceSection() {
  const planner = usePlanner();
  const finance = useFinance();
  const sees = planner.family && planner.family.access !== "calendar";
  useEffect(() => {
    if (sees) finance.open();
  }, [sees, finance]);

  if (!planner.family) return null;
  if (!sees) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("finance.calendar_only")}
      </p>
    );
  }
  const edit = !planner.readOnly;
  const cats = finance.categories;

  async function remove(c: Category) {
    if (
      await confirm(
        t("finance.category_delete_confirm", { name: c.name }),
        t("types.delete"),
      )
    ) {
      finance.deleteCategory(c.id);
    }
  }

  return (
    <>
      <SettingsCard title={t("finance.currency")} scope="family">
        <Select
          value={finance.currency}
          disabled={!edit}
          onValueChange={(v) => finance.setCurrency(v)}
        >
          <SelectTrigger className="w-40" aria-label={t("finance.currency")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...new Set([finance.currency, ...CURRENCIES])].map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsCard>
      <SettingsCard
        title={t("finance.categories")}
        scope="family"
        description={t("finance.categories_help")}
      >
        <div className="space-y-2">
          {cats.map((c, i) => (
            <CategoryRow
              key={c.id}
              category={c}
              first={i === 0}
              last={i === cats.length - 1}
              disabled={!edit}
              onChange={(patch) => finance.updateCategory(c.id, patch)}
              onMove={(dir) => finance.moveCategory(i, dir)}
              onDelete={() => remove(c)}
            />
          ))}
        </div>
        {edit && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                finance.addCategory({
                  name: t("finance.new_category", { n: cats.length + 1 }),
                  color: nextColor(cats.map((c) => ({ ...c, role: "none" }))),
                  icon: "",
                  kind: "expense",
                })}
            >
              <Plus /> {t("finance.add_category")}
            </Button>
            <Button
              variant="outline"
              onClick={() => finance.addDefaultCategories()}
            >
              {t("finance.add_defaults")}
            </Button>
          </div>
        )}
      </SettingsCard>
      {edit && finance.mappings.length > 0 && (
        <SettingsCard
          title={t("finance.mappings")}
          scope="family"
          description={t("finance.mappings_help")}
        >
          <ul className="divide-y rounded-lg border">
            {finance.mappings.map((m) => (
              <li
                key={m.signature}
                className="flex items-center gap-2 px-3 py-2 text-sm"
              >
                <code className="min-w-0 flex-1 truncate text-xs">
                  {m.signature}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  title={t("types.delete")}
                  onClick={() => finance.deleteMapping(m.signature)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </SettingsCard>
      )}
    </>
  );
}

function CategoryRow(
  { category, first, last, disabled, onChange, onMove, onDelete }: {
    category: Category;
    first: boolean;
    last: boolean;
    disabled: boolean;
    onChange: (patch: Partial<Category>) => void;
    onMove: (dir: -1 | 1) => void;
    onDelete: () => void;
  },
) {
  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon);
  useEffect(() => setName(category.name), [category.name]);
  useEffect(() => setIcon(category.icon), [category.icon]);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b pb-2 last:border-0 sm:flex-nowrap sm:border-0 sm:pb-0">
      <input
        type="color"
        className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-card p-1 disabled:cursor-default"
        title={t("types.color")}
        value={category.color}
        disabled={disabled}
        onChange={(e) => onChange({ color: e.target.value })}
      />
      <Input
        className="w-12 shrink-0 px-1 text-center"
        aria-label={t("note.icon")}
        maxLength={16}
        value={icon}
        disabled={disabled}
        onChange={(e) => setIcon(e.target.value)}
        onBlur={() => icon.trim() !== category.icon && onChange({ icon: icon.trim() })}
      />
      <Input
        className="min-w-0 flex-1 basis-[calc(100%-110px)] sm:basis-auto"
        aria-label={t("types.name")}
        maxLength={80}
        value={name}
        disabled={disabled}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const next = name.trim();
          if (!next) setName(category.name);
          else if (next !== category.name) onChange({ name: next });
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <Select
        value={category.kind}
        disabled={disabled}
        onValueChange={(v) => onChange({ kind: v as CategoryKind })}
      >
        <SelectTrigger
          className="min-w-0 flex-1 sm:w-36 sm:flex-none"
          aria-label={t("finance.kind")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {KINDS.map((k) => <SelectItem key={k} value={k}>{t(`finance.kind_${k}`)}</SelectItem>)}
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
