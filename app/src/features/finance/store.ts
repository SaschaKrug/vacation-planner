// The open family's finances: accounts, categories and settings, the transactions of the chosen
// period (filtered), and the summary. Changes go straight to the API; each one can be undone from
// its toast with the inverse ops the API returns. Account balances come with the overview, so it
// reloads after every change that can move money.

import { toast } from "sonner";
import {
  type Account,
  api,
  type CategorizeResult,
  type Category,
  type FinanceOverview,
  type FinanceSummary,
  type TransactionList,
  type TransactionOp,
  type TransferPair,
} from "@/lib/api";
import type { CsvMapping } from "@/lib/csv";
import { getLang, t } from "@/lib/i18n";

export type PeriodMode = "month" | "year" | "all";
export interface Period {
  mode: PeriodMode;
  year: number;
  month: number; // 0-11
}
export interface Filter {
  q: string;
  category: string; // "" = all, "none" = uncategorized, else a category id
  account: string; // "" = all, "none" = without an account, else an account id
  kind: "" | "income" | "expense" | "transfer";
}

const PAGE = 200;
const CATEGORIZE_BATCH = 200; // the most the API sorts in one call
const MAX_OPS = 2000; // the most ops POST /finance/transactions takes

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function lastDay(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export class FinanceStore {
  overview: FinanceOverview | null = null;
  list: TransactionList | null = null;
  summary: FinanceSummary | null = null;
  loadingList = false;
  error: string | null = null;
  period: Period;
  filter: Filter = { q: "", category: "", account: "", kind: "" };
  limit = PAGE;
  /** Transactions ticked in the list, to combine them into a transfer. */
  selected = new Set<string>();
  rev = 0;
  /** How far the AI is with sorting transactions into categories (null when idle). */
  categorizing: { done: number; total: number } | null = null;
  private categorizeQueue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private opened = false;
  private listSeq = 0;
  private summarySeq = 0;

  constructor(readonly token: string) {
    const now = new Date();
    this.period = { mode: "month", year: now.getFullYear(), month: now.getMonth() };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRev = () => this.rev;

  private emit() {
    this.rev++;
    for (const fn of this.listeners) fn();
  }

  get currency() {
    return this.overview?.currency ?? "EUR";
  }

  get categories(): Category[] {
    return this.overview?.categories ?? [];
  }

  categoryById(id: string | null) {
    return id ? this.categories.find((c) => c.id === id) : undefined;
  }

  get accounts(): Account[] {
    return this.overview?.accounts ?? [];
  }

  accountById(id: string | null) {
    return id ? this.accounts.find((a) => a.id === id) : undefined;
  }

  /** Loads the categories and the first page once; later calls do nothing. */
  open() {
    if (this.opened) return;
    this.opened = true;
    this.loadOverview();
    this.loadList();
  }

  async loadOverview() {
    try {
      this.overview = await api.finance(this.token);
      this.error = null;
    } catch (err) {
      this.error = (err as Error).message;
    }
    this.emit();
  }

  /** The period as a date range (none for "all"). */
  range(period = this.period): { from?: string; to?: string } {
    const { mode, year, month } = period;
    if (mode === "all") return {};
    if (mode === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
    return {
      from: `${year}-${pad(month + 1)}-01`,
      to: `${year}-${pad(month + 1)}-${lastDay(year, month)}`,
    };
  }

  /** The summary covers the year of a month (a chart of one month says little). */
  summaryRange() {
    return this.range(
      this.period.mode === "month" ? { ...this.period, mode: "year" } : this.period,
    );
  }

  async loadList() {
    const seq = ++this.listSeq;
    this.loadingList = true;
    this.emit();
    const { from, to } = this.range();
    const query: Record<string, string> = { limit: String(this.limit) };
    if (from) query.from = from;
    if (to) query.to = to;
    if (this.filter.q.trim()) query.q = this.filter.q.trim();
    if (this.filter.category) query.category = this.filter.category;
    if (this.filter.account) query.account = this.filter.account;
    if (this.filter.kind) query.kind = this.filter.kind;
    try {
      const list = await api.transactions(this.token, query);
      if (seq !== this.listSeq) return; // a newer request is on its way
      this.list = list;
      this.error = null;
      // Keep only what is still shown ticked (e.g. not a row that was just deleted).
      const ids = new Set(list.transactions.map((tx) => tx.id));
      this.selected = new Set([...this.selected].filter((id) => ids.has(id)));
    } catch (err) {
      if (seq !== this.listSeq) return;
      this.error = (err as Error).message;
    }
    this.loadingList = false;
    this.emit();
  }

  async loadSummary() {
    const seq = ++this.summarySeq;
    const { from, to } = this.summaryRange();
    const query: Record<string, string> = {};
    if (from) query.from = from;
    if (to) query.to = to;
    try {
      const summary = await api.financeSummary(this.token, query);
      if (seq === this.summarySeq) this.summary = summary;
    } catch (err) {
      this.error = (err as Error).message;
    }
    this.emit();
  }

  private reload() {
    if (!this.opened) return; // nothing shown yet: it loads when the page opens
    this.loadList();
    if (this.summary) this.loadSummary();
  }

  /** After transactions changed: what is shown and the account balances. */
  private changed() {
    if (!this.opened) return;
    this.reload();
    this.loadOverview();
  }

  /** Reloads what is shown, e.g. after the assistant changed transactions. */
  refresh() {
    this.changed();
  }

  setPeriod(period: Partial<Period>) {
    this.period = { ...this.period, ...period };
    this.limit = PAGE;
    this.selected = new Set();
    this.reload();
  }

  /** The previous / next month or year. */
  step(dir: -1 | 1) {
    const { mode, year, month } = this.period;
    if (mode === "year") this.setPeriod({ year: year + dir });
    else if (mode === "month") {
      const m = month + dir;
      this.setPeriod({ year: year + Math.floor(m / 12), month: (m + 12) % 12 });
    }
  }

  setFilter(filter: Partial<Filter>) {
    this.filter = { ...this.filter, ...filter };
    this.limit = PAGE;
    this.selected = new Set();
    this.loadList();
  }

  toggleSelected(id: string, on: boolean) {
    const next = new Set(this.selected);
    if (on) next.add(id);
    else next.delete(id);
    this.selected = next;
    this.emit();
  }

  clearSelection() {
    if (!this.selected.size) return;
    this.selected = new Set();
    this.emit();
  }

  showMore() {
    this.limit += PAGE;
    this.loadList();
  }

  /** Applies transaction ops; the toast offers to undo them. Resolves to the new ids. */
  async change(ops: TransactionOp[], message: string): Promise<string[] | null> {
    try {
      const res = await api.changeTransactions(this.token, ops);
      this.changed();
      toast(message, {
        action: {
          label: t("finance.undo"),
          onClick: () => this.undo(res.inverse),
        },
      });
      return res.added;
    } catch (err) {
      toast(t("finance.save_failed", { msg: (err as Error).message }));
      return null;
    }
  }

  private async undo(inverse: TransactionOp[]) {
    try {
      for (let i = 0; i < inverse.length; i += MAX_OPS) {
        await api.changeTransactions(this.token, inverse.slice(i, i + MAX_OPS));
      }
      this.changed();
      toast(t("finance.undone"));
    } catch (err) {
      toast(t("finance.save_failed", { msg: (err as Error).message }));
    }
  }

  // ------------------------------------------------------------- transfers

  /** Combines transactions into one transfer: they count once, as their sum. */
  async link(ids: string[]) {
    const ok = await this.change([{ action: "link", ids }], t("finance.linked"));
    if (ok) this.clearSelection();
    return ok;
  }

  /** Combines each pair into a transfer of its own, in one undoable step. */
  linkPairs(pairs: string[][]) {
    return this.change(
      pairs.map((ids) => ({ action: "link", ids })),
      t("finance.linked_pairs", { n: pairs.length }),
    );
  }

  /** Splits the transfer a transaction belongs to back into normal transactions. */
  unlink(id: string) {
    return this.change([{ action: "unlink", id }], t("finance.unlinked"));
  }

  /** Combines every likely transfer of the period at once; the toast can undo it. */
  async autoCombineTransfers() {
    try {
      const res = await api.autoTransfers(this.token, this.range());
      if (!res.linked) {
        toast(t("finance.no_transfers_found"));
        return res;
      }
      this.changed();
      toast(t("finance.linked_pairs", { n: res.linked }), {
        action: {
          label: t("finance.undo"),
          onClick: () => this.undo(res.inverse),
        },
      });
      return res;
    } catch (err) {
      toast(t("finance.save_failed", { msg: (err as Error).message }));
      return null;
    }
  }

  /** Transactions of the period that look like transfers between two accounts. */
  async suggestions(): Promise<TransferPair[]> {
    const { from, to } = this.range();
    const query: Record<string, string> = {};
    if (from) query.from = from;
    if (to) query.to = to;
    return (await api.transferSuggestions(this.token, query)).pairs;
  }

  async importRows(
    rows: Parameters<typeof api.importTransactions>[1],
    accountId?: string,
    autoTransfers = false,
  ) {
    const res = await api.importTransactions(this.token, rows, false, accountId, autoTransfers);
    this.changed();
    if (res.ids.length) {
      const imported = t("finance.imported", { n: res.added, skipped: res.duplicates.length });
      const linked = res.transfers ? t("finance.imported_transfers", { n: res.transfers }) : "";
      toast(imported + linked, {
        action: {
          label: t("finance.undo"),
          onClick: () => this.undo([{ action: "delete", ids: res.ids }]),
        },
      });
    } else toast(t("finance.imported_none", { skipped: res.duplicates.length }));
    return res;
  }

  /** Sorts the period's uncategorized transactions into categories (like similar ones, the
   *  rest with the AI), in batches; the toast offers to undo it. Does nothing while a run is
   *  going on. */
  autoCategorize() {
    if (this.categorizing) return Promise.resolve();
    const { from, to } = this.range();
    return this.categorize(async (call) => {
      let skip = 0; // the ones earlier batches left uncategorized
      let done = 0;
      let total = 0;
      for (;;) {
        const res = await call({ from, to, skip });
        done += res.considered;
        total ||= res.considered + res.remaining;
        this.progress(done, total);
        if (!res.considered || !res.remaining) return;
        skip += res.considered - res.changed;
      }
    });
  }

  /** Sorts the given transactions (e.g. just imported) into categories. Waits for a run that
   *  is going on. */
  categorizeIds(ids: string[]) {
    if (!ids.length) return Promise.resolve();
    return this.categorize(async (call) => {
      this.progress(0, ids.length);
      for (let i = 0; i < ids.length; i += CATEGORIZE_BATCH) {
        await call({ ids: ids.slice(i, i + CATEGORIZE_BATCH) });
        this.progress(Math.min(i + CATEGORIZE_BATCH, ids.length), ids.length);
      }
    });
  }

  private progress(done: number, total: number) {
    this.categorizing = { done, total };
    this.emit();
  }

  /** Runs one categorize job after the ones before it; `run` makes the calls. Reports with a
   *  toast whose undo reverts all of the job's calls. */
  private categorize(
    run: (
      call: (body: Parameters<typeof api.categorize>[1]) => Promise<CategorizeResult>,
    ) => Promise<void>,
  ) {
    const job = async () => {
      this.progress(0, 0);
      const inverses: TransactionOp[][] = [];
      let changed = 0;
      let matched = 0;
      let error = "";
      try {
        await run(async (body) => {
          const res = await api.categorize(this.token, { ...body, lang: getLang() });
          inverses.push(res.inverse);
          changed += res.changed;
          matched += res.matched;
          return res;
        });
      } catch (err) {
        error = (err as Error).message;
      }
      this.categorizing = null;
      if (changed) {
        this.reload();
        // The last call's inverse first.
        const inverse = inverses.reverse().flat();
        toast(t("finance.categorized", { n: changed, matched }), {
          action: { label: t("finance.undo"), onClick: () => this.undo(inverse) },
        });
      } else this.emit();
      if (error) toast(t("finance.categorize_failed", { msg: error }));
      else if (!changed) toast(t("finance.categorized_none"));
    };
    this.categorizeQueue = this.categorizeQueue.then(job);
    return this.categorizeQueue;
  }

  // ------------------------------------------------------------- categories + settings

  private async withOverview<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      const out = await fn();
      await this.loadOverview();
      return out;
    } catch (err) {
      toast(t("finance.save_failed", { msg: (err as Error).message }));
      await this.loadOverview();
      return null;
    }
  }

  addCategory(c: Omit<Category, "id" | "position">) {
    return this.withOverview(() => api.addCategory(this.token, c));
  }

  updateCategory(id: string, patch: Partial<Category>) {
    // Show it right away; the reload corrects it if saving fails.
    if (this.overview) {
      this.overview = {
        ...this.overview,
        categories: this.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      };
      this.emit();
    }
    return this.withOverview(() => api.updateCategory(this.token, id, patch));
  }

  moveCategory(i: number, dir: -1 | 1) {
    const list = [...this.categories];
    const j = i + dir;
    [list[i], list[j]] = [list[j], list[i]];
    if (this.overview) this.overview = { ...this.overview, categories: list };
    this.emit();
    return this.withOverview(() =>
      Promise.all([
        api.updateCategory(this.token, list[i].id, { position: i }),
        api.updateCategory(this.token, list[j].id, { position: j }),
      ])
    );
  }

  async deleteCategory(id: string) {
    await this.withOverview(() => api.deleteCategory(this.token, id));
    this.reload();
  }

  // ------------------------------------------------------------- accounts

  addAccount(a: Parameters<typeof api.addAccount>[1]) {
    return this.withOverview(() => api.addAccount(this.token, a));
  }

  updateAccount(id: string, patch: Parameters<typeof api.updateAccount>[2]) {
    // Show it right away; the reload corrects it (and the balance) if saving fails.
    if (this.overview) {
      this.overview = {
        ...this.overview,
        accounts: this.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      };
      this.emit();
    }
    return this.withOverview(() => api.updateAccount(this.token, id, patch));
  }

  moveAccount(i: number, dir: -1 | 1) {
    const list = [...this.accounts];
    const j = i + dir;
    [list[i], list[j]] = [list[j], list[i]];
    if (this.overview) this.overview = { ...this.overview, accounts: list };
    this.emit();
    return this.withOverview(() =>
      Promise.all([
        api.updateAccount(this.token, list[i].id, { position: i }),
        api.updateAccount(this.token, list[j].id, { position: j }),
      ])
    );
  }

  async deleteAccount(id: string) {
    await this.withOverview(() => api.deleteAccount(this.token, id));
    if (this.filter.account === id) this.setFilter({ account: "" });
    else this.reload();
  }

  addDefaultCategories() {
    return this.withOverview(() => api.defaultCategories(this.token, getLang()));
  }

  async setCurrency(currency: string) {
    await this.withOverview(() => api.financeSettings(this.token, { currency }));
    this.reload();
  }

  /** Deletes all transactions, categories and settings; there is no undo. */
  async clearAll() {
    const out = await this.withOverview(() => api.clearFinance(this.token));
    this.reload();
    if (out) toast(t("finance.cleared"));
  }

  get mappings(): CsvMapping[] {
    return (this.overview?.csvMappings ?? []) as CsvMapping[];
  }

  /** Remembers how a bank's files map (by their header), newest first. */
  saveMapping(mapping: CsvMapping) {
    if (!mapping.signature) return;
    const rest = this.mappings.filter((m) => m.signature !== mapping.signature);
    return this.withOverview(() =>
      api.financeSettings(this.token, { csvMappings: [mapping, ...rest].slice(0, 20) })
    );
  }

  deleteMapping(signature: string) {
    const rest = this.mappings.filter((m) => m.signature !== signature);
    return this.withOverview(() => api.financeSettings(this.token, { csvMappings: rest }));
  }
}
