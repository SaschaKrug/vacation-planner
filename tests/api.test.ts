import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  createHandler,
  type HandlerOptions,
  RATE_LIMITS,
} from "../supabase/functions/_shared/handler.ts";
import {
  clientAddress,
  MemoryRateLimiter,
  type RateLimiter,
} from "../supabase/functions/_shared/rate_limit.ts";
import { MemoryStore } from "../supabase/functions/_shared/store.ts";
import { MAX_TOOL_RESULT, runTool, TOOLS } from "../supabase/functions/_shared/ai/tools.ts";
import { addMember, addUser, TEST_ITERATIONS } from "./helpers.ts";

const BASE = "http://localhost/functions/v1/api";

type Call = (
  method: string,
  path: string,
  body?: unknown,
  ip?: string,
) => Promise<{ status: number; data: any; headers: Headers }>;

/** A handler on an empty store and `call`, signed in as an admin ("owner@test"). `as(token)`
 *  calls as someone else (null: not signed in); `viewerOf(id)` as a new viewer of a family. */
async function setup(options?: HandlerOptions) {
  const store = new MemoryStore();
  const handler = createHandler(store, { passwordIterations: TEST_ITERATIONS, ...options });
  const owner = await addUser(store, "owner@test", { is_admin: true });
  const as = (token: string | null): Call => async (method, path, body, ip = "203.0.113.7") => {
    const res = await handler(
      new Request(BASE + path, {
        method,
        headers: {
          "x-forwarded-for": ip,
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch { /* ics */ }
    return { status: res.status, data, headers: res.headers };
  };
  let viewers = 0;
  const viewerOf = async (familyId: string) => {
    const viewer = await addUser(store, `viewer${++viewers}@test`);
    await addMember(store, familyId, viewer.user.id, "viewer");
    return as(viewer.token);
  };
  const call = Object.assign(as(owner.token), { as, viewerOf });
  return { call, store, handler, owner, as, viewerOf };
}

/** A new family of the owner, and `view`: a call as a viewer of it. */
async function newFamily(call: Awaited<ReturnType<typeof setup>>["call"]) {
  const res = await call("POST", "/families", { name: "Family", year: 2026 });
  assertEquals(res.status, 201);
  const family = res.data.family as { id: string; feedId: string };
  return { ...family, view: await call.viewerOf(family.id) };
}

Deno.test("creates a family with preset types", async () => {
  const { call } = await setup();
  const res = await call("POST", "/families", {});
  assertEquals(res.status, 201);
  assertEquals(res.data.types.map((t: any) => t.name), ["Holiday", "Vacation", "Sick"]);
  // Without a year, the presets go into the current year.
  const year = new Date().getUTCFullYear();
  assertEquals(res.data.types.map((t: any) => t.year), [year, year, year]);
  assertEquals(res.data.typeYears, [year]);
  assertEquals(res.data.family.readOnly, false);
  assertMatch(res.data.family.id, /^[A-Za-z0-9]{20}$/);
  assert(res.data.family.id !== res.data.family.feedId);
});

Deno.test("creates a German family with localized presets", async () => {
  const { call } = await setup();
  const res = await call("POST", "/families", { lang: "de", year: 2026 });
  assertEquals(res.status, 201);
  assertEquals(res.data.family.name, "Familie");
  assertEquals(res.data.types.map((t: any) => [t.id, t.name]), [
    ["holiday", "Feiertag"],
    ["vacation", "Urlaub"],
    ["sick", "Krank"],
  ]);
  assertEquals(res.data.types.map((t: any) => t.role), ["day_off", "covers", "none"]);
  // Ids stay stable, so API references keep working.
  const entry = await call("POST", `/families/${res.data.family.id}/entries`, {
    type: "vacation",
    dates: ["2026-08-03"],
  });
  assertEquals(entry.status, 200);

  const en = await call("POST", "/families", {});
  assertEquals(en.data.family.name, "Family");

  const custom = await call("POST", "/families", {
    lang: "de",
    types: [{ name: "Kita zu", color: "#8b5cf6", role: "needs_cover" }],
  });
  assertEquals(custom.data.family.name, "Familie");
  assertEquals(custom.data.types.map((t: any) => t.name), ["Kita zu"]);
});

Deno.test("rejects an unknown lang", async () => {
  const { call } = await setup();
  for (const lang of ["fr", "DE", 1, null]) {
    const res = await call("POST", "/families", { lang });
    assertEquals(res.status, 400);
    assertEquals(res.data.error, "lang must be en or de");
  }
});

Deno.test("adds, removes, sets and clears entries", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  const post = (body: unknown) => call("POST", `/families/${s.id}/entries`, body);

  assertEquals(
    (await post({ action: "add", type: "Vacation", from: "2026-08-03", to: "2026-08-09" })).status,
    200,
  );
  await post({ action: "add", type: "sick", dates: ["2026-08-04"] });
  let state = (await call("GET", `/families/${s.id}?year=2026`)).data;
  assertEquals(Object.keys(state.entries).length, 7);
  assertEquals(state.entries["2026-08-04"].sort(), ["sick", "vacation"]);

  await post({
    ops: [
      { action: "remove", type: "vacation", dates: ["2026-08-04"] },
      { action: "set", types: ["holiday"], dates: ["2026-08-05"] },
      { action: "clear", from: "2026-08-08", to: "2026-08-09" },
    ],
  });
  state = (await call("GET", `/families/${s.id}?year=2026`)).data;
  assertEquals(state.entries["2026-08-04"], ["sick"]);
  assertEquals(state.entries["2026-08-05"], ["holiday"]);
  assertEquals(state.entries["2026-08-08"], undefined);
  assertEquals((await call("GET", `/families/${s.id}?year=2025`)).data.entries, {});
});

Deno.test("skipWeekends leaves Saturday and Sunday out", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/entries`, {
    action: "add",
    type: "vacation",
    from: "2026-08-03",
    to: "2026-08-16",
    skipWeekends: true,
  });
  const entries = (await call("GET", `/families/${s.id}/entries?year=2026`)).data;
  assertEquals(Object.keys(entries).length, 10);
});

Deno.test("a viewer can read but not write", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/entries`, { type: "vacation", dates: ["2026-01-05"] });
  await call("POST", `/families/${s.id}/types`, { name: "Remote", color: "#123456", year: 2026 });

  const state = (await s.view("GET", `/families/${s.id}?year=2026`)).data;
  assertEquals(state.family.readOnly, true);
  assertEquals(state.family.access, "view");
  assertEquals(state.types.map((t: any) => t.id), ["holiday", "vacation", "sick", "remote"]);
  assertEquals(state.entries, { "2026-01-05": ["vacation"] });
  assertEquals((await s.view("GET", `/families/${s.id}/entries`)).data, {
    "2026-01-05": ["vacation"],
  });
  assertEquals((await s.view("GET", `/families/${s.id}/types?year=2026`)).data.length, 4);

  const writes: [string, string, unknown?][] = [
    ["POST", "/entries", { type: "vacation", dates: ["2026-01-02"] }],
    ["PATCH", "", { name: "Hijacked" }],
    ["POST", "/types", { name: "X", color: "#000000" }],
    ["PATCH", "/types/vacation?year=2026", { name: "X" }],
    ["DELETE", "/types/vacation?year=2026"],
    ["POST", "/types/copy", { from: 2026, to: 2027 }],
  ];
  for (const [method, path, body] of writes) {
    const res = await s.view(method, `/families/${s.id}${path}`, body);
    assertEquals(res.status, 403);
    assertEquals(res.data.error, "You can only view this family");
  }
  const after = (await call("GET", `/families/${s.id}?year=2026`)).data;
  assertEquals(after.family.name, "Family");
  assertEquals(after.types.length, 4);
  assertEquals(after.entries, { "2026-01-05": ["vacation"] });
});

Deno.test("rejects malformed tokens as not found", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  for (const token of ["abc,def.ghij", "aaaaaaaaaa)", `${s.id},read_id.eq.x`, "short"]) {
    const t = encodeURIComponent(token);
    assertEquals((await call("GET", `/families/${t}`)).status, 404);
    assertEquals((await call("GET", `/families/${t}/entries`)).status, 404);
    assertEquals((await call("PATCH", `/families/${t}`, { name: "X" })).status, 404);
    assertEquals(
      (await call("POST", `/families/${t}/entries`, { type: "vacation", dates: ["2026-01-02"] }))
        .status,
      404,
    );
  }
});

Deno.test("validates input", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  const post = (body: unknown) => call("POST", `/families/${s.id}/entries`, body);
  assertEquals((await post({ type: "vacation", dates: ["2026-02-30"] })).status, 400);
  assertEquals((await post({ type: "nope", dates: ["2026-02-03"] })).status, 404);
  assertEquals((await post({ action: "add", dates: ["2026-02-03"] })).status, 400);
  assertEquals((await call("GET", "/families/doesnotexist123")).status, 404);
  assertEquals(
    (await call("POST", `/families/${s.id}/types`, { name: "X", color: "red" })).status,
    400,
  );
});

Deno.test("manages entry types", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  const created = await call("POST", `/families/${s.id}/types?year=2026`, {
    name: "Day care closed",
    color: "#8B5CF6",
    role: "needs_cover",
  });
  assertEquals(created.status, 201);
  assertEquals(created.data.id, "day-care-closed");
  assertEquals(created.data.year, 2026);
  assertEquals(created.data.color, "#8b5cf6");
  assertEquals(created.data.position, 3);

  const renamed = await call("PATCH", `/families/${s.id}/types/vacation?year=2026`, {
    name: "Vacation Dad",
  });
  assertEquals(renamed.data.name, "Vacation Dad");
  // Names work as references too.
  await call("POST", `/families/${s.id}/entries`, {
    type: "vacation dad",
    dates: ["2026-03-02"],
  });

  await call("DELETE", `/families/${s.id}/types/vacation?year=2026`);
  const state = (await call("GET", `/families/${s.id}`)).data;
  assertEquals(state.types.map((t: any) => t.id), ["holiday", "sick", "day-care-closed"]);
  assertEquals(state.entries, {});
});

Deno.test("renames a family", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  const res = await call("PATCH", `/families/${s.id}`, { name: "Our family" });
  assertEquals(res.status, 200);
  assertEquals(res.data.family.name, "Our family");
  assertEquals(res.data.family.id, s.id);
  assertEquals(res.data.family.readOnly, false);
  assertEquals(res.data.types.length, 3);
  assertEquals((await s.view("GET", `/families/${s.id}`)).data.family.name, "Our family");
});

Deno.test("serves an iCalendar feed with merged ranges and gaps", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/types`, {
    name: "Day care closed",
    color: "#8b5cf6",
    role: "needs_cover",
    year: 2026,
  });
  await call("POST", `/families/${s.id}/entries`, {
    ops: [
      { action: "add", type: "day-care-closed", from: "2026-08-03", to: "2026-08-07" },
      { action: "add", type: "vacation", from: "2026-08-03", to: "2026-08-05" },
    ],
  });
  const res = await call("GET", `/families/${s.feedId}/calendar.ics?gaps=1`);
  assertEquals(res.status, 200);
  assertMatch(res.headers.get("content-type")!, /^text\/calendar/);
  const ics: string = res.data;
  assert(ics.includes("SUMMARY:Vacation\r\n"));
  assert(ics.includes("DTSTART;VALUE=DATE:20260803\r\nDTEND;VALUE=DATE:20260806"));
  assert(ics.includes("SUMMARY:⚠ Not covered: Day care closed"));
  assert(ics.includes("DTSTART;VALUE=DATE:20260806\r\nDTEND;VALUE=DATE:20260808"));

  const onlyVacation =
    (await call("GET", `/families/${s.feedId}/calendar.ics?types=vacation`)).data;
  assert(!onlyVacation.includes("Day care closed"));
  assertEquals(onlyVacation.match(/BEGIN:VEVENT/g).length, 1);
});

Deno.test("serves a German iCalendar feed with ?lang=de", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/types`, {
    name: "Kita zu",
    color: "#8b5cf6",
    role: "needs_cover",
    year: 2026,
  });
  await call("POST", `/families/${s.id}/entries`, {
    ops: [
      { action: "add", type: "kita-zu", from: "2026-08-06", to: "2026-08-07" },
      { action: "add", type: "vacation", from: "2026-08-07", to: "2026-08-09" },
    ],
  });
  const de: string = (await call("GET", `/families/${s.feedId}/calendar.ics?gaps=1&lang=de`))
    .data;
  assert(de.includes("SUMMARY:⚠ Nicht abgedeckt: Kita zu\r\n"));
  assert(de.includes("DESCRIPTION:Vacation: 3 Tage (1 Arbeitstag)\r\n"));

  // Unknown languages fall back to English instead of breaking the feed.
  const fallback = await call("GET", `/families/${s.feedId}/calendar.ics?gaps=1&lang=xx`);
  assertEquals(fallback.status, 200);
  assert(fallback.data.includes("SUMMARY:⚠ Not covered: Kita zu\r\n"));
  assert(fallback.data.includes("DESCRIPTION:Vacation: 3 days (1 workdays)\r\n"));
});

Deno.test("sets, replaces and clears day notes", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  const post = (body: unknown) => call("POST", `/families/${s.id}/notes`, body);

  let res = await post({
    icon: " 🎄 ",
    comment: " Christmas ",
    from: "2026-12-24",
    to: "2026-12-26",
  });
  assertEquals(res.status, 200);
  assertEquals(res.data, { ok: true, ops: 1, days: 3 });
  assertEquals((await call("GET", `/families/${s.id}/notes?year=2026`)).data, {
    "2026-12-24": { icon: "🎄", comment: "Christmas" },
    "2026-12-25": { icon: "🎄", comment: "Christmas" },
    "2026-12-26": { icon: "🎄", comment: "Christmas" },
  });

  res = await post({
    ops: [
      // "set" replaces the whole note: no comment given means "".
      { action: "set", icon: "🎁", dates: ["2026-12-24"] },
      { action: "clear", date: "2026-12-26" },
      // Both empty after trimming behaves like "clear".
      { icon: " ", comment: "", date: "2026-12-25" },
      { comment: "Easter", from: "2026-04-03", to: "2026-04-06" },
    ],
  });
  assertEquals(res.data, { ok: true, ops: 4, days: 7 });
  const notes = (await call("GET", `/families/${s.id}/notes?from=2026-12-01&to=2026-12-31`)).data;
  assertEquals(notes, { "2026-12-24": { icon: "🎁", comment: "" } });
  assertEquals(
    Object.keys((await call("GET", `/families/${s.id}/notes?year=2026`)).data).length,
    5,
  );
  assertEquals((await call("GET", `/families/${s.id}/notes?year=2025`)).data, {});
});

