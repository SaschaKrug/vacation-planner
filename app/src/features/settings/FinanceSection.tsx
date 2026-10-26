import { ArrowDown, ArrowUp, CornerDownRight, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { confirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFinance, usePlanner } from "@/features/family/context";
import type { Account, Benchmark, Category, CategoryKind, CentsRange } from "@/lib/api";
import { nextColor } from "@/lib/core";
import { getLang, t } from "@/lib/i18n";
import { centsToInput, formatMoney, parseMoney } from "@/lib/money";
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
/** Indentation per level, up to this many levels (deeper ones line up with the last). */
const MAX_INDENT = 6;

export function FinanceSection() {
  const planner = usePlanner();
  const finance = useFinance();
  const sees = !!planner.family;
  useEffect(() => {
    if (sees) finance.open();
  }, [sees, finance]);

  if (!planner.family) return null;
  const edit = !planner.readOnly;
  const cats = finance.categories;
  const tree = finance.categoryTree;
  const accounts = finance.accounts;

  async function clearAll() {
    if (await confirm(t("finance.clear_confirm"), t("finance.clear"))) finance.clearAll();
  }

  async function remove(c: Category) {
    const parent = tree.parentOf(c.id);
    const text = parent
      ? t("finance.subcategory_delete_confirm", { name: c.name, parent: parent.name })
      : t("finance.category_delete_confirm", { name: c.name });
    if (await confirm(text, t("types.delete"))) finance.deleteCategory(c.id);
  }

  /** A new category, at the top level or (with its color and kind) under `parent`. */
  function addCategory(parent?: Category) {
    finance.addCategory({
      name: t("finance.new_category", { n: cats.length + 1 }),
      color: parent?.color ?? nextColor(cats.map((c) => ({ ...c, role: "none" }))),
      icon: "",
      kind: parent?.kind ?? "expense",
      parentId: parent?.id ?? null,
    });
  }

  async function removeAccount(a: Account) {
    if (await confirm(t("finance.account_delete_confirm", { name: a.name }), t("types.delete"))) {
      finance.deleteAccount(a.id);
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
        title={t("finance.accounts")}
        scope="family"
        description={t("finance.accounts_help")}
      >
        <div className="space-y-2">
          {accounts.map((a, i) => (
            <AccountRow
              key={a.id}
              account={a}
              currency={finance.currency}
              first={i === 0}
              last={i === accounts.length - 1}
              disabled={!edit}
              onChange={(patch) => finance.updateAccount(a.id, patch)}
              onMove={(dir) => finance.moveAccount(i, dir)}
              onDelete={() => removeAccount(a)}
            />
          ))}
        </div>
        {edit && (
          <Button
            variant="outline"
            onClick={() =>
              finance.addAccount({
                name: t("finance.new_account", { n: accounts.length + 1 }),
                color: nextColor(accounts.map((a) => ({ ...a, role: "none" }))),
                icon: "",
              })}
          >
            <Plus /> {t("finance.add_account")}
          </Button>
        )}
      </SettingsCard>
      <SettingsCard
        title={t("finance.categories")}
        scope="family"
        description={t("finance.categories_help")}
      >
        <div className="space-y-2">
          {tree.ordered.map(({ category: c, depth }) => {
            const parent = tree.parentOf(c.id);
            const siblings = parent ? tree.byId.get(parent.id)!.children : tree.roots;
            const i = siblings.findIndex((n) => n.category.id === c.id);
            // Anywhere but into itself or one of its subcategories.
            const inside = tree.subtree(c.id);
            const targets = tree.ordered.filter((n) => !inside.has(n.category.id));
            return (
              <CategoryRow
                key={c.id}
                category={c}
                depth={depth}
                first={i === 0}
                last={i === siblings.length - 1}
                disabled={!edit}
                targets={targets.map((n) => ({ category: n.category, depth: n.depth }))}
                onChange={(patch) => finance.updateCategory(c.id, patch)}
                onMove={(dir) => finance.moveCategory(c.id, dir)}
                onMoveTo={(parentId) => finance.moveCategoryTo(c.id, parentId)}
                onAddChild={() => addCategory(c)}
                onDelete={() => remove(c)}
              />
            );
          })}
        </div>
        {edit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => addCategory()}>
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
      <BenchmarkCard edit={edit} />
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
      {edit && (
        <SettingsCard
          title={t("finance.danger_zone")}
          scope="family"
          description={t("finance.clear_help")}
          danger
        >
          <Button variant="destructive" className="justify-self-start" onClick={clearAll}>
            <Trash2 /> {t("finance.clear")}
          </Button>
        </SettingsCard>
      )}
    </>
  );
}

/** A category: color, icon, name and (top level only; subcategories have their top
 *  category's) kind; moved among its siblings with the arrows, elsewhere in the tree from the
 *  menu, where subcategories are added too. Indented by its depth. */
function CategoryRow(
  {
    category,
    depth,
    first,
    last,
    disabled,
    targets,
    onChange,
    onMove,
    onMoveTo,
    onAddChild,
    onDelete,
  }: {
    category: Category;
    depth: number;
    first: boolean;
    last: boolean;
    disabled: boolean;
    /** Where it can move to (not into itself or its subcategories). */
    targets: { category: Category; depth: number }[];
    onChange: (patch: Partial<Category>) => void;
    onMove: (dir: -1 | 1) => void;
    onMoveTo: (parentId: string | null) => void;
    onAddChild: () => void;
    onDelete: () => void;
  },
) {
  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon);
  useEffect(() => setName(category.name), [category.name]);
  useEffect(() => setIcon(category.icon), [category.icon]);

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b pb-2 last:border-0 sm:flex-nowrap sm:border-0 sm:pb-0"
      style={{ marginInlineStart: `${Math.min(depth, MAX_INDENT) * 1.25}rem` }}
    >
      {depth > 0 && <CornerDownRight className="size-4 shrink-0 text-muted-foreground" />}
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
      {depth === 0 && (
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
      )}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title={t("finance.category_actions")}
                aria-label={t("finance.category_actions")}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onAddChild}>
                <Plus /> {t("finance.add_subcategory")}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <CornerDownRight /> {t("finance.move_to")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                  <DropdownMenuItem
                    disabled={!category.parentId}
                    onSelect={() => onMoveTo(null)}
                  >
                    {t("finance.top_level")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {targets.map(({ category: c, depth }) => (
                    <DropdownMenuItem
                      key={c.id}
                      disabled={c.id === category.parentId}
                      style={{ paddingLeft: `${0.5 + Math.min(depth, MAX_INDENT) * 0.875}rem` }}
                      onSelect={() => onMoveTo(c.id)}
                    >
                      {c.icon} {c.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
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

/** Cents as an editable string, with a minus for a negative balance. */
function balanceInput(cents: number) {
  return (cents < 0 ? "-" : "") + centsToInput(cents, getLang());
}

function AccountRow(
  { account, currency, first, last, disabled, onChange, onMove, onDelete }: {
    account: Account;
    currency: string;
    first: boolean;
    last: boolean;
    disabled: boolean;
    onChange: (patch: Partial<Account>) => void;
    onMove: (dir: -1 | 1) => void;
    onDelete: () => void;
  },
) {
  const [name, setName] = useState(account.name);
  const [icon, setIcon] = useState(account.icon);
  const [opening, setOpening] = useState(balanceInput(account.openingCents));
  useEffect(() => setName(account.name), [account.name]);
  useEffect(() => setIcon(account.icon), [account.icon]);
  useEffect(() => setOpening(balanceInput(account.openingCents)), [account.openingCents]);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b pb-2 last:border-0">
      <input
        type="color"
        className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-card p-1 disabled:cursor-default"
        title={t("types.color")}
        value={account.color}
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
        onBlur={() => icon.trim() !== account.icon && onChange({ icon: icon.trim() })}
      />
      <Input
        className="min-w-32 flex-1"
        aria-label={t("types.name")}
        maxLength={80}
        value={name}
        disabled={disabled}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const next = name.trim();
          if (!next) setName(account.name);
          else if (next !== account.name) onChange({ name: next });
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="shrink-0">{t("finance.opening")}</span>
        <Input
          className="w-28 text-right tabular-nums"
          inputMode="decimal"
          aria-label={`${t("finance.opening")} (${currency})`}
          title={`${t("finance.balance")}: ${
            formatMoney(account.balanceCents, currency, getLang())
          }`}
          value={opening}
          disabled={disabled}
          onChange={(e) => setOpening(e.target.value)}
          onBlur={() => {
            const cents = opening.trim() ? parseMoney(opening) : 0;
            if (cents === null) setOpening(balanceInput(account.openingCents));
            else if (cents !== account.openingCents) onChange({ openingCents: cents });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </label>
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

/** A range per month as typed: "" for an end that isn't given. */
interface RangeDraft {
  low: string;
  high: string;
}

function rangeDraft(r: CentsRange | null | undefined): RangeDraft {
  const input = (cents: number) => centsToInput(cents, getLang());
  return r ? { low: input(r.lowCents), high: input(r.highCents) } : { low: "", high: "" };
}

/** A typed range: null when empty, "invalid" when not numbers of at least 0 from low to high.
 *  One end alone is a single value. */
function parseRange(d: RangeDraft): CentsRange | null | "invalid" {
  const parse = (v: string) => (v.trim() ? parseMoney(v) : undefined);
  const low = parse(d.low), high = parse(d.high);
  if (low === undefined && high === undefined) return null;
  if (low === null || high === null || (low ?? 0) < 0 || (high ?? 0) < 0) {
    return "invalid";
  }
  if (low !== undefined && high !== undefined && low > high) return "invalid";
  return { lowCents: low ?? high!, highCents: high ?? low! };
}

/** Two amounts, from and to. */
function RangeInput(
  { label, value, placeholder, disabled, onChange }: {
    label: string;
    value: RangeDraft;
    placeholder?: RangeDraft;
    disabled: boolean;
    onChange: (value: RangeDraft) => void;
  },
) {
  const input = (end: "low" | "high") => (
    <Input
      className="w-24 text-right tabular-nums sm:w-28"
      inputMode="decimal"
      aria-label={`${label}: ${
        t(end === "low" ? "finance.benchmark_from" : "finance.benchmark_to")
      }`}
      placeholder={placeholder?.[end] ??
        t(end === "low" ? "finance.benchmark_from" : "finance.benchmark_to")}
      value={value[end]}
      disabled={disabled}
      onChange={(e) => onChange({ ...value, [end]: e.target.value })}
    />
  );
  return (
    <div className="flex shrink-0 items-center gap-1">
      {input("low")}
      <span className="text-muted-foreground">–</span>
      {input("high")}
    </div>
  );
}

/**
 * The statistic average the overview compares with (e.g. a statistics office's household
 * spending): a source, and ranges per month (from – to; one end alone is a single value) for
 * income, expenses and the top-level categories. Ranges the assistant set on subcategories stay
 * as they are; a top-level category without its own shows their sum. Saved with the button;
 * without any amount it is removed.
 */
function BenchmarkCard({ edit }: { edit: boolean }) {
  const finance = useFinance();
  const lang = getLang();
  const saved = finance.overview?.benchmark ?? null;
  const tree = finance.categoryTree;
  const fromSaved = () => ({
    label: saved?.label ?? "",
    income: rangeDraft(saved?.income),
    expense: rangeDraft(saved?.expense),
    categories: Object.fromEntries(
      (saved?.categories ?? []).map((c) => [c.categoryId, rangeDraft(c)]),
    ) as Record<string, RangeDraft>,
  });
  const [draft, setDraft] = useState(fromSaved);
  const [saving, setSaving] = useState(false);
  const savedKey = JSON.stringify(saved);
  useEffect(() => setDraft(fromSaved()), [savedKey]);

  const income = parseRange(draft.income);
  const expense = parseRange(draft.expense);
  const categories = Object.entries(draft.categories)
    .filter(([id]) => tree.byId.has(id))
    .map(([categoryId, d]) => ({ categoryId, range: parseRange(d) }));
  const invalid = [income, expense, ...categories.map((c) => c.range)]
    .some((r) => r === "invalid");
  const next: Benchmark | null = invalid ? null : {
    label: draft.label.trim(),
    income: income as CentsRange | null,
    expense: expense as CentsRange | null,
    categories: categories.flatMap(({ categoryId, range }) =>
      range ? [{ categoryId, ...(range as CentsRange) }] : []
    ),
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(fromSaved());
  const empty = !next?.income && !next?.expense && !next?.categories.length;

  if (!edit && !saved) return null; // viewers see it only when it is set

  async function save(b: Benchmark | null) {
    setSaving(true);
    await finance.setBenchmark(b);
    setSaving(false);
  }

  /** What a top-level category without its own range shows: its subcategories' sum. */
  const rolledUp = (id: string): RangeDraft | undefined => {
    const below = [...tree.subtree(id)].flatMap((k) => {
      const r = k === id ? null : parseRange(draft.categories[k] ?? { low: "", high: "" });
      return r && r !== "invalid" ? [r] : [];
    });
    if (!below.length) return undefined;
    const sum = (end: "lowCents" | "highCents") =>
      centsToInput(below.reduce((n, r) => n + r[end], 0), lang);
    return { low: sum("lowCents"), high: sum("highCents") };
  };

  const total = (field: "income" | "expense", label: string) => (
    <div className="grid gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <RangeInput
        label={label}
        value={draft[field]}
        disabled={!edit}
        onChange={(v) => setDraft({ ...draft, [field]: v })}
      />
    </div>
  );

  return (
    <SettingsCard
      title={t("finance.benchmark")}
      scope="family"
      description={t("finance.benchmark_help", { currency: finance.currency })}
    >
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-xs text-muted-foreground">{t("finance.benchmark_label")}</span>
          <Input
            maxLength={120}
            placeholder={t("finance.benchmark_label_placeholder")}
            value={draft.label}
            disabled={!edit}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {total("income", t("finance.benchmark_income"))}
          {total("expense", t("finance.benchmark_expense"))}
        </div>
        {tree.roots.length > 0 && (
          <details className="text-sm" open={!!saved?.categories.length}>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              {t("finance.benchmark_categories")}
            </summary>
            <div className="mt-2 grid gap-1.5">
              {tree.roots.map(({ category: c }) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {c.icon ? `${c.icon} ` : ""}
                    {c.name}
                    {c.kind === "income" && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {t("finance.income")}
                      </span>
                    )}
                  </span>
                  <RangeInput
                    label={c.name}
                    value={draft.categories[c.id] ?? { low: "", high: "" }}
                    placeholder={rolledUp(c.id)}
                    disabled={!edit}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        categories: { ...draft.categories, [c.id]: v },
                      })}
                  />
                </div>
              ))}
            </div>
          </details>
        )}
        {edit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={!dirty || invalid || saving}
              onClick={() => save(empty ? null : next)}
            >
              {t("finance.benchmark_save")}
            </Button>
            {saved && (
              <Button variant="outline" disabled={saving} onClick={() => save(null)}>
                <Trash2 /> {t("finance.benchmark_remove")}
              </Button>
            )}
            {invalid && <span className="text-xs text-gap">{t("finance.benchmark_invalid")}</span>}
          </div>
        )}
        {edit && <p className="text-xs text-muted-foreground">{t("finance.benchmark_ai_hint")}</p>}
      </div>
    </SettingsCard>
  );
}
