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
  await call("POST", `/sessions/${s.id}/entries`, { type: "vacation", dates: ["2026-01-05"] });
  await call("POST", `/sessions/${s.id}/types`, { name: "Remote", color: "#123456" });

  const state = (await call("GET", `/sessions/${s.readId}?year=2026`)).data;
  assertEquals(state.session.readOnly, true);
  assertEquals(state.session.id, undefined);
  assertEquals(state.session.readId, s.readId);
  assertEquals(state.types.map((t: any) => t.id), ["holiday", "vacation", "sick", "remote"]);
  assertEquals(state.entries, { "2026-01-05": ["vacation"] });
  assertEquals((await call("GET", `/sessions/${s.readId}/entries`)).data, {
    "2026-01-05": ["vacation"],
  });
  assertEquals((await call("GET", `/sessions/${s.readId}/types`)).data.length, 4);

  const writes: [string, string, unknown?][] = [
    ["POST", "/entries", { type: "vacation", dates: ["2026-01-02"] }],
    ["PATCH", "", { name: "Hijacked" }],
    ["POST", "/types", { name: "X", color: "#000000" }],
    ["PATCH", "/types/vacation", { name: "X" }],
    ["DELETE", "/types/vacation"],
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
  assertEquals(res.status, 200);
  assertEquals(res.data.session.name, "Krug family");
  assertEquals(res.data.session.id, s.id);
  assertEquals(res.data.session.readOnly, false);
  assertEquals(res.data.types.length, 3);
  assertEquals((await call("GET", `/sessions/${s.readId}`)).data.session.name, "Krug family");
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

Deno.test("answers CORS preflight", async () => {
  const handler = createHandler(new MemoryStore());
  const res = await handler(new Request(BASE + "/sessions", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});