Deno.test("note ops skip weekends like entry ops", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  const res = await call("POST", `/families/${s.id}/notes`, {
    icon: "🏖",
    from: "2026-08-03",
    to: "2026-08-16",
    skipWeekends: true,
  });
  assertEquals(res.data.days, 10);
  const notes = (await call("GET", `/families/${s.id}/notes`)).data;
  assertEquals(Object.keys(notes).length, 10);
  assertEquals(notes["2026-08-08"], undefined);
});

Deno.test("family state includes notes for the requested range", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/notes`, {
    ops: [
      { icon: "🎄", comment: "Christmas", date: "2026-12-25" },
      { icon: "🎆", date: "2025-12-31" },
    ],
  });
  const state = (await call("GET", `/families/${s.id}?year=2026`)).data;
  assertEquals(state.notes, { "2026-12-25": { icon: "🎄", comment: "Christmas" } });
  // Viewers read notes too.
  const view = (await s.view("GET", `/families/${s.id}?from=2025-12-01&to=2025-12-31`)).data;
  assertEquals(view.notes, { "2025-12-31": { icon: "🎆", comment: "" } });
  assertEquals(
    Object.keys((await s.view("GET", `/families/${s.id}/notes`)).data),
    ["2025-12-31", "2026-12-25"],
  );
  assertEquals((await call("POST", "/families", {})).data.notes, {});
});

Deno.test("notes and entries are independent", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/entries`, { type: "holiday", date: "2026-12-25" });
  await call("POST", `/families/${s.id}/notes`, { comment: "Christmas", date: "2026-12-25" });

  await call("POST", `/families/${s.id}/entries`, { action: "clear", date: "2026-12-25" });
  let state = (await call("GET", `/families/${s.id}?year=2026`)).data;
  assertEquals(state.entries, {});
  assertEquals(state.notes, { "2026-12-25": { icon: "", comment: "Christmas" } });

  await call("POST", `/families/${s.id}/entries`, { type: "holiday", date: "2026-12-25" });
  await call("POST", `/families/${s.id}/notes`, { action: "clear", date: "2026-12-25" });
  state = (await call("GET", `/families/${s.id}?year=2026`)).data;
  assertEquals(state.entries, { "2026-12-25": ["holiday"] });
  assertEquals(state.notes, {});
});

Deno.test("a viewer cannot change notes", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  const res = await s.view("POST", `/families/${s.id}/notes`, {
    icon: "🎄",
    date: "2026-12-25",
  });
  assertEquals(res.status, 403);
  assertEquals(res.data.error, "You can only view this family");
});

Deno.test("validates note ops", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  const post = (body: unknown) => call("POST", `/families/${s.id}/notes`, body);
  const cases: [unknown, string][] = [
    [{ action: "add", icon: "🎄", date: "2026-12-25" }, "action must be set or clear"],
    [{ date: "2026-12-25" }, '"set" needs "icon" or "comment"'],
    [{ icon: 1, date: "2026-12-25" }, "icon must be a string"],
    [{ comment: null, date: "2026-12-25" }, "comment must be a string"],
    [{ icon: "🎄".repeat(9), date: "2026-12-25" }, "icon is too long (max. 16)"],
    [{ comment: "x".repeat(501), date: "2026-12-25" }, "comment is too long (max. 500)"],
    [{ icon: "🎄", dates: ["2026-02-30"] }, 'Invalid date "2026-02-30" (use YYYY-MM-DD)'],
    [{ icon: "🎄", dates: "2026-12-25" }, "dates must be an array"],
    [{ icon: "🎄", from: "2026-12-25", to: "nope" }, "from/to must be YYYY-MM-DD"],
    [{ icon: "🎄" }, 'Op needs "dates" or "from"/"to"'],
    [{ ops: [1] }, "Each op must be an object"],
    [{ icon: "🎄", from: "2020-01-01", to: "2026-12-31" }, "Range is too long"],
    [
      {
        ops: [1, 2, 3, 4].map((y) => ({
          icon: "🎄",
          from: `202${y}-01-01`,
          to: `202${y + 2}-12-31`,
        })),
      },
      "Too many days in one request",
    ],
  ];
  for (const [body, error] of cases) {
    const res = await post(body);
    assertEquals([res.status, res.data.error], [400, error]);
  }
  // Limits are inclusive; a flag (2 code points, 4 UTF-16 units) fits easily.
  const ok = await post({ icon: "🇩🇪", comment: "x".repeat(500), date: "2026-10-03" });
  assertEquals(ok.status, 200);
  // Nothing was written by the failed requests.
  assertEquals(Object.keys((await call("GET", `/families/${s.id}/notes`)).data), ["2026-10-03"]);
});

Deno.test("adds notes to the iCalendar feed only with ?notes=1", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/entries`, { type: "holiday", date: "2026-12-25" });
  await call("POST", `/families/${s.id}/notes`, {
    ops: [
      { icon: "🎄", comment: "Christmas", from: "2026-12-24", to: "2026-12-26" },
      { icon: "🎆", comment: "New Year's Eve, party", date: "2026-12-31" },
    ],
  });
  const plain: string = (await call("GET", `/families/${s.feedId}/calendar.ics`)).data;
  assertEquals(plain.match(/BEGIN:VEVENT/g)!.length, 1);
  assert(!plain.includes("Christmas"));

  const ics: string = (await call("GET", `/families/${s.feedId}/calendar.ics?notes=1`)).data;
  assertEquals(ics.match(/BEGIN:VEVENT/g)!.length, 3);
  assert(ics.includes("SUMMARY:🎄 Christmas\r\n"));
  assert(ics.includes("DTSTART;VALUE=DATE:20261224\r\nDTEND;VALUE=DATE:20261227"));
  assert(ics.includes(`UID:${s.feedId}-note-2026-12-24@vacation-planner`));
  assert(ics.includes("SUMMARY:🎆 New Year's Eve\\, party\r\n"));
  // Type filters don't hide notes.
  const filtered: string =
    (await call("GET", `/families/${s.feedId}/calendar.ics?types=sick&notes=1`)).data;
  assertEquals(filtered.match(/BEGIN:VEVENT/g)!.length, 2);
});

Deno.test("every year has its own entry types", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  const types = `/families/${s.id}/types`;
  const state = (year: number) => call("GET", `/families/${s.id}?year=${year}`);

  // A year without types of its own has none, and its days can't use other years' types.
  assertEquals((await state(2027)).data.types, []);
  assertEquals((await state(2027)).data.typeYears, [2026]);
  const missing = await call("POST", `/families/${s.id}/entries`, {
    type: "vacation",
    dates: ["2027-01-04"],
  });
  assertEquals([missing.status, missing.data.error], [
    404,
    'Unknown entry type "vacation" in 2027',
  ]);

  // Copying keeps ids, names, colors, roles and order.
  const copied = await call("POST", `${types}/copy`, { from: 2026, to: 2027 });
  assertEquals(copied.status, 200);
  assertEquals(copied.data.map((t: any) => [t.id, t.year, t.position]), [
    ["holiday", 2027, 0],
    ["vacation", 2027, 1],
    ["sick", 2027, 2],
  ]);
  assertEquals((await state(2027)).data.typeYears, [2026, 2027]);

  // Changes stay within their year.
  await call("PATCH", `${types}/vacation?year=2027`, { name: "Vacation Mom", color: "#0ea5e9" });
  await call("POST", types, { name: "Day care closed", color: "#8b5cf6", year: 2027 });
  await call("DELETE", `${types}/sick?year=2026`);
  assertEquals((await call("GET", `${types}?year=2026`)).data.map((t: any) => t.name), [
    "Holiday",
    "Vacation",
  ]);
  assertEquals((await call("GET", `${types}?year=2027`)).data.map((t: any) => t.name), [
    "Holiday",
    "Vacation Mom",
    "Sick",
    "Day care closed",
  ]);

  // A copy only adds what the target year doesn't have yet.
  const again = await call("POST", `${types}/copy`, { from: 2027, to: 2026 });
  assertEquals(again.data.map((t: any) => [t.id, t.name]), [
    ["holiday", "Holiday"],
    ["vacation", "Vacation"],
    ["sick", "Sick"],
    ["day-care-closed", "Day care closed"],
  ]);

  // Without a year filter, the state has the types of every year.
  const all = (await call("GET", `/families/${s.id}`)).data;
  assertEquals(all.types.length, 8);
  const range = (await call("GET", `/families/${s.id}?from=2026-12-01&to=2027-01-31`)).data;
  assertEquals(range.types.length, 8);
  assertEquals((await call("GET", `/families/${s.id}?year=2028`)).data.types, []);

  const errors: [unknown, number, string][] = [
    [{ from: 2025, to: 2026 }, 404, "2025 has no entry types"],
    [{ from: "26", to: 2027 }, 400, "from must be YYYY"],
    [{ from: 2026 }, 400, "to must be YYYY"],
  ];
  for (const [body, status, error] of errors) {
    const res = await call("POST", `${types}/copy`, body);
    assertEquals([res.status, res.data.error], [status, error]);
  }
  assertEquals((await call("GET", `${types}?year=nope`)).status, 400);
});

Deno.test("resolves type references per year of each day", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/types`, { name: "Urlaub", color: "#22c55e", year: 2027 });
  // "Urlaub" is "vacation" in 2026 (renamed) and "urlaub" in 2027.
  await call("PATCH", `/families/${s.id}/types/vacation?year=2026`, { name: "Urlaub" });
  const res = await call("POST", `/families/${s.id}/entries`, {
    type: "urlaub",
    from: "2026-12-31",
    to: "2027-01-01",
  });
  assertEquals(res.data, { ok: true, ops: 1, days: 2 });
  assertEquals((await call("GET", `/families/${s.id}/entries`)).data, {
    "2026-12-31": ["vacation"],
    "2027-01-01": ["urlaub"],
  });

  // Deleting a type removes only its own year's entries.
  await call("POST", `/families/${s.id}/types/copy`, { from: 2026, to: 2027 });
  await call("POST", `/families/${s.id}/entries`, { type: "vacation", date: "2027-01-04" });
  await call("DELETE", `/families/${s.id}/types/vacation?year=2027`);
  assertEquals((await call("GET", `/families/${s.id}/entries`)).data, {
    "2026-12-31": ["vacation"],
    "2027-01-01": ["urlaub"],
  });
});

Deno.test("the iCalendar feed uses each year's types", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/types/copy`, { from: 2026, to: 2027 });
  await call("PATCH", `/families/${s.id}/types/vacation?year=2027`, {
    name: "Day care closed",
    role: "needs_cover",
  });
  await call("POST", `/families/${s.id}/entries`, {
    ops: [
      { type: "vacation", date: "2026-08-03" },
      { type: "vacation", date: "2027-08-02" },
    ],
  });
  const ics: string = (await call("GET", `/families/${s.feedId}/calendar.ics?gaps=1`)).data;
  assert(ics.includes("SUMMARY:Vacation\r\nDESCRIPTION:Vacation\r\n"));
  assert(ics.includes(`UID:${s.feedId}-vacation-2027-08-02@vacation-planner`));
  assert(ics.includes("SUMMARY:Day care closed\r\n"));
  // Only the 2027 day needs cover.
  assert(
    ics.includes(
      "SUMMARY:⚠ Not covered: Day care closed\r\nDESCRIPTION:⚠ Not covered: Day care closed\r\n",
    ),
  );
  assertEquals(ics.match(/DTSTART;VALUE=DATE:20270802/g)!.length, 2);

  // A filter matches by id or name in every year.
  const byName: string =
    (await call("GET", `/families/${s.feedId}/calendar.ics?types=day%20care%20closed`)).data;
  assertEquals(byName.match(/BEGIN:VEVENT/g)!.length, 1);
  const byId: string = (await call("GET", `/families/${s.feedId}/calendar.ics?types=vacation`))
    .data;
  assertEquals(byId.match(/BEGIN:VEVENT/g)!.length, 2);
  assertEquals((await call("GET", `/families/${s.feedId}/calendar.ics?types=nope`)).status, 404);
});

Deno.test("answers CORS preflight", async () => {
  const handler = createHandler(new MemoryStore());
  const res = await handler(new Request(BASE + "/families", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});

Deno.test("agent page describes the planner with ready-to-use URLs", async () => {
  const { call } = await setup();
  // Types only in 2025: the examples use that year instead of the current one.
  const created = await call("POST", "/families", { name: "Family", year: 2025 });
  const s = created.data.family;
  const res = await call("GET", `/families/${s.id}/agent`);
  assertEquals(res.status, 200);
  assertMatch(res.headers.get("content-type")!, /^text\/markdown/);
  assertEquals(res.headers.get("cache-control"), "no-store");
  const doc: string = res.data;
  assert(doc.includes("Family"));
  assert(doc.includes("full edit access"));
  assert(doc.includes(`POST ${BASE}/families/${s.id}/entries`));
  assert(doc.includes("| `vacation` | Vacation | covers | #22c55e |"));
  // The example body in the page works against the real endpoint.
  const body = JSON.parse(/-d '(\{.*\})'/.exec(doc)![1]);
  assertEquals(body.from, "2025-08-03");
  const add = await call("POST", `/families/${s.id}/entries`, body);
  assertEquals(add.status, 200);
  const entries = await call("GET", `/families/${s.id}/entries?year=2025`);
  assert(entries.data["2025-08-04"].includes("vacation"));
});

Deno.test("agent page for a viewer has no write requests", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  const res = await s.view("GET", `/families/${s.id}/agent`);
  assertEquals(res.status, 200);
  assert(res.data.includes("can only **view**"));
  assert(res.data.includes("Authorization: Bearer"));
  assert(!res.data.includes("POST"));
});

Deno.test("agent page only answers GET and doesn't run requests", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  let res = await call("POST", `/families/${s.id}/agent`, {});
  assertEquals(res.status, 405);
  const body = encodeURIComponent(JSON.stringify({ type: "vacation", date: "2026-03-02" }));
  res = await call("GET", `/families/${s.id}/agent/entries?method=POST&body=${body}`);
  assertEquals(res.status, 404);
  res = await call("GET", `/families/${s.id}/agent?method=PATCH&body=%7B%22name%22%3A%22x%22%7D`);
  assertEquals(res.status, 200);
  const state = await call("GET", `/families/${s.id}?year=2026`);
  assertEquals(state.data.family.name, "Family");
  assertEquals(state.data.entries, {});
  res = await call("GET", `/families/nosuchsession1234/agent`);
  assertEquals(res.status, 404);
});

Deno.test("clones a planner with all years, types, entries and notes", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/types/copy`, { from: 2026, to: 2027 });
  await call("POST", `/families/${s.id}/entries`, {
    ops: [
      { type: "vacation", dates: ["2026-08-03"] },
      { type: "holiday", dates: ["2027-01-01"] },
    ],
  });
  await call("POST", `/families/${s.id}/notes`, { icon: "🎄", date: "2026-12-25" });

  const res = await call("POST", `/families/${s.id}/clone`, {});
  assertEquals(res.status, 201);
  const copy = res.data.family;
  assertEquals(copy.name, "Family (copy)");
  assertEquals(copy.readOnly, false);
  assert(copy.id !== s.id && copy.feedId !== s.feedId);
  assertEquals(res.data.typeYears, [2026, 2027]);

  const all = (await call("GET", `/families/${copy.id}`)).data;
  assertEquals(all.entries, { "2026-08-03": ["vacation"], "2027-01-01": ["holiday"] });
  assertEquals(all.notes, { "2026-12-25": { icon: "🎄", comment: "" } });

  // The copy is independent of the original.
  await call("POST", `/families/${copy.id}/entries`, { action: "clear", date: "2026-08-03" });
  await call("PATCH", `/families/${copy.id}/types/sick?year=2026`, { name: "Ill" });
  const original = (await call("GET", `/families/${s.id}?year=2026`)).data;
  assertEquals(original.entries, { "2026-08-03": ["vacation"] });
  assertEquals(original.types.find((t: any) => t.id === "sick").name, "Sick");
});

