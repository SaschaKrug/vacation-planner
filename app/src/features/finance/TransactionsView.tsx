import { Download, Pencil, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import type { Category, Transaction } from "@/lib/api";
import { getLang, t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export function CategoryLabel({ category }: { category?: Category }) {
  if (!category) return <span className="text-muted-foreground">{t("finance.uncategorized")}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: category.color }}
      />
      <span className="truncate">{category.icon ? `${category.icon} ` : ""}{category.name}</span>
    </span>
  );
}

/** The filtered transactions of the period, newest first; categories can be set inline. */
export function TransactionsView({ onEdit }: { onEdit?: (t: Transaction) => void }) {
  const finance = useFinance();
  const planner = usePlanner();
  const [q, setQ] = useState(finance.filter.q);
  const lang = getLang();
  const list = finance.list;

  // Search as you type, a moment after the last key.
  useEffect(() => {
    if (q === finance.filter.q) return;
    const timer = setTimeout(() => finance.setFilter({ q }), 250);
    return () => clearTimeout(timer);
  }, [q, finance]);

  const remove = (tx: Transaction) =>
    finance.change([{ action: "delete", id: tx.id }], t("finance.deleted"));

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-40 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t("finance.search")}
            aria-label={t("finance.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          value={finance.filter.category || "all"}
          onValueChange={(v) => finance.setFilter({ category: v === "all" ? "" : v })}
        >
          <SelectTrigger className="w-44" aria-label={t("finance.category")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-80">
            <SelectItem value="all">{t("finance.all_categories")}</SelectItem>
            <SelectItem value="none">{t("finance.uncategorized")}</SelectItem>
            {finance.categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={finance.filter.kind || "all"}
          onValueChange={(v) =>
            finance.setFilter({ kind: v === "all" ? "" : v as "income" | "expense" })}
        >
          <SelectTrigger className="w-36" aria-label={t("finance.kind")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-80">
            <SelectItem value="all">{t("finance.all_kinds")}</SelectItem>
            <SelectItem value="income">{t("finance.income")}</SelectItem>
            <SelectItem value="expense">{t("finance.expenses")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {finance.error && <p className="p-4 text-sm text-gap">{finance.error}</p>}
      {list && list.transactions.length === 0 && (
        <p className="p-8 text-center text-sm text-muted-foreground">
          {t(planner.readOnly ? "finance.empty_readonly" : "finance.empty")}
        </p>
      )}
      <ul
        className={cn("divide-y", finance.loadingList && "opacity-60")}
        aria-busy={finance.loadingList}
      >
        {list?.transactions.map((tx) => (
          <li
            key={tx.id}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[6.5rem_1fr_12rem_8rem_auto]"
            // a stripe in the category's color down the row's left edge
            style={{
              boxShadow: `inset 3px 0 0 ${
                finance.categoryById(tx.categoryId)?.color ?? "transparent"
              }`,
            }}
          >
            <time
              className="text-xs text-muted-foreground tabular-nums sm:text-sm"
              dateTime={tx.date}
            >
              {new Intl.DateTimeFormat(lang, { day: "2-digit", month: "short", year: "numeric" })
                .format(
                  new Date(tx.date + "T00:00:00"),
                )}
            </time>
            <div className="col-start-1 col-end-3 row-start-2 min-w-0 sm:col-auto sm:row-auto">
              <div className="truncate font-medium">{tx.payee || tx.description || "—"}</div>
              {tx.payee && tx.description && (
                <div className="truncate text-xs text-muted-foreground">{tx.description}</div>
              )}
            </div>
            <div className="col-start-1 col-end-3 row-start-3 min-w-0 text-sm sm:col-auto sm:row-auto">
              {onEdit
                ? (
                  <Select
                    value={tx.categoryId ?? "none"}
                    onValueChange={(v) =>
                      finance.change(
                        [{ action: "update", id: tx.id, categoryId: v === "none" ? null : v }],
                        t("finance.saved"),
                      )}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-8 w-full border-transparent shadow-none hover:border-input"
                      aria-label={t("finance.category")}
                    >
                      <CategoryLabel category={finance.categoryById(tx.categoryId)} />
                    </SelectTrigger>
                    <SelectContent position="popper" className="max-h-80">
                      <SelectItem value="none">{t("finance.uncategorized")}</SelectItem>
                      {finance.categories
                        .filter((c) =>
                          c.kind === "both" || (c.kind === "income") === tx.amountCents > 0
                        )
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )
                : <CategoryLabel category={finance.categoryById(tx.categoryId)} />}
            </div>
            <div
              className={cn(
                "col-start-3 row-start-1 text-right font-semibold whitespace-nowrap tabular-nums sm:col-auto sm:row-auto",
                tx.amountCents > 0 && "text-ok",
                tx.amountCents < 0 && "text-gap",
              )}
            >
              {formatMoney(tx.amountCents, finance.currency, lang, { sign: tx.amountCents > 0 })}
            </div>
            <div className="col-start-3 row-span-2 row-start-2 flex justify-end gap-0.5 sm:col-auto sm:row-auto">
              {tx.imported && (
                <span className="self-center" title={t("finance.imported_row")}>
                  <Download
                    className="size-3.5 text-muted-foreground"
                    aria-label={t("finance.imported_row")}
                  />
                </span>
              )}
              {onEdit && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    title={t("finance.edit")}
                    onClick={() => onEdit(tx)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    title={t("finance.delete")}
                    onClick={() => remove(tx)}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {list && list.total > list.transactions.length && (
        <div className="border-t p-3 text-center">
          <Button variant="outline" size="sm" onClick={() => finance.showMore()}>
            {t("finance.show_more", { n: list.total - list.transactions.length })}
          </Button>
        </div>
      )}
    </div>
  );
}
