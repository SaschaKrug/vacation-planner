import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createHandler, type HandlerOptions } from "../supabase/functions/_shared/handler.ts";
import { MemoryRateLimiter } from "../supabase/functions/_shared/rate_limit.ts";
import { MemoryStore } from "../supabase/functions/_shared/store.ts";
import { Authenticator } from "./authenticator.ts";
import { addUser, TEST_ITERATIONS } from "./helpers.ts";

const BASE = "http://localhost/functions/v1/api";
const APP = "https://planner.example";

/** A handler on an empty store; `api(token)` calls with a session or API token (or none). */
function setup(options: HandlerOptions = {}, store = new MemoryStore()) {
  const handler = createHandler(store, { passwordIterations: TEST_ITERATIONS, ...options });
  const api = (token?: string | null, origin = APP) =>
  async (
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const res = await handler(
      new Request(BASE + path, {
        method,
        headers: {
          "x-forwarded-for": "203.0.113.5",
          origin,
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body && method !== "GET" ? JSON.stringify(body) : undefined,
      }),
    );
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch { /* not JSON */ }
    return { status: res.status, data };
  };
  return { store, api, anon: api(null) };
}

/** Signs in with email and password; the call as that user. */
async function signIn(t: ReturnType<typeof setup>, email: string, password: string) {
  const res = await t.anon("POST", "/auth/login", { email, password });
  assertEquals(res.status, 200, res.data);
  return { ...res.data, call: t.api(res.data.token) };
}

/** A fresh installation, signed in as the admin with a new password. */
async function admin(options: HandlerOptions = {}) {
  const t = setup(options);
  const first = await signIn(t, "admin", "admin");
  const res = await first.call("PUT", "/auth/password", {
    current: "admin",
    password: "correct horse",
  });
  assertEquals(res.status, 200);
  return { ...t, call: first.call, token: first.token as string };
}

/** An account made by the admin, set up with a password; the call as that user. */
async function person(t: Awaited<ReturnType<typeof admin>>, email: string) {
  const made = await t.call("POST", "/admin/users", { email, name: email.split("@")[0] });
  assertEquals(made.status, 201, made.data);
  const setup = await t.anon("POST", "/auth/setup", { token: made.data.setupToken });
  const call = t.api(setup.data.token);
  assertEquals((await call("PUT", "/auth/password", { password: "password1" })).status, 200);
  return { id: made.data.user.id as string, call };
}

Deno.test("a new installation starts with admin/admin, which must be changed first", async () => {
  const t = setup();
  // Families from before accounts: nobody is a member yet.
  const now = new Date().toISOString();
  for (const id of ["OldFamily000000000001", "OldFamily000000000002"]) {
    await t.store.createFamily(
      { id, feed_id: id + "f", legacy_id: null, name: id, created_at: now, updated_at: now },
      [],
    );
  }

  assertEquals(
    (await t.anon("POST", "/auth/login", { email: "admin", password: "x" })).status,
    401,
  );
  const first = await signIn(t, "Admin", "admin");
  assertMatch(first.token, /^fps_/);
  assertEquals(first.user.email, "admin");
  assertEquals(first.user.isAdmin, true);
  assertEquals(first.user.mustChangePassword, true);
  // The admin gets every family that exists, to hand them out.
  assertEquals(first.families.map((f: any) => [f.id, f.role]), [
    ["OldFamily000000000001", "editor"],
    ["OldFamily000000000002", "editor"],
  ]);

  // Nothing but the password change works until then.
  for (
    const [method, path] of [
      ["GET", "/families/OldFamily000000000001"],
      ["POST", "/families"],
      ["GET", "/admin/users"],
      ["POST", "/auth/tokens"],
    ]
  ) {
    const res = await first.call(method, path, {});
    assertEquals(res.status, 403, path);
    assertEquals(res.data.error, "Change your password first");
  }
  assertEquals((await first.call("GET", "/auth/me")).status, 200);

  const second = await signIn(t, "admin", "admin");
  const change = (body: unknown) => first.call("PUT", "/auth/password", body);
  assertEquals((await change({ current: "wrong", password: "something" })).status, 403);
  assertEquals((await change({ current: "admin", password: "short" })).status, 400);
  assertEquals((await change({ current: "admin", password: "admin" })).status, 400);
  const changed = await change({ current: "admin", password: "correct horse" });
  assertEquals(changed.status, 200);
  assertEquals(changed.data.user.mustChangePassword, false);
  assertEquals((await first.call("GET", "/families/OldFamily000000000001")).status, 200);
  // Other sessions are signed out; the old password is gone.
  assertEquals((await second.call("GET", "/auth/me")).status, 401);
  assertEquals(
    (await t.anon("POST", "/auth/login", { email: "admin", password: "admin" })).status,
    401,
  );
  await signIn(t, "admin", "correct horse");
  // The admin isn't made again.
  assertEquals(await t.store.countUsers(), 1);
});

Deno.test("the initial admin password can be set by the installation", async () => {
  const t = setup({ initialAdminPassword: "from-the-env" });
  assertEquals(
    (await t.anon("POST", "/auth/login", { email: "admin", password: "admin" })).status,
    401,
  );
  await signIn(t, "admin", "from-the-env");
});

Deno.test("wrong sign-ins say the same, and are limited per account", async () => {
  const limits = {
    create: { max: 99, seconds: 60 },
    createAll: { max: 99, seconds: 60 },
    write: { max: 99, seconds: 60 },
    ai: { max: 99, seconds: 60 },
    aiFamily: { max: 99, seconds: 60 },
    login: { max: 99, seconds: 60 },
    loginAccount: { max: 3, seconds: 60 },
  };
  const t = await admin({ rateLimiter: new MemoryRateLimiter(), limits });
  const unknown = await t.anon("POST", "/auth/login", { email: "nobody@x.de", password: "abc" });
  const wrong = await t.anon("POST", "/auth/login", { email: "admin", password: "abc" });
  assertEquals([unknown.status, wrong.status], [401, 401]);
  assertEquals(unknown.data.error, wrong.data.error);
  assertEquals(
    (await t.anon("POST", "/auth/login", { email: "admin", password: "abc" })).status,
    401,
  );
  // The account's limit is used up, whatever the password.
  const res = await t.anon("POST", "/auth/login", { email: "admin", password: "correct horse" });
  assertEquals(res.status, 429);
  assertEquals((await t.anon("POST", "/auth/login", {})).status, 400);
});

Deno.test("signing out ends the session; ended sessions are refused", async () => {
  const t = await admin();
  const other = await signIn(t, "admin", "correct horse");
  assertEquals((await other.call("POST", "/auth/logout")).status, 200);
  const res = await other.call("GET", "/auth/me");
  assertEquals(res.status, 401);
  assertEquals(res.data.error, "Your session has ended, sign in again");
  assertEquals((await t.call("GET", "/auth/me")).status, 200);

  const expired = await signIn(t, "admin", "correct horse");
  for (const token of t.store.tokens.values()) {
    if (token.kind === "session") token.expires_at = "2020-01-01T00:00:00.000Z";
  }
  assertEquals((await expired.call("GET", "/auth/me")).status, 401);
  assertEquals((await t.api("Bearer")("GET", "/auth/me")).status, 401);
});

Deno.test("admins create accounts that are set up with a one-time link", async () => {
  const t = await admin();
  const made = await t.call("POST", "/admin/users", { email: " Mom@Example.com ", name: "Mom" });
  assertEquals(made.status, 201);
  assertEquals(made.data.user.email, "mom@example.com");
  assertEquals(made.data.user.hasPassword, false);
  assertEquals(made.data.user.setupPending, true);
  assertMatch(made.data.setupToken, /^fpu_/);
  // The link isn't a session.
  assertEquals((await t.api(made.data.setupToken)("GET", "/auth/me")).status, 401);

  const setup = await t.anon("POST", "/auth/setup", { token: made.data.setupToken });
  assertEquals(setup.status, 200);
  assertEquals(setup.data.user.email, "mom@example.com");
  assertEquals(setup.data.user.hasPassword, false);
  assertEquals(setup.data.families, []);
  // Once only.
  assertEquals((await t.anon("POST", "/auth/setup", { token: made.data.setupToken })).status, 404);
  // A device that still sends an ended session can use a link (and sign in) all the same.
  const link2 = (await t.call("POST", `/admin/users/${made.data.user.id}/setup`)).data.setupToken;
  const stale = t.api("fps_ended");
  assertEquals((await stale("POST", "/auth/setup", { token: link2 })).status, 200);
  const login = await stale("POST", "/auth/login", { email: "admin", password: "correct horse" });
  assertEquals(login.status, 200);
  assertEquals((await stale("GET", "/auth/me")).status, 401);
  assertEquals((await t.anon("POST", "/auth/setup", { token: "fpu_nonsense" })).status, 404);

  const mom = t.api(setup.data.token);
  assertEquals((await mom("PUT", "/auth/password", { password: "mom's secret" })).status, 200);
  await signIn(t, "MOM@example.com", "mom's secret");

  // A new link (e.g. a forgotten password) lets her set a new one without the old one.
  const link = await t.call("POST", `/admin/users/${made.data.user.id}/setup`);
  const again = t.api(
    (await t.anon("POST", "/auth/setup", { token: link.data.setupToken })).data.token,
  );
  assertEquals((await again("PUT", "/auth/password", { password: "new secret!" })).status, 200);
  await signIn(t, "mom@example.com", "new secret!");
  // An ordinary session needs the current password.
  const plain = await signIn(t, "mom@example.com", "new secret!");
  assertEquals(
    (await plain.call("PUT", "/auth/password", { password: "another one" })).status,
    403,
  );

  // Emails are unique.
  const dup = await t.call("POST", "/admin/users", { email: "mom@example.com" });
  assertEquals(dup.status, 409);
  assertEquals((await t.call("POST", "/admin/users", { email: "not an email" })).status, 400);
});

Deno.test("only admins administrate, and keep their own rights", async () => {
  const t = await admin();
  const kid = await person(t, "kid@example.com");
  assertEquals((await kid.call("GET", "/admin/users")).status, 403);
  assertEquals((await kid.call("POST", "/admin/families", {})).status, 403);

  const me = (await t.call("GET", "/auth/me")).data.user;
  assertEquals((await t.call("PATCH", `/admin/users/${me.id}`, { isAdmin: false })).status, 400);
  assertEquals((await t.call("DELETE", `/admin/users/${me.id}`)).status, 400);

  // Admins make other admins.
  const promoted = await t.call("PATCH", `/admin/users/${kid.id}`, { isAdmin: true, name: "Kid" });
  assertEquals([promoted.data.isAdmin, promoted.data.name], [true, "Kid"]);
  assertEquals((await kid.call("GET", "/admin/users")).status, 200);
  assertEquals((await kid.call("PATCH", `/admin/users/${me.id}`, { isAdmin: false })).status, 200);
  assertEquals((await t.call("GET", "/admin/users")).status, 403);

  const users = (await kid.call("GET", "/admin/users")).data;
  assertEquals(users.map((u: any) => u.email), ["admin", "kid@example.com"]);
  assertEquals((await kid.call("DELETE", `/admin/users/${me.id}`)).status, 200);
  assertEquals((await t.call("GET", "/auth/me")).status, 401);
  assertEquals((await kid.call("DELETE", `/admin/users/${me.id}`)).status, 404);
});

Deno.test("admins create families and decide who is a member", async () => {
  const t = await admin();
  const mom = await person(t, "mom@example.com");
  const kid = await person(t, "kid@example.com");

  const made = await t.call("POST", "/admin/families", {
    name: "Krugs",
    lang: "de",
    members: [{ userId: mom.id, role: "editor" }, { userId: kid.id, role: "viewer" }],
  });
  assertEquals(made.status, 201);
  const id = made.data.id;
  assertEquals(made.data.members.map((m: any) => [m.email, m.role]), [
    ["mom@example.com", "editor"],
    ["kid@example.com", "viewer"],
  ]);
  // The admin isn't a member, so it doesn't see inside.
  assertEquals((await t.call("GET", `/families/${id}`)).status, 404);
  const state = (await mom.call("GET", `/families/${id}?year=2026`)).data;
  assertEquals([state.family.name, state.family.access], ["Krugs", "edit"]);
  assertEquals((await mom.call("GET", "/auth/me")).data.families, [
    { id, name: "Krugs", role: "editor" },
  ]);
  assertEquals((await kid.call("GET", `/families/${id}`)).data.family.access, "view");

  const renamed = await t.call("PATCH", `/admin/families/${id}`, { name: "Familie Krug" });
  assertEquals(renamed.data.name, "Familie Krug");
  await t.call("PUT", `/admin/families/${id}/members/${kid.id}`, { role: "editor" });
  assertEquals((await kid.call("GET", `/families/${id}`)).data.family.access, "edit");
  await t.call("DELETE", `/admin/families/${id}/members/${kid.id}`);
  assertEquals((await kid.call("GET", `/families/${id}`)).status, 404);
  assertEquals(
    (await t.call("PUT", `/admin/families/${id}/members/nobody`, { role: "editor" })).status,
    404,
  );
  assertEquals(
    (await t.call("PUT", `/admin/families/${id}/members/${kid.id}`, { role: "boss" })).status,
    400,
  );

  const users = (await t.call("GET", "/admin/users")).data;
  assertEquals(users.find((u: any) => u.email === "mom@example.com").families, [
    { id, name: "Familie Krug", role: "editor" },
  ]);
  assertEquals((await t.call("GET", "/admin/families")).data.length, 1);

  assertEquals((await t.call("DELETE", `/admin/families/${id}`)).status, 200);
  assertEquals((await mom.call("GET", `/families/${id}`)).status, 404);
  assertEquals((await mom.call("GET", "/auth/me")).data.families, []);
  assertEquals(t.store.types.has(id), false);
});

Deno.test("editors add people to their family; everyone may leave", async () => {
  const t = await admin();
  const mom = await person(t, "mom@example.com");
  const dad = await person(t, "dad@example.com");
  const kid = await person(t, "kid@example.com");
  // Any user can make a family, and is its editor.
  const created = await mom.call("POST", "/families", { name: "Ours" });
  assertEquals(created.status, 201);
  const m = `/families/${created.data.family.id}/members`;

  assertEquals((await mom.call("POST", m, { email: "nobody@example.com" })).status, 404);
  const added = await mom.call("POST", m, { email: "DAD@example.com" });
  assertEquals(added.status, 201);
  await mom.call("POST", m, { email: "kid@example.com", role: "viewer" });
  const list = (await kid.call("GET", m)).data;
  assertEquals(list.map((x: any) => [x.email, x.role, x.you]), [
    ["dad@example.com", "editor", false],
    ["mom@example.com", "editor", false],
    ["kid@example.com", "viewer", true],
  ]);

  // Viewers can't change members.
  assertEquals((await kid.call("POST", m, { email: "dad@example.com" })).status, 403);
  assertEquals((await kid.call("DELETE", `${m}/${dad.id}`)).status, 403);
  // A family keeps one editor.
  await mom.call("PATCH", `${m}/${dad.id}`, { role: "viewer" });
  const me = (await mom.call("GET", "/auth/me")).data.user.id;
  assertEquals((await mom.call("PATCH", `${m}/${me}`, { role: "viewer" })).status, 400);
  assertEquals((await mom.call("DELETE", `${m}/${me}`)).status, 400);
  assertEquals((await dad.call("PATCH", `${m}/${dad.id}`, { role: "editor" })).status, 403);
  // Leaving needs no editor rights.
  assertEquals((await kid.call("DELETE", `${m}/${kid.id}`)).status, 200);
  assertEquals((await kid.call("GET", m)).status, 404);
  assertEquals((await mom.call("DELETE", `${m}/${kid.id}`)).status, 404);
});

Deno.test("API tokens act as the user, but can't manage the account", async () => {
  const t = await admin();
  const family = (await t.call("POST", "/families", { name: "Ours", year: 2026 })).data.family;
  const made = await t.call("POST", "/auth/tokens", { name: "Script" });
  assertEquals(made.status, 201);
  assertMatch(made.data.token, /^fpt_/);
  const script = t.api(made.data.token);

  assertEquals((await script("GET", `/families/${family.id}/types?year=2026`)).status, 200);
  const write = await script("POST", `/families/${family.id}/entries`, {
    type: "vacation",
    date: "2026-08-03",
  });
  assertEquals(write.status, 200);
  assertEquals((await script("GET", "/auth/me")).status, 200);
  for (
    const [method, path] of [
      ["GET", "/admin/users"],
      ["POST", "/auth/tokens"],
      ["PUT", "/auth/password"],
      ["POST", "/auth/passkeys/start"],
    ]
  ) {
    assertEquals((await script(method, path, {})).status, 403, path);
  }

  const list = (await t.call("GET", "/auth/tokens")).data;
  assertEquals(list.map((x: any) => x.name), ["Script"]);
  assert(list[0].lastUsedAt);
  assertEquals("token" in list[0], false);
  await t.call("DELETE", `/auth/tokens/${list[0].id}`);
  assertEquals((await script("GET", "/auth/me")).status, 401);
});

Deno.test("signs in with a passkey", async () => {
  const t = await admin();
  const passkey = new Authenticator(APP);
  const start = await t.call("POST", "/auth/passkeys/start");
  assertEquals(start.status, 200);
  assertEquals(start.data.options.rp.id, "planner.example");
  assertEquals(start.data.options.authenticatorSelection.residentKey, "required");
  const response = await passkey.register(start.data.options);
  const finish = await t.call("POST", "/auth/passkeys/finish", {
    challengeId: start.data.challengeId,
    response,
    name: "Laptop",
  });
  assertEquals(finish.status, 201, finish.data);
  assertEquals(finish.data.name, "Laptop");
  // A challenge works once.
  const replay = await t.call("POST", "/auth/passkeys/finish", {
    challengeId: start.data.challengeId,
    response,
  });
  assertEquals(replay.status, 400);

  const signInWith = async (origin = APP) => {
    const anon = t.api(null, origin);
    const options = await anon("POST", "/auth/passkey/start");
    return await anon("POST", "/auth/passkey/finish", {
      challengeId: options.data.challengeId,
      response: await passkey.signIn(options.data.options),
    });
  };
  const res = await signInWith();
  assertEquals(res.status, 200, JSON.stringify(res.data));
  assertMatch(res.data.token, /^fps_/);
  assertEquals(res.data.user.email, "admin");
  assertEquals(res.data.user.passkeys, 1);
  assertEquals((await signInWith()).status, 200);
  const [stored] = await t.store.listPasskeys(res.data.user.id);
  assertEquals(stored.counter, 2);
  assert(stored.last_used_at);

  // Passkeys belong to the app's host: another site can't use them.
  assertEquals((await signInWith("https://evil.example")).status, 401);
  assertEquals((await t.api(null, "")("POST", "/auth/passkey/start")).status, 400);

  // Passkey-only accounts: the password can go, but not the last way to sign in.
  const removed = await t.call("DELETE", "/auth/password");
  assertEquals(removed.data.user.hasPassword, false);
  assertEquals((await t.call("DELETE", `/auth/passkeys/${passkey.id}`)).status, 400);
  const renamed = await t.call("PATCH", `/auth/passkeys/${passkey.id}`, { name: "Phone" });
  assertEquals(renamed.data.name, "Phone");
  assertEquals((await t.call("GET", "/auth/passkeys")).data.map((p: any) => p.name), ["Phone"]);
});

Deno.test("passkeys are only for the configured app origins", async () => {
  const t = await admin({ appOrigins: [APP] });
  assertEquals(
    (await t.api(t.token, "https://other.example")("POST", "/auth/passkeys/start")).status,
    400,
  );
  assertEquals((await t.call("POST", "/auth/passkeys/start")).status, 200);
});

Deno.test("users edit their own name and email", async () => {
  const t = await admin();
  const kid = await person(t, "kid@example.com");
  const res = await kid.call("PATCH", "/auth/me", { name: "Kiddo", email: "Kiddo@Example.com" });
  assertEquals([res.data.user.name, res.data.user.email], ["Kiddo", "kiddo@example.com"]);
  assertEquals((await kid.call("PATCH", "/auth/me", { email: "admin" })).status, 409);
  await signIn(t, "kiddo@example.com", "password1");
});

Deno.test("accounts and memberships survive a dev server restart", async () => {
  const t = await admin();
  const family = (await t.call("POST", "/families", { name: "Ours" })).data.family;
  const restored = new MemoryStore();
  restored.restore(JSON.parse(JSON.stringify(t.store.snapshot())));
  const again = setup({}, restored);
  const res = await again.api(t.token)("GET", `/families/${family.id}`);
  assertEquals(res.status, 200);
  assertEquals(await restored.countUsers(), 1);
});

Deno.test("a test user exists before the first request: no admin is made", async () => {
  const store = new MemoryStore();
  const { token } = await addUser(store, "someone@test");
  const t = setup({}, store);
  assertEquals((await t.api(token)("GET", "/auth/me")).status, 200);
  assertEquals(await store.findUserByEmail("admin"), null);
});