Deno.test("a viewer can clone, and the copy is theirs to edit", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/entries`, { type: "vacation", date: "2026-05-04" });
  const res = await s.view("POST", `/families/${s.id}/clone`, { name: "Mine" });
  assertEquals(res.status, 201);
  assertEquals(res.data.family.name, "Mine");
  assertEquals(res.data.entries, { "2026-05-04": ["vacation"] });
  assertEquals(res.data.family.access, "edit");
  const edit = await s.view("POST", `/families/${res.data.family.id}/entries`, {
    type: "sick",
    date: "2026-05-05",
  });
  assertEquals(edit.status, 200);
});

Deno.test("clone validates its input", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  assertEquals((await call("POST", "/families/unknownToken123/clone", {})).status, 404);
  assertEquals((await call("GET", `/families/${s.id}/clone`)).status, 405);
  assertEquals((await call("POST", `/families/${s.id}/clone`, { name: "" })).status, 400);
  const long = await call("PATCH", `/families/${s.id}`, { name: "x".repeat(80) });
  assertEquals(long.status, 200);
  const res = await call("POST", `/families/${s.id}/clone`, {});
  assertEquals(res.data.family.name, "x".repeat(73) + " (copy)");
});

Deno.test("exports a planner and imports the file over another one", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/types/copy`, { from: 2026, to: 2027 });
  await call("PATCH", `/families/${s.id}/types/sick?year=2027`, { name: "Ill", position: 7 });
  await call("POST", `/families/${s.id}/entries`, {
    ops: [
      { types: ["vacation", "sick"], dates: ["2026-08-03"] },
      { type: "holiday", dates: ["2027-01-01"] },
    ],
  });
  await call("POST", `/families/${s.id}/notes`, {
    icon: "🎄",
    comment: "Xmas",
    date: "2026-12-25",
  });

  // The view-only id may export; the file never contains the planner's ids.
  const res = await s.view("GET", `/families/${s.id}/export`);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-disposition"), 'attachment; filename="family.json"');
  const file = res.data;
  assertEquals(file.format, "family-planner");
  assertEquals(file.version, 2);
  assertEquals(file.name, "Family");
  assertEquals(file.types.length, 6);
  assertEquals(file.entries, { "2026-08-03": ["vacation", "sick"], "2027-01-01": ["holiday"] });
  assertEquals(file.notes, { "2026-12-25": { icon: "🎄", comment: "Xmas" } });
  const text = JSON.stringify(file);
  assert(!text.includes(s.id) && !text.includes(s.feedId));

  // Importing replaces everything of the target, but keeps its name and links.
  const target = (await call("POST", "/families", { name: "Other", year: 2028 })).data.family;
  await call("POST", `/families/${target.id}/types?year=2028`, { name: "Gone", color: "#000000" });
  await call("POST", `/families/${target.id}/entries`, { type: "gone", date: "2028-03-01" });
  await call("POST", `/families/${target.id}/notes`, { icon: "👻", date: "2028-03-02" });
  const imported = await call("POST", `/families/${target.id}/import?year=2027`, file);
  assertEquals(imported.status, 200);
  assertEquals(imported.data.family.id, target.id);
  assertEquals(imported.data.family.name, "Other");
  assertEquals(imported.data.typeYears, [2026, 2027]);
  assertEquals(imported.data.entries, { "2027-01-01": ["holiday"] });

  const all = (await call("GET", `/families/${target.id}`)).data;
  const original = (await call("GET", `/families/${s.id}`)).data;
  assertEquals(all.types, original.types);
  assertEquals(all.entries, original.entries);
  assertEquals(all.notes, original.notes);
  assertEquals((await call("GET", `/families/${target.id}/export`)).data.types, file.types);
});

Deno.test("import needs the edit id and validates the file", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  const type = { year: 2026, id: "vacation", name: "Vacation", color: "#22c55e", role: "covers" };
  const file = { format: "vacation-planner", version: 1, name: "Imported", types: [type] };
  const path = `/families/${s.id}/import`;
  const status = async (body: unknown) => (await call("POST", path, body)).status;

  assertEquals((await s.view("POST", `/families/${s.id}/import`, file)).status, 403);
  assertEquals((await call("POST", "/families/unknownToken123/import", file)).status, 404);
  assertEquals((await call("GET", path)).status, 405);
  assertEquals(await status({ ...file, format: "other" }), 400);
  assertEquals(await status({ ...file, version: 3 }), 400);
  assertEquals(await status({ ...file, types: {} }), 400);
  assertEquals(await status({ ...file, types: [type, type] }), 400);
  assertEquals(await status({ ...file, types: [{ ...type, id: "../x" }] }), 400);
  assertEquals(await status({ ...file, types: [{ ...type, color: "red" }] }), 400);
  assertEquals(await status({ ...file, types: [{ ...type, role: "boss" }] }), 400);
  assertEquals(await status({ ...file, types: [{ ...type, year: 26 }] }), 400);
  // Entries can only use the types of their own year.
  assertEquals(await status({ ...file, entries: { "2027-08-03": ["vacation"] } }), 400);
  assertEquals(await status({ ...file, entries: { "2026-02-30": ["vacation"] } }), 400);
  assertEquals(await status({ ...file, entries: { "2026-08-03": "vacation" } }), 400);
  assertEquals(await status({ ...file, entries: { "2026-08-03": [1] } }), 400);
  assertEquals(await status({ ...file, notes: { "2026-12-25": "🎄" } }), 400);
  assertEquals(
    await status({ ...file, notes: { "2026-12-25": { comment: "x".repeat(501) } } }),
    400,
  );

  // A rejected file changes nothing.
  const before = (await call("GET", `/families/${s.id}`)).data;
  assertEquals(before.types.map((t: any) => t.id), ["holiday", "vacation", "sick"]);

  // Empty notes are dropped.
  const res = await call("POST", `${path}?year=2026`, {
    ...file,
    entries: { "2026-08-03": ["vacation"] },
    notes: { "2026-12-24": { icon: "", comment: " " }, "2026-12-25": { icon: "🎄" } },
  });
  assertEquals(res.status, 200);
  assertEquals(res.data.entries, { "2026-08-03": ["vacation"] });
  assertEquals(res.data.notes, { "2026-12-25": { icon: "🎄", comment: "" } });
});

const SMALL_LIMITS = {
  create: { max: 2, seconds: 3600 },
  createAll: { max: 5, seconds: 3600 },
  write: { max: 3, seconds: 3600 },
  ai: { max: 100, seconds: 3600 },
  aiFamily: { max: 100, seconds: 3600 },
  login: { max: 100, seconds: 3600 },
  loginAccount: { max: 100, seconds: 3600 },
};

Deno.test("limits how many planners one client creates", async () => {
  const { call } = await setup({ rateLimiter: new MemoryRateLimiter(), limits: SMALL_LIMITS });
  const s = await newFamily(call);
  // Cloning counts as creating.
  assertEquals((await call("POST", `/families/${s.id}/clone`, {})).status, 201);
  const res = await call("POST", "/families", {});
  assertEquals(res.status, 429);
  assertMatch(res.data.error, /^Too many requests/);
  const retry = Number(res.headers.get("retry-after"));
  assert(retry > 0 && retry <= 3600);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
  assertEquals((await call("POST", `/families/${s.id}/clone`, {})).status, 429);
  // Other clients and reads are not affected.
  assertEquals((await call("POST", "/families", {}, "198.51.100.1")).status, 201);
  assertEquals((await call("GET", `/families/${s.id}`)).status, 200);
});

Deno.test("limits planners of all clients together", async () => {
  const { call } = await setup({ rateLimiter: new MemoryRateLimiter(), limits: SMALL_LIMITS });
  for (let i = 0; i < 5; i++) {
    assertEquals((await call("POST", "/families", {}, `198.51.100.${i}`)).status, 201);
  }
  assertEquals((await call("POST", "/families", {}, "198.51.100.99")).status, 429);
});

Deno.test("limits writes per client, but not reads", async () => {
  const limiter = new MemoryRateLimiter();
  const { call } = await setup({ rateLimiter: limiter, limits: SMALL_LIMITS });
  const s = await newFamily(call);
  const write = (ip?: string) =>
    call("POST", `/families/${s.id}/entries`, { type: "vacation", date: "2026-03-02" }, ip);
  for (let i = 0; i < 3; i++) assertEquals((await write()).status, 200);
  assertEquals((await write()).status, 429);
  assertEquals((await call("PATCH", `/families/${s.id}`, { name: "x" })).status, 429);
  assertEquals((await write("198.51.100.1")).status, 200);
  for (let i = 0; i < 10; i++) {
    assertEquals((await call("GET", `/families/${s.feedId}/calendar.ics`)).status, 200);
  }
});

Deno.test("the write window resets", async () => {
  let now = Date.UTC(2026, 0, 1);
  const { call } = await setup({
    rateLimiter: new MemoryRateLimiter(() => now),
    limits: { ...SMALL_LIMITS, write: { max: 1, seconds: 60 } },
  });
  const s = await newFamily(call);
  const write = () => call("PATCH", `/families/${s.id}`, { name: "x" });
  assertEquals((await write()).status, 200);
  assertEquals((await write()).status, 429);
  now += 60_000;
  assertEquals((await write()).status, 200);
});

Deno.test("a failing rate limiter lets requests through", async () => {
  const broken: RateLimiter = { hit: () => Promise.reject(new Error("db down")) };
  const { call } = await setup({ rateLimiter: broken, limits: SMALL_LIMITS });
  const error = console.error;
  console.error = () => {};
  try {
    for (let i = 0; i < 3; i++) assertEquals((await call("POST", "/families", {})).status, 201);
  } finally {
    console.error = error;
  }
});

Deno.test("default limits leave room for normal use", () => {
  assert(RATE_LIMITS.create.max >= 10);
  assert(RATE_LIMITS.write.max / RATE_LIMITS.write.seconds >= 0.5);
});

