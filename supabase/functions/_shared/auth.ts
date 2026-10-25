// Accounts: who is asking (sessions and API tokens), signing in with a password or a passkey,
// and the user's own account: /auth/... The administration is in admin.ts.
//
// Tokens travel as `Authorization: Bearer <token>` (the app and the API are on different
// hosts, so no cookies). Only their SHA-256 is stored. Kinds:
// - session (fps_…): the app, after signing in; 30 days, renewed while used
// - api (fpt_…): personal API tokens for scripts and AI agents; until deleted
// - setup (fpu_…): one-time links from an admin to set up (or regain) an account; 7 days

import { HttpError, json, NO_STORE, randomToken, readBody } from "./http.ts";
import {
  hashPassword,
  hashToken,
  MAX_PASSWORD,
  MIN_PASSWORD,
  PASSWORD_ITERATIONS,
  verifyPassword,
} from "./passwords.ts";
import type { AuthTokenRow, MemberRole, PasskeyRow, Store, TokenKind, UserRow } from "./store.ts";
import {
  authenticationOptions,
  registrationOptions,
  relyingParty,
  verifyAuthentication,
  verifyRegistration,
} from "./webauthn.ts";

const DAY_MS = 24 * 3600_000;
const SESSION_MS = 30 * DAY_MS;
export const SETUP_MS = 7 * DAY_MS;
/** How often last_used_at is written at most (it costs a write per request otherwise). */
const TOUCH_MS = 3600_000;
const PREFIX: Record<TokenKind, string> = { session: "fps_", api: "fpt_", setup: "fpu_" };
const MAX_TOKENS = 50;
const MAX_PASSKEYS = 20;

/** The account that the initial admin gets. */
export const ADMIN_EMAIL = "admin";

export interface AuthEnv {
  /** PBKDF2 iterations for new password hashes (tests use few). */
  passwordIterations: number;
  /** The app's origins that may use passkeys; none: whatever the request comes from. */
  appOrigins?: string[];
  /** The initial admin's password. Default: "admin". */
  initialAdminPassword: string;
}

export function authEnv(
  options: { passwordIterations?: number; appOrigins?: string[]; initialAdminPassword?: string },
): AuthEnv {
  return {
    passwordIterations: options.passwordIterations ?? PASSWORD_ITERATIONS,
    appOrigins: options.appOrigins,
    initialAdminPassword: options.initialAdminPassword || "admin",
  };
}

/** Who sent the request, and with which token. */
export interface Principal {
  user: UserRow;
  token: AuthTokenRow;
}

/**
 * Creates the admin (admin/admin, to be changed at the first sign-in) when there are no users
 * yet, and makes it an editor of every family: on a fresh installation, and right after the
 * migration that brought accounts, so the admin can hand the families out.
 */
export async function ensureAdmin(store: Store, env: AuthEnv): Promise<void> {
  if (await store.countUsers() > 0) return;
  const now = new Date().toISOString();
  const admin: UserRow = {
    id: randomToken(20),
    email: ADMIN_EMAIL,
    name: "Admin",
    password_hash: await hashPassword(env.initialAdminPassword, env.passwordIterations),
    is_admin: true,
    must_change_password: true,
    created_at: now,
    updated_at: now,
  };
  try {
    await store.createUser(admin);
  } catch (err) {
    // Another instance was faster (the email is unique): its admin got the families.
    if (await store.findUserByEmail(ADMIN_EMAIL)) return;
    throw err;
  }
  for (const family of await store.listFamilies()) {
    await store.setMember({
      family_id: family.id,
      user_id: admin.id,
      role: "editor",
      created_at: now,
    });
  }
  console.log(`Created the account "${ADMIN_EMAIL}" for the first sign-in`);
}

/** A new token of the kind for the user; returns the token itself (shown once). */
export async function issueToken(
  store: Store,
  userId: string,
  kind: TokenKind,
  extra: { name?: string; canReset?: boolean } = {},
): Promise<{ token: string; row: AuthTokenRow }> {
  const token = PREFIX[kind] + randomToken(40);
  const now = Date.now();
  const row: AuthTokenRow = {
    id: randomToken(20),
    hash: await hashToken(token),
    user_id: userId,
    kind,
    name: extra.name ?? "",
    can_reset: extra.canReset ?? false,
    created_at: new Date(now).toISOString(),
    last_used_at: null,
    expires_at: kind === "session"
      ? new Date(now + SESSION_MS).toISOString()
      : kind === "setup"
      ? new Date(now + SETUP_MS).toISOString()
      : null,
  };
  await store.createToken(row);
  return { token, row };
}

