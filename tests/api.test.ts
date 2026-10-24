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
  const store = new MemoryStore();
  const handler = createHandler(store, options);
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
  return { call, store };
}

async function newFamily(call: ReturnType<typeof setup>["call"]) {
  const res = await call("POST", "/families", { name: "Family", year: 2026 });
  assertEquals(res.status, 201);
  return res.data.family as { id: string; readId: string; feedId: string };
}

Deno.test("creates a family with preset types", async () => {
  const { call } = setup();
  const res = await call("POST", "/families", {});
  assertEquals(res.status, 201);
  assertEquals(res.data.types.map((t: any) => t.name), ["Holiday", "Vacation", "Sick"]);
  // Without a year, the presets go into the current year.
  const year = new Date().getUTCFullYear();
  assertEquals(res.data.types.map((t: any) => t.year), [year, year, year]);
  assertEquals(res.data.typeYears, [year]);
  assertEquals(res.data.family.readOnly, false);
  assertMatch(res.data.family.id, /^[A-Za-z0-9]{20}$/);
  assert(res.data.family.id !== res.data.family.readId);
});

Deno.test("creates a German family with localized presets", async () => {
  const { call } = setup();
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
  const { call } = setup();
  for (const lang of ["fr", "DE", 1, null]) {
    const res = await call("POST", "/families", { lang });
    assertEquals(res.status, 400);
    assertEquals(res.data.error, "lang must be en or de");
  }
});

