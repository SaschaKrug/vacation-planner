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

const BASE = "http://localhost/functions/v1/api";

function setup(options?: HandlerOptions) {
  const handler = createHandler(new MemoryStore(), options);
  const call = async (method: string, path: string, body?: unknown, ip = "203.0.113.7") => {
    const res = await handler(
      new Request(BASE + path, {
        method,
        headers: {
          "x-forwarded-for": ip,
          ...(body ? { "content-type": "application/json" } : {}),
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
  return { call };
}

async function newSession(call: ReturnType<typeof setup>["call"]) {
  const res = await call("POST", "/sessions", { name: "Family", year: 2026 });
  assertEquals(res.status, 201);
  return res.data.session as { id: string; readId: string };
}

Deno.test("creates a session with preset types", async () => {
  const { call } = setup();
  const res = await call("POST", "/sessions", {});
  assertEquals(res.status, 201);
  assertEquals(res.data.types.map((t: any) => t.name), ["Holiday", "Vacation", "Sick"]);
  // Without a year, the presets go into the current year.
  const year = new Date().getUTCFullYear();
  assertEquals(res.data.types.map((t: any) => t.year), [year, year, year]);
  assertEquals(res.data.typeYears, [year]);
  assertEquals(res.data.session.readOnly, false);
  assertMatch(res.data.session.id, /^[A-Za-z0-9]{20}$/);
  assert(res.data.session.id !== res.data.session.readId);
});

Deno.test("creates a German session with localized presets", async () => {
  const { call } = setup();
  const res = await call("POST", "/sessions", { lang: "de", year: 2026 });
  assertEquals(res.status, 201);
  assertEquals(res.data.session.name, "Urlaubsplaner");
  assertEquals(res.data.types.map((t: any) => [t.id, t.name]), [
    ["holiday", "Feiertag"],
    ["vacation", "Urlaub"],
    ["sick", "Krank"],
  ]);
  assertEquals(res.data.types.map((t: any) => t.role), ["day_off", "covers", "none"]);
  // Ids stay stable, so API references keep working.
  const entry = await call("POST", `/sessions/${res.data.session.id}/entries`, {
    type: "vacation",
    dates: ["2026-08-03"],
  });
  assertEquals(entry.status, 200);

  const en = await call("POST", "/sessions", {});
  assertEquals(en.data.session.name, "Vacation planner");

  const custom = await call("POST", "/sessions", {
    lang: "de",
    types: [{ name: "Kita zu", color: "#8b5cf6", role: "needs_cover" }],
  });
  assertEquals(custom.data.session.name, "Urlaubsplaner");
  assertEquals(custom.data.types.map((t: any) => t.name), ["Kita zu"]);
});

Deno.test("rejects an unknown lang", async () => {
  const { call } = setup();
  for (const lang of ["fr", "DE", 1, null]) {
    const res = await call("POST", "/sessions", { lang });
    assertEquals(res.status, 400);
    assertEquals(res.data.error, "lang must be en or de");
  }
});

Deno.test("adds, removes, sets and clears entries", async () => {
  const { call } = setup();
  const s = await newSession(call);
  const post = (body: unknown) => call("POST", `/sessions/${s.id}/entries`, body);

  assertEquals(
    (await post({ action: "add", type: "Vacation", from: "2026-08-03", to: "2026-08-09" })).status,
    200,
  );
  await post({ action: "add", type: "sick", dates: ["2026-08-04"] });
  let state = (await call("GET", `/sessions/${s.id}?year=2026`)).data;
  assertEquals(Object.keys(state.entries).length, 7);
  assertEquals(state.entries["2026-08-04"].sort(), ["sick", "vacation"]);

  await post({
    ops: [
      { action: "remove", type: "vacation", dates: ["2026-08-04"] },
      { action: "set", types: ["holiday"], dates: ["2026-08-05"] },
      { action: "clear", from: "2026-08-08", to: "2026-08-09" },
    ],
  });
  state = (await call("GET", `/sessions/${s.id}?year=2026`)).data;
  assertEquals(state.entries["2026-08-04"], ["sick"]);
  assertEquals(state.entries["2026-08-05"], ["holiday"]);
  assertEquals(state.entries["2026-08-08"], undefined);
  assertEquals((await call("GET", `/sessions/${s.id}?year=2025`)).data.entries, {});
});

Deno.test("skipWeekends leaves Saturday and Sunday out", async () => {
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/entries`, {
    action: "add",
    type: "vacation",
    from: "2026-08-03",
    to: "2026-08-16",
    skipWeekends: true,
  });
  const entries = (await call("GET", `/sessions/${s.id}/entries?year=2026`)).data;
  assertEquals(Object.keys(entries).length, 10);
});

Deno.test("read-only id can read but not write", async () => {
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/entries`, { type: "vacation", dates: ["2026-01-05"] });
  await call("POST", `/sessions/${s.id}/types`, { name: "Remote", color: "#123456", year: 2026 });

  const state = (await call("GET", `/sessions/${s.readId}?year=2026`)).data;
  assertEquals(state.session.readOnly, true);
  assertEquals(state.session.id, undefined);
  assertEquals(state.session.readId, s.readId);
  assertEquals(state.types.map((t: any) => t.id), ["holiday", "vacation", "sick", "remote"]);
  assertEquals(state.entries, { "2026-01-05": ["vacation"] });
  assertEquals((await call("GET", `/sessions/${s.readId}/entries`)).data, {
    "2026-01-05": ["vacation"],
  });
  assertEquals((await call("GET", `/sessions/${s.readId}/types?year=2026`)).data.length, 4);

  const writes: [string, string, unknown?][] = [
    ["POST", "/entries", { type: "vacation", dates: ["2026-01-02"] }],
    ["PATCH", "", { name: "Hijacked" }],
    ["POST", "/types", { name: "X", color: "#000000" }],
    ["PATCH", "/types/vacation?year=2026", { name: "X" }],
    ["DELETE", "/types/vacation?year=2026"],
    ["POST", "/types/copy", { from: 2026, to: 2027 }],
  ];
  for (const [method, path, body] of writes) {
    assertEquals((await call(method, `/sessions/${s.readId}${path}`, body)).status, 403);
  }
  const after = (await call("GET", `/sessions/${s.id}?year=2026`)).data;
  assertEquals(after.session.name, "Family");
  assertEquals(after.types.length, 4);
  assertEquals(after.entries, { "2026-01-05": ["vacation"] });
});

Deno.test("rejects malformed tokens as not found", async () => {
  const { call } = setup();
  const s = await newSession(call);
  for (const token of ["abc,def.ghij", "aaaaaaaaaa)", `${s.id},read_id.eq.x`, "short"]) {
    const t = encodeURIComponent(token);
    assertEquals((await call("GET", `/sessions/${t}`)).status, 404);
    assertEquals((await call("GET", `/sessions/${t}/entries`)).status, 404);
    assertEquals((await call("PATCH", `/sessions/${t}`, { name: "X" })).status, 404);
    assertEquals(
      (await call("POST", `/sessions/${t}/entries`, { type: "vacation", dates: ["2026-01-02"] }))
        .status,
      404,
    );
  }
});

Deno.test("validates input", async () => {
  const { call } = setup();
  const s = await newSession(call);
  const post = (body: unknown) => call("POST", `/sessions/${s.id}/entries`, body);
  assertEquals((await post({ type: "vacation", dates: ["2026-02-30"] })).status, 400);
  assertEquals((await post({ type: "nope", dates: ["2026-02-03"] })).status, 404);
  assertEquals((await post({ action: "add", dates: ["2026-02-03"] })).status, 400);
  assertEquals((await call("GET", "/sessions/doesnotexist123")).status, 404);
  assertEquals(
    (await call("POST", `/sessions/${s.id}/types`, { name: "X", color: "red" })).status,
    400,
  );
});

Deno.test("manages entry types", async () => {
  const { call } = setup();
  const s = await newSession(call);
  const created = await call("POST", `/sessions/${s.id}/types?year=2026`, {
    name: "Day care closed",
    color: "#8B5CF6",
    role: "needs_cover",
  });
  assertEquals(created.status, 201);
  assertEquals(created.data.id, "day-care-closed");
  assertEquals(created.data.year, 2026);
  assertEquals(created.data.color, "#8b5cf6");
  assertEquals(created.data.position, 3);

  const renamed = await call("PATCH", `/sessions/${s.id}/types/vacation?year=2026`, {
    name: "Vacation Dad",
  });
  assertEquals(renamed.data.name, "Vacation Dad");
  // Names work as references too.
  await call("POST", `/sessions/${s.id}/entries`, {
    type: "vacation dad",
    dates: ["2026-03-02"],
  });

  await call("DELETE", `/sessions/${s.id}/types/vacation?year=2026`);
  const state = (await call("GET", `/sessions/${s.id}`)).data;
  assertEquals(state.types.map((t: any) => t.id), ["holiday", "sick", "day-care-closed"]);
  assertEquals(state.entries, {});
});

Deno.test("renames a session", async () => {
  const { call } = setup();
  const s = await newSession(call);
  const res = await call("PATCH", `/sessions/${s.id}`, { name: "Our family" });
  assertEquals(res.status, 200);
  assertEquals(res.data.session.name, "Our family");
  assertEquals(res.data.session.id, s.id);
  assertEquals(res.data.session.readOnly, false);
  assertEquals(res.data.types.length, 3);
  assertEquals((await call("GET", `/sessions/${s.readId}`)).data.session.name, "Our family");
});

Deno.test("serves an iCalendar feed with merged ranges and gaps", async () => {
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/types`, {
    name: "Day care closed",
    color: "#8b5cf6",
    role: "needs_cover",
    year: 2026,
  });
  await call("POST", `/sessions/${s.id}/entries`, {
    ops: [
      { action: "add", type: "day-care-closed", from: "2026-08-03", to: "2026-08-07" },
      { action: "add", type: "vacation", from: "2026-08-03", to: "2026-08-05" },
    ],
  });
  const res = await call("GET", `/sessions/${s.readId}/calendar.ics?gaps=1`);
  assertEquals(res.status, 200);
  assertMatch(res.headers.get("content-type")!, /^text\/calendar/);
  const ics: string = res.data;
  assert(ics.includes("SUMMARY:Vacation\r\n"));
  assert(ics.includes("DTSTART;VALUE=DATE:20260803\r\nDTEND;VALUE=DATE:20260806"));
  assert(ics.includes("SUMMARY:⚠ Not covered: Day care closed"));
  assert(ics.includes("DTSTART;VALUE=DATE:20260806\r\nDTEND;VALUE=DATE:20260808"));

  const onlyVacation =
    (await call("GET", `/sessions/${s.readId}/calendar.ics?types=vacation`)).data;
  assert(!onlyVacation.includes("Day care closed"));
  assertEquals(onlyVacation.match(/BEGIN:VEVENT/g).length, 1);
});

Deno.test("serves a German iCalendar feed with ?lang=de", async () => {
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/types`, {
    name: "Kita zu",
    color: "#8b5cf6",
    role: "needs_cover",
    year: 2026,
  });
  await call("POST", `/sessions/${s.id}/entries`, {
    ops: [
      { action: "add", type: "kita-zu", from: "2026-08-06", to: "2026-08-07" },
      { action: "add", type: "vacation", from: "2026-08-07", to: "2026-08-09" },
    ],
  });
  const de: string = (await call("GET", `/sessions/${s.readId}/calendar.ics?gaps=1&lang=de`))
    .data;
  assert(de.includes("SUMMARY:⚠ Nicht abgedeckt: Kita zu\r\n"));
  assert(de.includes("DESCRIPTION:Vacation: 3 Tage (1 Arbeitstag)\r\n"));

  // Unknown languages fall back to English instead of breaking the feed.
  const fallback = await call("GET", `/sessions/${s.readId}/calendar.ics?gaps=1&lang=xx`);
  assertEquals(fallback.status, 200);
  assert(fallback.data.includes("SUMMARY:⚠ Not covered: Kita zu\r\n"));
  assert(fallback.data.includes("DESCRIPTION:Vacation: 3 days (1 workdays)\r\n"));
});

Deno.test("sets, replaces and clears day notes", async () => {
  const { call } = setup();
  const s = await newSession(call);
  const post = (body: unknown) => call("POST", `/sessions/${s.id}/notes`, body);

  let res = await post({
    icon: " 🎄 ",
    comment: " Christmas ",
    from: "2026-12-24",
    to: "2026-12-26",
  });
  assertEquals(res.status, 200);
  assertEquals(res.data, { ok: true, ops: 1, days: 3 });
  assertEquals((await call("GET", `/sessions/${s.id}/notes?year=2026`)).data, {
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
  const notes = (await call("GET", `/sessions/${s.id}/notes?from=2026-12-01&to=2026-12-31`)).data;
  assertEquals(notes, { "2026-12-24": { icon: "🎁", comment: "" } });
  assertEquals(
    Object.keys((await call("GET", `/sessions/${s.id}/notes?year=2026`)).data).length,
    5,
  );
  assertEquals((await call("GET", `/sessions/${s.id}/notes?year=2025`)).data, {});
});

Deno.test("note ops skip weekends like entry ops", async () => {
  const { call } = setup();
  const s = await newSession(call);
  const res = await call("POST", `/sessions/${s.id}/notes`, {
    icon: "🏖",
    from: "2026-08-03",
    to: "2026-08-16",
    skipWeekends: true,
  });
  assertEquals(res.data.days, 10);
  const notes = (await call("GET", `/sessions/${s.id}/notes`)).data;
  assertEquals(Object.keys(notes).length, 10);
  assertEquals(notes["2026-08-08"], undefined);
});

Deno.test("session state includes notes for the requested range", async () => {
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/notes`, {
    ops: [
      { icon: "🎄", comment: "Christmas", date: "2026-12-25" },
      { icon: "🎆", date: "2025-12-31" },
    ],
  });
  const state = (await call("GET", `/sessions/${s.id}?year=2026`)).data;
  assertEquals(state.notes, { "2026-12-25": { icon: "🎄", comment: "Christmas" } });
  // The view-only id reads notes too.
  const view = (await call("GET", `/sessions/${s.readId}?from=2025-12-01&to=2025-12-31`)).data;
  assertEquals(view.notes, { "2025-12-31": { icon: "🎆", comment: "" } });
  assertEquals(
    Object.keys((await call("GET", `/sessions/${s.readId}/notes`)).data),
    ["2025-12-31", "2026-12-25"],
  );
  assertEquals((await call("POST", "/sessions", {})).data.notes, {});
});

Deno.test("notes and entries are independent", async () => {
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/entries`, { type: "holiday", date: "2026-12-25" });
  await call("POST", `/sessions/${s.id}/notes`, { comment: "Christmas", date: "2026-12-25" });

  await call("POST", `/sessions/${s.id}/entries`, { action: "clear", date: "2026-12-25" });
  let state = (await call("GET", `/sessions/${s.id}?year=2026`)).data;
  assertEquals(state.entries, {});
  assertEquals(state.notes, { "2026-12-25": { icon: "", comment: "Christmas" } });

  await call("POST", `/sessions/${s.id}/entries`, { type: "holiday", date: "2026-12-25" });
  await call("POST", `/sessions/${s.id}/notes`, { action: "clear", date: "2026-12-25" });
  state = (await call("GET", `/sessions/${s.id}?year=2026`)).data;
  assertEquals(state.entries, { "2026-12-25": ["holiday"] });
  assertEquals(state.notes, {});
});

Deno.test("read-only id cannot change notes", async () => {
  const { call } = setup();
  const s = await newSession(call);
  const res = await call("POST", `/sessions/${s.readId}/notes`, {
    icon: "🎄",
    date: "2026-12-25",
  });
  assertEquals(res.status, 403);
  assertEquals(res.data.error, "This is a read-only link");
});

Deno.test("validates note ops", async () => {
  const { call } = setup();
  const s = await newSession(call);
  const post = (body: unknown) => call("POST", `/sessions/${s.id}/notes`, body);
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
  assertEquals(Object.keys((await call("GET", `/sessions/${s.id}/notes`)).data), ["2026-10-03"]);
});

Deno.test("adds notes to the iCalendar feed only with ?notes=1", async () => {
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/entries`, { type: "holiday", date: "2026-12-25" });
  await call("POST", `/sessions/${s.id}/notes`, {
    ops: [
      { icon: "🎄", comment: "Christmas", from: "2026-12-24", to: "2026-12-26" },
      { icon: "🎆", comment: "New Year's Eve, party", date: "2026-12-31" },
    ],
  });
  const plain: string = (await call("GET", `/sessions/${s.readId}/calendar.ics`)).data;
  assertEquals(plain.match(/BEGIN:VEVENT/g)!.length, 1);
  assert(!plain.includes("Christmas"));

  const ics: string = (await call("GET", `/sessions/${s.readId}/calendar.ics?notes=1`)).data;
  assertEquals(ics.match(/BEGIN:VEVENT/g)!.length, 3);
  assert(ics.includes("SUMMARY:🎄 Christmas\r\n"));
  assert(ics.includes("DTSTART;VALUE=DATE:20261224\r\nDTEND;VALUE=DATE:20261227"));
  assert(ics.includes(`UID:${s.readId}-note-2026-12-24@vacation-planner`));
  assert(ics.includes("SUMMARY:🎆 New Year's Eve\\, party\r\n"));
  // Type filters don't hide notes.
  const filtered: string =
    (await call("GET", `/sessions/${s.readId}/calendar.ics?types=sick&notes=1`)).data;
  assertEquals(filtered.match(/BEGIN:VEVENT/g)!.length, 2);
});

Deno.test("every year has its own entry types", async () => {
  const { call } = setup();
  const s = await newSession(call);
  const types = `/sessions/${s.id}/types`;
  const state = (year: number) => call("GET", `/sessions/${s.id}?year=${year}`);

  // A year without types of its own has none, and its days can't use other years' types.
  assertEquals((await state(2027)).data.types, []);
  assertEquals((await state(2027)).data.typeYears, [2026]);
  const missing = await call("POST", `/sessions/${s.id}/entries`, {
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
  const all = (await call("GET", `/sessions/${s.id}`)).data;
  assertEquals(all.types.length, 8);
  const range = (await call("GET", `/sessions/${s.id}?from=2026-12-01&to=2027-01-31`)).data;
  assertEquals(range.types.length, 8);
  assertEquals((await call("GET", `/sessions/${s.id}?year=2028`)).data.types, []);

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
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/types`, { name: "Urlaub", color: "#22c55e", year: 2027 });
  // "Urlaub" is "vacation" in 2026 (renamed) and "urlaub" in 2027.
  await call("PATCH", `/sessions/${s.id}/types/vacation?year=2026`, { name: "Urlaub" });
  const res = await call("POST", `/sessions/${s.id}/entries`, {
    type: "urlaub",
    from: "2026-12-31",
    to: "2027-01-01",
  });
  assertEquals(res.data, { ok: true, ops: 1, days: 2 });
  assertEquals((await call("GET", `/sessions/${s.id}/entries`)).data, {
    "2026-12-31": ["vacation"],
    "2027-01-01": ["urlaub"],
  });

  // Deleting a type removes only its own year's entries.
  await call("POST", `/sessions/${s.id}/types/copy`, { from: 2026, to: 2027 });
  await call("POST", `/sessions/${s.id}/entries`, { type: "vacation", date: "2027-01-04" });
  await call("DELETE", `/sessions/${s.id}/types/vacation?year=2027`);
  assertEquals((await call("GET", `/sessions/${s.id}/entries`)).data, {
    "2026-12-31": ["vacation"],
    "2027-01-01": ["urlaub"],
  });
});

Deno.test("the iCalendar feed uses each year's types", async () => {
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/types/copy`, { from: 2026, to: 2027 });
  await call("PATCH", `/sessions/${s.id}/types/vacation?year=2027`, {
    name: "Day care closed",
    role: "needs_cover",
  });
  await call("POST", `/sessions/${s.id}/entries`, {
    ops: [
      { type: "vacation", date: "2026-08-03" },
      { type: "vacation", date: "2027-08-02" },
    ],
  });
  const ics: string = (await call("GET", `/sessions/${s.readId}/calendar.ics?gaps=1`)).data;
  assert(ics.includes("SUMMARY:Vacation\r\nDESCRIPTION:Vacation\r\n"));
  assert(ics.includes(`UID:${s.readId}-vacation-2027-08-02@vacation-planner`));
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
    (await call("GET", `/sessions/${s.readId}/calendar.ics?types=day%20care%20closed`)).data;
  assertEquals(byName.match(/BEGIN:VEVENT/g)!.length, 1);
  const byId: string = (await call("GET", `/sessions/${s.readId}/calendar.ics?types=vacation`))
    .data;
  assertEquals(byId.match(/BEGIN:VEVENT/g)!.length, 2);
  assertEquals((await call("GET", `/sessions/${s.readId}/calendar.ics?types=nope`)).status, 404);
});

Deno.test("answers CORS preflight", async () => {
  const handler = createHandler(new MemoryStore());
  const res = await handler(new Request(BASE + "/sessions", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});

Deno.test("agent page describes the planner with ready-to-use URLs", async () => {
  const { call } = setup();
  // Types only in 2025: the examples use that year instead of the current one.
  const created = await call("POST", "/sessions", { name: "Family", year: 2025 });
  const s = created.data.session;
  const res = await call("GET", `/sessions/${s.id}/agent`);
  assertEquals(res.status, 200);
  assertMatch(res.headers.get("content-type")!, /^text\/markdown/);
  assertEquals(res.headers.get("cache-control"), "no-store");
  const doc: string = res.data;
  assert(doc.includes("Family"));
  assert(doc.includes("full edit access"));
  assert(doc.includes(`POST ${BASE}/sessions/${s.id}/entries`));
  assert(doc.includes("| `vacation` | Vacation | covers | #22c55e |"));
  // The example body in the page works against the real endpoint.
  const body = JSON.parse(/-d '(\{.*\})'/.exec(doc)![1]);
  assertEquals(body.from, "2025-08-03");
  const add = await call("POST", `/sessions/${s.id}/entries`, body);
  assertEquals(add.status, 200);
  const entries = await call("GET", `/sessions/${s.id}/entries?year=2025`);
  assert(entries.data["2025-08-04"].includes("vacation"));
});

Deno.test("agent page for a read-only id has no edit id or write requests", async () => {
  const { call } = setup();
  const s = await newSession(call);
  const res = await call("GET", `/sessions/${s.readId}/agent`);
  assertEquals(res.status, 200);
  assert(res.data.includes("read-only"));
  assert(!res.data.includes(s.id));
  assert(!res.data.includes("POST"));
});

Deno.test("agent page only answers GET and doesn't run requests", async () => {
  const { call } = setup();
  const s = await newSession(call);
  let res = await call("POST", `/sessions/${s.id}/agent`, {});
  assertEquals(res.status, 405);
  const body = encodeURIComponent(JSON.stringify({ type: "vacation", date: "2026-03-02" }));
  res = await call("GET", `/sessions/${s.id}/agent/entries?method=POST&body=${body}`);
  assertEquals(res.status, 404);
  res = await call("GET", `/sessions/${s.id}/agent?method=PATCH&body=%7B%22name%22%3A%22x%22%7D`);
  assertEquals(res.status, 200);
  const state = await call("GET", `/sessions/${s.id}?year=2026`);
  assertEquals(state.data.session.name, "Family");
  assertEquals(state.data.entries, {});
  res = await call("GET", `/sessions/nosuchsession1234/agent`);
  assertEquals(res.status, 404);
});

Deno.test("clones a planner with all years, types, entries and notes", async () => {
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/types/copy`, { from: 2026, to: 2027 });
  await call("POST", `/sessions/${s.id}/entries`, {
    ops: [
      { type: "vacation", dates: ["2026-08-03"] },
      { type: "holiday", dates: ["2027-01-01"] },
    ],
  });
  await call("POST", `/sessions/${s.id}/notes`, { icon: "🎄", date: "2026-12-25" });

  const res = await call("POST", `/sessions/${s.id}/clone`, {});
  assertEquals(res.status, 201);
  const copy = res.data.session;
  assertEquals(copy.name, "Family (copy)");
  assertEquals(copy.readOnly, false);
  assert(![s.id, s.readId].includes(copy.id) && ![s.id, s.readId].includes(copy.readId));
  assertEquals(res.data.typeYears, [2026, 2027]);

  const all = (await call("GET", `/sessions/${copy.id}`)).data;
  assertEquals(all.entries, { "2026-08-03": ["vacation"], "2027-01-01": ["holiday"] });
  assertEquals(all.notes, { "2026-12-25": { icon: "🎄", comment: "" } });

  // The copy is independent of the original.
  await call("POST", `/sessions/${copy.id}/entries`, { action: "clear", date: "2026-08-03" });
  await call("PATCH", `/sessions/${copy.id}/types/sick?year=2026`, { name: "Ill" });
  const original = (await call("GET", `/sessions/${s.id}?year=2026`)).data;
  assertEquals(original.entries, { "2026-08-03": ["vacation"] });
  assertEquals(original.types.find((t: any) => t.id === "sick").name, "Sick");
});

Deno.test("a view-only id can clone, and the copy is editable", async () => {
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/entries`, { type: "vacation", date: "2026-05-04" });
  const res = await call("POST", `/sessions/${s.readId}/clone`, { name: "Mine" });
  assertEquals(res.status, 201);
  assertEquals(res.data.session.name, "Mine");
  assertEquals(res.data.entries, { "2026-05-04": ["vacation"] });
  const edit = await call("POST", `/sessions/${res.data.session.id}/entries`, {
    type: "sick",
    date: "2026-05-05",
  });
  assertEquals(edit.status, 200);
});

Deno.test("clone validates its input", async () => {
  const { call } = setup();
  const s = await newSession(call);
  assertEquals((await call("POST", "/sessions/unknownToken123/clone", {})).status, 404);
  assertEquals((await call("GET", `/sessions/${s.id}/clone`)).status, 405);
  assertEquals((await call("POST", `/sessions/${s.id}/clone`, { name: "" })).status, 400);
  const long = await call("PATCH", `/sessions/${s.id}`, { name: "x".repeat(80) });
  assertEquals(long.status, 200);
  const res = await call("POST", `/sessions/${s.id}/clone`, {});
  assertEquals(res.data.session.name, "x".repeat(73) + " (copy)");
});

Deno.test("exports a planner and imports the file over another one", async () => {
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/types/copy`, { from: 2026, to: 2027 });
  await call("PATCH", `/sessions/${s.id}/types/sick?year=2027`, { name: "Ill", position: 7 });
  await call("POST", `/sessions/${s.id}/entries`, {
    ops: [
      { types: ["vacation", "sick"], dates: ["2026-08-03"] },
      { type: "holiday", dates: ["2027-01-01"] },
    ],
  });
  await call("POST", `/sessions/${s.id}/notes`, {
    icon: "🎄",
    comment: "Xmas",
    date: "2026-12-25",
  });

  // The view-only id may export; the file never contains the planner's ids.
  const res = await call("GET", `/sessions/${s.readId}/export`);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-disposition"), 'attachment; filename="family.json"');
  const file = res.data;
  assertEquals(file.format, "vacation-planner");
  assertEquals(file.version, 1);
  assertEquals(file.name, "Family");
  assertEquals(file.types.length, 6);
  assertEquals(file.entries, { "2026-08-03": ["vacation", "sick"], "2027-01-01": ["holiday"] });
  assertEquals(file.notes, { "2026-12-25": { icon: "🎄", comment: "Xmas" } });
  const text = JSON.stringify(file);
  assert(!text.includes(s.id) && !text.includes(s.readId));

  // Importing replaces everything of the target, but keeps its name and links.
  const target = (await call("POST", "/sessions", { name: "Other", year: 2028 })).data.session;
  await call("POST", `/sessions/${target.id}/types?year=2028`, { name: "Gone", color: "#000000" });
  await call("POST", `/sessions/${target.id}/entries`, { type: "gone", date: "2028-03-01" });
  await call("POST", `/sessions/${target.id}/notes`, { icon: "👻", date: "2028-03-02" });
  const imported = await call("POST", `/sessions/${target.id}/import?year=2027`, file);
  assertEquals(imported.status, 200);
  assertEquals(imported.data.session.id, target.id);
  assertEquals(imported.data.session.name, "Other");
  assertEquals(imported.data.typeYears, [2026, 2027]);
  assertEquals(imported.data.entries, { "2027-01-01": ["holiday"] });

  const all = (await call("GET", `/sessions/${target.id}`)).data;
  const original = (await call("GET", `/sessions/${s.id}`)).data;
  assertEquals(all.types, original.types);
  assertEquals(all.entries, original.entries);
  assertEquals(all.notes, original.notes);
  assertEquals((await call("GET", `/sessions/${target.id}/export`)).data.types, file.types);
});

Deno.test("import needs the edit id and validates the file", async () => {
  const { call } = setup();
  const s = await newSession(call);
  const type = { year: 2026, id: "vacation", name: "Vacation", color: "#22c55e", role: "covers" };
  const file = { format: "vacation-planner", version: 1, name: "Imported", types: [type] };
  const path = `/sessions/${s.id}/import`;
  const status = async (body: unknown) => (await call("POST", path, body)).status;

  assertEquals((await call("POST", `/sessions/${s.readId}/import`, file)).status, 403);
  assertEquals((await call("POST", "/sessions/unknownToken123/import", file)).status, 404);
  assertEquals((await call("GET", path)).status, 405);
  assertEquals(await status({ ...file, format: "other" }), 400);
  assertEquals(await status({ ...file, version: 2 }), 400);
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
  const before = (await call("GET", `/sessions/${s.id}`)).data;
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
};

Deno.test("limits how many planners one client creates", async () => {
  const { call } = setup({ rateLimiter: new MemoryRateLimiter(), limits: SMALL_LIMITS });
  const s = await newSession(call);
  // Cloning counts as creating.
  assertEquals((await call("POST", `/sessions/${s.id}/clone`, {})).status, 201);
  const res = await call("POST", "/sessions", {});
  assertEquals(res.status, 429);
  assertMatch(res.data.error, /^Too many requests/);
  const retry = Number(res.headers.get("retry-after"));
  assert(retry > 0 && retry <= 3600);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
  assertEquals((await call("POST", `/sessions/${s.id}/clone`, {})).status, 429);
  // Other clients and reads are not affected.
  assertEquals((await call("POST", "/sessions", {}, "198.51.100.1")).status, 201);
  assertEquals((await call("GET", `/sessions/${s.id}`)).status, 200);
});

Deno.test("limits planners of all clients together", async () => {
  const { call } = setup({ rateLimiter: new MemoryRateLimiter(), limits: SMALL_LIMITS });
  for (let i = 0; i < 5; i++) {
    assertEquals((await call("POST", "/sessions", {}, `198.51.100.${i}`)).status, 201);
  }
  assertEquals((await call("POST", "/sessions", {}, "198.51.100.99")).status, 429);
});

Deno.test("limits writes per client, but not reads", async () => {
  const limiter = new MemoryRateLimiter();
  const { call } = setup({ rateLimiter: limiter, limits: SMALL_LIMITS });
  const s = await newSession(call);
  const write = (ip?: string) =>
    call("POST", `/sessions/${s.id}/entries`, { type: "vacation", date: "2026-03-02" }, ip);
  for (let i = 0; i < 3; i++) assertEquals((await write()).status, 200);
  assertEquals((await write()).status, 429);
  assertEquals((await call("PATCH", `/sessions/${s.id}`, { name: "x" })).status, 429);
  assertEquals((await write("198.51.100.1")).status, 200);
  for (let i = 0; i < 10; i++) {
    assertEquals((await call("GET", `/sessions/${s.id}/calendar.ics`)).status, 200);
  }
});

Deno.test("the write window resets", async () => {
  let now = Date.UTC(2026, 0, 1);
  const { call } = setup({
    rateLimiter: new MemoryRateLimiter(() => now),
    limits: { ...SMALL_LIMITS, write: { max: 1, seconds: 60 } },
  });
  const s = await newSession(call);
  const write = () => call("PATCH", `/sessions/${s.id}`, { name: "x" });
  assertEquals((await write()).status, 200);
  assertEquals((await write()).status, 429);
  now += 60_000;
  assertEquals((await write()).status, 200);
});

Deno.test("a failing rate limiter lets requests through", async () => {
  const broken: RateLimiter = { hit: () => Promise.reject(new Error("db down")) };
  const { call } = setup({ rateLimiter: broken, limits: SMALL_LIMITS });
  const error = console.error;
  console.error = () => {};
  try {
    for (let i = 0; i < 3; i++) assertEquals((await call("POST", "/sessions", {})).status, 201);
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

Deno.test("a memory store snapshot restores sessions, types, entries and notes", async () => {
  const store = new MemoryStore();
  const handler = createHandler(store);
  const call = async (method: string, path: string, body?: unknown, h = handler) => {
    const res = await h(
      new Request(BASE + path, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return await res.json();
  };
  const { session } = await call("POST", "/sessions", { name: "Family", year: 2026 });
  await call("POST", `/sessions/${session.id}/entries`, {
    action: "add",
    type: "vacation",
    from: "2026-08-03",
    to: "2026-08-05",
  });
  await call("POST", `/sessions/${session.id}/notes`, { icon: "🎄", date: "2026-12-24" });
  const before = await call("GET", `/sessions/${session.id}?year=2026`);

  const restored = new MemoryStore();
  restored.restore(JSON.parse(JSON.stringify(store.snapshot())));
  const after = await call(
    "GET",
    `/sessions/${session.id}?year=2026`,
    undefined,
    createHandler(restored),
  );
  assertEquals(after, before);
  assertEquals(Object.keys(after.entries).length, 3);
});
