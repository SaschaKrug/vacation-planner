import { ChevronLeft, ChevronRight, Plus, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFinance, usePlanner } from "@/features/family/context";
import type { Transaction } from "@/lib/api";
import { getLang, t, useLang } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/layout/PageHeader";
import { ImportDialog } from "./ImportDialog";
import type { PeriodMode } from "./store";
import { SummaryView } from "./SummaryView";
import { TransactionDialog } from "./TransactionDialog";
import { TransactionsView } from "./TransactionsView";

export function FinancePage() {
  const planner = usePlanner();
  const finance = useFinance();
  useLang();
  const [editing, setEditing] = useState<Transaction | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState("transactions");
  const family = planner.family;
  const sees = family && family.access !== "calendar";

  useEffect(() => {
    if (sees) finance.open();
  }, [sees, finance]);

  useEffect(() => {
    if (sees && tab === "overview") finance.loadSummary();
  }, [sees, tab, finance]);

  if (family && !sees) {
    return (
      <>
        <PageHeader title={t("nav.finance")} />
        <p className="m-6 max-w-xl rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {t("finance.calendar_only")}
        </p>
      </>
    );
  }

  const edit = !planner.readOnly;
  const list = finance.list;

  return (
    <>
      <PageHeader title={t("nav.finance")}>
        <PeriodNav />
        <div className="flex-1" />
        {edit && (
          <>
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              <Upload /> <span className="max-md:sr-only">{t("finance.import")}</span>
            </Button>
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus /> <span className="max-md:sr-only">{t("finance.add")}</span>
            </Button>
          </>
        )}
      </PageHeader>
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="transactions">{t("finance.transactions")}</TabsTrigger>
            <TabsTrigger value="overview">{t("finance.overview")}</TabsTrigger>
          </TabsList>
          <TabsContent value="transactions" className="mt-4 space-y-4">
            {finance.accounts.length > 0 && <AccountCards />}
            {list && (
              <StatTiles
                income={list.incomeCents}
                expense={list.expenseCents}
                currency={finance.currency}
              />
            )}
            <TransactionsView onEdit={edit ? setEditing : undefined} />
          </TabsContent>
          <TabsContent value="overview" className="mt-4">
            <SummaryView />
          </TabsContent>
        </Tabs>
      </div>
      {editing && (
        <TransactionDialog
          transaction={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}

// Account cards and stat tiles share one grid and one tile shape, so the two rows line up.
const tileGrid = "grid grid-cols-3 gap-2 sm:gap-3";
const tileBox = "min-w-0 rounded-xl border bg-card p-2.5 text-left sm:px-4 sm:py-3";
const tileValue = "mt-0.5 truncate text-[13px] font-semibold tabular-nums sm:text-xl";

/** Income, expenses and the difference, as headline numbers. */
export function StatTiles(
  { income, expense, currency }: { income: number; expense: number; currency: string },
) {
  const lang = getLang();
  const net = income - expense;
  const tiles = [
    {
      label: t("finance.income"),
      dot: "bg-(--series-1)",
      value: formatMoney(income, currency, lang),
    },
    {
      label: t("finance.expenses"),
      dot: "bg-(--series-2)",
      value: formatMoney(expense, currency, lang),
    },
    {
      label: t("finance.net"),
      value: formatMoney(net, currency, lang, { sign: true }),
      negative: net < 0,
      hint: income > 0 ? t("finance.savings_rate", { n: Math.round((net / income) * 100) }) : "",
    },
  ];
  return (
    <div className={tileGrid}>
      {tiles.map((tile) => (
        <div key={tile.label} className={tileBox}>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {tile.dot && <span className={cn("size-2.5 shrink-0 rounded-sm", tile.dot)} />}
            <span className="truncate">{tile.label}</span>
            {tile.hint && <span className="ml-auto shrink-0 max-sm:hidden">{tile.hint}</span>}
          </div>
          <div className={cn(tileValue, tile.negative && "text-gap")}>{tile.value}</div>
          {tile.hint && (
            <div className="truncate text-xs text-muted-foreground sm:hidden">{tile.hint}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/** The accounts with their balances; picking one shows only its transactions. With several
 *  accounts a total comes first, and picking it shows them all again. */
function AccountCards() {
  const finance = useFinance();
  const lang = getLang();
  const active = finance.filter.account;
  const cards = finance.accounts.map((a) => ({
    id: a.id,
    label: `${a.icon ? `${a.icon} ` : ""}${a.name}`,
    color: a.color as string | undefined,
    cents: a.balanceCents,
  }));
  if (cards.length > 1) {
    cards.unshift({
      id: "",
      label: t("finance.all_accounts"),
      color: undefined,
      cents: cards.reduce((sum, c) => sum + c.cents, 0),
    });
  }
  return (
    <div className={tileGrid}>
      {cards.map((c) => (
        <button
          key={c.id || "all"}
          type="button"
          aria-pressed={active === c.id}
          title={t("finance.balance")}
          className={cn(
            tileBox,
            "transition-colors hover:bg-accent",
            c.id && active === c.id && "border-primary ring-1 ring-primary",
          )}
          onClick={() => finance.setFilter({ account: active === c.id ? "" : c.id })}
        >
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {c.color && (
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.color }}
              />
            )}
            <span className="truncate">{c.label}</span>
          </div>
          <div className={cn(tileValue, c.cents < 0 && "text-gap")}>
            {formatMoney(c.cents, finance.currency, lang)}
          </div>
        </button>
      ))}
    </div>
  );
}

function PeriodNav() {
  const finance = useFinance();
  const { mode, year } = finance.period;
  const lang = getLang();
  const monthLabel = (month: "long" | "short") =>
    new Intl.DateTimeFormat(lang, { month, year: "numeric" }).format(
      new Date(year, finance.period.month, 1),
    );
  const label = mode === "all" ? t("finance.all_time") : mode === "year" ? String(year) : (
    <>
      <span className="max-sm:hidden">{monthLabel("long")}</span>
      <span className="sm:hidden">{monthLabel("short")}</span>
    </>
  );
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select value={mode} onValueChange={(v) => finance.setPeriod({ mode: v as PeriodMode })}>
        <SelectTrigger className="h-8 w-auto gap-1.5" aria-label={t("finance.period")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="month">{t("finance.month")}</SelectItem>
          <SelectItem value="year">{t("finance.year")}</SelectItem>
          <SelectItem value="all">{t("finance.all_time")}</SelectItem>
        </SelectContent>
      </Select>
      {mode !== "all" && (
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("finance.previous")}
            onClick={() => finance.step(-1)}
          >
            <ChevronLeft />
          </Button>
          <span
            className={cn(
              "truncate text-center text-sm font-semibold tabular-nums",
              mode === "month" ? "min-w-16 sm:min-w-28" : "min-w-12",
            )}
          >
            {label}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("finance.next")}
            onClick={() => finance.step(1)}
          >
            <ChevronRight />
          </Button>
        </>
      )}
    </div>
  );
}