/** The user behind the request's bearer token; null without one, 401 for a bad one. */
export async function authenticate(store: Store, req: Request): Promise<Principal | null> {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) throw new HttpError(401, "Sign in again");
  const found = token.startsWith(PREFIX.session) || token.startsWith(PREFIX.api)
    ? await store.findToken(await hashToken(token))
    : null;
  const now = Date.now();
  if (
    !found || found.token.kind === "setup" ||
    (found.token.expires_at && Date.parse(found.token.expires_at) < now)
  ) {
    throw new HttpError(401, "Your session has ended, sign in again");
  }
  const used = found.token.last_used_at ? Date.parse(found.token.last_used_at) : 0;
  if (now - used > TOUCH_MS) {
    const patch = {
      last_used_at: new Date(now).toISOString(),
      // Sessions stay open while they are used.
      ...(found.token.kind === "session"
        ? { expires_at: new Date(now + SESSION_MS).toISOString() }
        : {}),
    };
    await store.updateToken(found.token.id, patch);
    Object.assign(found.token, patch);
  }
  return found;
}

export function cleanEmail(v: unknown): string {
  if (typeof v !== "string") throw new HttpError(400, "email is required");
  const s = v.trim().toLowerCase();
  if (
    s.length > 254 || !(/^[^@\s]+@[^@\s]+$/.test(s) || /^[a-z0-9][a-z0-9._-]{0,63}$/.test(s))
  ) {
    throw new HttpError(400, "email must be an email address (or a simple name like admin)");
  }
  return s;
}

/** A display name; may be empty. */
export function cleanUserName(v: unknown): string {
  if (typeof v !== "string") throw new HttpError(400, "name must be a string");
  const s = v.trim();
  if (s.length > 80) throw new HttpError(400, "name is too long (max. 80)");
  return s;
}

function cleanPassword(v: unknown, field = "password"): string {
  if (typeof v !== "string" || v.length < MIN_PASSWORD) {
    throw new HttpError(400, `${field} must have at least ${MIN_PASSWORD} characters`);
  }
  if (v.length > MAX_PASSWORD) {
    throw new HttpError(400, `${field} is too long (max. ${MAX_PASSWORD})`);
  }
  return v;
}

/** A taken email is the one expected failure of saving a user. */
export async function saveUser(store: Store, save: () => Promise<void>, email: string) {
  try {
    await save();
  } catch (err) {
    if (await store.findUserByEmail(email)) {
      throw new HttpError(409, "There is already an account with this email");
    }
    throw err;
  }
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.is_admin,
    mustChangePassword: user.must_change_password,
    hasPassword: !!user.password_hash,
  };
}

/** The families a user is a member of, by name, with their role. */
export async function familiesOf(store: Store, userId: string) {
  const members = await store.listMembers({ userId });
  const role = new Map<string, MemberRole>(members.map((m) => [m.family_id, m.role]));
  const families = members.length ? await store.listFamilies([...role.keys()]) : [];
  return families.map((f) => ({ id: f.id, name: f.name, role: role.get(f.id)! }));
}

/** GET /auth/me: the user, how they can sign in, and their families. */
async function me(store: Store, user: UserRow) {
  const [passkeys, families] = await Promise.all([
    store.listPasskeys(user.id),
    familiesOf(store, user.id),
  ]);
  return { user: { ...publicUser(user), passkeys: passkeys.length }, families };
}

function publicPasskey(p: PasskeyRow) {
  return { id: p.id, name: p.name, createdAt: p.created_at, lastUsedAt: p.last_used_at };
}

function publicToken(t: AuthTokenRow) {
  return { id: t.id, name: t.name, createdAt: t.created_at, lastUsedAt: t.last_used_at };
}

export interface AuthCtx {
  store: Store;
  req: Request;
  method: string;
  /** The path parts after /auth. */
  rest: string[];
  principal: Principal | null;
  env: AuthEnv;
  /** Counts a password attempt against the account's limit. */
  limitAccount(email: string): Promise<void>;
}

/** Routes the parts of /auth that are allowed before the initial password is changed. */
export const BEFORE_PASSWORD_CHANGE = ["GET me", "PUT password", "POST logout"];
/** What an API token may do under /auth (the rest is for people in the app). */
export const API_TOKEN_AUTH = ["GET me"];

