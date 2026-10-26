// The AI assistant's routes under /families/{id}/ai: settings (keys stored encrypted, never
// returned), the endpoint's model list, a connection test, the chats (see ai/chats.ts), a chat
// turn without a stored chat (for scripts) and sorting transactions into categories. All are
// for editors: the assistant spends the family's AI tokens and can change things.

import { DEFAULT_WINDOW } from "./ai/context.ts";
import {
  type ChatMessage,
  contextWindow,
  listModels,
  type Provider,
  streamChat,
} from "./ai/provider.ts";
import { checkUrl, type Fetch, type NetOptions } from "./ai/net.ts";
import { matchSimilar, type Search, suggestCategories } from "./ai/categorize.ts";
import {
  type ChatContext,
  cleanContext,
  cleanHistory,
  runChat,
  sseResponse,
  systemPrompt,
} from "./ai/chat.ts";
import { handleChats, type Turn } from "./ai/chats.ts";
import type { Ctx } from "./context.ts";
import { isValidDate } from "./dates.ts";
import { applyTransactionOps, benchmarkOf } from "./finance.ts";
import { CORS, HttpError, json, NO_STORE, readBody } from "./http.ts";
import type { SecretBox } from "./secrets.ts";
import {
  type AiSettingsRow,
  type FamilyRow,
  SEARCH_PROVIDERS,
  type SearchProvider,
  type Store,
  type TransactionRow,
} from "./store.ts";

export interface AiEnv {
  /** Encrypts the stored keys; without it (no AI_CONFIG_KEY) keys can't be saved. */
  secrets: SecretBox | null;
  net: NetOptions;
  /** Keeps a chat turn running after its request answered (EdgeRuntime.waitUntil). */
  background: (task: Promise<unknown>) => void;
  /** How a chat turn calls the API again, to hand itself on to a new invocation. */
  selfFetch: Fetch;
  /** When a chat request hands the turn on to the next one (tests). */
  handOffMs?: number;
  /** When a chat request cuts off a model call that is still running (tests). */
  deadlineMs?: number;
  /** How often the chat's followers look for news, and how long a stream lasts (tests). */
  pollMs?: number;
  streamMs?: number;
  /** How long a chat turn holds the chat without renewing, and waits before a retry (tests). */
  leaseMs?: number;
  retryMs?: number;
}

/** The context windows a family can set (tokens); 0 finds it out (or takes DEFAULT_WINDOW). */
const MIN_WINDOW = 1000;
const MAX_WINDOW = 10_000_000;

/** Transactions one categorize request sends to the model. */
const MAX_CATEGORIZE = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function emptyRow(familyId: string): AiSettingsRow {
  return {
    family_id: familyId,
    base_url: "",
    model: "",
    api_key_enc: "",
    search_provider: "none",
    search_key_enc: "",
    allow_writes: true,
    context_window: 0,
    updated_at: new Date().toISOString(),
  };
}

const hint = (key: string) => (key ? key.slice(-4) : "");

async function openKey(env: AiEnv, sealed: string): Promise<string> {
  if (!sealed) return "";
  if (!env.secrets) {
    throw new HttpError(503, "The server can't read the stored keys (AI_CONFIG_KEY is missing)");
  }
  try {
    return await env.secrets.open(sealed);
  } catch {
    throw new HttpError(
      503,
      "The stored key can't be read anymore (AI_CONFIG_KEY changed?) – enter it again",
    );
  }
}

async function publicSettings(env: AiEnv, row: AiSettingsRow) {
  const [key, searchKey] = await Promise.all([
    openKey(env, row.api_key_enc).catch(() => ""),
    openKey(env, row.search_key_enc).catch(() => ""),
  ]);
  return {
    configured: !!(row.base_url && row.model),
    baseUrl: row.base_url,
    model: row.model,
    hasKey: !!row.api_key_enc,
    keyHint: hint(key),
    searchProvider: row.search_provider,
    hasSearchKey: !!row.search_key_enc,
    searchKeyHint: hint(searchKey),
    allowWrites: row.allow_writes,
    contextWindow: row.context_window ?? 0,
    serverReady: !!env.secrets,
  };
}

