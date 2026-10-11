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

Deno.test("answers CORS preflight", async () => {
  const handler = createHandler(new MemoryStore());
  const res = await handler(new Request(BASE + "/sessions", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});
