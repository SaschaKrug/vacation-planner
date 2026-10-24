import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useFinance } from "@/features/family/context";
import { today } from "@/features/vacation/store";
import type { Transaction } from "@/lib/api";
import { getLang, t } from "@/lib/i18n";
import { centsToInput, parseMoney } from "@/lib/money";

/** Adds a transaction, or edits one. */
export function TransactionDialog(
  { transaction, onClose }: {
    transaction: Transaction | null;
    onClose: () => void;
  },
) {
  const finance = useFinance();
  const lang = getLang();
  const [kind, setKind] = useState<"expense" | "income">(
    transaction && transaction.amountCents > 0 ? "income" : "expense",
  );
  const [date, setDate] = useState(transaction?.date ?? today);
  const [amount, setAmount] = useState(
    transaction ? centsToInput(transaction.amountCents, lang) : "",
  );
  const [payee, setPayee] = useState(transaction?.payee ?? "");
  const [description, setDescription] = useState(
    transaction?.description ?? "",
  );
  const [category, setCategory] = useState(transaction?.categoryId ?? "none");
  // A new one goes to the account the list shows, else the first one.
  const [account, setAccount] = useState(() => {
    if (transaction) return transaction.accountId ?? "none";
    const shown = finance.filter.account;
    return shown || finance.accounts[0]?.id || "none";
  });
  const [note, setNote] = useState(transaction?.note ?? "");
  const [error, setError] = useState("");

  const categories = finance.categories.filter((c) => c.kind === "both" || c.kind === kind);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null || cents === 0) {
      return setError(t("finance.amount_invalid"));
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return setError(t("finance.date_invalid"));
    }
    const fields = {
      date,
      amountCents: kind === "expense" ? -Math.abs(cents) : Math.abs(cents),
      payee,
      description,
      categoryId: category === "none" ? null : category,
      accountId: account === "none" ? null : account,
      note,
    };
    const ok = await finance.change(
      [
        transaction
          ? { action: "update", id: transaction.id, ...fields }
          : { action: "add", ...fields },
      ],
      t(transaction ? "finance.saved" : "finance.added"),
    );
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-4" onSubmit={save}>
          <DialogHeader>
            <DialogTitle>
              {t(transaction ? "finance.edit_title" : "finance.add_title")}
            </DialogTitle>
          </DialogHeader>
          <Tabs
            value={kind}
            onValueChange={(v) => setKind(v as "expense" | "income")}
          >
            <TabsList className="w-full">
              <TabsTrigger value="expense">{t("finance.expense")}</TabsTrigger>
              <TabsTrigger value="income">{t("finance.income")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              {t("finance.amount")} ({finance.currency})
              <Input
                autoFocus
                inputMode="decimal"
                value={amount}
                placeholder={lang === "de" ? "0,00" : "0.00"}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t("finance.date")}
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          <label className="grid gap-1.5 text-sm font-medium">
            {t(kind === "income" ? "finance.payer" : "finance.payee")}
            <Input
              maxLength={200}
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {t("finance.description")}
            <Input
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {(finance.accounts.length > 0 || account !== "none") && (
            <label className="grid gap-1.5 text-sm font-medium">
              {t("finance.account")}
              <Select value={account} onValueChange={setAccount}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-80">
                  <SelectItem value="none">{t("finance.no_account")}</SelectItem>
                  {finance.accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.icon} {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          <label className="grid gap-1.5 text-sm font-medium">
            {t("finance.category")}
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-80">
                <SelectItem value="none">
                  {t("finance.uncategorized")}
                </SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {t("finance.note")}
            <Textarea
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-gap">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("note.cancel")}
            </Button>
            <Button type="submit">{t("note.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