async function loadRow(store: Store, familyId: string) {
  return (await store.getAiSettings(familyId)) ?? emptyRow(familyId);
}

async function cleanBaseUrl(v: unknown, env: AiEnv): Promise<string> {
  if (typeof v !== "string") throw new HttpError(400, "baseUrl must be a string");
  const s = v.trim().replace(/\/+$/, "");
  if (!s) return "";
  if (s.length > 500) throw new HttpError(400, "baseUrl is too long");
  return (await checkUrl(s, env.net)).href.replace(/\/+$/, "");
}

function cleanKey(v: unknown, field: string): string {
  if (typeof v !== "string") throw new HttpError(400, `${field} must be a string`);
  const s = v.trim();
  if (s.length > 1000 || /\s/.test(s)) throw new HttpError(400, `${field} doesn't look like a key`);
  return s;
}

/** Routes /families/{id}/ai/...; null for anything else. */
export function handleAi(ctx: Ctx, env: AiEnv): Promise<Response> | null {
  if (ctx.rest[0] !== "ai") return null;
  if (ctx.rest[1] === "chats") {
    return handleChats(
      ctx,
      env,
      (store, family, context, signal) => prepareTurn(store, env, family, context, signal),
    );
  }
  if (ctx.rest.length !== 2) return null;
  const route = `${ctx.method} ${ctx.rest[1]}`;
  switch (route) {
    case "GET settings":
      return getSettings(ctx, env);
    case "PUT settings":
      return putSettings(ctx, env);
    case "POST models":
      return models(ctx, env);
    case "POST test":
      return test(ctx, env);
    case "POST chat":
      return chat(ctx, env);
    case "POST categorize":
      return categorize(ctx, env);
  }
  return Promise.reject(new HttpError(404, "Not found"));
}

async function getSettings({ store, load }: Ctx, env: AiEnv) {
  const { family } = await load("edit");
  return json(await publicSettings(env, await loadRow(store, family.id)), 200, NO_STORE);
}

/** PUT /ai/settings {baseUrl, apiKey ("" removes it), model, searchProvider, searchKey,
 *  allowWrites, contextWindow (tokens, 0: from the endpoint)}: only the fields given change. */
async function putSettings({ store, req, load }: Ctx, env: AiEnv) {
  const { family } = await load("edit");
  const body = await readBody(req);
  const row = await loadRow(store, family.id);
  if (body.baseUrl !== undefined) row.base_url = await cleanBaseUrl(body.baseUrl, env);
  if (body.model !== undefined) {
    if (typeof body.model !== "string" || body.model.length > 200) {
      throw new HttpError(400, "model must be a string (max. 200)");
    }
    row.model = body.model.trim();
  }
  const seal = async (v: unknown, field: string) => {
    const key = cleanKey(v, field);
    if (key && !env.secrets) {
      throw new HttpError(
        503,
        "The server can't store keys yet: AI_CONFIG_KEY is missing (see README)",
      );
    }
    return key ? await env.secrets!.seal(key) : "";
  };
  if (body.apiKey !== undefined) row.api_key_enc = await seal(body.apiKey, "apiKey");
  if (body.searchKey !== undefined) row.search_key_enc = await seal(body.searchKey, "searchKey");
  if (body.searchProvider !== undefined) {
    if (!SEARCH_PROVIDERS.includes(body.searchProvider as SearchProvider)) {
      throw new HttpError(400, `searchProvider must be one of ${SEARCH_PROVIDERS.join(", ")}`);
    }
    row.search_provider = body.searchProvider as SearchProvider;
  }
  if (body.allowWrites !== undefined) {
    if (typeof body.allowWrites !== "boolean") {
      throw new HttpError(400, "allowWrites must be true or false");
    }
    row.allow_writes = body.allowWrites;
  }
  if (body.contextWindow !== undefined) {
    const n = body.contextWindow;
    if (
      typeof n !== "number" || !Number.isInteger(n) ||
      (n !== 0 && (n < MIN_WINDOW || n > MAX_WINDOW))
    ) {
      throw new HttpError(
        400,
        `contextWindow must be 0 (automatic) or ${MIN_WINDOW} to ${MAX_WINDOW} tokens`,
      );
    }
    row.context_window = n;
  }
  row.updated_at = new Date().toISOString();
  await store.saveAiSettings(row);
  return json(await publicSettings(env, row), 200, NO_STORE);
}

