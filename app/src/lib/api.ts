// Thin client for the Family Planner API (Supabase Edge Function "api").

import type { EntryOp, EntryType, NoteOp, Role } from "./core";

declare global {
  interface Window {
    FP_CONFIG?: { apiBase?: string };
  }
}

export type Access = "edit" | "view" | "calendar";

export interface Family {
  id?: string;
  readId?: string;
  feedId: string;
  legacyId?: string;
  name: string;
  access: Access;
  readOnly: boolean;
  updatedAt: string;
}

export interface FamilyState {
  family: Family;
  types: EntryType[];
  typeYears?: number[];
  entries: Record<string, string[]>;
  notes?: Record<string, { icon: string; comment: string }>;
}

export type CategoryKind = "income" | "expense" | "both";

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  kind: CategoryKind;
  position: number;
}

/** A bank account (Konto); its balance is the opening balance plus all its transactions. */
export interface Account {
  id: string;
  name: string;
  color: string;
  icon: string;
  openingCents: number;
  position: number;
  balanceCents: number;
}

export interface Transaction {
  id: string;
  date: string;
  amountCents: number;
  payee: string;
  description: string;
  categoryId: string | null;
  accountId: string | null;
  /** Set on the legs of a transfer (≥ 2 transactions that count once, as their sum). */
  transferId: string | null;
  note: string;
  imported: boolean;
}

/** Two transactions that look like money moved between two of the family's accounts. */
export interface TransferPair {
  out: Transaction;
  in: Transaction;
}

export interface FinanceOverview {
  currency: string;
  csvMappings: unknown[];
  categories: Category[];
  accounts: Account[];
}

export interface TransactionList {
  transactions: Transaction[];
  total: number;
  incomeCents: number;
  expenseCents: number;
}

export interface FinanceSummary {
  currency: string;
  incomeCents: number;
  expenseCents: number;
  count: number;
  months: { month: string; incomeCents: number; expenseCents: number }[];
  categories: {
    categoryId: string | null;
    incomeCents: number;
    expenseCents: number;
    count: number;
  }[];
}

/** An op for POST /finance/transactions; the response's `inverse` ops undo a request. */
export type TransactionOp = Record<string, unknown> & {
  action: "add" | "update" | "delete" | "link" | "unlink";
};

export interface TransactionResult {
  ok: true;
  changed: number;
  added: string[];
  inverse: TransactionOp[];
}

/** What one POST /ai/categorize call did; `inverse` undoes it. */
export interface CategorizeResult {
  changed: number; // how many got a category
  matched: number; // of these, how many like similar earlier ones (no AI)
  considered: number; // how many the model looked at (at most 200)
  remaining: number; // uncategorized ones after these, not looked at yet
  ai: boolean; // whether the AI is set up (without, only similar ones are matched)
  inverse: TransactionOp[];
  assignments: { id: string; categoryId: string; source: "similar" | "ai" }[];
}

export interface AiSettings {
  configured: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyHint: string;
  searchProvider: "none" | "tavily" | "brave";
  hasSearchKey: boolean;
  searchKeyHint: string;
  allowWrites: boolean;
  serverReady: boolean;
}

export interface AiSettingsPatch {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  searchProvider?: AiSettings["searchProvider"];
  searchKey?: string;
  allowWrites?: boolean;
}

/** A part of a user message: text, or an image as a data URL. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** A message in the OpenAI format, as the chat endpoint takes and returns them. */
export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string | null | ContentPart[];
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** A request against /families/{id} that undoes (part of) a change the assistant made. */
export interface UndoStep {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}

export type ChatEvent =
  | { event: "text"; data: { delta: string } }
  | { event: "tool"; data: { id: string; name: string; args: Record<string, unknown> } }
  | { event: "tool_result"; data: { id: string; name: string; ok: boolean; summary: string } }
  | {
    event: "change";
    data: {
      id: string;
      kind: "entries" | "notes" | "types" | "transactions";
      summary: string;
      undo: UndoStep[];
    };
  }
  | { event: "messages"; data: { messages: ChatMessage[] } }
  | { event: "done"; data: Record<string, never> }
  | { event: "error"; data: { message: string } };

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

