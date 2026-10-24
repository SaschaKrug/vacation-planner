// The AI assistant's routes under /families/{id}/ai: settings (keys stored encrypted, never
// returned), the endpoint's model list, a connection test and the chat. All need the edit link:
// the assistant spends the family's AI tokens and can change things.

import { type ChatMessage, listModels, type Provider, streamChat } from "./ai/provider.ts";
import { checkUrl, type NetOptions } from "./ai/net.ts";
import { cleanHistory, runChat, sseResponse, systemPrompt } from "./ai/chat.ts";
import type { Ctx } from "./context.ts";
import { formatDate, isValidDate } from "./dates.ts";
import { CORS, HttpError, json, NO_STORE, readBody } from "./http.ts";
import type { SecretBox } from "./secrets.ts";
import { type AiSettingsRow, SEARCH_PROVIDERS, type SearchProvider, type Store } from "./store.ts";

export interface AiEnv {
  /** Encrypts the stored keys; without it (no AI_CONFIG_KEY) keys can't be saved. */
  secrets: SecretBox | null;
  net: NetOptions;
}

const PAGES = ["vacation", "finance", "settings"];

function emptyRow(familyId: string): AiSettingsRow {
  return {
    family_id: familyId,
    base_url: "",
    model: "",
    api_key_enc: "",
    search_provider: "none",
    search_key_enc: "",
    allow_writes: true,
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
  if (ctx.rest[0] !== "ai" || ctx.rest.length !== 2) return null;
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
  }
  return Promise.reject(new HttpError(404, "Not found"));
}

async function getSettings({ store, load }: Ctx, env: AiEnv) {
  const { family } = await load("edit");
  return json(await publicSettings(env, await loadRow(store, family.id)), 200, NO_STORE);
}

/** PUT /ai/settings {baseUrl, apiKey ("" removes it), model, searchProvider, searchKey,
 *  allowWrites}: only the fields given change. */
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

/** POST /ai/chat {messages, year, page, lang, today}: streams the answer (text/event-stream). */
async function chat({ store, req, load }: Ctx, env: AiEnv) {
  const { family } = await load("edit");
  const body = await readBody(req);
  const history: ChatMessage[] = cleanHistory(body.messages);
  const row = await loadRow(store, family.id);
  if (!row.base_url || !row.model) throw new HttpError(400, "The AI assistant isn't set up yet");
  const p: Provider = await provider(row, env);
  const search = row.search_provider !== "none" && row.search_key_enc
    ? { provider: row.search_provider, key: await openKey(env, row.search_key_enc) }
    : null;
  const [types, categories, accounts, settings] = await Promise.all([
    store.listTypes(family.id),
    store.listCategories(family.id),
    store.listAccounts(family.id),
    store.getFinanceSettings(family.id),
  ]);
  // The app's local date, so "today" matches the user's day; the server's as a fallback.
  const today = isValidDate(body.today) ? body.today as string : formatDate(new Date());
  const year = Number.isInteger(body.year) ? body.year as number : Number(today.slice(0, 4));
  const system = systemPrompt({
    family,
    types,
    categories,
    accounts,
    currency: settings?.currency ?? "EUR",
    today,
    year,
    page: PAGES.includes(body.page as string) ? body.page as string : "vacation",
    lang: body.lang === "de" ? "de" : "en",
    writes: row.allow_writes,
    search: !!search,
  });
  return sseResponse(
    (emit) =>
      runChat({
        provider: p,
        system,
        history,
        ctx: {
          lang: body.lang === "de" ? "de" : "en",
          store,
          familyId: family.id,
          net: env.net,
          search,
          signal: req.signal,
        },
        writes: row.allow_writes,
        search: !!search,
        emit,
        signal: req.signal,
      }),
    CORS,
  );
}