Deno.test("clientAddress keys IPv4 by address and IPv6 by /64 network", () => {
  const req = (headers: Record<string, string>) => new Request(BASE, { headers });
  assertEquals(clientAddress(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assertEquals(clientAddress(req({ "x-forwarded-for": "::ffff:203.0.113.7" })), "203.0.113.7");
  assertEquals(clientAddress(req({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assertEquals(clientAddress(req({})), "unknown");
  assertEquals(
    clientAddress(req({ "x-forwarded-for": "2001:0DB8:0a:1:abcd::1" })),
    "2001:db8:a:1::/64",
  );
  assertEquals(clientAddress(req({ "x-forwarded-for": "2001:db8::1" })), "2001:db8:0:0::/64");
  assertEquals(clientAddress(req({ "x-forwarded-for": "::1" })), "0:0:0:0::/64");
});

Deno.test("a memory store snapshot restores families, types, entries and notes", async () => {
  const { store, handler, owner } = await setup();
  const call = async (method: string, path: string, body?: unknown, h = handler) => {
    const res = await h(
      new Request(BASE + path, {
        method,
        headers: {
          authorization: `Bearer ${owner.token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return await res.json();
  };
  const { family } = await call("POST", "/families", { name: "Family", year: 2026 });
  await call("POST", `/families/${family.id}/entries`, {
    action: "add",
    type: "vacation",
    from: "2026-08-03",
    to: "2026-08-05",
  });
  await call("POST", `/families/${family.id}/notes`, { icon: "🎄", date: "2026-12-24" });
  const before = await call("GET", `/families/${family.id}?year=2026`);

  const restored = new MemoryStore();
  restored.restore(JSON.parse(JSON.stringify(store.snapshot())));
  const after = await call(
    "GET",
    `/families/${family.id}?year=2026`,
    undefined,
    createHandler(restored),
  );
  assertEquals(after, before);
  assertEquals(Object.keys(after.entries).length, 3);
});

Deno.test("/sessions stays an alias of /families", async () => {
  const { call } = await setup();
  const res = await call("POST", "/sessions", { name: "Old script", year: 2026 });
  assertEquals(res.status, 201);
  // Scripts from before families read "session".
  assertEquals(res.data.session, res.data.family);
  const id = res.data.family.id;
  const add = await call("POST", `/sessions/${id}/entries`, {
    type: "vacation",
    dates: ["2026-08-03"],
  });
  assertEquals(add.status, 200);
  const read = await call("GET", `/families/${id}/entries?year=2026`);
  assertEquals(read.data, { "2026-08-03": ["vacation"] });
  const feed = await call("GET", `/sessions/${res.data.family.feedId}/calendar.ics`);
  assertEquals(feed.status, 200);
});

Deno.test("each member only gets what their role allows", async () => {
  const { call } = await setup();
  const s = await newFamily(call);
  for (const token of [s.id, s.feedId]) assertMatch(token, /^[A-Za-z0-9]{20}$/);
  assert(s.id !== s.feedId);

  const edit = (await call("GET", `/families/${s.id}`)).data.family;
  assertEquals(edit.access, "edit");
  assertEquals([edit.id, edit.feedId], [s.id, s.feedId]);

  const view = (await s.view("GET", `/families/${s.id}`)).data.family;
  assertEquals(view.access, "view");
  assertEquals(view.readOnly, true);
  assertEquals([view.id, view.feedId], [s.id, s.feedId]);

  // The feed id opens the calendar feed and nothing else, signed in or not.
  assertEquals((await call.as(null)("GET", `/families/${s.feedId}/calendar.ics`)).status, 200);
  for (const path of ["", "/entries", "/notes", "/types", "/agent", "/export"]) {
    assertEquals((await call("GET", `/families/${s.feedId}${path}`)).status, 404, path);
  }
  assertEquals((await call("POST", `/families/${s.feedId}/clone`)).status, 404);
});

Deno.test("everything but the calendar feed needs signing in", async () => {
  const { call, as } = await setup();
  const s = await newFamily(call);
  const anon = as(null);
  for (const path of ["", "/entries", "/types", "/agent", "/export", "/finance", "/members"]) {
    const res = await anon("GET", `/families/${s.id}${path}`);
    assertEquals(res.status, 401, path);
    assertEquals(res.data.error, "Sign in first");
  }
  assertEquals((await anon("POST", "/families", {})).status, 401);
  assertEquals((await anon("POST", `/families/${s.id}/entries`, { type: "x" })).status, 401);
  // The edit id of old is no calendar feed any more: it's in every URL of the app.
  assertEquals((await anon("GET", `/families/${s.id}/calendar.ics`)).status, 404);
  // A wrong or ended session says so.
  const bad = await as("fps_nonsense")("GET", `/families/${s.id}`);
  assertEquals(bad.status, 401);
  assertEquals(bad.data.error, "Your session has ended, sign in again");
});

Deno.test("families of others look like no family at all", async () => {
  const { call, store, as } = await setup();
  const s = await newFamily(call);
  const other = as((await addUser(store, "other@test")).token);
  assertEquals((await other("GET", `/families/${s.id}`)).status, 404);
  assertEquals((await other("POST", `/families/${s.id}/clone`, {})).status, 404);
  assertEquals((await other("PATCH", `/families/${s.id}`, { name: "Mine" })).status, 404);
  // Admins too: being an admin doesn't open families.
  const admin = as((await addUser(store, "admin2@test", { is_admin: true })).token);
  assertEquals((await admin("GET", `/families/${s.id}/finance`)).status, 404);
});

Deno.test("the view id of a planner from before families keeps its calendar feed", async () => {
  const { call, store, as } = await setup();
  const s = await newFamily(call);
  // What the migration does: the old view id becomes the legacy id.
  await store.updateFamily(s.id, { legacy_id: "OldViewId1234567890" });
  await call("POST", `/families/${s.id}/entries`, { type: "vacation", date: "2026-08-03" });

  // It opens nothing but the feed now.
  assertEquals((await call("GET", "/sessions/OldViewId1234567890?year=2026")).status, 404);
  // Old subscriptions keep their URL and their event ids.
  const ics: string = (await as(null)("GET", "/sessions/OldViewId1234567890/calendar.ics")).data;
  assert(ics.includes("UID:OldViewId1234567890-vacation-2026-08-03@vacation-planner"));
  const viaFeed: string = (await call("GET", `/families/${s.feedId}/calendar.ics`)).data;
  assert(viaFeed.includes("UID:OldViewId1234567890-vacation-2026-08-03@vacation-planner"));
  // Editors see it, so the app can offer to remove it; viewers don't.
  assertEquals(
    (await call("GET", `/families/${s.id}`)).data.family.legacyId,
    "OldViewId1234567890",
  );
  assertEquals((await s.view("GET", `/families/${s.id}`)).data.family.legacyId, undefined);
});

Deno.test("rotates the feed link and removes the legacy link", async () => {
  const { call, store } = await setup();
  const s = await newFamily(call);
  await store.updateFamily(s.id, { legacy_id: "OldViewId1234567890" });

  const feed = await call("POST", `/families/${s.id}/links`, { link: "feed" });
  assertEquals(feed.status, 200);
  const feedId = feed.data.family.feedId;
  assert(feedId !== s.feedId);
  assertEquals((await call("GET", `/families/${s.feedId}/calendar.ics`)).status, 404);
  assertEquals((await call("GET", `/families/${feedId}/calendar.ics`)).status, 200);

  const legacy = await call("POST", `/families/${s.id}/links`, { link: "legacy" });
  assertEquals(legacy.data.family.legacyId, undefined);
  assertEquals((await call("GET", "/families/OldViewId1234567890/calendar.ics")).status, 404);

  assertEquals((await call("POST", `/families/${s.id}/links`, { link: "view" })).status, 400);
  assertEquals((await call("POST", `/families/${s.id}/links`, { link: "edit" })).status, 400);
  assertEquals((await s.view("POST", `/families/${s.id}/links`, { link: "feed" })).status, 403);
  assertEquals((await call("GET", `/families/${s.id}/links`)).status, 405);
});

Deno.test("a memory store snapshot from before families gets a legacy id", () => {
  const store = new MemoryStore();
  const now = "2026-01-01T00:00:00.000Z";
  store.restore(JSON.parse(JSON.stringify([{
    session: {
      id: "EditId123456",
      read_id: "ViewId123456",
      name: "Old",
      created_at: now,
      updated_at: now,
    },
    types: [{
      session_id: "EditId123456",
      year: 2026,
      id: "vacation",
      name: "Vacation",
      color: "#22c55e",
      role: "covers",
      position: 0,
    }],
    entries: ["2026-08-03|vacation"],
    notes: [],
  }])));
  const family = store.families.get("EditId123456")!;
  assertEquals(family.legacy_id, "ViewId123456");
  assertEquals("read_id" in family, false);
  assertMatch(family.feed_id, /^[A-Za-z0-9]{32}$/);
  assertEquals(store.types.get("EditId123456")![0].family_id, "EditId123456");
});

// ------------------------------------------------------------------ finance

async function financeFamily() {
  const { call, store, owner } = await setup();
  const s = await newFamily(call);
  const f = `/families/${s.id}/finance`;
  return { call, store, owner, s, f };
}

Deno.test("new families get default finance categories", async () => {
  const { call, f } = await financeFamily();
  const res = await call("GET", f);
  assertEquals(res.status, 200);
  assertEquals(res.data.currency, "EUR");
  assertEquals(res.data.categories[0], {
    id: "salary",
    name: "Salary",
    color: "#22c55e",
    icon: "💼",
    kind: "income",
    position: 0,
    parentId: null,
  });
  const de = await call("POST", "/families", { lang: "de" });
  const cats = (await call("GET", `/families/${de.data.family.id}/finance`)).data.categories;
  assertEquals(cats.find((c: any) => c.id === "groceries").name, "Lebensmittel");
});

Deno.test("manages finance categories and settings", async () => {
  const { call, store, s, f } = await financeFamily();
  await store.deleteCategory(s.id, "groceries"); // like a family from before finances
  const add = await call("POST", `${f}/categories`, { name: "Pets", color: "#ff0000", icon: "🐶" });
  assertEquals(add.status, 201);
  assertEquals(add.data.id, "pets");
  assertEquals(add.data.kind, "expense");
  const patched = await call("PATCH", `${f}/categories/Pets`, { kind: "both", position: 99 });
  assertEquals([patched.data.kind, patched.data.position], ["both", 99]);
  assertEquals((await call("POST", `${f}/categories`, { name: "X", color: "red" })).status, 400);

  const defaults = await call("POST", `${f}/categories/defaults`, { lang: "en" });
  assert(defaults.data.some((c: any) => c.id === "groceries"));
  assertEquals(defaults.data.filter((c: any) => c.id === "salary").length, 1);

  const settings = await call("PATCH", `${f}/settings`, {
    currency: "CHF",
    csvMappings: [{ signature: "a;b", date: 0 }],
  });
  assertEquals(settings.data.currency, "CHF");
  assertEquals(settings.data.csvMappings, [{ signature: "a;b", date: 0 }]);
  assertEquals((await call("PATCH", `${f}/settings`, { currency: "euro" })).status, 400);
  assertEquals((await s.view("PATCH", `/families/${s.id}/finance/settings`, {})).status, 403);

  assertEquals((await call("DELETE", `${f}/categories/pets`)).status, 200);
  assertEquals((await call("DELETE", `${f}/categories/pets`)).status, 404);
});

Deno.test("nests finance categories to any depth", async () => {
  const { call, s, f } = await financeFamily();
  const food = (await call("POST", `${f}/categories`, { name: "Food", color: "#ff0000" })).data;
  assertEquals(food.parentId, null);
  // Moving a category under another; a subcategory has its top-level category's kind.
  const moved = await call("PATCH", `${f}/categories/groceries`, { parentId: "Food" });
  assertEquals([moved.data.parentId, moved.data.kind], ["food", "expense"]);
  const bakery = await call("POST", `${f}/categories`, {
    name: "Bakery",
    color: "#00ff00",
    kind: "income",
    parentId: "food > GROCERIES",
  });
  assertEquals([bakery.status, bakery.data.parentId, bakery.data.kind], [
    201,
    "groceries",
    "expense",
  ]);
  // Not into itself or one of its subcategories.
  for (const parentId of ["food", "bakery"]) {
    assertEquals((await call("PATCH", `${f}/categories/food`, { parentId })).status, 400);
  }
  // The top level's kind goes down the tree; a subcategory's can't be set.
  await call("PATCH", `${f}/categories/food`, { kind: "both" });
  await call("PATCH", `${f}/categories/bakery`, { kind: "income" });
  const kinds = async () =>
    Object.fromEntries(
      (await call("GET", f)).data.categories.map((c: any) => [c.id, [c.parentId, c.kind]]),
    );
  assertEquals((await kinds()).bakery, ["groceries", "both"]);

  // A name that several categories have needs the path.
  await call("POST", `${f}/categories`, { name: "Other", color: "#000000", parentId: "food" });
  const ambiguous = await call("POST", `${f}/transactions`, {
    date: "2026-03-01",
    amountCents: -1,
    categoryId: "Other",
  });
  assertEquals(ambiguous.status, 400);
  assertMatch(ambiguous.data.error, /Food > Other/);

  const add = await call("POST", `${f}/transactions`, {
    ops: [
      { date: "2026-03-01", amountCents: -100, payee: "Market", categoryId: "Food" },
      { date: "2026-03-02", amountCents: -200, payee: "Super", categoryId: "Food > Groceries" },
      { date: "2026-03-03", amountCents: -400, payee: "Baker", categoryId: "bakery" },
      { date: "2026-03-04", amountCents: -800, payee: "Snacks", categoryId: "Food > Other" },
      { date: "2026-03-05", amountCents: -1600, payee: "Rent", categoryId: "housing" },
    ],
  });
  assertEquals(add.status, 200);
  // Filtering by a category includes its subcategories.
  const total = async (category: string) =>
    (await call("GET", `${f}/transactions?category=${encodeURIComponent(category)}`)).data
      .expenseCents;
  assertEquals(await total("food"), 1500);
  assertEquals(await total("groceries"), 600);
  assertEquals(await total("Food > Groceries > Bakery"), 400);

  // Deleting moves the subcategories and transactions to the parent.
  assertEquals((await call("DELETE", `${f}/categories/groceries`)).status, 200);
  assertEquals((await kinds()).bakery, ["food", "both"]);
  const list = (await call("GET", `${f}/transactions?category=food`)).data.transactions;
  assertEquals(list.find((t: any) => t.payee === "Super").categoryId, "food");
  // A top-level one's subcategories become top-level ones, its transactions uncategorized.
  await call("DELETE", `${f}/categories/food`);
  assertEquals((await kinds()).bakery, [null, "both"]);
  assertEquals(await total("none"), 300);

  // Export and import keep the tree; a loop is refused.
  await call("PATCH", `${f}/categories/bakery`, { parentId: "housing" });
  const file = (await call("GET", `/families/${s.id}/export`)).data;
  const target = (await call("POST", "/families", {})).data.family;
  assertEquals((await call("POST", `/families/${target.id}/import`, file)).status, 200);
  const imported = (await call("GET", `/families/${target.id}/finance`)).data.categories;
  assertEquals(imported.find((c: any) => c.id === "bakery").parentId, "housing");
  const loop = file.finance.categories.map((c: any) =>
    c.id === "housing" ? { ...c, parentId: "bakery" } : c
  );
  const bad = { ...file, finance: { ...file.finance, categories: loop } };
  assertEquals((await call("POST", `/families/${target.id}/import`, bad)).status, 400);
});

Deno.test("adds, updates and deletes transactions with undo ops", async () => {
  const { call, f } = await financeFamily();
  const add = await call("POST", `${f}/transactions`, {
    ops: [
      { date: "2026-03-01", amountCents: 250000, payee: "Employer", categoryId: "salary" },
      { date: "2026-03-02", amountCents: -4599, payee: "Supermarket", categoryId: "Groceries" },
      { date: "2026-04-10", amountCents: -120000, payee: "Landlord", categoryId: "housing" },
    ],
  });
  assertEquals(add.status, 200);
  assertEquals(add.data.added.length, 3);
  const [salary, groceries] = add.data.added;

  const list = await call("GET", `${f}/transactions?from=2026-03-01&to=2026-03-31`);
  assertEquals(list.data.total, 2);
  assertEquals(list.data.incomeCents, 250000);
  assertEquals(list.data.expenseCents, 4599);
  // Newest first.
  assertEquals(list.data.transactions.map((t: any) => t.payee), ["Supermarket", "Employer"]);
  assertEquals(list.data.transactions[0].categoryId, "groceries");

  const update = await call("POST", `${f}/transactions`, {
    action: "update",
    id: groceries,
    amountCents: -5000,
    categoryId: null,
  });
  assertEquals(update.status, 200);
  const none = await call("GET", `${f}/transactions?category=none`);
  assertEquals(none.data.transactions.map((t: any) => t.amountCents), [-5000]);

  // The inverse ops put it back.
  await call("POST", `${f}/transactions`, { ops: update.data.inverse });
  const back = (await call("GET", `${f}/transactions?q=supermarket`)).data.transactions[0];
  assertEquals([back.amountCents, back.categoryId], [-4599, "groceries"]);

  const del = await call("POST", `${f}/transactions`, { action: "delete", ids: [salary] });
  assertEquals(del.data.changed, 1);
  assertEquals((await call("GET", `${f}/transactions?kind=income`)).data.total, 0);
  await call("POST", `${f}/transactions`, { ops: del.data.inverse });
  const restored = (await call("GET", `${f}/transactions?kind=income`)).data.transactions;
  assertEquals(restored.map((t: any) => [t.id, t.payee]), [[salary, "Employer"]]);

  // Undoing an add deletes it.
  await call("POST", `${f}/transactions`, { ops: add.data.inverse });
  assertEquals((await call("GET", `${f}/transactions`)).data.total, 0);
});

Deno.test("deletes all finance data", async () => {
  const { call, s, f } = await financeFamily();
  await call("POST", `${f}/transactions`, {
    ops: [{ date: "2026-03-01", amountCents: 250000, payee: "Employer", categoryId: "salary" }],
  });
  await call("PATCH", `${f}/settings`, { currency: "CHF", csvMappings: [{ signature: "a;b" }] });
  await call("POST", `${f}/accounts`, { name: "Checking", color: "#3b82f6" });
  const other = await newFamily(call);
  const o = `/families/${other.id}/finance`;
  await call("POST", `${o}/transactions`, { date: "2026-03-01", amountCents: 1 });
  await call("POST", `${o}/accounts`, { name: "Cash", color: "#22c55e" });

  // Only the edit link may.
  assertEquals((await s.view("DELETE", `/families/${s.id}/finance`)).status, 403);
  const res = await call("DELETE", f);
  assertEquals(res.status, 200);
  assertEquals(res.data, { currency: "EUR", csvMappings: [], accounts: [], categories: [] });
  assertEquals((await call("GET", `${f}/transactions`)).data.total, 0);
  // Other families keep theirs.
  assertEquals((await call("GET", `${o}/transactions`)).data.total, 1);
  assert((await call("GET", o)).data.categories.length > 0);
  assertEquals((await call("GET", o)).data.accounts.length, 1);
});

Deno.test("validates transaction ops", async () => {
  const { call, s, f } = await financeFamily();
  const status = async (body: unknown) => (await call("POST", `${f}/transactions`, body)).status;
  assertEquals(await status({ date: "2026-02-30", amountCents: 1 }), 400);
  assertEquals(await status({ date: "2026-02-01", amountCents: 1.5 }), 400);
  assertEquals(await status({ date: "2026-02-01", amountCents: 1, categoryId: "nope" }), 404);
  assertEquals(await status({ date: "2026-02-01", amountCents: 1, payee: "x".repeat(201) }), 400);
  assertEquals(await status({ action: "update", id: "not-a-uuid" }), 400);
  assertEquals(await status({ action: "update", id: crypto.randomUUID(), payee: "x" }), 404);
  assertEquals(await status({ action: "fly" }), 400);
  // Reading needs the view link, writing the edit link.
  assertEquals((await s.view("GET", `/families/${s.id}/finance/transactions`)).status, 200);
  assertEquals(
    (await s.view("POST", `/families/${s.id}/finance/transactions`, {
      date: "2026-02-01",
      amountCents: 1,
    })).status,
    403,
  );
});

Deno.test("the legacy and feed links never see finances", async () => {
  const { call, store, s, f } = await financeFamily();
  await call("POST", `${f}/transactions`, {
    date: "2026-03-01",
    amountCents: -100,
    payee: "Secret",
  });
  await store.updateFamily(s.id, { legacy_id: "OldViewId1234567890" });
  for (const token of ["OldViewId1234567890", s.feedId]) {
    for (const path of ["/finance", "/finance/transactions", "/finance/summary", "/export"]) {
      assertEquals((await call("GET", `/families/${token}${path}`)).status, 404, token + path);
    }
  }
  // A viewer clones the finances too, into a family of their own.
  const full = (await s.view("POST", `/families/${s.id}/clone`, {})).data.family;
  assertEquals((await s.view("GET", `/families/${full.id}/finance/transactions`)).data.total, 1);
  assertEquals((await call("GET", `/families/${full.id}`)).status, 404);
});

Deno.test("imports statement rows once, keeping identical rows apart", async () => {
  const { call, f } = await financeFamily();
  const rows = [
    { date: "2026-05-02", amountCents: -350, payee: "Café", description: "Coffee" },
    { date: "2026-05-02", amountCents: -350, payee: "Café", description: "Coffee" },
    { date: "2026-05-03", amountCents: 100000, payee: "Employer", categoryId: "salary" },
  ];
  const dry = await call("POST", `${f}/import`, { rows, dryRun: true });
  assertEquals([dry.data.added, dry.data.duplicates], [0, []]);
  assertEquals((await call("GET", `${f}/transactions`)).data.total, 0);

  const first = await call("POST", `${f}/import`, { rows });
  assertEquals([first.data.added, first.data.duplicates], [3, []]);
  // Same statement again: nothing new.
  const again = await call("POST", `${f}/import`, { rows });
  assertEquals([again.data.added, again.data.duplicates], [0, [0, 1, 2]]);
  // A longer statement with a third coffee: only that one is new.
  const more = await call("POST", `${f}/import`, { rows: [...rows, rows[0]] });
  assertEquals([more.data.added, more.data.duplicates], [1, [0, 1, 2]]);
  const list = (await call("GET", `${f}/transactions`)).data;
  assertEquals(list.total, 4);
  assert(list.transactions.every((t: any) => t.imported));
  assertEquals((await call("POST", `${f}/import`, { rows: [{ date: "x" }] })).status, 400);
});

Deno.test("summarizes income and expenses per month and category", async () => {
  const { call, f } = await financeFamily();
  await call("POST", `${f}/transactions`, {
    ops: [
      { date: "2026-01-31", amountCents: 300000, categoryId: "salary" },
      { date: "2026-01-15", amountCents: -5000, categoryId: "groceries" },
      { date: "2026-02-03", amountCents: -7000, categoryId: "groceries" },
      { date: "2026-02-10", amountCents: -2000 },
      { date: "2025-12-24", amountCents: -99999, categoryId: "shopping" },
    ],
  });
  const res = await call("GET", `${f}/summary?from=2026-01-01&to=2026-12-31`);
  assertEquals(res.status, 200);
  assertEquals(res.data.currency, "EUR");
  assertEquals([res.data.incomeCents, res.data.expenseCents, res.data.count], [300000, 14000, 4]);
  assertEquals(res.data.months, [
    { month: "2026-01", incomeCents: 300000, expenseCents: 5000 },
    { month: "2026-02", incomeCents: 0, expenseCents: 9000 },
  ]);
  assertEquals(res.data.categories[0], {
    categoryId: "groceries",
    incomeCents: 0,
    expenseCents: 12000,
    count: 2,
  });
  assert(res.data.categories.some((c: any) => c.categoryId === null && c.expenseCents === 2000));
});

Deno.test("exports and imports the finances", async () => {
  const { call, s, f } = await financeFamily();
  await call("PATCH", `${f}/settings`, { currency: "USD" });
  await call("POST", `${f}/categories`, { name: "Pets", color: "#ff0000" });
  await call("POST", `${f}/transactions`, {
    date: "2026-03-01",
    amountCents: -1234,
    payee: "Vet",
    categoryId: "pets",
  });
  const file = (await call("GET", `/families/${s.id}/export`)).data;
  assertEquals(file.finance.currency, "USD");
  assertEquals(file.finance.transactions.length, 1);

  const target = (await call("POST", "/families", {})).data.family;
  const t = `/families/${target.id}/finance`;
  await call("POST", `${t}/transactions`, { date: "2026-01-01", amountCents: 1, payee: "Old" });
  assertEquals((await call("POST", `/families/${target.id}/import`, file)).status, 200);
  const list = (await call("GET", `${t}/transactions`)).data.transactions;
  assertEquals(list.map((x: any) => [x.payee, x.categoryId, x.amountCents]), [[
    "Vet",
    "pets",
    -1234,
  ]]);
  assertEquals((await call("GET", t)).data.currency, "USD");

  // A file without finances (version 1) leaves them alone.
  const { finance: _, ...v1 } = file;
  await call("POST", `/families/${target.id}/import`, { ...v1, version: 1 });
  assertEquals((await call("GET", `${t}/transactions`)).data.total, 1);

  const bad = { ...file, finance: { ...file.finance, transactions: [{ date: "2026-01-01" }] } };
  assertEquals((await call("POST", `/families/${target.id}/import`, bad)).status, 400);
});

Deno.test("the agent page explains the finances, and to viewers only reading", async () => {
  const { call, s } = await financeFamily();
  const edit: string = (await call("GET", `/families/${s.id}/agent`)).data;
  assert(edit.includes("## Finances"));
  assert(edit.includes(`POST ${BASE}/families/${s.id}/finance/transactions`));
  const view: string = (await s.view("GET", `/families/${s.id}/agent`)).data;
  assert(view.includes("## Finances") && !view.includes("finance/transactions` with"));
});

// ------------------------------------------------------------------ accounts and transfers

/** A family with two accounts, and a helper that adds transactions and returns their ids. */
async function accountsFamily() {
  const t = await financeFamily();
  const { call, f } = t;
  await call("POST", `${f}/accounts`, { name: "Checking", color: "#3b82f6", openingCents: 1000 });
  await call("POST", `${f}/accounts`, { name: "Savings", color: "#22c55e" });
  const add = async (...ops: Record<string, unknown>[]) => {
    const res = await call("POST", `${f}/transactions`, { ops });
    assertEquals(res.status, 200, JSON.stringify(res.data));
    return res.data.added as string[];
  };
  const ops = async (...ops: Record<string, unknown>[]) => {
    const res = await call("POST", `${f}/transactions`, { ops });
    assertEquals(res.status, 200, JSON.stringify(res.data));
    return res.data;
  };
  const list = async (query = "") =>
    (await call("GET", `${f}/transactions${query ? "?" + query : ""}`)).data;
  return { ...t, add, ops, list };
}

Deno.test("tells the account balances at the end of a day", async () => {
  const { call, s, f, add, ops } = await accountsFamily();
  const [, , booking, part] = await add(
    { date: "2026-03-01", amountCents: -300, accountId: "checking" },
    { date: "2026-03-31", amountCents: 5000, accountId: "savings" },
    { date: "2026-04-02", amountCents: -200, accountId: "checking" },
    { date: "2026-04-02", amountCents: -150, accountId: "checking" },
  );
  // A part of a split booking doesn't count, its booking does.
  await ops({ action: "split", id: booking, ids: [part] });
  const at = async (day?: string) => {
    const res = await call("GET", `${f}/accounts${day ? `?at=${day}` : ""}`);
    assertEquals(res.status, 200, JSON.stringify(res.data));
    return [res.data.at, ...res.data.accounts.map((a: any) => a.balanceCents)];
  };
  assertEquals(await at("2026-02-28"), ["2026-02-28", 1000, 0]);
  assertEquals(await at("2026-03-01"), ["2026-03-01", 700, 0]);
  assertEquals(await at("2026-03-31"), ["2026-03-31", 700, 5000]);
  assertEquals(await at("2026-04-02"), ["2026-04-02", 500, 5000]);
  assertEquals(await at(), [null, 500, 5000]);
  assertEquals((await call("GET", `${f}/accounts?at=2026-13-01`)).status, 400);
  // Viewers can read it.
  const view = `/families/${s.id}/finance/accounts?at=2026-03-01`;
  assertEquals((await s.view("GET", view)).data.accounts.length, 2);
});

Deno.test("manages finance accounts with balances", async () => {
  const { call, s, f, add } = await accountsFamily();
  const overview = (await call("GET", f)).data;
  assertEquals(overview.accounts, [
    {
      id: "checking",
      name: "Checking",
      color: "#3b82f6",
      icon: "",
      openingCents: 1000,
      position: 0,
      balanceCents: 1000,
    },
    {
      id: "savings",
      name: "Savings",
      color: "#22c55e",
      icon: "",
      openingCents: 0,
      position: 1,
      balanceCents: 0,
    },
  ]);
  await add(
    { date: "2026-03-01", amountCents: -300, accountId: "checking" },
    { date: "2026-03-02", amountCents: 5000, accountId: "Savings" },
    { date: "2026-03-03", amountCents: -99 },
  );
  const balances = (await call("GET", f)).data.accounts.map((a: any) => a.balanceCents);
  assertEquals(balances, [700, 5000]);
  // The settings answer has them too.
  assertEquals((await call("PATCH", `${f}/settings`, {})).data.accounts.length, 2);

  const created = await call("POST", `${f}/accounts`, {
    name: "Cash",
    color: "#ff0000",
    icon: "💶",
    openingCents: -50,
  });
  assertEquals(created.status, 201);
  assertEquals([created.data.id, created.data.balanceCents], ["cash", -50]);
  assertEquals((await call("POST", `${f}/accounts`, { name: "X", color: "red" })).status, 400);
  assertEquals(
    (await call("POST", `${f}/accounts`, { name: "X", color: "#000000", openingCents: 1.5 }))
      .status,
    400,
  );
  const patched = await call("PATCH", `${f}/accounts/Checking`, {
    openingCents: 2000,
    position: 9,
  });
  assertEquals([patched.data.balanceCents, patched.data.position], [1700, 9]);
  assertEquals((await call("PATCH", `${f}/accounts/nope`, { name: "Y" })).status, 404);

  // Unknown accounts are refused like unknown categories.
  const bad = await call("POST", `${f}/transactions`, {
    date: "2026-03-01",
    amountCents: 1,
    accountId: "nope",
  });
  assertEquals(bad.status, 404);

  // Viewers read, editors change.
  const view = `/families/${s.id}/finance`;
  assertEquals((await s.view("GET", view)).data.accounts.length, 3);
  assertEquals(
    (await s.view("POST", `${view}/accounts`, { name: "A", color: "#000000" })).status,
    403,
  );
  assertEquals((await s.view("PATCH", `${view}/accounts/cash`, { name: "B" })).status, 403);
  assertEquals((await s.view("DELETE", `${view}/accounts/cash`)).status, 403);

  // Deleting an account deletes its transactions too.
  assertEquals((await call("DELETE", `${f}/accounts/savings`)).data, {
    deleted: "savings",
    transactions: 1,
  });
  assertEquals((await call("DELETE", `${f}/accounts/savings`)).status, 404);
  const rows = (await call("GET", `${f}/transactions?account=none`)).data.transactions;
  assertEquals(rows.map((t: any) => t.amountCents), [-99]);
  const checking = (await call("GET", `${f}/transactions?account=checking`)).data;
  assertEquals(checking.transactions.map((t: any) => t.accountId), ["checking"]);
});

Deno.test("deleting an account leaves the other leg of its transfers alone", async () => {
  const { call, f, add, ops, list } = await accountsFamily();
  const [out, into] = await add(
    { date: "2026-03-10", amountCents: -50000, accountId: "checking" },
    { date: "2026-03-11", amountCents: 50000, accountId: "savings" },
  );
  await ops({ action: "link", ids: [out, into] });
  assertEquals((await call("DELETE", `${f}/accounts/savings`)).data.transactions, 1);
  const rows = (await list()).transactions;
  assertEquals(rows.map((t: any) => [t.id, t.transferId]), [[out, null]]);
});

Deno.test("transfers count once by their net", async () => {
  const { call, f, add, ops, list } = await accountsFamily();
  const [out, into, coffee] = await add(
    { date: "2026-03-10", amountCents: -50000, payee: "To savings", accountId: "checking" },
    { date: "2026-03-11", amountCents: 50000, payee: "From checking", accountId: "savings" },
    { date: "2026-03-12", amountCents: -350, payee: "Café", accountId: "checking" },
  );
  assertEquals(
    [(await list()).incomeCents, (await list()).expenseCents],
    [50000, 50350],
  );
  const linked = await ops({ action: "link", ids: [out, into] });
  assertEquals(linked.changed, 2);
  let all = await list();
  assertEquals([all.incomeCents, all.expenseCents, all.total], [0, 350, 3]);
  const transferId = all.transactions.find((t: any) => t.id === out).transferId;
  assertMatch(transferId, /^[0-9a-f-]{36}$/);
  assertEquals(all.transactions.find((t: any) => t.id === into).transferId, transferId);
  assertEquals(all.transactions.find((t: any) => t.id === coffee).transferId, null);
  // Balances still move between the accounts.
  const accounts = (await call("GET", f)).data.accounts.map((a: any) => a.balanceCents);
  assertEquals(accounts, [1000 - 50000 - 350, 50000]);

  // Kinds: a net-0 transfer is neither income nor expense.
  assertEquals((await list("kind=transfer")).transactions.length, 2);
  assertEquals((await list("kind=income")).total, 0);
  assertEquals((await list("kind=expense")).transactions.map((t: any) => t.id), [coffee]);

  const summary = (await call("GET", `${f}/summary?from=2026-01-01&to=2026-12-31`)).data;
  assertEquals([summary.incomeCents, summary.expenseCents, summary.count], [0, 350, 1]);

  // 500 out, only 480 arrive: the transfer costs 20.
  await ops({ action: "update", id: into, amountCents: 48000 });
  all = await list();
  assertEquals([all.incomeCents, all.expenseCents], [0, 2350]);
  const expense = await list("kind=expense");
  assertEquals(expense.transactions.map((t: any) => t.id).sort(), [out, into, coffee].sort());
  assertEquals(expense.expenseCents, 2350);

  // Unlinking either leg dissolves the group; the inverse links it again.
  const unlinked = await ops({ action: "unlink", id: into });
  assertEquals(unlinked.changed, 2);
  assertEquals((await list()).transactions.every((t: any) => t.transferId === null), true);
  assertEquals((await list()).incomeCents, 48000);
  await ops(...unlinked.inverse);
  assertEquals((await list("kind=transfer")).transactions.map((t: any) => t.transferId), [
    transferId,
    transferId,
  ]);
  // The inverse of the link puts everything back the way it was.
  await ops(...linked.inverse);
  assertEquals((await list("kind=transfer")).total, 0);

  // Validation.
  const status = async (body: unknown) => (await call("POST", `${f}/transactions`, body)).status;
  assertEquals(await status({ action: "link", ids: [out] }), 400);
  assertEquals(await status({ action: "link", ids: [out, out] }), 400);
  assertEquals(await status({ action: "link", ids: [out, crypto.randomUUID()] }), 404);
  assertEquals(await status({ action: "unlink", ids: ["x"] }), 400);
  assertEquals(await status({ action: "update", id: out, transferId: "nope" }), 400);
});

Deno.test("a transfer across a month boundary counts once, in its lead leg's month", async () => {
  const { call, f, add, ops, list } = await accountsFamily();
  const [out, into] = await add(
    { date: "2026-01-31", amountCents: -10000, accountId: "checking", categoryId: "vacation" },
    { date: "2026-02-01", amountCents: 9000, accountId: "savings" },
  );
  await ops({ action: "link", ids: [into, out] });
  const summary = (await call("GET", `${f}/summary?from=2026-01-01&to=2026-12-31`)).data;
  assertEquals(summary.months, [{ month: "2026-01", incomeCents: 0, expenseCents: 1000 }]);
  assertEquals(summary.categories, [
    { categoryId: "vacation", incomeCents: 0, expenseCents: 1000, count: 1 },
  ]);
  // A range with only the second leg doesn't count the group (its lead is in January), but
  // still knows it is a leg of one.
  const feb = await list("from=2026-02-01&to=2026-02-28");
  assertEquals([feb.incomeCents, feb.expenseCents], [0, 0]);
  assertEquals(feb.transactions[0].transferId !== null, true);
  assertEquals((await list("from=2026-02-01&to=2026-02-28&kind=expense")).total, 1);
  const jan = await list("from=2026-01-01&to=2026-01-31");
  assertEquals([jan.incomeCents, jan.expenseCents], [0, 1000]);
  const febSummary = (await call("GET", `${f}/summary?from=2026-02-01&to=2026-02-28`)).data;
  assertEquals([febSummary.count, febSummary.months], [0, []]);
});

Deno.test("deleting a leg clears the other's transfer, and undo restores both", async () => {
  const { add, ops, list } = await accountsFamily();
  const [a, b, c] = await add(
    { date: "2026-05-01", amountCents: -1000, accountId: "checking" },
    { date: "2026-05-01", amountCents: 600, accountId: "savings" },
    { date: "2026-05-02", amountCents: 400, accountId: "savings" },
  );
  await ops({ action: "link", ids: [a, b, c] });
  const before = (await list()).transactions;
  const transferId = before[0].transferId;

  // Three legs: deleting one leaves a group of two.
  const first = await ops({ action: "delete", ids: [c] });
  assertEquals((await list("kind=transfer")).total, 2);
  // Two legs: deleting one leaves a lone leg, which leaves the group.
  const second = await ops({ action: "delete", ids: [b] });
  const [lone] = (await list()).transactions;
  assertEquals([lone.id, lone.transferId], [a, null]);
  assertEquals((await list()).expenseCents, 1000);

  await ops(...second.inverse);
  await ops(...first.inverse);
  const after = (await list()).transactions;
  assertEquals(after, before);
  assertEquals(after.every((t: any) => t.transferId === transferId), true);
  assertEquals([(await list()).incomeCents, (await list()).expenseCents], [0, 0]);

  // Linking a leg into a new group: the rest of its old group stays a group if it has two
  // legs, a leg left alone loses its transfer; the inverse restores all of it.
  const [d] = await add({ date: "2026-05-03", amountCents: -1000, accountId: "savings" });
  const relink = await ops({ action: "link", ids: [a, d] });
  const transfers = async (...ids: string[]) => {
    const rows = (await list()).transactions;
    return ids.map((x) => rows.find((t: any) => t.id === x).transferId);
  };
  assertEquals(await transfers(b, c), [transferId, transferId]);
  const [newId] = await transfers(a);
  assert(newId && newId !== transferId);
  assertEquals(await transfers(d), [newId]);
  const again = await ops({ action: "link", ids: [b, d] });
  assertEquals(await transfers(a, c), [null, null]);
  assertEquals(
    (await list("kind=transfer")).transactions.map((t: any) => t.id).sort(),
    [b, d].sort(),
  );
  await ops(...again.inverse);
  assertEquals(await transfers(a, b, c, d), [
    newId,
    transferId,
    transferId,
    newId,
  ]);
  await ops(...relink.inverse);
  assertEquals((await list()).transactions.filter((t: any) => t.id !== d), before);
});

Deno.test("suggests transfers between accounts", async () => {
  const { call, s, f, add, ops } = await accountsFamily();
  const [out1, in1, out2, in2] = await add(
    { date: "2026-06-01", amountCents: -20000, accountId: "checking" },
    { date: "2026-06-03", amountCents: 20000, accountId: "savings" },
    { date: "2026-06-02", amountCents: -20000, accountId: "checking" },
    { date: "2026-06-02", amountCents: 20000, accountId: "savings" },
    { date: "2026-06-20", amountCents: -7000, accountId: "checking" },
    { date: "2026-06-25", amountCents: 7000, accountId: "savings" }, // 5 days: too far
    { date: "2026-06-10", amountCents: -500, accountId: "checking" },
    { date: "2026-06-10", amountCents: 500, accountId: "checking" }, // same account
    { date: "2026-06-11", amountCents: -800 },
    { date: "2026-06-11", amountCents: 800 }, // both without an account
  );
  const res = await s.view("GET", `/families/${s.id}/finance/transfers/suggestions`);
  assertEquals(res.status, 200);
  // Closest days first: out2 and in2 on the same day, then out1 with in1. Newest first.
  assertEquals(res.data.pairs.map((p: any) => [p.out.id, p.in.id]), [[out1, in1], [out2, in2]]);
  assertEquals(res.data.pairs[0].in.accountId, "savings");
  const ranged = await call("GET", `${f}/transfers/suggestions?from=2026-06-02&to=2026-06-30`);
  assertEquals(ranged.data.pairs.map((p: any) => p.out.id), [out2]);
  assertEquals((await call("GET", `${f}/transfers/suggestions?from=x`)).status, 400);
  // Grouped transactions aren't suggested again.
  await ops({ action: "link", ids: [out2, in2] });
  const after = await call("GET", `${f}/transfers/suggestions`);
  assertEquals(after.data.pairs.map((p: any) => p.out.id), [out1]);
});

Deno.test("auto-combines transfers, and the inverse splits them again", async () => {
  const { call, s, f, add, ops, list } = await accountsFamily();
  await add(
    { date: "2026-06-01", amountCents: -20000, accountId: "checking" },
    { date: "2026-06-02", amountCents: 20000, accountId: "savings" },
    { date: "2026-07-01", amountCents: -3000, accountId: "savings" },
    { date: "2026-07-01", amountCents: 3000, accountId: "checking" },
    { date: "2026-08-01", amountCents: -100, accountId: "savings" },
    { date: "2026-08-01", amountCents: 100, accountId: "checking" },
  );
  assertEquals(
    (await s.view("POST", `/families/${s.id}/finance/transfers/auto`, {})).status,
    403,
  );
  assertEquals((await call("POST", `${f}/transfers/auto`, { from: "nope" })).status, 400);
  const res = await call("POST", `${f}/transfers/auto`, { from: "2026-06-01", to: "2026-07-31" });
  assertEquals(res.status, 200);
  assertEquals([res.data.ok, res.data.linked, res.data.changed], [true, 2, 4]);
  assertEquals((await list("kind=transfer")).total, 4);
  assertEquals([(await list()).incomeCents, (await list()).expenseCents], [100, 100]);
  const groups = new Set((await list("kind=transfer")).transactions.map((t: any) => t.transferId));
  assertEquals(groups.size, 2);
  await ops(...res.data.inverse);
  assertEquals((await list("kind=transfer")).total, 0);
  // Without a range: the whole history.
  assertEquals((await call("POST", `${f}/transfers/auto`, {})).data.linked, 3);
  assertEquals((await call("POST", `${f}/transfers/auto`, {})).data, {
    ok: true,
    changed: 0,
    added: [],
    inverse: [],
    linked: 0,
    splits: 0,
  });
});

Deno.test("imports a statement into an account", async () => {
  const { call, f, list } = await accountsFamily();
  const rows = [{ date: "2026-05-02", amountCents: -350, payee: "Café", description: "Coffee" }];
  assertEquals((await call("POST", `${f}/import`, { rows, accountId: "nope" })).status, 404);
  const dry = await call("POST", `${f}/import`, { rows, dryRun: true, accountId: "Checking" });
  assertEquals([dry.data.added, dry.data.duplicates, dry.data.transfers], [0, [], 0]);
  assertEquals((await list()).total, 0);
  const first = await call("POST", `${f}/import`, { rows, accountId: "checking" });
  assertEquals(first.data.added, 1);
  assertEquals((await list()).transactions[0].accountId, "checking");
  // The same booking on another account's statement isn't a duplicate…
  const other = await call("POST", `${f}/import`, { rows, accountId: "savings" });
  assertEquals([other.data.added, other.data.duplicates], [1, []]);
  // …but on the same account's statement it is, and without an account the hash is as before.
  const again = await call("POST", `${f}/import`, { rows, accountId: "checking", dryRun: true });
  assertEquals(again.data.duplicates, [0]);
  const plain = await call("POST", `${f}/import`, { rows });
  assertEquals(plain.data.added, 1);
  assertEquals((await call("POST", `${f}/import`, { rows })).data.duplicates, [0]);
  assertEquals((await list("account=none")).total, 1);
});

Deno.test("an import can combine transfers automatically", async () => {
  const { call, f, add, list } = await accountsFamily();
  const [out] = await add(
    { date: "2026-05-01", amountCents: -20000, payee: "To savings", accountId: "checking" },
    // An older pair that isn't combined: not touched by the import.
    { date: "2026-04-01", amountCents: -5000, accountId: "checking" },
    { date: "2026-04-01", amountCents: 5000, accountId: "savings" },
  );
  const rows = [
    { date: "2026-05-03", amountCents: 20000, payee: "From checking" },
    { date: "2026-05-04", amountCents: -999, payee: "Bank fee" },
  ];
  const body = { rows, accountId: "savings", autoTransfers: true };
  const dry = await call("POST", `${f}/import`, { ...body, dryRun: true });
  assertEquals([dry.data.added, dry.data.transfers], [0, 1]);
  assertEquals((await list()).total, 3);
  assertEquals((await list("kind=transfer")).total, 0);

  // Without the flag nothing is linked.
  const without = await call("POST", `${f}/import`, { rows: [rows[1]], accountId: "savings" });
  assertEquals(without.data.transfers, 0);
  assertEquals((await list("kind=transfer")).total, 0);

  const res = await call("POST", `${f}/import`, body);
  assertEquals([res.data.added, res.data.duplicates, res.data.transfers], [1, [1], 1]);
  const legs = (await list("kind=transfer")).transactions;
  assertEquals(legs.map((t: any) => t.id).sort(), [out, res.data.ids[0]].sort());
  assertEquals(legs[0].transferId, legs[1].transferId);
  // Undoing the import (deleting its rows) leaves the other leg alone again.
  await call("POST", `${f}/transactions`, { action: "delete", ids: res.data.ids });
  assertEquals((await list("kind=transfer")).total, 0);
});

Deno.test("exports, imports and clones accounts and transfers", async () => {
  const { call, s, add, ops } = await accountsFamily();
  const [a, b] = await add(
    { date: "2026-03-01", amountCents: -500, accountId: "checking" },
    { date: "2026-03-01", amountCents: 500, accountId: "savings" },
  );
  await ops({ action: "link", ids: [a, b] });
  const file = (await call("GET", `/families/${s.id}/export`)).data;
  assertEquals(file.finance.accounts.map((x: any) => [x.id, x.openingCents]), [
    ["checking", 1000],
    ["savings", 0],
  ]);
  assert(file.finance.transactions.every((t: any) => t.transferId && t.accountId));

  const target = (await call("POST", "/families", {})).data.family;
  const t = `/families/${target.id}/finance`;
  assertEquals((await call("POST", `/families/${target.id}/import`, file)).status, 200);
  assertEquals((await call("GET", t)).data.accounts.map((x: any) => x.balanceCents), [500, 500]);
  const imported = (await call("GET", `${t}/transactions?kind=transfer`)).data;
  assertEquals([imported.total, imported.incomeCents, imported.expenseCents], [2, 0, 0]);

  // Files from before accounts still import.
  const old = {
    ...file,
    finance: {
      ...file.finance,
      accounts: undefined,
      transactions: file.finance.transactions.map(
        ({ accountId: _, transferId: __, ...x }: any) => x,
      ),
    },
  };
  assertEquals((await call("POST", `/families/${target.id}/import`, old)).status, 200);
  assertEquals((await call("GET", t)).data.accounts, []);
  assertEquals((await call("GET", `${t}/transactions`)).data.incomeCents, 500);
  // A transaction with an unknown account is refused.
  const bad = { ...file, finance: { ...file.finance, accounts: [] } };
  assertEquals((await call("POST", `/families/${target.id}/import`, bad)).status, 400);

  // Clones copy the accounts and the transfers (with their own transfer id).
  const copy = (await call("POST", `/families/${s.id}/clone`, {})).data.family;
  const c = `/families/${copy.id}/finance`;
  assertEquals((await call("GET", c)).data.accounts.map((x: any) => x.id), [
    "checking",
    "savings",
  ]);
  const legs = (await call("GET", `${c}/transactions?kind=transfer`)).data.transactions;
  assertEquals(legs.length, 2);
  assertEquals(legs[0].transferId, legs[1].transferId);
  assert(legs[0].transferId !== file.finance.transactions[0].transferId);
});

Deno.test("a memory store snapshot keeps accounts and transfers", async () => {
  const { store, owner, s, f, add, ops } = await accountsFamily();
  const [a, b] = await add(
    { date: "2026-03-01", amountCents: -500, accountId: "checking" },
    { date: "2026-03-01", amountCents: 500, accountId: "savings" },
  );
  await ops({ action: "link", ids: [a, b] });
  const restored = new MemoryStore();
  restored.restore(JSON.parse(JSON.stringify(store.snapshot())));
  const handler = createHandler(restored);
  // Accounts, sessions and memberships are in the snapshot too.
  const headers = { authorization: `Bearer ${owner.token}` };
  const get = async (path: string) =>
    await (await handler(new Request(BASE + path, { headers }))).json();
  assertEquals((await get(f)).accounts.map((x: any) => x.balanceCents), [500, 500]);
  assertEquals((await get(`${f}/transactions?kind=transfer`)).total, 2);
  // Snapshots from before accounts have neither.
  const old = store.snapshot().families.map(({ accounts: _, ...item }) => ({
    ...item,
    transactions: item.transactions?.map(({ account_id: _, transfer_id: __, ...t }) => t),
  }));
  const older = new MemoryStore();
  older.restore(JSON.parse(JSON.stringify(old)));
  const [t] = await older.getTransactions(s.id, [a]);
  assertEquals([t.account_id, t.transfer_id], [null, null]);
});

Deno.test("the AI tools nest categories and analyze them per level", async () => {
  const { call, store, s, f } = await financeFamily();
  const ctx = { lang: "en" as const, store, familyId: s.id, net: {} as any, search: null };
  const allowed = new Set(Object.keys(TOOLS));
  const run = async (name: string, args: unknown) =>
    await runTool(name, JSON.stringify(args), ctx, allowed);
  const undo = async (out: Awaited<ReturnType<typeof run>>) => {
    for (const step of out.change!.undo) {
      await call(step.method, `/families/${s.id}${step.path}`, step.body);
    }
  };

  const food = await run("manage_categories", { action: "add", name: "Food" });
  assertEquals((food.result as any).parentId, null);
  await run("manage_categories", { action: "update", category: "Groceries", parent: "Food" });
  const bakery = await run("manage_categories", {
    action: "add",
    name: "Bakery",
    parent: "Food > Groceries",
  });
  assertEquals((bakery.result as any).parentId, "groceries");
  // Moving back to the top level, and undoing it.
  const moved = await run("manage_categories", {
    action: "update",
    category: "Groceries",
    parent: "",
  });
  assertEquals((moved.result as any).parentId, null);
  await undo(moved);
  const cats = (await call("GET", f)).data.categories;
  assertEquals(cats.find((c: any) => c.id === "groceries").parentId, "food");
  const loop = await run("manage_categories", {
    action: "update",
    category: "Food",
    parent: "Bakery",
  });
  assertMatch(String((loop.result as any).error), /itself or one of its subcategories/);

  await call("POST", `${f}/transactions`, {
    ops: [
      { date: "2026-03-01", amountCents: -100, payee: "Market", categoryId: "food" },
      { date: "2026-03-02", amountCents: -200, payee: "Super", categoryId: "groceries" },
      { date: "2026-03-03", amountCents: -400, payee: "Baker", categoryId: "bakery" },
      { date: "2026-03-05", amountCents: -1600, payee: "Rent", categoryId: "housing" },
    ],
  });
  const groups = async (args: Record<string, unknown>) =>
    ((await run("analyze_transactions", { groupBy: ["category"], ...args })).result as any)
      .groups.map((g: any) => [g.category, g.categoryPath ?? null, g.expenseCents]);
  assertEquals(await groups({ categoryLevel: 1 }), [["housing", null, 1600], ["food", null, 700]]);
  assertEquals(await groups({ category: "food", categoryLevel: 2, sortBy: "key" }), [
    ["food", null, 100],
    ["groceries", "Food > Groceries", 600],
  ]);
  assertEquals((await groups({ category: "food" })).map((g: any[]) => g[0]), [
    "bakery",
    "groceries",
    "food",
  ]);
  const bad = await run("analyze_transactions", { groupBy: ["category"], categoryLevel: 0 });
  assertMatch(String((bad.result as any).error), /categoryLevel/);

  const summary = await run("finance_summary", { from: "2026-03-01", to: "2026-03-31" });
  const byId = Object.fromEntries(
    (summary.result as any).categories.map((c: any) => [c.categoryId, c]),
  );
  assertEquals(byId.food.expenseCents, 100);
  assertEquals(byId.food.withSubcategories, { incomeCents: 0, expenseCents: 700, count: 3 });
  assertEquals(byId.bakery.path, "Food > Groceries > Bakery");
  assertEquals("withSubcategories" in byId.bakery, false);
});

Deno.test("the AI tools know accounts and transfers", async () => {
  const { store, s, add, ops } = await accountsFamily();
  const [a, b] = await add(
    { date: "2026-03-01", amountCents: -500, accountId: "checking" },
    { date: "2026-03-02", amountCents: 500, accountId: "savings" },
    { date: "2026-03-03", amountCents: -42, accountId: "checking" },
    { date: "2026-04-01", amountCents: -700, accountId: "checking" },
    { date: "2026-04-01", amountCents: 700, accountId: "savings" },
  );
  const ctx = { lang: "en" as const, store, familyId: s.id, net: {} as any, search: null };
  const allowed = new Set(Object.keys(TOOLS));
  const run = async (name: string, args: unknown) =>
    await runTool(name, JSON.stringify(args), ctx, allowed);

  await ops({ action: "link", ids: [a, b] });
  const listed = await run("list_transactions", { account: "Checking", kind: "expense" });
  assertEquals((listed.result as any).rows.map((t: any) => t[2]), [-700, -42]);
  const transfers = await run("list_transactions", { kind: "transfer" });
  assertEquals((transfers.result as any).total, 2);
  const summary = await run("finance_summary", { from: "2026-03-01", to: "2026-03-31" });
  assertEquals((summary.result as any).expenseCents, 42);
  assertEquals((summary.result as any).accounts.map((x: any) => x.balanceCents), [
    1000 - 500 - 42 - 700,
    1200,
  ]);

  const combined = await run("combine_transfers", { from: "2026-04-01", to: "2026-04-30" });
  assertEquals((combined.result as any).linked, 1);
  assertEquals(combined.change?.summary, "1 transfer combined");
  const undo = combined.change!.undo[0];
  await ops(...(undo.body as any).ops);
  assertEquals((await run("list_transactions", { kind: "transfer" }) as any).result.total, 2);

  const unlinked = await run("change_transactions", { ops: [{ action: "unlink", id: a }] });
  assertEquals((unlinked.result as any).changed, 2);
  assertEquals((await run("list_transactions", { kind: "transfer" }) as any).result.total, 0);
});

Deno.test("the AI tool lists many transactions in few calls, page by page", async () => {
  const { store, s, add } = await accountsFamily();
  const long = "SEPA-Lastschrift Mandatsreferenz 123456789 Glaeubiger-ID DE98ZZZ09999999999 "
    .repeat(3);
  await add(
    ...Array.from({ length: 150 }, (_, i) => ({
      date: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, "0")}`,
      amountCents: -100 - i,
      payee: `Shop ${i}`,
      description: long,
      accountId: "checking",
    })),
  );
  const ctx = { lang: "en" as const, store, familyId: s.id, net: {} as any, search: null };
  const run = async (args: unknown) =>
    (await runTool("list_transactions", JSON.stringify(args), ctx, new Set(Object.keys(TOOLS))))
      .result as any;

  const seen: string[] = [];
  let page = await run({});
  let calls = 1;
  assertEquals(page.columns[4], "description");
  assert(page.rows[0][4].length <= 101);
  for (;;) {
    // Each page fits into what the model gets, so nothing is cut off mid-list.
    assert(JSON.stringify(page).length <= MAX_TOOL_RESULT);
    seen.push(...page.rows.map((r: any) => r[0]));
    if (page.nextOffset === undefined) break;
    page = await run({ offset: page.nextOffset });
    calls++;
  }
  assertEquals(new Set(seen).size, 150);
  assert(calls <= 3, `${calls} calls`);
  assertEquals((await run({ limit: 5 })).nextOffset, 5);
});

/** A December checking account statement with Amazon "Splitbuchungen": the bank lists each
 *  booking and its order lines, which add up to the booking up to shipping and vouchers. */
const SPLIT_STATEMENT = [
  { date: "2026-12-17", amountCents: -355, payee: "Amazon Payments", description: "Splitbuchung" },
  { date: "2026-12-17", amountCents: -6491, payee: "Amazon Payments", description: "Splitbuchung" },
  {
    date: "2026-12-17",
    amountCents: -395,
    payee: "AMAZON EU S.A R.L.",
    description: "Bestellnr. 1",
  },
  { date: "2026-12-17", amountCents: 40, payee: "AMAZON EU S.A R.L.", description: "Bestellnr. 1" },
  { date: "2026-12-17", amountCents: -6491, payee: "Amazon.de", description: "Bestellnr. 2 CASO" },
  { date: "2026-12-17", amountCents: -2000, payee: "REWE", description: "Groceries" },
  { date: "2026-12-20", amountCents: -899, payee: "Amazon Prime", description: "Membership" },
  { date: "2026-12-24", amountCents: -2498, payee: "Amazon Payments", description: "Splitbuchung" },
  { date: "2026-12-24", amountCents: -2199, payee: "Amazon.de", description: "Bestellnr. 3" },
  { date: "2026-12-30", amountCents: -2495, payee: "Amazon Payments", description: "Splitbuchung" },
  { date: "2026-12-30", amountCents: -466, payee: "Amazon.de", description: "Bestellnr. 4" },
  {
    date: "2026-12-30",
    amountCents: -2495,
    payee: "Amazon.de",
    description: "Bestellnr. 4 Ginkgo",
  },
  { date: "2026-12-30", amountCents: 499, payee: "Amazon.de", description: "Gutschein" },
];
/** What the statement adds up to: the bookings and the other rows, not the order lines. */
const SPLIT_STATEMENT_NET = -(355 + 6491 + 2000 + 899 + 2498 + 2495);

Deno.test("an import combines split bookings, so their order lines don't count twice", async () => {
  const { call, f, add, list } = await accountsFamily();
  // An Amazon card payment the day before the voucher: not a transfer.
  await add({ date: "2026-12-29", amountCents: -499, payee: "AMAZON.DE", accountId: "savings" });
  const body = { rows: SPLIT_STATEMENT, accountId: "checking", autoTransfers: true };
  const dry = await call("POST", `${f}/import`, { ...body, dryRun: true });
  assertEquals([dry.data.added, dry.data.splits, dry.data.transfers], [0, 4, 0]);

  const res = await call("POST", `${f}/import`, body);
  assertEquals([res.data.added, res.data.splits, res.data.transfers], [13, 4, 0]);
  const all = await list("from=2026-12-01&to=2026-12-31&account=checking");
  assertEquals(all.incomeCents - all.expenseCents, SPLIT_STATEMENT_NET);
  const byText = (amount: number, text: string) =>
    all.transactions.find((t: any) => t.amountCents === amount && t.description.includes(text));
  const bookings = all.transactions.filter((t: any) => t.split)
    .map((t: any) => [t.date, t.amountCents, t.split.parts, t.split.remainderCents]);
  assertEquals(bookings, [
    ["2026-12-30", -2495, 3, -33],
    ["2026-12-24", -2498, 1, -299],
    ["2026-12-17", -355, 2, 0],
    ["2026-12-17", -6491, 1, 0],
  ]);
  // Several bookings on one day each take the order lines that add up to them.
  const small = byText(-355, "Splitbuchung");
  assertEquals(byText(-395, "Bestellnr. 1").splitOf, small.id);
  assertEquals(byText(40, "Bestellnr. 1").splitOf, small.id);
  assertEquals(byText(-6491, "CASO").splitOf, byText(-6491, "Splitbuchung").id);
  assertEquals([byText(-2000, "Groceries").splitOf, byText(-899, "Membership").splitOf], [
    null,
    null,
  ]);
  assertEquals((await list("kind=transfer")).total, 0);
  // The balance counts the bookings, not their parts.
  const accounts = (await call("GET", f)).data.accounts;
  assertEquals(accounts[0].balanceCents, 1000 + SPLIT_STATEMENT_NET);

  // Importing the statement again changes nothing.
  const again = await call("POST", `${f}/import`, body);
  assertEquals([again.data.added, again.data.splits], [0, 0]);
});

/** A checking account statement whose order lines have no payee: they name their order
 *  ("Bestellnr."), as does the bank's booking, which isn't marked "Splitbuchung". */
const AMAZON = "AMAZON PAYMENTS EUROPE S.C.A.";
const ORDER_STATEMENT = [
  {
    date: "2026-01-02",
    amountCents: -7289,
    payee: AMAZON,
    description: "306-0265205-1111111 AMZN",
  },
  {
    date: "2026-01-02",
    amountCents: -7289,
    payee: "",
    description: "Fleece Bestellnr. 306-0265205-1111111",
  },
  // An order line booked a day later.
  {
    date: "2026-01-03",
    amountCents: -500,
    payee: "",
    description: "Cap Bestellnr. 306-0265205-1111111",
  },
  // Two charges for one order, and an order line listed twice.
  { date: "2026-05-20", amountCents: -7295, payee: AMAZON, description: "306-6954512-2222222" },
  { date: "2026-05-20", amountCents: -2804, payee: AMAZON, description: "306-6954512-2222222" },
  {
    date: "2026-05-20",
    amountCents: -2804,
    payee: "",
    description: "Wiper Bestellnr. 306-6954512-2222222",
  },
  {
    date: "2026-05-20",
    amountCents: -2804,
    payee: "",
    description: "Wiper Bestellnr. 306-6954512-2222222 ",
  },
  {
    date: "2026-05-20",
    amountCents: -7295,
    payee: "",
    description: "Board Bestellnr. 306-6954512-2222222",
  },
  // A discount: the order line is more than the booking.
  { date: "2026-05-20", amountCents: -1359, payee: AMAZON, description: "306-1227454-3333333" },
  {
    date: "2026-05-20",
    amountCents: -1699,
    payee: "",
    description: "Lock Bestellnr. 306-1227454-3333333",
  },
  // An order line months after its order's booking stays alone.
  {
    date: "2026-05-21",
    amountCents: -500,
    payee: "",
    description: "Cable Bestellnr. 306-0265205-1111111",
  },
];

Deno.test("auto-combine finds split bookings by their order number", async () => {
  const { call, f, list } = await accountsFamily();
  const body = { rows: ORDER_STATEMENT, accountId: "checking", autoTransfers: true };
  const res = await call("POST", `${f}/import`, body);
  assertEquals([res.data.added, res.data.splits, res.data.transfers], [11, 4, 0]);
  const all = await list("account=checking");
  const bookings = all.transactions.filter((t: any) => t.split)
    .map((t: any) => [t.date, t.amountCents, t.split.parts, t.split.remainderCents]);
  // Every order line is a part, so the bookings count as the bank booked them: the line listed
  // twice and the discount even out in the remainder.
  assertEquals(bookings, [
    ["2026-05-20", -7295, 2, 2804],
    ["2026-05-20", -2804, 1, 0],
    ["2026-05-20", -1359, 1, 340],
    ["2026-01-02", -7289, 2, 500],
  ]);
  const alone = all.transactions.filter((t: any) => !t.split && !t.splitOf)
    .map((t: any) => `${t.date} ${t.amountCents}`);
  assertEquals(alone, ["2026-05-21 -500"]);
  assertEquals(all.incomeCents - all.expenseCents, -(7289 + 7295 + 2804 + 1359 + 500));
});

/** January's Amazon rows of a checking account statement (with a "Splitbuchung" column, true
 *  for the order lines): a refund's order line is listed twice, once by the bank. */
const JANUARY_AMAZON = [
  {
    date: "2026-01-12",
    amountCents: -1198,
    payee: "AMAZON EU S.A R.L., NIEDERLASSUNG DEUTSCHLAND",
    description: "306-0582276-2307564 Amazon.de 1Y7CA  7VM96XQJW7Z",
  },
  {
    date: "2026-01-12",
    amountCents: -1198,
    payee: "",
    description: "tesa INSULATION Fenster-Isolierfolie Bestellnr. 306-0582276-2307564",
  },
  {
    date: "2026-01-14",
    amountCents: -1177,
    payee: "AMAZON EU S.A R.L., NIEDERLASSUNG DEUTSCHLAND",
    description: "306-2295250-0932308 Amazon.de 58PAO  3MUUGGKX28W",
  },
  {
    date: "2026-01-14",
    amountCents: -1177,
    payee: "",
    description: "Doppelherz Omega-3 Seefischoel 1000 Bestellnr. 306-2295250-0932308",
  },
  {
    date: "2026-01-14",
    amountCents: 1198,
    payee: "AMAZON EU S.A R.L., NIEDERLASSUNG DEUTSCHLAND",
    description: "306-0582276-2307564 Amazon.de 1NJ2I  1WOZFDK72RD",
  },
  {
    date: "2026-01-14",
    amountCents: 1198,
    payee: "",
    description: "Erstattung Bestellnr. 306-0582276-2307564",
  },
  {
    date: "2026-01-14",
    amountCents: 1198,
    payee: "",
    description: "COMDIRECT BANK AG0800 Bestellnummer 306-0582276-2307564 Erstattung",
  },
  {
    date: "2026-01-23",
    amountCents: -1435,
    payee: "AMAZON PAYMENTS EUROPE S.C.A.",
    description: "305-9356245-3073956 AMZN Mktp DE 5X  MTBO28KNURUUSB",
  },
];
/** What the bank booked: the rows without the order lines. */
const JANUARY_AMAZON_NET = -1198 - 1177 + 1198 - 1435;

Deno.test("auto-combine gives a split booking the order lines it is still missing", async () => {
  const { call, f, ops, list } = await accountsFamily();
  const res = await call("POST", `${f}/import`, { rows: JANUARY_AMAZON, accountId: "checking" });
  const ids: string[] = res.data.ids;
  // As before: the refund took only one of its two order lines.
  await ops({ action: "split", id: ids[4], ids: [ids[5]] });
  const before = await list("account=checking");
  assertEquals(before.incomeCents - before.expenseCents, -1198 * 2 - 1177 * 2 + 1198 * 2 - 1435);

  const auto = (await call("POST", `${f}/transfers/auto`, {})).data;
  assertEquals([auto.splits, auto.linked], [3, 0]);
  const all = await list("account=checking");
  assertEquals(all.incomeCents - all.expenseCents, JANUARY_AMAZON_NET);
  const refund = all.transactions.find((t: any) => t.id === ids[4]);
  assertEquals([refund.split.parts, refund.split.remainderCents], [2, -1198]);
  assertEquals(all.transactions.find((t: any) => t.id === ids[6]).splitOf, ids[4]);

  // Undo takes back only the new parts.
  await ops(...auto.inverse);
  const undone = await list("account=checking");
  assertEquals(undone.incomeCents - undone.expenseCents, before.incomeCents - before.expenseCents);
  assertEquals(undone.transactions.find((t: any) => t.id === ids[5]).splitOf, ids[4]);
});

Deno.test("auto-combine turns a voucher wrongly combined as a transfer into a part", async () => {
  const { call, f, add, ops, list } = await accountsFamily();
  const [card] = await add({
    date: "2026-12-29",
    amountCents: -499,
    payee: "AMAZON.DE",
    accountId: "savings",
  });
  const ids = await add(...SPLIT_STATEMENT.map((r) => ({ ...r, accountId: "checking" })));
  const voucher = ids[12];
  await ops({ action: "link", ids: [card, voucher] });
  assertEquals((await list("kind=transfer")).total, 2);
  // "Find transfers" doesn't suggest order lines either.
  await ops({ action: "unlink", id: card });
  assertEquals((await call("GET", `${f}/transfers/suggestions`)).data.pairs, []);
  await ops({ action: "link", ids: [card, voucher] });

  const res = await call("POST", `${f}/transfers/auto`, {});
  assertEquals([res.data.splits, res.data.linked], [4, 0]);
  assertEquals((await list("kind=transfer")).total, 0);
  const year = await list("from=2026-12-01&to=2026-12-31&account=checking");
  assertEquals(year.incomeCents - year.expenseCents, SPLIT_STATEMENT_NET);
  assertEquals((await list("account=savings")).expenseCents, 499);

  // Undo puts the transfer back and the order lines back on their own.
  await ops(...res.data.inverse);
  const after = await list();
  assertEquals(after.transactions.filter((t: any) => t.split || t.splitOf), []);
  assertEquals((await list("kind=transfer")).total, 2);
});

Deno.test("transactions can be split and unsplit by hand", async () => {
  const { call, f, add, ops, list } = await accountsFamily();
  const [booking, a, b, other, c, d] = await add(
    { date: "2026-03-01", amountCents: -5000, payee: "Shop", accountId: "checking" },
    { date: "2026-03-01", amountCents: -3000, categoryId: "groceries" },
    { date: "2026-03-01", amountCents: -1500, categoryId: "kids" },
    { date: "2026-03-02", amountCents: -100, accountId: "checking" },
    { date: "2026-03-02", amountCents: -500, accountId: "checking" },
    { date: "2026-03-02", amountCents: 500, accountId: "savings" },
  );
  const bad = async (op: Record<string, unknown>, status = 400) =>
    assertEquals((await call("POST", `${f}/transactions`, op)).status, status);
  await bad({ action: "split", ids: [a] });
  await bad({ action: "split", id: booking, ids: [booking] });
  await bad({ action: "split", id: booking, ids: [crypto.randomUUID()] }, 404);

  const res = await ops({ action: "split", id: booking, ids: [a, b] });
  assertEquals(res.changed, 3);
  const month = await list("from=2026-03-01&to=2026-03-01");
  assertEquals([month.incomeCents, month.expenseCents], [0, 5000]);
  const row = (id: string) => month.transactions.find((t: any) => t.id === id);
  assertEquals(row(booking).split, { parts: 2, remainderCents: -500 });
  assertEquals([row(a).splitOf, row(b).splitOf, row(booking).splitOf], [booking, booking, null]);
  // Each part counts in its own category, the rest in the booking's (none).
  const summary = (await call("GET", `${f}/summary?from=2026-03-01&to=2026-03-01`)).data;
  assertEquals(
    summary.categories.map((c: any) => [c.categoryId, c.expenseCents]),
    [["groceries", 3000], ["kids", 1500], [null, 500]],
  );

  // Parts and bookings can't be transfer legs, and parts can't have parts.
  await bad({ action: "link", ids: [booking, d] });
  await bad({ action: "link", ids: [a, d] });
  await bad({ action: "split", id: a, ids: [other] });
  await bad({ action: "split", id: other, ids: [booking] });
  await bad({ action: "update", id: a, transferId: crypto.randomUUID() });
  // A transfer leg that becomes a part leaves its transfer.
  await ops({ action: "link", ids: [c, d] });
  await ops({ action: "split", id: other, ids: [c] });
  assertEquals((await list("kind=transfer")).total, 0);
  await ops({ action: "unsplit", ids: [c] });

  // Deleting the booking keeps its parts; undo makes them parts again.
  const del = await ops({ action: "delete", ids: [booking] });
  assertEquals((await list("from=2026-03-01&to=2026-03-01")).expenseCents, 4500);
  assert((await list()).transactions.every((t: any) => !t.splitOf));
  await ops(...del.inverse);
  assertEquals((await list()).transactions.find((t: any) => t.id === a).splitOf, booking);
  assertEquals((await list("from=2026-03-01&to=2026-03-01")).expenseCents, 5000);

  // Unsplitting a part takes just it out; unsplitting the booking all of them.
  await ops({ action: "unsplit", ids: [a] });
  let rows = (await list()).transactions;
  assertEquals(rows.find((t: any) => t.id === booking).split, { parts: 1, remainderCents: -3500 });
  const undo = await ops({ action: "unsplit", ids: [booking] });
  rows = (await list()).transactions;
  assertEquals(rows.filter((t: any) => t.split || t.splitOf), []);
  assertEquals((await list("from=2026-03-01&to=2026-03-01")).expenseCents, 9500);
  // Undo gives the booking back the part it had (a was taken out before).
  await ops(...undo.inverse);
  assertEquals((await list("from=2026-03-01&to=2026-03-01")).expenseCents, 8000);
});

Deno.test("exports, imports, clones and snapshots keep split bookings", async () => {
  const { call, s, store, add, ops } = await accountsFamily();
  const [booking, a, b] = await add(
    { date: "2026-03-01", amountCents: -5000, accountId: "checking" },
    { date: "2026-03-01", amountCents: -3000, accountId: "checking" },
    { date: "2026-03-01", amountCents: -2000, accountId: "checking" },
  );
  await ops({ action: "split", id: booking, ids: [a, b] });
  const file = (await call("GET", `/families/${s.id}/export`)).data;
  assertEquals(file.finance.transactions.filter((t: any) => t.splitOf === booking).length, 2);
  const check = async (familyId: string) => {
    const t = `/families/${familyId}/finance`;
    const res = (await call("GET", `${t}/transactions`)).data;
    assertEquals([res.incomeCents, res.expenseCents], [0, 5000]);
    const top = res.transactions.find((t: any) => t.split);
    assertEquals(top.split, { parts: 2, remainderCents: 0 });
    assertEquals(res.transactions.filter((t: any) => t.splitOf === top.id).length, 2);
    assertEquals((await call("GET", t)).data.accounts[0].balanceCents, 1000 - 5000);
  };

  const target = (await call("POST", "/families", {})).data.family;
  assertEquals((await call("POST", `/families/${target.id}/import`, file)).status, 200);
  await check(target.id);
  // A part whose booking isn't in the file is refused.
  const broken = {
    ...file,
    finance: {
      ...file.finance,
      transactions: file.finance.transactions.filter((t: any) => t.id !== booking),
    },
  };
  assertEquals((await call("POST", `/families/${target.id}/import`, broken)).status, 400);

  const copy = (await call("POST", `/families/${s.id}/clone`, {})).data.family;
  await check(copy.id);
  const copied = (await call("GET", `/families/${copy.id}/finance/transactions`)).data;
  assert(copied.transactions.every((t: any) => t.splitOf !== booking));

  const restored = new MemoryStore();
  restored.restore(JSON.parse(JSON.stringify(store.snapshot())));
  const [part] = await restored.getTransactions(s.id, [a]);
  assertEquals(part.split_of, booking);
});

Deno.test("the AI tools combine and list split bookings", async () => {
  const { store, s, add, ops } = await accountsFamily();
  await add(...SPLIT_STATEMENT.map((r) => ({ ...r, accountId: "checking" })));
  const ctx = { lang: "en" as const, store, familyId: s.id, net: {} as any, search: null };
  const allowed = new Set(Object.keys(TOOLS));
  const run = async (name: string, args: unknown) =>
    await runTool(name, JSON.stringify(args), ctx, allowed);
  const combined = await run("combine_transfers", {});
  assertEquals((combined.result as any).splits, 4);
  assertEquals(combined.change?.summary, "4 split bookings combined");
  const listed = (await run("list_transactions", {})).result as any;
  assertEquals(listed.incomeCents - listed.expenseCents, SPLIT_STATEMENT_NET);
  const splitOf = listed.columns.indexOf("splitOf");
  assertEquals(listed.rows.filter((r: any) => r[splitOf]).length, 7);
  await ops(...(combined.change!.undo[0].body as any).ops);
  const after = (await run("list_transactions", {})).result as any;
  assertEquals(after.rows.filter((r: any) => r[splitOf]).length, 0);
});