export function handleAuth(ctx: AuthCtx): Promise<Response> {
  const { method, rest } = ctx;
  const route = `${method} ${rest.join("/")}`;
  switch (route) {
    case "POST login":
      return login(ctx);
    case "POST passkey/start":
      return passkeyStart(ctx);
    case "POST passkey/finish":
      return passkeyFinish(ctx);
    case "POST setup":
      return setup(ctx);
  }
  const principal = ctx.principal;
  if (!principal) return Promise.reject(new HttpError(401, "Sign in first"));
  const { store } = ctx;
  const { user } = principal;
  switch (route) {
    case "GET me":
      return me(store, user).then((data) => json(data, 200, NO_STORE));
    case "PATCH me":
      return updateMe(ctx, principal);
    case "POST logout":
      return store.deleteTokens(user.id, { id: principal.token.id }).then(() => json({ ok: true }));
    case "PUT password":
      return setPassword(ctx, principal);
    case "DELETE password":
      return removePassword(ctx, principal);
    case "GET passkeys":
      return store.listPasskeys(user.id).then((list) => json(list.map(publicPasskey)));
    case "POST passkeys/start":
      return addPasskeyStart(ctx, principal);
    case "POST passkeys/finish":
      return addPasskeyFinish(ctx, principal);
    case "GET tokens":
      return store.listTokens(user.id, "api").then((list) => json(list.map(publicToken)));
    case "POST tokens":
      return createApiToken(ctx, principal);
  }
  if (rest.length === 2 && rest[0] === "passkeys") {
    if (method === "PATCH") return renamePasskey(ctx, principal, rest[1]);
    if (method === "DELETE") return deletePasskey(ctx, principal, rest[1]);
  }
  if (rest.length === 2 && rest[0] === "tokens" && method === "DELETE") {
    return store.deleteTokens(user.id, { id: rest[1] }).then(() => json({ ok: true }));
  }
  return Promise.reject(new HttpError(404, "Not found"));
}

/** A new session for the user, answered like GET /auth/me plus the token. */
async function signedIn(store: Store, user: UserRow, canReset = false): Promise<Response> {
  const { token } = await issueToken(store, user.id, "session", { canReset });
  return json({ token, ...await me(store, user) }, 200, NO_STORE);
}

// Checked when the email is unknown, so a wrong email takes as long as a wrong password.
let dummyHash: Promise<string> | null = null;

/** POST /auth/login {email, password} */
async function login({ store, req, env, limitAccount }: AuthCtx): Promise<Response> {
  const body = await readBody(req);
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    throw new HttpError(400, "email and password are required");
  }
  const email = body.email.trim().toLowerCase();
  await limitAccount(email);
  const user = await store.findUserByEmail(email);
  const hash = user?.password_hash ??
    await (dummyHash ??= hashPassword(crypto.randomUUID(), env.passwordIterations));
  const ok = await verifyPassword(body.password.slice(0, MAX_PASSWORD), hash);
  if (!user?.password_hash || !ok) throw new HttpError(401, "Wrong email or password");
  return signedIn(store, user);
}

/** POST /auth/passkey/start: options to sign in with a passkey. */
async function passkeyStart({ store, req, env }: AuthCtx): Promise<Response> {
  return json(await authenticationOptions(store, relyingParty(req, env.appOrigins)), 200, NO_STORE);
}

/** POST /auth/passkey/finish {challengeId, response} */
async function passkeyFinish({ store, req }: AuthCtx): Promise<Response> {
  const body = await readBody(req);
  const passkey = await verifyAuthentication(store, body.challengeId, body.response);
  const user = await store.getUser(passkey.user_id);
  if (!user) throw new HttpError(401, "This passkey isn't known here");
  await store.savePasskey(passkey);
  return signedIn(store, user);
}

/** POST /auth/setup {token}: trades a setup link for a session that may set a new password
 *  without the old one. The link works once. */
async function setup({ store, req }: AuthCtx): Promise<Response> {
  const token = (await readBody(req)).token;
  const found = typeof token === "string" && token.startsWith(PREFIX.setup)
    ? await store.findToken(await hashToken(token))
    : null;
  if (
    !found || found.token.kind !== "setup" ||
    Date.parse(found.token.expires_at ?? "") < Date.now()
  ) {
    throw new HttpError(404, "This link is invalid or has expired: ask an admin for a new one");
  }
  await store.deleteTokens(found.user.id, { kinds: ["setup"] });
  return signedIn(store, found.user, true);
}