async function provider(row: AiSettingsRow, env: AiEnv, override: Record<string, unknown> = {}) {
  const baseUrl = override.baseUrl !== undefined
    ? await cleanBaseUrl(override.baseUrl, env)
    : row.base_url;
  if (!baseUrl) throw new HttpError(400, "Enter the URL of an OpenAI-compatible API first");
  const apiKey = override.apiKey
    ? cleanKey(override.apiKey, "apiKey")
    : await openKey(env, row.api_key_enc);
  return { baseUrl, apiKey, model: row.model };
}

/** The web search the family set up, with its key; null without. */
async function searchOf(row: AiSettingsRow, env: AiEnv): Promise<Search | null> {
  return row.search_provider !== "none" && row.search_key_enc
    ? { provider: row.search_provider, key: await openKey(env, row.search_key_enc) }
    : null;
}

/** POST /ai/models {baseUrl?, apiKey?}: the endpoint's models (the form can ask before saving). */
async function models({ store, req, load }: Ctx, env: AiEnv) {
  const { family } = await load("edit");
  const body = await readBody(req);
  const p = await provider(await loadRow(store, family.id), env, body);
  return json({ models: await listModels(p, env.net) });
}

/** POST /ai/test: one short completion with the saved settings. */
async function test({ store, req, load }: Ctx, env: AiEnv) {
  const { family } = await load("edit");
  const row = await loadRow(store, family.id);
  const p = await provider(row, env);
  if (!p.model) throw new HttpError(400, "Pick a model first");
  let reply = "";
  for await (
    const ev of streamChat(
      p,
      {
        messages: [{ role: "user", content: "Reply with the single word OK." }],
      },
      env.net,
      req.signal,
    )
  ) {
    if (ev.type === "done") reply = ev.content;
  }
  return json({ ok: true, model: p.model, reply: reply.trim().slice(0, 200) });
}

/** A chat turn of the family: its model, the instructions for the context, and the tools. */
async function prepareTurn(
  store: Store,
  env: AiEnv,
  family: FamilyRow,
  context: ChatContext,
  signal?: AbortSignal,
): Promise<Turn> {
  const row = await loadRow(store, family.id);
  if (!row.base_url || !row.model) throw new HttpError(400, "The AI assistant isn't set up yet");
  const p: Provider = await provider(row, env);
  const search = await searchOf(row, env);
  const [types, categories, accounts, settings, window] = await Promise.all([
    store.listTypes(family.id),
    store.listCategories(family.id),
    store.listAccounts(family.id),
    store.getFinanceSettings(family.id),
    row.context_window || contextWindow(p, env.net),
  ]);
  const system = systemPrompt({
    family,
    types,
    categories,
    accounts,
    currency: settings?.currency ?? "EUR",
    benchmark: benchmarkOf(settings, categories),
    ...context,
    writes: row.allow_writes,
    search: !!search,
  });
  return {
    provider: p,
    system,
    ctx: { lang: context.lang, store, familyId: family.id, net: env.net, search, signal },
    writes: row.allow_writes,
    search: !!search,
    window: window || DEFAULT_WINDOW,
  };
}

/** POST /ai/chat {messages, year, page, lang, today, continue?}: one turn of a chat the caller
 *  keeps (the app's chats are stored, see ai/chats.ts), streamed (text/event-stream). With
 *  `continue: true` the history ends with tool results and the turn that a "continue" event
 *  handed back goes on. */
