// The administration (admins only): /admin/users and /admin/families. Admins create accounts
// (the person sets up a passkey or password with a one-time link), make other admins, create
// families and decide who is a member. Being an admin doesn't open a family: the admin adds
// themselves as a member for that.

import {
  cleanEmail,
  cleanUserName,
  issueToken,
  type Principal,
  publicUser,
  saveUser,
} from "./auth.ts";
import { addMember, cleanRole, makeFamily, memberList } from "./families.ts";
import { cleanName, HttpError, json, NO_STORE, randomToken, readBody } from "./http.ts";
import type { MemberRow, Store, UserRow } from "./store.ts";

export interface AdminCtx {
  store: Store;
  req: Request;
  method: string;
  /** The path parts after /admin. */
  rest: string[];
  principal: Principal;
}

export function handleAdmin(ctx: AdminCtx): Promise<Response> {
  if (!ctx.principal.user.is_admin) {
    return Promise.reject(new HttpError(403, "Only admins can do this"));
  }
  const { method, rest } = ctx;
  const [collection, id, sub, subId] = rest;
  if (collection === "users") {
    if (rest.length === 1) {
      if (method === "GET") return listUsers(ctx);
      if (method === "POST") return createUser(ctx);
    } else if (rest.length === 2) {
      if (method === "PATCH") return updateUser(ctx, id);
      if (method === "DELETE") return deleteUser(ctx, id);
    } else if (rest.length === 3 && sub === "setup" && method === "POST") {
      return setupLink(ctx, id);
    }
  }
  if (collection === "families") {
    if (rest.length === 1) {
      if (method === "GET") return listFamilies(ctx);
      if (method === "POST") return createFamily(ctx);
    } else if (rest.length === 2) {
      if (method === "PATCH") return renameFamily(ctx, id);
      if (method === "DELETE") return deleteFamily(ctx, id);
    } else if (rest.length === 4 && sub === "members") {
      if (method === "PUT") return setMember(ctx, id, subId);
      if (method === "DELETE") return removeMember(ctx, id, subId);
    }
  }
  return Promise.reject(new HttpError(404, "Not found"));
}

async function getUser(store: Store, id: string): Promise<UserRow> {
  const user = await store.getUser(id);
  if (!user) throw new HttpError(404, "User not found");
  return user;
}

async function getFamily(store: Store, id: string) {
  const [family] = await store.listFamilies([id]);
  if (!family) throw new HttpError(404, "Family not found");
  return family;
}

/** A user for the administration: how they sign in and their families. */
async function adminUser(
  store: Store,
  user: UserRow,
  members: MemberRow[],
  names: Map<string, string>,
) {
  const [passkeys, setup] = await Promise.all([
    store.listPasskeys(user.id),
    store.listTokens(user.id, "setup"),
  ]);
  const lastSignIn = (await store.listTokens(user.id, "session"))
    .map((t) => t.last_used_at ?? t.created_at).sort().at(-1) ?? null;
  return {
    ...publicUser(user),
    passkeys: passkeys.length,
    setupPending: setup.some((t) => Date.parse(t.expires_at ?? "") > Date.now()),
    lastSignIn,
    createdAt: user.created_at,
    families: members.filter((m) => m.user_id === user.id && names.has(m.family_id))
      .map((m) => ({ id: m.family_id, name: names.get(m.family_id)!, role: m.role })),
  };
}

async function listUsers({ store }: AdminCtx): Promise<Response> {
  const [users, members, families] = await Promise.all([
    store.listUsers(),
    store.listMembers({}),
    store.listFamilies(),
  ]);
  const names = new Map(families.map((f) => [f.id, f.name]));
  return json(await Promise.all(users.map((u) => adminUser(store, u, members, names))));
}

async function oneUser(store: Store, user: UserRow) {
  const members = await store.listMembers({ userId: user.id });
  const families = members.length ? await store.listFamilies(members.map((m) => m.family_id)) : [];
  return adminUser(store, user, members, new Map(families.map((f) => [f.id, f.name])));
}

/** A new one-time setup link token for the user; older ones stop working. */
async function newSetupToken(store: Store, userId: string): Promise<string> {
  await store.deleteTokens(userId, { kinds: ["setup"] });
  return (await issueToken(store, userId, "setup")).token;
}

/** POST /admin/users {email, name, isAdmin}: the account and its setup link token (the app
 *  makes the link: /#/setup/{token}). */
