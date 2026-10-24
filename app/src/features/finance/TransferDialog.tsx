import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFinance } from "@/features/family/context";
import type { Transaction, TransferPair } from "@/lib/api";
import { getLang, t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";

/** Finds bookings of the period that look like money moved between two of the family's
 *  accounts, and combines the ticked pairs into transfers in one undoable step. */
export function TransferDialog({ onClose }: { onClose: () => void }) {
  const finance = useFinance();
  const lang = getLang();
  const [pairs, setPairs] = useState<TransferPair[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    finance.suggestions().then(
      (found) => {
        if (!live) return;
        setPairs(found);
        setChecked(new Set(found.map((_, i) => i)));
      },
      (err) => live && setError((err as Error).message),
    );
    return () => {
      live = false;
    };
  }, [finance]);

  const day = (tx: Transaction) =>
    new Intl.DateTimeFormat(lang, { day: "2-digit", month: "short" }).format(
      new Date(tx.date + "T00:00:00"),
    );
  const accountName = (tx: Transaction) =>
    finance.accountById(tx.accountId)?.name ?? t("finance.no_account");

  function toggle(i: number, on: boolean) {
    const next = new Set(checked);
    if (on) next.add(i);
    else next.delete(i);
    setChecked(next);
  }

  async function run() {
    if (!pairs) return;
    setBusy(true);
    const ok = await finance.linkPairs(
      pairs.filter((_, i) => checked.has(i)).map((p) => [p.out.id, p.in.id]),
    );
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("finance.find_transfers")}</DialogTitle>
          <DialogDescription>{t("finance.find_transfers_help")}</DialogDescription>
        </DialogHeader>

        {!pairs && !error && <div className="h-32 animate-pulse rounded-lg bg-muted" />}
        {pairs?.length === 0 && (
          <p className="rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground">
            {t("finance.no_suggestions")}
          </p>
        )}
        {pairs && pairs.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {pairs.map((p, i) => (
              <li key={`${p.out.id}-${p.in.id}`}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                  <Checkbox checked={checked.has(i)} onCheckedChange={(v) => toggle(i, !!v)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {p.out.payee || p.out.description || p.in.payee || p.in.description || "—"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.out.date === p.in.date ? day(p.out) : `${day(p.out)} – ${day(p.in)}`}
                      {" · "}
                      {accountName(p.out)} → {accountName(p.in)}
                    </div>
                  </div>
                  <div className="font-semibold whitespace-nowrap tabular-nums">
                    {formatMoney(p.in.amountCents, finance.currency, lang)}
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-gap">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("note.cancel")}</Button>
          {pairs && pairs.length > 0 && (
            <Button disabled={busy || !checked.size} onClick={run}>
              {t("finance.combine_n", { n: checked.size })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
