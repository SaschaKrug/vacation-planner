// Thin client for the Family Planner API (Supabase Edge Function "api").

import { clearSession, type Me, type MemberRole, sessionToken, type User } from "./auth";
import type { EntryOp, EntryType, NoteOp, Role } from "./core";

declare global {
  interface Window {
    FP_CONFIG?: { apiBase?: string };
  }
}

export type Access = "edit" | "view";

export interface Family {
  id: string;
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
  /** A subcategory has the kind of its top-level category. */
  kind: CategoryKind;
  /** Among its siblings. */
  position: number;
  /** The category it is a subcategory of; null for a top-level one. */
  parentId: string | null;
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
  /** Set on a part of a split booking: the booking's id. A part counts on its own, with its
   *  own category; the booking only with what its parts leave over. */
  splitOf: string | null;
  /** Set on a booking that has parts: how many, and what it still counts itself (its amount
   *  minus the parts' sum, often 0). */
  split: { parts: number; remainderCents: number } | null;
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
  action: "add" | "update" | "delete" | "link" | "unlink" | "split" | "unsplit";
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

/** A request against /families/{id} that undoes (part of) a change the assistant made. */
export interface UndoStep {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}

/** A question of the assistant: pick one option (or several) or write an own answer. */
export interface ChatQuestion {
  id: string;
  question: string;
  options: string[];
  multiple: boolean;
}

/** What a running turn does right now. */
export type ChatActivity =
  | { kind: "thinking" | "writing" | "tool" }
  | { kind: "retrying"; attempt: number; max: number };

/** A chat as the list shows it; the server runs its turns. */
export interface ChatSummary {
  id: string;
  title: string;
  status: "idle" | "running";
  activity: ChatActivity | null;
  updatedAt: string;
}

/** A chat with what it shows (the items, by position) and their revision. */
export interface ChatState<Item = unknown> {
  chat: ChatSummary;
  rev: number;
  items: Item[];
}

/** What a chat's stream sends: the chat, items that changed (by position; `rev` once they are
 *  saved up to that revision), text the assistant writes, then the end (no turn runs any more)
 *  or "reconnect" (ask again to go on following). */
export type ChatEvent<Item = unknown> =
  | { event: "chat"; data: ChatSummary }
  | { event: "items"; data: { rev?: number; items: { seq: number; item: Item }[] } }
  | { event: "delta"; data: { seq: number; text: string } }
  | { event: "end"; data: { deleted?: boolean } }
  | { event: "reconnect"; data: Record<string, never> };

/** A message for the assistant: the text, files as text, images as data URLs; and where the
 *  user is (the page, the year they look at, their language and day). */
export interface ChatInput {
  text?: string;
  attachments?: (
    | { kind: "image"; name: string; url: string }
    | { kind: "file"; name: string; text: string }
  )[];
  page: string;
  year: number;
  lang: "en" | "de";
  today: string;
}

/** A member of a family, as its members see them. */
export interface Member {
  userId: string;
  email: string;
  name: string;
  role: MemberRole;
  you?: boolean;
}

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ApiToken {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** A user in the administration. */
export interface AdminUser extends Omit<User, "passkeys"> {
  passkeys: number;
  setupPending: boolean;
  lastSignIn: string | null;
  createdAt: string;
  families: { id: string; name: string; role: MemberRole }[];
}

export interface AdminFamily {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  members: Member[];
}

/** Options for the browser's passkey dialog, and the id to answer them with. */
export interface PasskeyOptions {
  challengeId: string;
  options: any;
}

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

function headers(json: boolean): Record<string, string> {
  const token = sessionToken();
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** A 401 with a session means it ended: sign out, which shows the sign-in page. */
function checkSession(res: Response, sent: string | null) {
  if (res.status === 401 && sent && sent === sessionToken()) clearSession();
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  const sent = sessionToken();
  try {
    res = await fetch(apiBase() + path, {
      method,
      headers: headers(!!body),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError((err as Error).message); // offline: no status
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    checkSession(res, sent);
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

/** A request whose answer is a stream of server-sent events: calls `onEvent` for each until
 *  the stream ends (or `signal` stops it). */
async function stream<E>(
  method: string,
  path: string,
  body: unknown,
  onEvent: (e: E) => void,
  signal?: AbortSignal,
) {
  let res: Response;
  const sent = sessionToken();
  try {
    res = await fetch(apiBase() + path, {
      method,
      headers: headers(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    throw new ApiError((err as Error).message);
  }
  if (!res.ok || !res.body) {
    checkSession(res, sent);
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
        onEvent({ event, data: JSON.parse(data) } as E);
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    throw new ApiError((err as Error).message);
  }
}

const enc = encodeURIComponent;
const fam = (token: string) => `/families/${enc(token)}`;

const admin = "/admin";

export const api = {
  // ---------------------------------------------------------------- account
  login: (email: string, password: string) =>
    request<Me & { token: string }>("POST", "/auth/login", { email, password }),
  passkeyLoginOptions: () => request<PasskeyOptions>("POST", "/auth/passkey/start"),
  passkeyLogin: (challengeId: string, response: unknown) =>
    request<Me & { token: string }>("POST", "/auth/passkey/finish", {
      challengeId,
      response,
    }),
  openSetupLink: (token: string) =>
    request<Me & { token: string }>("POST", "/auth/setup", { token }),
  me: () => request<Me>("GET", "/auth/me"),
  updateMe: (patch: { name?: string; email?: string }) => request<Me>("PATCH", "/auth/me", patch),
  logout: () => request<unknown>("POST", "/auth/logout"),
  setPassword: (password: string, current?: string) =>
    request<Me>("PUT", "/auth/password", {
      password,
      ...(current ? { current } : {}),
    }),
  removePassword: () => request<Me>("DELETE", "/auth/password"),
  passkeys: () => request<Passkey[]>("GET", "/auth/passkeys"),
  passkeyOptions: () => request<PasskeyOptions>("POST", "/auth/passkeys/start"),
  addPasskey: (challengeId: string, response: unknown, name: string) =>
    request<Passkey>("POST", "/auth/passkeys/finish", {
      challengeId,
      response,
      name,
    }),
  renamePasskey: (id: string, name: string) =>
    request<Passkey>("PATCH", `/auth/passkeys/${enc(id)}`, { name }),
  deletePasskey: (id: string) => request<unknown>("DELETE", `/auth/passkeys/${enc(id)}`),
  apiTokens: () => request<ApiToken[]>("GET", "/auth/tokens"),
  createApiToken: (name: string) =>
    request<ApiToken & { token: string }>("POST", "/auth/tokens", { name }),
  deleteApiToken: (id: string) => request<unknown>("DELETE", `/auth/tokens/${enc(id)}`),

  // ---------------------------------------------------------------- administration
  adminUsers: () => request<AdminUser[]>("GET", `${admin}/users`),
  adminCreateUser: (body: { email: string; name: string; isAdmin: boolean }) =>
    request<{ user: AdminUser; setupToken: string }>(
      "POST",
      `${admin}/users`,
      body,
    ),
  adminUpdateUser: (
    id: string,
    patch: { email?: string; name?: string; isAdmin?: boolean },
  ) => request<AdminUser>("PATCH", `${admin}/users/${enc(id)}`, patch),
  adminDeleteUser: (id: string) => request<unknown>("DELETE", `${admin}/users/${enc(id)}`),
  adminSetupLink: (id: string) =>
    request<{ setupToken: string }>("POST", `${admin}/users/${enc(id)}/setup`),
  adminFamilies: () => request<AdminFamily[]>("GET", `${admin}/families`),
  adminCreateFamily: (
    body: {
      name: string;
      lang: string;
      members: { userId: string; role: MemberRole }[];
    },
  ) => request<AdminFamily>("POST", `${admin}/families`, body),
  adminRenameFamily: (id: string, name: string) =>
    request<AdminFamily>("PATCH", `${admin}/families/${enc(id)}`, { name }),
  adminDeleteFamily: (id: string) => request<unknown>("DELETE", `${admin}/families/${enc(id)}`),
  adminSetMember: (id: string, userId: string, role: MemberRole) =>
    request<AdminFamily>(
      "PUT",
      `${admin}/families/${enc(id)}/members/${enc(userId)}`,
      { role },
    ),
  adminRemoveMember: (id: string, userId: string) =>
    request<AdminFamily>(
      "DELETE",
      `${admin}/families/${enc(id)}/members/${enc(userId)}`,
    ),

  // ---------------------------------------------------------------- families
  members: (token: string) => request<Member[]>("GET", `${fam(token)}/members`),
  addMember: (token: string, email: string, role: MemberRole) =>
    request<Member[]>("POST", `${fam(token)}/members`, { email, role }),
  setMemberRole: (token: string, userId: string, role: MemberRole) =>
    request<Member[]>("PATCH", `${fam(token)}/members/${enc(userId)}`, {
      role,
    }),
  removeMember: (token: string, userId: string) =>
    request<Member[]>("DELETE", `${fam(token)}/members/${enc(userId)}`),
  createFamily: (body: { name?: string; lang?: string; year?: number } = {}) =>
    request<FamilyState>("POST", "/families", body),
  getFamily: (token: string, year: number) =>
    request<FamilyState>("GET", `${fam(token)}?year=${year}`),
  renameFamily: (token: string, name: string) =>
    request<FamilyState>("PATCH", fam(token), { name }),
  rotateLink: (token: string, link: "feed" | "legacy", year: number) =>
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
  financeSettings: (
    token: string,
    patch: { currency?: string; csvMappings?: unknown[] },
  ) => request<FinanceOverview>("PATCH", `${fam(token)}/finance/settings`, patch),
  addCategory: (
    token: string,
    c: Omit<Category, "id" | "position" | "parentId"> & { parentId?: string | null },
  ) => request<Category>("POST", `${fam(token)}/finance/categories`, c),
  updateCategory: (token: string, id: string, patch: Partial<Category>) =>
    request<Category>(
      "PATCH",
      `${fam(token)}/finance/categories/${enc(id)}`,
      patch,
    ),
  deleteCategory: (token: string, id: string) =>
    request<unknown>("DELETE", `${fam(token)}/finance/categories/${enc(id)}`),
  defaultCategories: (token: string, lang: string) =>
    request<Category[]>("POST", `${fam(token)}/finance/categories/defaults`, {
      lang,
    }),
  addAccount: (
    token: string,
    a: { name: string; color: string; icon?: string; openingCents?: number },
  ) => request<Account>("POST", `${fam(token)}/finance/accounts`, a),
  updateAccount: (
    token: string,
    id: string,
    patch: Partial<Omit<Account, "id" | "balanceCents">>,
  ) => request<Account>("PATCH", `${fam(token)}/finance/accounts/${enc(id)}`, patch),
  /** The accounts with their balances at the end of the day `at`. */
  accountsAt: (token: string, at: string) =>
    request<{ at: string; accounts: Account[] }>(
      "GET",
      `${fam(token)}/finance/accounts?${new URLSearchParams({ at })}`,
    ),
  deleteAccount: (token: string, id: string) =>
    request<{ deleted: string }>(
      "DELETE",
      `${fam(token)}/finance/accounts/${enc(id)}`,
    ),
  transactions: (token: string, query: Record<string, string>) =>
    request<TransactionList>(
      "GET",
      `${fam(token)}/finance/transactions?${new URLSearchParams(query)}`,
    ),
  changeTransactions: (token: string, ops: TransactionOp[]) =>
    request<TransactionResult>("POST", `${fam(token)}/finance/transactions`, {
      ops,
    }),
  importTransactions: (
    token: string,
    rows: {
      date: string;
      amountCents: number;
      payee: string;
      description: string;
    }[],
    dryRun = false,
    accountId?: string,
    autoTransfers = false,
  ) =>
    request<{
      added: number;
      duplicates: number[];
      ids: string[];
      transfers?: number;
      splits?: number;
    }>(
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
      `${fam(token)}/finance/transfers/suggestions?${new URLSearchParams(
        query,
      )}`,
    ),
  /** Combines the split bookings in the range (all time without one) with their parts, then
   *  every likely transfer into its own group. */
  autoTransfers: (token: string, range: { from?: string; to?: string }) =>
    request<TransactionResult & { linked: number; splits: number }>(
      "POST",
      `${fam(token)}/finance/transfers/auto`,
      range,
    ),
  financeSummary: (token: string, query: Record<string, string>) =>
    request<FinanceSummary>(
      "GET",
      `${fam(token)}/finance/summary?${new URLSearchParams(query)}`,
    ),
  aiSettings: (token: string) => request<AiSettings>("GET", `${fam(token)}/ai/settings`),
  saveAiSettings: (token: string, patch: AiSettingsPatch) =>
    request<AiSettings>("PUT", `${fam(token)}/ai/settings`, patch),
  aiModels: (token: string, body: { baseUrl?: string; apiKey?: string } = {}) =>
    request<{ models: string[] }>("POST", `${fam(token)}/ai/models`, body),
  aiTest: (token: string) =>
    request<{ ok: boolean; model: string; reply: string }>(
      "POST",
      `${fam(token)}/ai/test`,
      {},
    ),
  /** Sorts uncategorized transactions (the given ids, or those of a range) like similar ones,
   *  and the rest with the AI if it is set up. */
  categorize: (
    token: string,
    body: {
      ids?: string[];
      from?: string;
      to?: string;
      skip?: number;
      lang?: "en" | "de";
    },
  ) => request<CategorizeResult>("POST", `${fam(token)}/ai/categorize`, body),
  /** Runs undo steps in order (they are relative to the family). */
  undo: async (token: string, steps: UndoStep[]) => {
    for (const step of steps) {
      await request(step.method, fam(token) + step.path, step.body);
    }
  },
  // ---------------------------------------------------------------- AI chats
  chats: (token: string) =>
    request<{ chats: ChatSummary[] }>("GET", `${fam(token)}/ai/chats`).then((r) => r.chats),
  chat: <Item>(token: string, id: string) =>
    request<ChatState<Item>>("GET", `${fam(token)}/ai/chats/${enc(id)}`),
  /** Starts a chat with its first message; streams it like followChat. */
  startChat: <Item>(
    token: string,
    input: ChatInput,
    onEvent: (e: ChatEvent<Item>) => void,
    signal?: AbortSignal,
  ) => stream("POST", `${fam(token)}/ai/chats`, input, onEvent, signal),
  sendMessage: <Item>(
    token: string,
    id: string,
    input: ChatInput,
    onEvent: (e: ChatEvent<Item>) => void,
    signal?: AbortSignal,
  ) => stream("POST", `${fam(token)}/ai/chats/${enc(id)}/messages`, input, onEvent, signal),
  /** Answers the assistant's question `questionId`; the turn goes on. */
  answerQuestion: <Item>(
    token: string,
    id: string,
    answer: Omit<ChatInput, "text" | "attachments"> & {
      id: string;
      selected: string[];
      text?: string;
    },
    onEvent: (e: ChatEvent<Item>) => void,
    signal?: AbortSignal,
  ) => stream("POST", `${fam(token)}/ai/chats/${enc(id)}/answer`, answer, onEvent, signal),
  /** Follows a chat: what changed since revision `since`, and the running turn live. */
  followChat: <Item>(
    token: string,
    id: string,
    since: number,
    onEvent: (e: ChatEvent<Item>) => void,
    signal?: AbortSignal,
  ) =>
    stream(
      "GET",
      `${fam(token)}/ai/chats/${enc(id)}/events?since=${since}`,
      undefined,
      onEvent,
      signal,
    ),
  stopChat: (token: string, id: string) =>
    request<unknown>("POST", `${fam(token)}/ai/chats/${enc(id)}/stop`, {}),
  deleteChat: (token: string, id: string) =>
    request<unknown>("DELETE", `${fam(token)}/ai/chats/${enc(id)}`),
  /** Tells the chat that its change `changeId` was undone. */
  chatUndone: (token: string, id: string, changeId: string) =>
    request<unknown>("POST", `${fam(token)}/ai/chats/${enc(id)}/undone`, { id: changeId }),
  /** Stores a chat this device kept from before chats were stored on the server. */
  importChat: (token: string, chat: unknown) =>
    request<{ chat: ChatSummary }>("POST", `${fam(token)}/ai/chats/import`, chat),
  calendarUrl: (feedId: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return `${apiBase()}${fam(feedId)}/calendar.ics${qs ? "?" + qs : ""}`;
  },
};