/** PATCH /auth/me {name, email} */
async function updateMe({ store, req }: AuthCtx, { user }: Principal): Promise<Response> {
  const body = await readBody(req);
  const patch: { name?: string; email?: string } = {};
  if (body.name !== undefined) patch.name = cleanUserName(body.name);
  if (body.email !== undefined) patch.email = cleanEmail(body.email);
  if (patch.email && patch.email !== user.email) {
    await saveUser(store, () => store.updateUser(user.id, patch), patch.email);
  } else await store.updateUser(user.id, patch);
  return json(await me(store, { ...user, ...patch }), 200, NO_STORE);
}

/** PUT /auth/password {current, password}: the current password is needed if there is one,
 *  unless the session came from a setup link. Signs out the user's other sessions. */
async function setPassword(
  { store, req, env }: AuthCtx,
  { user, token }: Principal,
): Promise<Response> {
  const body = await readBody(req);
  const password = cleanPassword(body.password);
  if (user.password_hash && !token.can_reset) {
    if (
      typeof body.current !== "string" ||
      !await verifyPassword(body.current.slice(0, MAX_PASSWORD), user.password_hash)
    ) {
      throw new HttpError(403, "The current password is wrong");
    }
  }
  // (Compared as text: each hash costs a third of a second, and requests have little CPU.)
  if (user.must_change_password && password === env.initialAdminPassword) {
    throw new HttpError(400, "Choose a new password, not the initial one");
  }
  const patch = {
    password_hash: await hashPassword(password, env.passwordIterations),
    must_change_password: false,
  };
  await store.updateUser(user.id, patch);
  await store.deleteTokens(user.id, { kinds: ["session", "setup"], exceptId: token.id });
  return json(await me(store, { ...user, ...patch }), 200, NO_STORE);
}

/** DELETE /auth/password: passkeys only from now on. */
async function removePassword({ store }: AuthCtx, { user }: Principal): Promise<Response> {
  if (!(await store.listPasskeys(user.id)).length) {
    throw new HttpError(400, "Add a passkey first: you need a way to sign in");
  }
  await store.updateUser(user.id, { password_hash: null, must_change_password: false });
  return json(await me(store, { ...user, password_hash: null }), 200, NO_STORE);
}

/** POST /auth/passkeys/start: options to add a passkey to the account. */
async function addPasskeyStart({ store, req, env }: AuthCtx, { user }: Principal) {
  if ((await store.listPasskeys(user.id)).length >= MAX_PASSKEYS) {
    throw new HttpError(400, "Too many passkeys");
  }
  return json(
    await registrationOptions(store, user, relyingParty(req, env.appOrigins)),
    200,
    NO_STORE,
  );
}

/** POST /auth/passkeys/finish {challengeId, response, name} */
async function addPasskeyFinish({ store, req }: AuthCtx, { user }: Principal) {
  const body = await readBody(req);
  const name = body.name === undefined ? "" : cleanUserName(body.name);
  const passkey = await verifyRegistration(store, user, body.challengeId, body.response, name);
  await store.savePasskey(passkey);
  return json(publicPasskey(passkey), 201);
}

async function ownPasskey(store: Store, user: UserRow, id: string): Promise<PasskeyRow> {
  const passkey = await store.getPasskey(id);
  if (!passkey || passkey.user_id !== user.id) throw new HttpError(404, "Passkey not found");
  return passkey;
}

/** PATCH /auth/passkeys/{id} {name} */
async function renamePasskey({ store, req }: AuthCtx, { user }: Principal, id: string) {
  const passkey = await ownPasskey(store, user, id);
  passkey.name = cleanUserName((await readBody(req)).name);
  await store.savePasskey(passkey);
  return json(publicPasskey(passkey));
}

/** DELETE /auth/passkeys/{id}: not the last way to sign in. */
async function deletePasskey({ store }: AuthCtx, { user }: Principal, id: string) {
  await ownPasskey(store, user, id);
  if (!user.password_hash && (await store.listPasskeys(user.id)).length <= 1) {
    throw new HttpError(400, "Set a password first: you need a way to sign in");
  }
  await store.deletePasskey(user.id, id);
  return json({ ok: true });
}

/** POST /auth/tokens {name}: a personal API token, shown this once. */
async function createApiToken({ store, req }: AuthCtx, { user }: Principal) {
  const name = cleanUserName((await readBody(req)).name ?? "");
  if ((await store.listTokens(user.id, "api")).length >= MAX_TOKENS) {
    throw new HttpError(400, "Too many API tokens");
  }
  const { token, row } = await issueToken(store, user.id, "api", { name: name || "API token" });
  return json({ ...publicToken(row), token }, 201, NO_STORE);
}