async function createUser({ store, req }: AdminCtx): Promise<Response> {
  const body = await readBody(req);
  const email = cleanEmail(body.email);
  const now = new Date().toISOString();
  const user: UserRow = {
    id: randomToken(20),
    email,
    name: body.name === undefined ? "" : cleanUserName(body.name),
    password_hash: null,
    is_admin: body.isAdmin === true,
    must_change_password: false,
    created_at: now,
    updated_at: now,
  };
  await saveUser(store, () => store.createUser(user), email);
  const setupToken = await newSetupToken(store, user.id);
  return json({ user: await oneUser(store, user), setupToken }, 201, NO_STORE);
}

/** PATCH /admin/users/{id} {email, name, isAdmin} */
async function updateUser({ store, req, principal }: AdminCtx, id: string) {
  const user = await getUser(store, id);
  const body = await readBody(req);
  const patch: { email?: string; name?: string; is_admin?: boolean } = {};
  if (body.email !== undefined) patch.email = cleanEmail(body.email);
  if (body.name !== undefined) patch.name = cleanUserName(body.name);
  if (body.isAdmin !== undefined) {
    if (typeof body.isAdmin !== "boolean") {
      throw new HttpError(400, "isAdmin must be true or false");
    }
    patch.is_admin = body.isAdmin;
    if (!body.isAdmin && user.is_admin) {
      if (user.id === principal.user.id) {
        throw new HttpError(400, "You can't remove your own admin rights");
      }
    }
  }
  if (patch.email && patch.email !== user.email) {
    await saveUser(store, () => store.updateUser(id, patch), patch.email);
  } else await store.updateUser(id, patch);
  return json(await oneUser(store, { ...user, ...patch }));
}

/** DELETE /admin/users/{id}: not the admin's own account. */
async function deleteUser({ store, principal }: AdminCtx, id: string) {
  await getUser(store, id);
  if (id === principal.user.id) throw new HttpError(400, "You can't delete your own account");
  await store.deleteUser(id);
  return json({ ok: true });
}

/** POST /admin/users/{id}/setup: a new one-time link to set up a passkey or password, e.g.
 *  when someone lost theirs. Their current way to sign in keeps working. */
async function setupLink({ store }: AdminCtx, id: string) {
  await getUser(store, id);
  return json({ setupToken: await newSetupToken(store, id) }, 200, NO_STORE);
}

async function adminFamilies(store: Store, ids?: string[]) {
  const families = await store.listFamilies(ids);
  return await Promise.all(families.map(async (f) => ({
    id: f.id,
    name: f.name,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
    members: await memberList(store, f.id),
  })));
}

async function listFamilies({ store }: AdminCtx): Promise<Response> {
  return json(await adminFamilies(store));
}

async function oneFamily(store: Store, id: string) {
  return (await adminFamilies(store, [id]))[0];
}

/** POST /admin/families {name, lang, members: [{userId, role}]} */
async function createFamily({ store, req }: AdminCtx): Promise<Response> {
  const body = await readBody(req);
  const members = body.members === undefined ? [] : body.members;
  if (!Array.isArray(members)) throw new HttpError(400, "members must be a list");
  const wanted = await Promise.all(members.map(async (m) => {
    const userId = (m as { userId?: unknown })?.userId;
    if (typeof userId !== "string") throw new HttpError(400, "members need a userId");
    await getUser(store, userId);
    return { userId, role: cleanRole((m as { role?: unknown }).role ?? "editor") };
  }));
  const [family] = await makeFamily(store, { name: body.name, lang: body.lang });
  for (const m of wanted) await addMember(store, family.id, m.userId, m.role);
  return json(await oneFamily(store, family.id), 201);
}

/** PATCH /admin/families/{id} {name} */
async function renameFamily({ store, req }: AdminCtx, id: string) {
  await getFamily(store, id);
  await store.updateFamily(id, { name: cleanName((await readBody(req)).name) });
  return json(await oneFamily(store, id));
}

/** DELETE /admin/families/{id}: the family and everything in it. */
async function deleteFamily({ store }: AdminCtx, id: string) {
  await getFamily(store, id);
  await store.deleteFamily(id);
  return json({ ok: true });
}

/** PUT /admin/families/{id}/members/{userId} {role}: adds the member or changes the role. */
async function setMember({ store, req }: AdminCtx, id: string, userId: string) {
  await Promise.all([getFamily(store, id), getUser(store, userId)]);
  await addMember(store, id, userId, cleanRole((await readBody(req)).role));
  return json(await oneFamily(store, id));
}

/** DELETE /admin/families/{id}/members/{userId} */
async function removeMember({ store }: AdminCtx, id: string, userId: string) {
  await getFamily(store, id);
  await store.removeMember(id, userId);
  return json(await oneFamily(store, id));
}