async function chat({ store, req, load }: Ctx, env: AiEnv) {
  const { family } = await load("edit");
  const body = await readBody(req);
  const history: ChatMessage[] = cleanHistory(body.messages, body.continue === true);
  // The app's local date, so "today" matches the user's day; the server's as a fallback.
  const turn = await prepareTurn(store, env, family, cleanContext(body), req.signal);
  return sseResponse(
    (emit) =>
      runChat({
        ...turn,
        history,
        emit,
        signal: req.signal,
        handOffMs: env.handOffMs,
        deadlineMs: env.deadlineMs,
      }),
    CORS,
  );
}

/** POST /ai/categorize {ids?, from?, to?, skip?, lang?}: sorts uncategorized transactions (the
 *  given ones, or those in the range after the first `skip`, at most 200 per request) into
 *  categories: like similar earlier transactions where those agree (`matched`, no AI needed),
 *  the rest by the model, which may search the web for unknown payees. Without AI settings only
 *  the first step runs (`ai`: false). Returns `inverse` (ops for /finance/transactions that undo
 *  it) and `remaining`, the uncategorized rows in the range it didn't look at yet. */
async function categorize({ store, req, load }: Ctx, env: AiEnv) {
  const { family } = await load("edit");
  const body = await readBody(req);
  const row = await loadRow(store, family.id);
  const ai = !!(row.base_url && row.model);

  let candidates: TransactionRow[];
  let remaining = 0;
  if (body.ids !== undefined) {
    const ids = body.ids;
    if (
      !Array.isArray(ids) || ids.length > MAX_CATEGORIZE ||
      ids.some((id) => typeof id !== "string" || !UUID_RE.test(id))
    ) {
      throw new HttpError(400, `ids must be at most ${MAX_CATEGORIZE} transaction ids`);
    }
    candidates = (await store.getTransactions(family.id, ids)).filter((t) => !t.category_id);
  } else {
    const from = body.from ?? undefined, to = body.to ?? undefined;
    for (const d of [from, to]) {
      if (d !== undefined && !isValidDate(d)) {
        throw new HttpError(400, "from/to must be YYYY-MM-DD");
      }
    }
    const skip = body.skip ?? 0;
    if (!Number.isInteger(skip) || (skip as number) < 0) {
      throw new HttpError(400, "skip must be a whole number");
    }
    const open = (await store.listTransactions(family.id, from as string, to as string))
      .filter((t) => !t.category_id).slice(skip as number);
    candidates = open.slice(0, MAX_CATEGORIZE);
    remaining = open.length - candidates.length;
  }

  const [categories, all] = await Promise.all([
    store.listCategories(family.id),
    candidates.length ? store.listTransactions(family.id) : [],
  ]);
  const sorted = all.filter((t) => t.category_id);
  const similar = matchSimilar(candidates, sorted, categories);
  const rest = candidates.filter((t) => !similar.has(t.id));
  const byAi = ai && rest.length && categories.length
    ? await suggestCategories({
      provider: await provider(row, env),
      net: env.net,
      categories,
      rows: rest,
      sorted,
      lang: body.lang === "de" ? "de" : "en",
      search: await searchOf(row, env),
      store,
      familyId: family.id,
      signal: req.signal,
    })
    : new Map<string, string>();
  const assignments = [
    ...[...similar].map(([id, categoryId]) => ({ id, categoryId, source: "similar" })),
    ...[...byAi].map(([id, categoryId]) => ({ id, categoryId, source: "ai" })),
  ];
  const ops = assignments.map(({ id, categoryId }) => ({ action: "update", id, categoryId }));
  const { inverse } = ops.length
    ? await applyTransactionOps(store, family.id, ops)
    : { inverse: [] };
  return json({
    changed: ops.length,
    matched: similar.size,
    considered: candidates.length,
    remaining,
    ai,
    inverse,
    assignments,
  });
}
