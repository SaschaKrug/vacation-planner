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

/** Income, expenses and the difference, as headline numbers. */
export function StatTiles(
  { income, expense, currency }: { income: number; expense: number; currency: string },
) {
  const lang = getLang();
  const net = income - expense;
  const tiles = [
    { label: t("finance.income"), value: formatMoney(income, currency, lang) },
    { label: t("finance.expenses"), value: formatMoney(expense, currency, lang) },
    {
      label: t("finance.net"),
      value: formatMoney(net, currency, lang, { sign: true }),
      hint: income > 0 ? t("finance.savings_rate", { n: Math.round((net / income) * 100) }) : "",
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-xl border bg-card px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="text-xs text-muted-foreground">{tile.label}</div>
          <div className="mt-0.5 truncate text-sm font-semibold tabular-nums sm:text-xl">
            {tile.value}
          </div>
          {tile.hint && <div className="text-xs text-muted-foreground">{tile.hint}</div>}
        </div>
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
