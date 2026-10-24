// HTTP API of the Family Planner. Mounted as the Supabase Edge Function "api"
// (https://<project>.supabase.co/functions/v1/api/...) and reused by the local dev server
// with an in-memory store.
//
// Routes are /families/{token}/...; /sessions/{token}/... is the name from before families
// and stays as an alias (calendar subscriptions and scripts point there).

import { type AiEnv, handleAi } from "./ai.ts";
import type { Fetch } from "./ai/net.ts";
import { type Access, ACCESS_RANK, accessOf, type Ctx, type Loaded } from "./context.ts";
import { createFamily, handleFamily } from "./families.ts";
import { handleFinance } from "./finance.ts";
import { CORS, HttpError, json } from "./http.ts";
import { clientAddress, type RateLimiter } from "./rate_limit.ts";
import { SecretBox } from "./secrets.ts";
import type { Store } from "./store.ts";
import { handleVacation } from "./vacation.ts";

export { HttpError, randomToken } from "./http.ts";
export { PRESET_TYPES } from "./vacation.ts";

// Tokens come from randomToken() (or the migration); the Supabase store relies on them being
// alphanumeric.
const TOKEN_RE = /^[A-Za-z0-9]{10,64}$/;
const COLLECTIONS = ["families", "sessions"];

/** Requests per client and window. Reads aren't limited: iCloud fetches every feed from a
 *  few shared addresses, and reads don't add data. */
export const RATE_LIMITS = {
  /** New families (created or cloned) per client. */
  create: { max: 20, seconds: 3600 },
  /** New families of all clients together: a ceiling even if one client poses as many. */
  createAll: { max: 500, seconds: 3600 },
  /** Changes (POST / PATCH / DELETE) per client; the app batches edits made in quick
   *  succession, so this leaves plenty of room for fast clicking. */
  write: { max: 300, seconds: 300 },
  /** AI chats, model lists and tests per client, and per family (they cost the family's
   *  tokens and run outgoing requests). */
  ai: { max: 60, seconds: 300 },
  aiFamily: { max: 300, seconds: 3600 },
};
export type RateLimits = typeof RATE_LIMITS;

const DENIED: Partial<Record<Access, string>> = {
  view: "This is a read-only link",
  calendar: "This is a read-only link",
  feed: "This link only opens the calendar feed",
};

export interface HandlerOptions {
  /** Public API base for absolute links, e.g. https://<project>.supabase.co/functions/v1/api.
   * Default: derived from the request URL. */
  publicBase?: string;
  /** Counts requests for the rate limits; without one, nothing is limited. */
  rateLimiter?: RateLimiter;
  /** The client's rate-limit key. Default: its address (see clientAddress). */
  clientKey?: (req: Request) => string | Promise<string>;
  limits?: RateLimits;
  /** 32 random bytes, base64: encrypts the stored AI keys. Without it keys can't be saved. */
  aiSecret?: string;
  /** For the AI endpoint, web search and pages; tests pass a fake. Default: fetch. */
  fetch?: Fetch;
  /** Lets AI requests reach localhost and private networks (local development only). */
  allowPrivateNetwork?: boolean;
  /** Resolves host names for the private-address check (tests). */
  resolve?: (host: string) => Promise<string[]>;
}

export function createHandler(store: Store, options: HandlerOptions = {}) {
  const limits = options.limits ?? RATE_LIMITS;
  const clientKey = options.clientKey ?? clientAddress;
  const ai: AiEnv = {
    secrets: options.aiSecret ? new SecretBox(options.aiSecret) : null,
    net: {
      fetch: options.fetch ?? fetch,
      allowPrivate: options.allowPrivateNetwork,
      resolve: options.resolve,
    },
  };

  /** Counts the request against a limit; 429 once the window's limit is used up. */
  async function limit(name: keyof RateLimits, key: string) {
    if (!options.rateLimiter) return;
    const { max, seconds } = limits[name];
    let hits: number;
    try {
      hits = await options.rateLimiter.hit(`${name}:${key}`, seconds);
    } catch (err) {
      // Fail open: a broken counter is no reason to stop people from planning.
      console.error("Rate limit check failed:", err);
      return;
    }
    if (hits > max) {
      const retry = seconds - Math.floor(Date.now() / 1000) % seconds;
      throw new HttpError(429, `Too many requests, try again in ${retry} seconds`, {
        "retry-after": String(retry),
      });
    }
  }

  function checkToken(token: string) {
    if (!TOKEN_RE.test(token)) throw new HttpError(404, "Family not found");
  }

  async function load(token: string, need: Access): Promise<Loaded> {
    checkToken(token);
    const family = await store.findFamily(token);
    if (!family) throw new HttpError(404, "Family not found");
    const access = accessOf(family, token);
    if (ACCESS_RANK[access] < ACCESS_RANK[need]) throw new HttpError(403, DENIED[access]!);
    return { family, access };
  }

  /**
   * Loads the family and runs `query` for its id. The query starts alongside the lookup on
   * the guess that the token is the edit id (always true for writes); for any other token
   * the guess is dropped and the query runs again with the real id.
   */
  async function loadWith<T>(
    token: string,
    need: Access,
    query: (familyId: string) => Promise<T>,
  ): Promise<[Loaded, T]> {
    checkToken(token);
    const guess = query(token);
    guess.catch(() => {}); // a dropped guess must not end up as an unhandled rejection
    const loaded = await load(token, need);
    return [loaded, loaded.family.id === token ? await guess : await query(loaded.family.id)];
  }

  function publicBase(url: URL): string {
    if (options.publicBase) return options.publicBase.replace(/\/+$/, "");
    const prefix = /^(\/functions\/v1)?\/api(?=\/|$)/.exec(url.pathname)?.[0] ?? "";
    return url.origin + prefix;
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Strip the function prefix: /functions/v1/api/... or /api/...
    const path = url.pathname.replace(/^(\/functions\/v1)?\/api(?=\/|$)/, "")
      .replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const method = req.method;

    if (parts.length === 0 && method === "GET") {
      return json({
        name: "family-planner API",
        docs: "https://github.com/SaschaKrug/family-planner#api",
      });
    }
    if (!COLLECTIONS.includes(parts[0])) throw new HttpError(404, "Not found");

    if (method !== "GET") {
      const client = await clientKey(req);
      if (parts.length === 1 || parts[2] === "clone") {
        await limit("create", client);
        await limit("createAll", "all");
      } else await limit("write", client);
      if (parts[2] === "ai" && parts[3] !== "settings") {
        await limit("ai", client);
        await limit("aiFamily", parts[1]);
      }
    }

    if (parts.length === 1) {
      if (method !== "POST") throw new HttpError(405, "Method not allowed");
      return createFamily(store, req, url);
    }

    const token = parts[1];
    const ctx: Ctx = {
      store,
      req,
      url,
      method,
      token,
      rest: parts.slice(2),
      publicBase: publicBase(url),
      load: (need) => load(token, need),
      loadWith: (need, query) => loadWith(token, need, query),
    };
    const res = handleFamily(ctx) ?? handleVacation(ctx) ?? handleFinance(ctx) ??
      handleAi(ctx, ai);
    if (!res) throw new HttpError(404, "Not found");
    return await res;
  }

  return async function handler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      return await route(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, err.headers);
      console.error(err);
      return json({ error: "Internal error" }, 500);
    }
  };
}
