import { FileUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useChat, useFinance } from "@/features/family/context";
import { api } from "@/lib/api";
import {
  type CsvMapping,
  DATE_FORMATS,
  decode,
  type Encoding,
  guessMapping,
  mapRows,
  tableOf,
} from "@/lib/csv";
import { getLang, t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";

const NONE = "-1";
const DELIMITERS: [string, string][] = [[";", ";"], [",", ","], ["\t", "Tab"], ["|", "|"]];

type Step =
  | { name: "file" }
  | { name: "map"; bytes: Uint8Array; fileName: string }
  | { name: "review"; bytes: Uint8Array; fileName: string; duplicates: number[] };

/** Imports a bank statement: pick the file, check how its columns map, then import the rows
 *  that aren't there yet. Mappings are remembered per bank (by the file's header); the new
 *  transactions can be sorted into categories afterwards (like similar ones, then by the AI). */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const finance = useFinance();
  const chat = useChat();
  const [step, setStep] = useState<Step>({ name: "file" });
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [remember, setRemember] = useState(true);
  const [categorize, setCategorize] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const aiReady = !!chat.settings?.configured;

  useEffect(() => {
    chat.loadSettings();
  }, [chat]);

  const bytes = step.name === "file" ? null : step.bytes;
  const text = useMemo(
    () => (bytes && mapping ? decode(bytes, mapping.encoding).text : ""),
    [bytes, mapping?.encoding],
  );
  const table = useMemo(() => (mapping ? tableOf(text, mapping) : null), [text, mapping]);
  const parsed = useMemo(() => (table && mapping ? mapRows(table.rows, mapping) : null), [
    table,
    mapping,
  ]);

  async function pick(file: File) {
    setError("");
    const data = new Uint8Array(await file.arrayBuffer());
    const { text, encoding } = decode(data);
    const guess = guessMapping(text, encoding);
    // The same bank as before: use its saved mapping.
    const saved = finance.mappings.find((m) => m.signature && m.signature === guess.signature);
    setMapping(saved ?? guess);
    setStep({ name: "map", bytes: data, fileName: file.name });
  }

  const rowsToSend = () =>
    parsed!.ok.map(({ date, amountCents, payee, description }) => ({
      date,
      amountCents,
      payee,
      description,
    }));

  async function check() {
    if (step.name !== "map" || !parsed?.ok.length) return;
    setBusy(true);
    try {
      const res = await api.importTransactions(finance.token, rowsToSend(), true);
      setStep({ ...step, name: "review", duplicates: res.duplicates });
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function run() {
    setBusy(true);
    try {
      const res = await finance.importRows(rowsToSend());
      // Runs on after the dialog closed; its toast reports.
      if (categorize && finance.categories.length) finance.categorizeIds(res.ids);
      if (remember && mapping?.signature) await finance.saveMapping(mapping);
      onClose();
    } catch (err) {
      setError(t("finance.import_failed", { msg: (err as Error).message }));
      setBusy(false);
    }
  }

  const set = (patch: Partial<CsvMapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("finance.import_title")}</DialogTitle>
          <DialogDescription>
            {step.name === "file" ? t("finance.import_help") : step.fileName}
          </DialogDescription>
        </DialogHeader>

        {step.name === "file" && (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-10 text-center text-sm text-muted-foreground hover:bg-accent">
            <FileUp className="size-8" />
            {t("finance.import_pick")}
            <input
              type="file"
              accept=".csv,.txt,text/csv"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) pick(file);
              }}
            />
          </label>
        )}

        {step.name === "map" && mapping && table && parsed && (
          <MappingForm
            mapping={mapping}
            header={table.header}
            width={table.rows[0]?.length ?? 0}
            set={set}
          />
        )}

        {step.name !== "file" && parsed && (
          <Preview
            rows={parsed.ok.slice(0, step.name === "map" ? 6 : 0)}
            currency={finance.currency}
          />
        )}

        {step.name === "map" && parsed && (
          <p className="text-sm text-muted-foreground">
            {t("finance.import_counts", { ok: parsed.ok.length, errors: parsed.errors.length })}
          </p>
        )}

        {step.name === "review" && parsed && (
          <div className="space-y-2 rounded-lg border bg-muted/50 p-4 text-sm">
            <p className="font-medium">
              {t("finance.import_new", { n: parsed.ok.length - step.duplicates.length })}
            </p>
            {step.duplicates.length > 0 && (
              <p className="text-muted-foreground">
                {t("finance.import_dupes", { n: step.duplicates.length })}
              </p>
            )}
            {parsed.errors.length > 0 && (
              <p className="text-muted-foreground">
                {t("finance.import_skipped", { n: parsed.errors.length })}
              </p>
            )}
            {mapping?.signature && (
              <label className="flex items-center gap-2 pt-1">
                <Checkbox
                  checked={remember}
                  onCheckedChange={(v) => setRemember(!!v)}
                />
                {t("finance.import_remember")}
              </label>
            )}
            {finance.categories.length > 0 && (
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={categorize}
                  onCheckedChange={(v) => setCategorize(!!v)}
                />
                {t(aiReady ? "finance.import_categorize" : "finance.import_categorize_similar")}
              </label>
            )}
          </div>
        )}

        {error && <p className="text-sm text-gap">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("note.cancel")}</Button>
          {step.name === "map" && (
            <Button disabled={busy || !parsed?.ok.length} onClick={check}>
              {t("finance.import_next")}
            </Button>
          )}
          {step.name === "review" && (
            <>
              <Button variant="outline" onClick={() => setStep({ ...step, name: "map" })}>
                {t("finance.import_back")}
              </Button>
              <Button disabled={busy || parsed!.ok.length === step.duplicates.length} onClick={run}>
                {t("finance.import_run", { n: parsed!.ok.length - step.duplicates.length })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MappingForm(
  { mapping, header, width, set }: {
    mapping: CsvMapping;
    header: string[];
    width: number;
    set: (patch: Partial<CsvMapping>) => void;
  },
) {
  const columns = Array.from(
    { length: Math.max(width, header.length) },
    (_, i) => header[i] || t("finance.column", { n: i + 1 }),
  );
  const split = mapping.amount === null;
  const column = (
    label: string,
    value: number | null,
    onChange: (v: number | null) => void,
    optional = false,
  ) => (
    <label className="grid gap-1 text-xs font-medium">
      {label}
      <Select
        value={String(value ?? NONE)}
        onValueChange={(v) => onChange(v === NONE ? null : Number(v))}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {optional && <SelectItem value={NONE}>—</SelectItem>}
          {columns.map((c, i) => <SelectItem key={i} value={String(i)}>{c}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="grid gap-1 text-xs font-medium">
          {t("finance.encoding")}
          <Select value={mapping.encoding} onValueChange={(v) => set({ encoding: v as Encoding })}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="utf-8">UTF-8</SelectItem>
              <SelectItem value="windows-1252">Windows-1252 / ISO-8859-1</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          {t("finance.delimiter")}
          <Select value={mapping.delimiter} onValueChange={(v) => set({ delimiter: v })}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DELIMITERS.map(([d, label]) => <SelectItem key={label} value={d}>{label}
              </SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          {t("finance.skip_rows")}
          <Input
            type="number"
            min={0}
            max={50}
            className="h-8"
            value={mapping.skipRows}
            onChange={(e) =>
              set({ skipRows: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })}
          />
        </label>
        <label className="flex items-end gap-2 pb-1.5 text-xs font-medium">
          <Switch checked={mapping.hasHeader} onCheckedChange={(v) => set({ hasHeader: v })} />
          {t("finance.has_header")}
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {column(t("finance.date"), mapping.date, (v) => set({ date: v ?? 0 }))}
        <label className="grid gap-1 text-xs font-medium">
          {t("finance.date_format")}
          <Select
            value={mapping.dateFormat}
            onValueChange={(v) => set({ dateFormat: v as CsvMapping["dateFormat"] })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          {t("finance.amounts")}
          <Select
            value={split ? "split" : "single"}
            onValueChange={(v) =>
              set(
                v === "split"
                  ? { amount: null, debit: mapping.debit ?? 0, credit: mapping.credit ?? 0 }
                  : { amount: mapping.amount ?? mapping.debit ?? 0, debit: null, credit: null },
              )}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single">{t("finance.amount_single")}</SelectItem>
              <SelectItem value="split">{t("finance.amount_split")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          {t("finance.decimal")}
          <Select value={mapping.decimal} onValueChange={(v) => set({ decimal: v as "," | "." })}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=",">1.234,56</SelectItem>
              <SelectItem value=".">1,234.56</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {split
          ? (
            <>
              {column(t("finance.debit"), mapping.debit, (v) => set({ debit: v }))}
              {column(t("finance.credit"), mapping.credit, (v) => set({ credit: v }))}
            </>
          )
          : column(t("finance.amount"), mapping.amount, (v) => set({ amount: v ?? 0 }))}
        {column(t("finance.payee"), mapping.payee, (v) => set({ payee: v }), true)}
        {column(
          t("finance.description"),
          mapping.description[0] ?? null,
          (v) => set({ description: v === null ? [] : [v] }),
          true,
        )}
      </div>
    </div>
  );
}

function Preview(
  { rows, currency }: {
    rows: { date: string; amountCents: number; payee: string; description: string }[];
    currency: string;
  },
) {
  if (!rows.length) return null;
  const lang = getLang();
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">{t("finance.date")}</th>
            <th className="px-3 py-2 font-medium">{t("finance.payee")}</th>
            <th className="px-3 py-2 font-medium">{t("finance.description")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("finance.amount")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{r.date}</td>
              <td className="max-w-40 truncate px-3 py-1.5">{r.payee}</td>
              <td className="max-w-64 truncate px-3 py-1.5 text-muted-foreground">
                {r.description}
              </td>
              <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                {formatMoney(r.amountCents, currency, lang, { sign: r.amountCents > 0 })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