Deno.test("adds, removes, sets and clears entries", async () => {
  const { call } = setup();
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
  const { call } = setup();
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

Deno.test("read-only id can read but not write", async () => {
  const { call } = setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/entries`, { type: "vacation", dates: ["2026-01-05"] });
  await call("POST", `/families/${s.id}/types`, { name: "Remote", color: "#123456", year: 2026 });

  const state = (await call("GET", `/families/${s.readId}?year=2026`)).data;
  assertEquals(state.family.readOnly, true);
  assertEquals(state.family.id, undefined);
  assertEquals(state.family.readId, s.readId);
  assertEquals(state.types.map((t: any) => t.id), ["holiday", "vacation", "sick", "remote"]);
  assertEquals(state.entries, { "2026-01-05": ["vacation"] });
  assertEquals((await call("GET", `/families/${s.readId}/entries`)).data, {
    "2026-01-05": ["vacation"],
  });
  assertEquals((await call("GET", `/families/${s.readId}/types?year=2026`)).data.length, 4);

  const writes: [string, string, unknown?][] = [
    ["POST", "/entries", { type: "vacation", dates: ["2026-01-02"] }],
    ["PATCH", "", { name: "Hijacked" }],
    ["POST", "/types", { name: "X", color: "#000000" }],
    ["PATCH", "/types/vacation?year=2026", { name: "X" }],
    ["DELETE", "/types/vacation?year=2026"],
    ["POST", "/types/copy", { from: 2026, to: 2027 }],
  ];
  for (const [method, path, body] of writes) {
    assertEquals((await call(method, `/families/${s.readId}${path}`, body)).status, 403);
  }
  const after = (await call("GET", `/families/${s.id}?year=2026`)).data;
  assertEquals(after.family.name, "Family");
  assertEquals(after.types.length, 4);
  assertEquals(after.entries, { "2026-01-05": ["vacation"] });
});

Deno.test("rejects malformed tokens as not found", async () => {
  const { call } = setup();
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
  const { call } = setup();
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
  const { call } = setup();
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
  const { call } = setup();
  const s = await newFamily(call);
  const res = await call("PATCH", `/families/${s.id}`, { name: "Our family" });
  assertEquals(res.status, 200);
  assertEquals(res.data.family.name, "Our family");
  assertEquals(res.data.family.id, s.id);
  assertEquals(res.data.family.readOnly, false);
  assertEquals(res.data.types.length, 3);
  assertEquals((await call("GET", `/families/${s.readId}`)).data.family.name, "Our family");
});

Deno.test("serves an iCalendar feed with merged ranges and gaps", async () => {
  const { call } = setup();
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
  const res = await call("GET", `/families/${s.readId}/calendar.ics?gaps=1`);
  assertEquals(res.status, 200);
  assertMatch(res.headers.get("content-type")!, /^text\/calendar/);
  const ics: string = res.data;
  assert(ics.includes("SUMMARY:Vacation\r\n"));
  assert(ics.includes("DTSTART;VALUE=DATE:20260803\r\nDTEND;VALUE=DATE:20260806"));
  assert(ics.includes("SUMMARY:⚠ Not covered: Day care closed"));
  assert(ics.includes("DTSTART;VALUE=DATE:20260806\r\nDTEND;VALUE=DATE:20260808"));

  const onlyVacation =
    (await call("GET", `/families/${s.readId}/calendar.ics?types=vacation`)).data;
  assert(!onlyVacation.includes("Day care closed"));
  assertEquals(onlyVacation.match(/BEGIN:VEVENT/g).length, 1);
});

Deno.test("serves a German iCalendar feed with ?lang=de", async () => {
  const { call } = setup();
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
  const de: string = (await call("GET", `/families/${s.readId}/calendar.ics?gaps=1&lang=de`))
    .data;
  assert(de.includes("SUMMARY:⚠ Nicht abgedeckt: Kita zu\r\n"));
  assert(de.includes("DESCRIPTION:Vacation: 3 Tage (1 Arbeitstag)\r\n"));

  // Unknown languages fall back to English instead of breaking the feed.
  const fallback = await call("GET", `/families/${s.readId}/calendar.ics?gaps=1&lang=xx`);
  assertEquals(fallback.status, 200);
  assert(fallback.data.includes("SUMMARY:⚠ Not covered: Kita zu\r\n"));
  assert(fallback.data.includes("DESCRIPTION:Vacation: 3 days (1 workdays)\r\n"));
});

Deno.test("sets, replaces and clears day notes", async () => {
  const { call } = setup();
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
  const { call } = setup();
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
  const { call } = setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/notes`, {
    ops: [
      { icon: "🎄", comment: "Christmas", date: "2026-12-25" },
      { icon: "🎆", date: "2025-12-31" },
    ],
  });
  const state = (await call("GET", `/families/${s.id}?year=2026`)).data;
  assertEquals(state.notes, { "2026-12-25": { icon: "🎄", comment: "Christmas" } });
  // The view-only id reads notes too.
  const view = (await call("GET", `/families/${s.readId}?from=2025-12-01&to=2025-12-31`)).data;
  assertEquals(view.notes, { "2025-12-31": { icon: "🎆", comment: "" } });
  assertEquals(
    Object.keys((await call("GET", `/families/${s.readId}/notes`)).data),
    ["2025-12-31", "2026-12-25"],
  );
  assertEquals((await call("POST", "/families", {})).data.notes, {});
});

Deno.test("notes and entries are independent", async () => {
  const { call } = setup();
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

Deno.test("read-only id cannot change notes", async () => {
  const { call } = setup();
  const s = await newFamily(call);
  const res = await call("POST", `/families/${s.readId}/notes`, {
    icon: "🎄",
    date: "2026-12-25",
  });
  assertEquals(res.status, 403);
  assertEquals(res.data.error, "This is a read-only link");
});

Deno.test("validates note ops", async () => {
  const { call } = setup();
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
  const { call } = setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/entries`, { type: "holiday", date: "2026-12-25" });
  await call("POST", `/families/${s.id}/notes`, {
    ops: [
      { icon: "🎄", comment: "Christmas", from: "2026-12-24", to: "2026-12-26" },
      { icon: "🎆", comment: "New Year's Eve, party", date: "2026-12-31" },
    ],
  });
  const plain: string = (await call("GET", `/families/${s.readId}/calendar.ics`)).data;
  assertEquals(plain.match(/BEGIN:VEVENT/g)!.length, 1);
  assert(!plain.includes("Christmas"));

  const ics: string = (await call("GET", `/families/${s.readId}/calendar.ics?notes=1`)).data;
  assertEquals(ics.match(/BEGIN:VEVENT/g)!.length, 3);
  assert(ics.includes("SUMMARY:🎄 Christmas\r\n"));
  assert(ics.includes("DTSTART;VALUE=DATE:20261224\r\nDTEND;VALUE=DATE:20261227"));
  assert(ics.includes(`UID:${s.feedId}-note-2026-12-24@vacation-planner`));
  assert(ics.includes("SUMMARY:🎆 New Year's Eve\\, party\r\n"));
  // Type filters don't hide notes.
  const filtered: string =
    (await call("GET", `/families/${s.readId}/calendar.ics?types=sick&notes=1`)).data;
  assertEquals(filtered.match(/BEGIN:VEVENT/g)!.length, 2);
});

Deno.test("every year has its own entry types", async () => {
  const { call } = setup();
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
  const { call } = setup();
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
  const { call } = setup();
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
  const ics: string = (await call("GET", `/families/${s.readId}/calendar.ics?gaps=1`)).data;
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
    (await call("GET", `/families/${s.readId}/calendar.ics?types=day%20care%20closed`)).data;
  assertEquals(byName.match(/BEGIN:VEVENT/g)!.length, 1);
  const byId: string = (await call("GET", `/families/${s.readId}/calendar.ics?types=vacation`))
    .data;
  assertEquals(byId.match(/BEGIN:VEVENT/g)!.length, 2);
  assertEquals((await call("GET", `/families/${s.readId}/calendar.ics?types=nope`)).status, 404);
});

Deno.test("answers CORS preflight", async () => {
  const handler = createHandler(new MemoryStore());
  const res = await handler(new Request(BASE + "/families", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});

Deno.test("agent page describes the planner with ready-to-use URLs", async () => {
  const { call } = setup();
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

Deno.test("agent page for a read-only id has no edit id or write requests", async () => {
  const { call } = setup();
  const s = await newFamily(call);
  const res = await call("GET", `/families/${s.readId}/agent`);
  assertEquals(res.status, 200);
  assert(res.data.includes("read-only"));
  assert(!res.data.includes(s.id));
  assert(!res.data.includes("POST"));
});

Deno.test("agent page only answers GET and doesn't run requests", async () => {
  const { call } = setup();
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
  const { call } = setup();
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
  assert(![s.id, s.readId].includes(copy.id) && ![s.id, s.readId].includes(copy.readId));
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

Deno.test("a view-only id can clone, and the copy is editable", async () => {
  const { call } = setup();
  const s = await newFamily(call);
  await call("POST", `/families/${s.id}/entries`, { type: "vacation", date: "2026-05-04" });
  const res = await call("POST", `/families/${s.readId}/clone`, { name: "Mine" });
  assertEquals(res.status, 201);
  assertEquals(res.data.family.name, "Mine");
  assertEquals(res.data.entries, { "2026-05-04": ["vacation"] });
  const edit = await call("POST", `/families/${res.data.family.id}/entries`, {
    type: "sick",
    date: "2026-05-05",
  });
  assertEquals(edit.status, 200);
});

Deno.test("clone validates its input", async () => {
  const { call } = setup();
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
  const { call } = setup();
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
  const res = await call("GET", `/families/${s.readId}/export`);
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
  assert(!text.includes(s.id) && !text.includes(s.readId));

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
  const { call } = setup();
  const s = await newFamily(call);
  const type = { year: 2026, id: "vacation", name: "Vacation", color: "#22c55e", role: "covers" };
  const file = { format: "vacation-planner", version: 1, name: "Imported", types: [type] };
  const path = `/families/${s.id}/import`;
  const status = async (body: unknown) => (await call("POST", path, body)).status;

  assertEquals((await call("POST", `/families/${s.readId}/import`, file)).status, 403);
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
};

Deno.test("limits how many planners one client creates", async () => {
  const { call } = setup({ rateLimiter: new MemoryRateLimiter(), limits: SMALL_LIMITS });
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
  const { call } = setup({ rateLimiter: new MemoryRateLimiter(), limits: SMALL_LIMITS });
  for (let i = 0; i < 5; i++) {
    assertEquals((await call("POST", "/families", {}, `198.51.100.${i}`)).status, 201);
  }
  assertEquals((await call("POST", "/families", {}, "198.51.100.99")).status, 429);
});

Deno.test("limits writes per client, but not reads", async () => {
  const limiter = new MemoryRateLimiter();
  const { call } = setup({ rateLimiter: limiter, limits: SMALL_LIMITS });
  const s = await newFamily(call);
  const write = (ip?: string) =>
    call("POST", `/families/${s.id}/entries`, { type: "vacation", date: "2026-03-02" }, ip);
  for (let i = 0; i < 3; i++) assertEquals((await write()).status, 200);
  assertEquals((await write()).status, 429);
  assertEquals((await call("PATCH", `/families/${s.id}`, { name: "x" })).status, 429);
  assertEquals((await write("198.51.100.1")).status, 200);
  for (let i = 0; i < 10; i++) {
    assertEquals((await call("GET", `/families/${s.id}/calendar.ics`)).status, 200);
  }
});

Deno.test("the write window resets", async () => {
  let now = Date.UTC(2026, 0, 1);
  const { call } = setup({
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
  const { call } = setup({ rateLimiter: broken, limits: SMALL_LIMITS });
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
  const { call } = setup();
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
  const feed = await call("GET", `/sessions/${res.data.family.readId}/calendar.ics`);
  assertEquals(feed.status, 200);
});

Deno.test("each link only shows what it may", async () => {
  const { call } = setup();
  const s = await newFamily(call);
  for (const token of [s.id, s.readId, s.feedId]) assertMatch(token, /^[A-Za-z0-9]{20}$/);
  assertEquals(new Set([s.id, s.readId, s.feedId]).size, 3);

  const edit = (await call("GET", `/families/${s.id}`)).data.family;
  assertEquals(edit.access, "edit");
  assertEquals([edit.id, edit.readId, edit.feedId], [s.id, s.readId, s.feedId]);

  const view = (await call("GET", `/families/${s.readId}`)).data.family;
  assertEquals(view.access, "view");
  assertEquals(view.readOnly, true);
  assertEquals(view.id, undefined);
  assertEquals([view.readId, view.feedId], [s.readId, s.feedId]);

  // The feed id opens the calendar feed and nothing else.
  assertEquals((await call("GET", `/families/${s.feedId}/calendar.ics`)).status, 200);
  for (const path of ["", "/entries", "/notes", "/types", "/agent", "/export"]) {
    const res = await call("GET", `/families/${s.feedId}${path}`);
    assertEquals(res.status, 403, path);
    assertEquals(res.data.error, "This link only opens the calendar feed");
  }
  assertEquals((await call("POST", `/families/${s.feedId}/clone`)).status, 403);
  assertEquals(
    (await call("POST", `/families/${s.feedId}/entries`, { type: "vacation", date: "2026-01-05" }))
      .status,
    403,
  );
});

Deno.test("the view id of a planner from before families keeps its calendar", async () => {
  const { call, store } = setup();
  const s = await newFamily(call);
  // What the migration does: the old view id becomes the legacy id.
  await store.updateFamily(s.id, { legacy_id: "OldViewId1234567890" });
  await call("POST", `/families/${s.id}/entries`, { type: "vacation", date: "2026-08-03" });

  const res = await call("GET", "/sessions/OldViewId1234567890?year=2026");
  assertEquals(res.status, 200);
  assertEquals(res.data.family.access, "calendar");
  assertEquals(res.data.family.readOnly, true);
  // It must not learn the new view link, which will show more than the calendar.
  assertEquals(res.data.family.id, undefined);
  assertEquals(res.data.family.readId, undefined);
  assertEquals(res.data.entries, { "2026-08-03": ["vacation"] });
  assertEquals(
    (await call("POST", "/sessions/OldViewId1234567890/entries", {
      type: "sick",
      date: "2026-08-04",
    }))
      .status,
    403,
  );
  // Old subscriptions keep their URL and their event ids.
  const ics: string = (await call("GET", "/sessions/OldViewId1234567890/calendar.ics")).data;
  assert(ics.includes("UID:OldViewId1234567890-vacation-2026-08-03@vacation-planner"));
  const viaFeed: string = (await call("GET", `/families/${s.feedId}/calendar.ics`)).data;
  assert(viaFeed.includes("UID:OldViewId1234567890-vacation-2026-08-03@vacation-planner"));
  // The edit link sees it, so the app can offer to remove it.
  assertEquals(
    (await call("GET", `/families/${s.id}`)).data.family.legacyId,
    "OldViewId1234567890",
  );
});

Deno.test("rotates the view and feed links and removes the legacy link", async () => {
  const { call, store } = setup();
  const s = await newFamily(call);
  await store.updateFamily(s.id, { legacy_id: "OldViewId1234567890" });

  const view = await call("POST", `/families/${s.id}/links`, { link: "view" });
  assertEquals(view.status, 200);
  const readId = view.data.family.readId;
  assert(readId !== s.readId);
  assertEquals((await call("GET", `/families/${s.readId}`)).status, 404);
  assertEquals((await call("GET", `/families/${readId}`)).data.family.access, "view");

  const feed = await call("POST", `/families/${s.id}/links`, { link: "feed" });
  const feedId = feed.data.family.feedId;
  assert(feedId !== s.feedId);
  assertEquals((await call("GET", `/families/${s.feedId}/calendar.ics`)).status, 404);
  assertEquals((await call("GET", `/families/${feedId}/calendar.ics`)).status, 200);

  const legacy = await call("POST", `/families/${s.id}/links`, { link: "legacy" });
  assertEquals(legacy.data.family.legacyId, undefined);
  assertEquals((await call("GET", "/families/OldViewId1234567890")).status, 404);

  assertEquals((await call("POST", `/families/${s.id}/links`, { link: "edit" })).status, 400);
  assertEquals((await call("POST", `/families/${readId}/links`, { link: "view" })).status, 403);
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
  assert(family.read_id !== "ViewId123456");
  assertMatch(family.feed_id, /^[A-Za-z0-9]{32}$/);
  assertEquals(store.types.get("EditId123456")![0].family_id, "EditId123456");
});

// ------------------------------------------------------------------ finance

async function financeFamily() {
  const { call, store } = setup();
  const s = await newFamily(call);
  const f = `/families/${s.id}/finance`;
  return { call, store, s, f };
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
  assertEquals((await call("PATCH", `/families/${s.readId}/finance/settings`, {})).status, 403);

  assertEquals((await call("DELETE", `${f}/categories/pets`)).status, 200);
  assertEquals((await call("DELETE", `${f}/categories/pets`)).status, 404);
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
  assertEquals((await call("GET", `/families/${s.readId}/finance/transactions`)).status, 200);
  assertEquals(
    (await call("POST", `/families/${s.readId}/finance/transactions`, {
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
    for (const path of ["/finance", "/finance/transactions", "/finance/summary"]) {
      assertEquals((await call("GET", `/families/${token}${path}`)).status, 403, token + path);
    }
  }
  // The legacy link exports and clones the calendar only.
  const file = (await call("GET", "/families/OldViewId1234567890/export")).data;
  assertEquals(file.finance, undefined);
  assert(!JSON.stringify(file).includes("Secret"));
  const copy = (await call("POST", "/families/OldViewId1234567890/clone", {})).data.family;
  assertEquals((await call("GET", `/families/${copy.id}/finance/transactions`)).data.total, 0);
  // The view link clones the finances too.
  const full = (await call("POST", `/families/${s.readId}/clone`, {})).data.family;
  assertEquals((await call("GET", `/families/${full.id}/finance/transactions`)).data.total, 1);
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

Deno.test("the agent page explains the finances to links that may see them", async () => {
  const { call, store, s } = await financeFamily();
  const edit: string = (await call("GET", `/families/${s.id}/agent`)).data;
  assert(edit.includes("## Finances"));
  assert(edit.includes(`POST ${BASE}/families/${s.id}/finance/transactions`));
  const view: string = (await call("GET", `/families/${s.readId}/agent`)).data;
  assert(view.includes("## Finances") && !view.includes("finance/transactions` with"));
  await store.updateFamily(s.id, { legacy_id: "OldViewId1234567890" });
  const legacy: string = (await call("GET", "/families/OldViewId1234567890/agent")).data;
  assert(!legacy.includes("Finances"));
});