const base = (window.FP_CONFIG?.apiBase ?? "/api").replace(/\/+$/, "");

export function apiBase(): string {
  return new URL(base, location.href).href.replace(/\/+$/, "");
}

export function isConfigured(): boolean {
  return !!window.FP_CONFIG?.apiBase;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError((err as Error).message); // offline: no status
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

const enc = encodeURIComponent;
const fam = (token: string) => `/families/${enc(token)}`;

export const api = {
  createFamily: (body: { name?: string; lang?: string; year?: number } = {}) =>
    request<FamilyState>("POST", "/families", body),
  getFamily: (token: string, year: number) =>
    request<FamilyState>("GET", `${fam(token)}?year=${year}`),
  renameFamily: (token: string, name: string) =>
    request<FamilyState>("PATCH", fam(token), { name }),
  rotateLink: (token: string, link: "view" | "feed" | "legacy", year: number) =>
    request<FamilyState>("POST", `${fam(token)}/links?year=${year}`, { link }),
  cloneFamily: (token: string, name: string) =>
    request<FamilyState>("POST", `${fam(token)}/clone`, { name }),
  exportFamily: (token: string) => request<Record<string, unknown>>("GET", `${fam(token)}/export`),
  importFamily: (token: string, year: number, file: unknown) =>
    request<FamilyState>("POST", `${fam(token)}/import?year=${year}`, file),
  addType: (
    token: string,
    year: number,
    type: { name: string; color: string; role: Role },
  ) => request<EntryType>("POST", `${fam(token)}/types?year=${year}`, type),
  updateType: (
    token: string,
    year: number,
    id: string,
    patch: Partial<EntryType>,
  ) =>
    request<EntryType>(
      "PATCH",
      `${fam(token)}/types/${enc(id)}?year=${year}`,
      patch,
    ),
  deleteType: (token: string, year: number, id: string) =>
    request<unknown>("DELETE", `${fam(token)}/types/${enc(id)}?year=${year}`),
  copyTypes: (token: string, from: number, to: number) =>
    request<EntryType[]>("POST", `${fam(token)}/types/copy`, { from, to }),
  applyOps: (token: string, ops: EntryOp[]) =>
    request<unknown>("POST", `${fam(token)}/entries`, { ops }),
  applyNoteOps: (token: string, ops: NoteOp[]) =>
    request<unknown>("POST", `${fam(token)}/notes`, { ops }),
  finance: (token: string) => request<FinanceOverview>("GET", `${fam(token)}/finance`),
  clearFinance: (token: string) => request<FinanceOverview>("DELETE", `${fam(token)}/finance`),
  financeSettings: (token: string, patch: { currency?: string; csvMappings?: unknown[] }) =>
    request<FinanceOverview>("PATCH", `${fam(token)}/finance/settings`, patch),
  addCategory: (token: string, c: Omit<Category, "id" | "position">) =>
    request<Category>("POST", `${fam(token)}/finance/categories`, c),
  updateCategory: (token: string, id: string, patch: Partial<Category>) =>
    request<Category>("PATCH", `${fam(token)}/finance/categories/${enc(id)}`, patch),
  deleteCategory: (token: string, id: string) =>
    request<unknown>("DELETE", `${fam(token)}/finance/categories/${enc(id)}`),
  defaultCategories: (token: string, lang: string) =>
    request<Category[]>("POST", `${fam(token)}/finance/categories/defaults`, { lang }),
  addAccount: (
    token: string,
    a: { name: string; color: string; icon?: string; openingCents?: number },
  ) => request<Account>("POST", `${fam(token)}/finance/accounts`, a),
  updateAccount: (
    token: string,
    id: string,
    patch: Partial<Omit<Account, "id" | "balanceCents">>,
  ) => request<Account>("PATCH", `${fam(token)}/finance/accounts/${enc(id)}`, patch),
  deleteAccount: (token: string, id: string) =>
    request<{ deleted: string }>("DELETE", `${fam(token)}/finance/accounts/${enc(id)}`),
  transactions: (token: string, query: Record<string, string>) =>
    request<TransactionList>(
      "GET",
      `${fam(token)}/finance/transactions?${new URLSearchParams(query)}`,
    ),
  changeTransactions: (token: string, ops: TransactionOp[]) =>
    request<TransactionResult>("POST", `${fam(token)}/finance/transactions`, { ops }),
  importTransactions: (
    token: string,
    rows: { date: string; amountCents: number; payee: string; description: string }[],
    dryRun = false,
    accountId?: string,
    autoTransfers = false,
  ) =>
    request<{ added: number; duplicates: number[]; ids: string[]; transfers?: number }>(
      "POST",
      `${fam(token)}/finance/import`,
      {
        rows,
        dryRun,
        ...(accountId ? { accountId } : {}),
        ...(autoTransfers ? { autoTransfers } : {}),
      },
    ),
  transferSuggestions: (token: string, query: Record<string, string>) =>
    request<{ pairs: TransferPair[] }>(
      "GET",
      `${fam(token)}/finance/transfers/suggestions?${new URLSearchParams(query)}`,
    ),
  /** Combines every likely transfer in the range (all time without one) into its own group. */
  autoTransfers: (token: string, range: { from?: string; to?: string }) =>
    request<TransactionResult & { linked: number }>(
      "POST",
      `${fam(token)}/finance/transfers/auto`,
      range,
    ),
  financeSummary: (token: string, query: Record<string, string>) =>
    request<FinanceSummary>("GET", `${fam(token)}/finance/summary?${new URLSearchParams(query)}`),
  aiSettings: (token: string) => request<AiSettings>("GET", `${fam(token)}/ai/settings`),
  saveAiSettings: (token: string, patch: AiSettingsPatch) =>
    request<AiSettings>("PUT", `${fam(token)}/ai/settings`, patch),
  aiModels: (token: string, body: { baseUrl?: string; apiKey?: string } = {}) =>
    request<{ models: string[] }>("POST", `${fam(token)}/ai/models`, body),
  aiTest: (token: string) =>
    request<{ ok: boolean; model: string; reply: string }>("POST", `${fam(token)}/ai/test`, {}),
  /** Sorts uncategorized transactions (the given ids, or those of a range) like similar ones,
   *  and the rest with the AI if it is set up. */
  categorize: (
    token: string,
    body: { ids?: string[]; from?: string; to?: string; skip?: number; lang?: "en" | "de" },
  ) => request<CategorizeResult>("POST", `${fam(token)}/ai/categorize`, body),
  /** Runs undo steps in order (they are relative to the family). */
  undo: async (token: string, steps: UndoStep[]) => {
    for (const step of steps) await request(step.method, fam(token) + step.path, step.body);
  },
  /** Sends a chat turn and calls `onEvent` for every server-sent event until the end. */
  chat: async (
    token: string,
    body: Record<string, unknown>,
    onEvent: (e: ChatEvent) => void,
    signal?: AbortSignal,
  ) => {
    let res: Response;
    try {
      res = await fetch(`${apiBase()}${fam(token)}/ai/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      throw new ApiError((err as Error).message);
    }
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (!event || data === undefined || event === "ping") continue;
          onEvent({ event, data: JSON.parse(data) } as ChatEvent);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") throw err;
    }
  },
  calendarUrl: (feedId: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return `${apiBase()}${fam(feedId)}/calendar.ics${qs ? "?" + qs : ""}`;
  },
};
