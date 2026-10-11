import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createHandler } from "../supabase/functions/_shared/handler.ts";
import { MemoryStore } from "../supabase/functions/_shared/store.ts";

const BASE = "http://localhost/functions/v1/api";

function setup() {
  const handler = createHandler(new MemoryStore());
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handler(
      new Request(BASE + path, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
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
  const res = await call("POST", "/sessions", { name: "Family" });
  assertEquals(res.status, 201);
  return res.data.session as { id: string; readId: string };
}

Deno.test("creates a session with preset types", async () => {
  const { call } = setup();
  const res = await call("POST", "/sessions", {});
  assertEquals(res.status, 201);
  assertEquals(res.data.types.map((t: any) => t.name), ["Holiday", "Vacation", "Sick"]);
  assertEquals(res.data.session.readOnly, false);
  assertMatch(res.data.session.id, /^[A-Za-z0-9]{20}$/);
  assert(res.data.session.id !== res.data.session.readId);
});

Deno.test("creates a German session with localized presets", async () => {
  const { call } = setup();
  const res = await call("POST", "/sessions", { lang: "de" });
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
  const state = (await call("GET", `/sessions/${s.readId}`)).data;
  assertEquals(state.session.readOnly, true);
  assertEquals(state.session.id, undefined);
  const res = await call("POST", `/sessions/${s.readId}/entries`, {
    type: "vacation",
    dates: ["2026-01-02"],
  });
  assertEquals(res.status, 403);
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
  const created = await call("POST", `/sessions/${s.id}/types`, {
    name: "Day care closed",
    color: "#8B5CF6",
    role: "needs_cover",
  });
  assertEquals(created.status, 201);
  assertEquals(created.data.id, "day-care-closed");
  assertEquals(created.data.color, "#8b5cf6");
  assertEquals(created.data.position, 3);

  const renamed = await call("PATCH", `/sessions/${s.id}/types/vacation`, {
    name: "Vacation Sascha",
  });
  assertEquals(renamed.data.name, "Vacation Sascha");
  // Names work as references too.
  await call("POST", `/sessions/${s.id}/entries`, {
    type: "vacation sascha",
    dates: ["2026-03-02"],
  });

  await call("DELETE", `/sessions/${s.id}/types/vacation`);
  const state = (await call("GET", `/sessions/${s.id}`)).data;
  assertEquals(state.types.map((t: any) => t.id), ["holiday", "sick", "day-care-closed"]);
  assertEquals(state.entries, {});
});

Deno.test("renames a session", async () => {
  const { call } = setup();
  const s = await newSession(call);
  const res = await call("PATCH", `/sessions/${s.id}`, { name: "Krug family" });
  assertEquals(res.data.session.name, "Krug family");
});

Deno.test("serves an iCalendar feed with merged ranges and gaps", async () => {
  const { call } = setup();
  const s = await newSession(call);
  await call("POST", `/sessions/${s.id}/types`, {
    name: "Day care closed",
    color: "#8b5cf6",
    role: "needs_cover",
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

Deno.test("answers CORS preflight", async () => {
  const handler = createHandler(new MemoryStore());
  const res = await handler(new Request(BASE + "/sessions", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});
