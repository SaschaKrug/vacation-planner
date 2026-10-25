// HTTP API of the Family Planner. Mounted as the Supabase Edge Function "api"
// (https://<project>.supabase.co/functions/v1/api/...) and reused by the local dev server
// with an in-memory store.
//
// Routes are /families/{id}/...; /sessions/{id}/... is the name from before families and
// stays as an alias (calendar subscriptions and scripts point there). Everything needs a
// signed-in user (a bearer token, see auth.ts), except signing in and the calendar feed;
// /auth/... is the user's account, /admin/... the administration.

import { handleAdmin } from "./admin.ts";
import { type AiEnv, handleAi } from "./ai.ts";
import type { Fetch } from "./ai/net.ts";
import {
  API_TOKEN_AUTH,
  authenticate,
  authEnv,
  BEFORE_PASSWORD_CHANGE,
  ensureAdmin,
  handleAuth,
  type Principal,
} from "./auth.ts";
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

// Ids come from randomToken() (or the migration); the Supabase store relies on them being
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
  /** Sign-in attempts (password, passkey, setup link) per client. */
  login: { max: 30, seconds: 300 },
  /** Password attempts per account, from all clients together. */
  loginAccount: { max: 50, seconds: 3600 },
};
export type RateLimits = typeof RATE_LIMITS;

const DENIED: Partial<Record<Access, string>> = {
  view: "You can only view this family",
};

/** /auth routes that work without signing in. */
const PUBLIC_AUTH = ["POST login", "POST passkey/start", "POST passkey/finish", "POST setup"];

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
  /** When an AI chat request hands the turn on to a new one (tests). Default: 90 s. */
  aiHandOffMs?: number;
  /** When an AI chat request cuts off a model call that still runs (tests). Default: 130 s. */
  aiDeadlineMs?: number;
  /** PBKDF2 iterations for new password hashes. Default: 600 000 (tests use few). */
  passwordIterations?: number;
  /** The app's origins (e.g. https://family-planner.example) that may use passkeys. Default:
   *  whichever the request comes from; passkeys stay bound to that host either way. */
  appOrigins?: string[];
  /** The password of the admin created when there are no users. Default: "admin". */
  initialAdminPassword?: string;
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
    handOffMs: options.aiHandOffMs,
    deadlineMs: options.aiDeadlineMs,
  };
  const auth = authEnv(options);
  // Once per instance: the admin of a new installation (tried again if it failed).
  let bootstrap: Promise<void> | null = null;
  function ready(): Promise<void> {
    bootstrap ??= ensureAdmin(store, auth).catch((err) => {
      bootstrap = null;
      throw err;
    });
    return bootstrap;
  }

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

  function requireUser(principal: Principal | null): Principal {
    if (!principal) throw new HttpError(401, "Sign in first");
    return principal;
  }

  /** The calendar feed needs its feed (or legacy) id; everything else a member. */
  async function load(token: string, need: Access, principal: Principal | null): Promise<Loaded> {
    checkToken(token);
    if (need === "feed") {
      const family = await store.findFeed(token);
      if (!family) throw new HttpError(404, "Family not found");
      return { family, access: "feed" };
    }
    const { user } = requireUser(principal);
    // Not a member reads the same as no such family: ids don't reveal anything.
    const member = await store.findMembership(token, user.id);
    if (!member) throw new HttpError(404, "Family not found");
    const access = accessOf(member.role);
    if (ACCESS_RANK[access] < ACCESS_RANK[need]) throw new HttpError(403, DENIED[access]!);
    return { family: member.family, access };
  }

  /** Loads the family and runs `query` for its id alongside the lookup; the result is only
   *  used if the user may see it. */
  async function loadWith<T>(
    token: string,
    need: Access,
    principal: Principal | null,
    query: (familyId: string) => Promise<T>,
  ): Promise<[Loaded, T]> {
    checkToken(token);
    const result = query(token);
    result.catch(() => {}); // a dropped result must not end up as an unhandled rejection
    const loaded = await load(token, need, principal);
    return [loaded, await result];
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
    const area = parts[0] === "auth" || parts[0] === "admin" ? parts[0] : "families";
    if (area === "families" && !COLLECTIONS.includes(parts[0])) {
      throw new HttpError(404, "Not found");
    }
    const route = `${method} ${parts.slice(1).join("/")}`;
    const isFeed = area === "families" && parts[2] === "calendar.ics" && parts.length === 3 &&
      method === "GET";

    if (method !== "GET") {
      const client = await clientKey(req);
      if (area === "auth" && PUBLIC_AUTH.includes(route)) await limit("login", client);
      else if (area === "families" && (parts.length === 1 || parts[2] === "clone")) {
        await limit("create", client);
        await limit("createAll", "all");
      } else await limit("write", client);
      if (area === "families" && parts[2] === "ai" && parts[3] !== "settings") {
        await limit("ai", client);
        await limit("aiFamily", parts[1]);
      }
    }

    // The calendar feed is public and never sends a token: no account lookups for it.
    if (isFeed) {
      return await handleVacation(familyCtx(req, url, parts, null))!;
    }
    await ready();
    const principal = await authenticate(store, req);
    if (principal) {
      const allowed = area === "auth" &&
        [...BEFORE_PASSWORD_CHANGE, ...PUBLIC_AUTH].includes(route);
      if (principal.user.must_change_password && !allowed) {
        throw new HttpError(403, "Change your password first");
      }
      if (
        principal.token.kind === "api" &&
        (area === "admin" || (area === "auth" && !API_TOKEN_AUTH.includes(route)))
      ) {
        throw new HttpError(403, "API tokens can't do this: sign in to the app");
      }
    }

    if (area === "auth") {
      return await handleAuth({
        store,
        req,
        method,
        rest: parts.slice(1),
        principal,
        env: auth,
        limitAccount: (email) => limit("loginAccount", `email:${email}`),
      });
    }
    if (area === "admin") {
      return await handleAdmin({
        store,
        req,
        method,
        rest: parts.slice(1),
        principal: requireUser(principal),
      });
    }

    const ctx = familyCtx(req, url, parts, principal);
    if (parts.length === 1) {
      if (method !== "POST") throw new HttpError(405, "Method not allowed");
      return createFamily(ctx);
    }
    const res = handleFamily(ctx) ?? handleVacation(ctx) ?? handleFinance(ctx) ??
      handleAi(ctx, ai);
    if (!res) throw new HttpError(404, "Not found");
    return await res;
  }

  function familyCtx(req: Request, url: URL, parts: string[], principal: Principal | null): Ctx {
    const token = parts[1] ?? "";
    return {
      store,
      req,
      url,
      method: req.method,
      token,
      rest: parts.slice(2),
      publicBase: publicBase(url),
      principal,
      requireUser: () => requireUser(principal),
      load: (need) => load(token, need, principal),
      loadWith: (need, query) => loadWith(token, need, principal, query),
    };
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
