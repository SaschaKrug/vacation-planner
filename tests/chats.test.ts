// The AI chats kept on the server: turns run in the background (with or without the app), hand
// themselves on to new invocations, and are followed from any device.

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { mockAi } from "../dev/mock_ai.ts";
import { createHandler, type HandlerOptions } from "../supabase/functions/_shared/handler.ts";
import { devSecret } from "../supabase/functions/_shared/secrets.ts";
import { MemoryStore } from "../supabase/functions/_shared/store.ts";
import { addMember, addUser, TEST_ITERATIONS } from "./helpers.ts";

const BASE = "http://localhost/functions/v1/api";
const AI = "https://mock.test/v1";

/** The last request body the mock AI got. */
let aiBody: any = null;
const fakeFetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href.startsWith(AI)) {
    aiBody = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    return mockAi(new Request(url, init));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}) as typeof fetch;

type Event = { event: string; data: any };

function parse(sse: string): Event[] {
  return sse.split("\n\n").filter((b) => b.trim()).map((block) => ({
    event: /^event: (.*)$/m.exec(block)?.[1] ?? "",
    data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "{}"),
  })).filter((e) => e.event !== "ping");
}

/** A family with the mock AI set up; `call` is its editor, `resumes` counts hand-offs. */
async function setup(options: HandlerOptions = {}, settings: Record<string, unknown> = {}) {
  const store = new MemoryStore();
  const counts = { resumes: 0 };
  const handler: (req: Request) => Promise<Response> = createHandler(store, {
    aiSecret: devSecret(),
    fetch: fakeFetch,
    resolve: () => Promise.resolve(["93.184.216.34"]),
    passwordIterations: TEST_ITERATIONS,
    // A turn hands itself on to the same handler (a new invocation on Supabase).
    selfFetch: ((input: string | URL | Request, init?: RequestInit) => {
      counts.resumes++;
      return handler(new Request(input, init));
    }) as typeof fetch,
    aiPollMs: 5,
    aiRetryMs: 5,
    ...options,
  });
  const as = (token?: string) => async (method: string, path: string, body?: unknown) => {
    const res = await handler(
      new Request(BASE + path, {
        method,
        headers: {
          "x-forwarded-for": "203.0.113.9",
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      data = parse(text); // an event stream
    }
    return { status: res.status, data };
  };
  const editor = await addUser(store, "editor@test");
  const call = as(editor.token);
  const f = (await call("POST", "/families", { year: 2026 })).data.family as { id: string };
  const ai = `/families/${f.id}/ai`;
  const put = await call("PUT", `${ai}/settings`, {
    baseUrl: AI,
    apiKey: "sk-test-1234567890abcd",
    model: "mock-large",
    ...settings,
  });
  assertEquals(put.status, 200);
  /** Sends the request without reading the answer (like a closed browser). */
  const fire = async (method: string, path: string, body: unknown) => {
    const res = await handler(
      new Request(BASE + path, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${editor.token}` },
        body: JSON.stringify(body),
      }),
    );
    await res.body?.cancel();
    return res.status;
  };
  return { store, call, as, fire, f, ai, editor, counts };
}

type T = Awaited<ReturnType<typeof setup>>;
const CONTEXT = { today: "2026-03-10", year: 2026, lang: "en", page: "vacation" };

/** Starts a chat and reads its stream to the end. */
async function start(t: T, text: string) {
  const res = await t.call("POST", `${t.ai}/chats`, { text, ...CONTEXT });
  assertEquals(res.status, 200, JSON.stringify(res.data));
  const ev = res.data as Event[];
  return { ev, id: ev[0].data.id as string };
}

async function state(t: T, id: string) {
  const res = await t.call("GET", `${t.ai}/chats/${id}`);
  assertEquals(res.status, 200, JSON.stringify(res.data));
  return res.data as { chat: any; rev: number; items: any[] };
}

/** Waits until no turn runs in the chat. */
async function idle(t: T, id: string) {
  for (let i = 0; i < 500; i++) {
    const s = await state(t, id);
    if (s.chat.status === "idle") return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("The chat kept running");
}

/** The chat as the app builds it from a stream: items by position, live text appended. */
function replay(ev: Event[], items: any[] = []) {
  for (const e of ev) {
    if (e.event === "items") { for (const { seq, item } of e.data.items) items[seq] = item; }
    if (e.event === "delta") {
      items[e.data.seq] = { ...items[e.data.seq], text: items[e.data.seq].text + e.data.text };
    }
  }
  return items;
}

const shown = (items: any[]) =>
  items.filter((it) => !(it.kind === "assistant" && !it.text)).map((it) =>
    it.kind === "assistant" || it.kind === "user" ? `${it.kind}: ${it.text}` : it.kind
  );

Deno.test("a chat runs on the server and is kept for every device", async () => {
  const t = await setup();
  const { ev, id } = await start(t, "Add vacation from 2026-08-03 to 2026-08-07");
  assertEquals(ev[0].event, "chat");
  assertEquals(ev[0].data.status, "running");
  assertEquals(ev.at(-1)!.event, "end");
  // The text arrives live.
  assert(ev.some((e) => e.event === "delta"));
  const s = await state(t, id);
  assertEquals(s.chat.status, "idle");
  assertEquals(s.chat.title, "Add vacation from 2026-08-03 to 2026-08-07");
  assertEquals(shown(s.items), [
    "user: Add vacation from 2026-08-03 to 2026-08-07",
    "assistant: I'll add that.",
    "tool",
    "change",
    "assistant: Done: 5 days changed.",
  ]);
  // What the stream showed is what is stored.
  assertEquals(shown(replay(ev)), shown(s.items));
  const tool = s.items.find((it) => it.kind === "tool");
  assertEquals([tool.name, tool.status], ["change_entries", "ok"]);
  assertMatch(tool.result, /"changed":5/);
  const change = s.items.find((it) => it.kind === "change");
  assertEquals([change.change, change.summary], ["entries", "5 days changed"]);
  const entries = (await t.call("GET", `/families/${t.f.id}/entries?year=2026`)).data;
  assertEquals(Object.keys(entries).length, 5);

  const list = (await t.call("GET", `${t.ai}/chats`)).data.chats;
  assertEquals(list.map((c: any) => [c.id, c.status]), [[id, "idle"]]);

  // The next message: the model gets the whole chat back.
  const next = await t.call("POST", `${t.ai}/chats/${id}/messages`, { text: "thanks", ...CONTEXT });
  assertEquals(next.status, 200);
  assertEquals(aiBody.messages.map((m: any) => m.role), [
    "system",
    "user",
    "assistant",
    "tool",
    "assistant",
    "user",
  ]);
  assertEquals(shown((await state(t, id)).items).slice(-2), [
    "user: thanks",
    "assistant: Mock reply: thanks",
  ]);

  // Following an idle chat: what changed since, then the end.
  const { rev } = await state(t, id);
  const same = (await t.call("GET", `${t.ai}/chats/${id}/events?since=${rev}`)).data as Event[];
  assertEquals(same.map((e) => e.event), ["chat", "end"]);
  const all = (await t.call("GET", `${t.ai}/chats/${id}/events?since=0`)).data as Event[];
  assertEquals(replay(all).length, 7);
});

Deno.test("the turn goes on when the app is closed", async () => {
  const t = await setup();
  assertEquals(
    await t.fire("POST", `${t.ai}/chats`, { text: "how much did we spend?", ...CONTEXT }),
    200,
  );
  const id = (await t.call("GET", `${t.ai}/chats`)).data.chats[0].id;
  const s = await idle(t, id);
  assertEquals(shown(s.items), [
    "user: how much did we spend?",
    "tool",
    "assistant: Income 0, expenses 0.",
  ]);
});

Deno.test("near the time limit, a turn hands itself on to a new invocation", async () => {
  const t = await setup({ aiHandOffMs: 0 });
  const { ev, id } = await start(t, "keep looking");
  // The stream follows the turn across the invocations.
  assertEquals(ev.at(-1)!.event, "end");
  const s = await state(t, id);
  assertEquals(t.counts.resumes, 29);
  assertEquals(s.items.filter((it) => it.kind === "tool").length, 29);
  assertEquals(shown(s.items).at(-1), "assistant: Out of steps: here is what I have.");
  assertEquals(shown(replay(ev)), shown(s.items));
  assertEquals(aiBody.tool_choice, "none");
});

Deno.test("the assistant asks, and goes on with the answer", async () => {
  const t = await setup({}, { allowWrites: false });
  const { id } = await start(t, "ask several");
  let s = await state(t, id);
  const q = s.items.at(-1);
  assertEquals([s.chat.status, q.kind, q.multiple], ["idle", "question", true]);
  // Only the open question can be answered.
  const wrong = await t.call("POST", `${t.ai}/chats/${id}/answer`, {
    id: "nope",
    selected: ["Beach"],
  });
  assertEquals(wrong.status, 409);
  const res = await t.call("POST", `${t.ai}/chats/${id}/answer`, {
    id: q.id,
    selected: ["Beach", "City", "Moon"],
    text: "A lake",
    ...CONTEXT,
  });
  assertEquals(res.status, 200);
  s = await state(t, id);
  assertEquals(s.items.find((it) => it.kind === "question").answer, {
    selected: ["Beach", "City"],
    text: "A lake",
  });
  assertEquals(shown(s.items).at(-1), "assistant: You answered: Beach, City, A lake.");

  // A new message instead of an answer leaves the question unanswered.
  await t.call("POST", `${t.ai}/chats/${id}/messages`, { text: "ask", ...CONTEXT });
  await t.call("POST", `${t.ai}/chats/${id}/messages`, { text: "never mind", ...CONTEXT });
  s = await state(t, id);
  assertEquals(s.items.filter((it) => it.kind === "question").at(-1).skipped, true);
  assert(aiBody.messages.some((m: any) => m.role === "tool" && /skipped/.test(m.content)));
});

Deno.test("a stopped turn ends with what it did", async () => {
  const t = await setup();
  assertEquals(await t.fire("POST", `${t.ai}/chats`, { text: "take your time", ...CONTEXT }), 200);
  const id = (await t.call("GET", `${t.ai}/chats`)).data.chats[0].id;
  // While it runs, no other message.
  const busy = await t.call("POST", `${t.ai}/chats/${id}/messages`, { text: "hi", ...CONTEXT });
  assertEquals(busy.status, 409);
  assertEquals((await t.call("POST", `${t.ai}/chats/${id}/stop`)).status, 200);
  const s = await idle(t, id);
  assertEquals(shown(s.items), ["user: take your time"]);
  await t.call("POST", `${t.ai}/chats/${id}/messages`, { text: "hello", ...CONTEXT });
  assertEquals(aiBody.messages.slice(1), [
    { role: "user", content: "take your time" },
    { role: "assistant", content: "(stopped)" },
    { role: "user", content: "hello" },
  ]);
});

Deno.test("a failed step is tried again, and the turn gives up after five tries", async () => {
  const t = await setup();
  let { id } = await start(t, "calendar, then fail 2 times");
  let s = await state(t, id);
  assertEquals(shown(s.items), [
    "user: calendar, then fail 2 times",
    "tool",
    `assistant: ${s.items.at(-1).text}`,
  ]);
  assertMatch(s.items.at(-1).text, /Here is what I found/);

  ({ id } = await start(t, "keep looking, then fail"));
  s = await state(t, id);
  assertEquals(s.items.at(-1).kind, "error");
  assertMatch(s.items.at(-1).text, /503/);
  // The history stays valid for the next message.
  await t.call("POST", `${t.ai}/chats/${id}/messages`, { text: "ok", ...CONTEXT });
  assertEquals(aiBody.messages.at(-2).role, "assistant");
  assertMatch(aiBody.messages.at(-2).content, /No answer/);
});

Deno.test("a turn whose invocation died is taken over when someone looks", async () => {
  const t = await setup({ aiLeaseMs: 50 });
  const { id } = await start(t, "hello");
  // As if an invocation died in the middle of a step: its tool call is shown but not saved
  // for the model, and nobody renews the chat.
  const chat = t.store.chats.get(id)!;
  Object.assign(chat, {
    status: "running",
    run_token: "dead",
    run_until: new Date(Date.now() - 1000).toISOString(),
  });
  await t.store.addChatMessages(id, [{ seq: 2, message: { role: "user", content: "calendar" } }]);
  await t.store.putChatItems(id, [
    { seq: 2, item: { kind: "user", text: "calendar" } },
    {
      seq: 3,
      item: { kind: "tool", id: "call_dead", name: "get_calendar", args: {}, status: "running" },
    },
  ]);
  const s = await idle(t, id);
  const tool = s.items.find((it) => it.kind === "tool");
  assertEquals([tool.status, tool.interrupted], ["error", true]);
  assertMatch(shown(s.items).at(-1), /That didn't work: Interrupted/);
  // The model learned about the call.
  const call = aiBody.messages.find((m: any) => m.tool_calls?.[0]?.id === "call_dead");
  assertEquals(call.tool_calls[0].function.name, "get_calendar");
});

Deno.test("chats are their user's, and the hand-off needs its token", async () => {
  const t = await setup();
  const { id } = await start(t, "hello");
  const other = await addUser(t.store, "other@test");
  await addMember(t.store, t.f.id, other.user.id, "editor");
  const as = t.as(other.token);
  assertEquals((await as("GET", `${t.ai}/chats`)).data.chats, []);
  assertEquals((await as("GET", `${t.ai}/chats/${id}`)).status, 404);
  assertEquals((await as("POST", `${t.ai}/chats/${id}/messages`, { text: "hi" })).status, 404);
  assertEquals((await as("DELETE", `${t.ai}/chats/${id}`)).status, 404);
  const viewer = await addUser(t.store, "viewer@test");
  await addMember(t.store, t.f.id, viewer.user.id, "viewer");
  assertEquals((await t.as(viewer.token)("GET", `${t.ai}/chats`)).status, 403);
  // Without signing in, only the turn's own token resumes it.
  const resume = await t.as()("POST", `${t.ai}/chats/${id}/resume`, { token: "guess" });
  assertEquals(resume.status, 404);
  assertEquals((await t.call("POST", `${t.ai}/chats`, { ...CONTEXT })).status, 400);

  assertEquals((await t.call("DELETE", `${t.ai}/chats/${id}`)).status, 200);
  assertEquals((await t.call("GET", `${t.ai}/chats/${id}`)).status, 404);
});

Deno.test("undone changes are told to the assistant with the next message", async () => {
  const t = await setup();
  const { id } = await start(t, "Add vacation from 2026-08-03 to 2026-08-07");
  const change = (await state(t, id)).items.find((it) => it.kind === "change");
  for (const step of change.undo) {
    assertEquals(
      (await t.call(step.method, `/families/${t.f.id}${step.path}`, step.body)).status,
      200,
    );
  }
  assertEquals((await t.call("POST", `${t.ai}/chats/${id}/undone`, { id: change.id })).status, 200);
  assertEquals((await state(t, id)).items.find((it) => it.kind === "change").undone, true);
  await t.call("POST", `${t.ai}/chats/${id}/messages`, { text: "thanks", ...CONTEXT });
  assertEquals(aiBody.messages.slice(-3), [
    { role: "user", content: "(I undid this change: 5 days changed)" },
    { role: "assistant", content: "OK." },
    { role: "user", content: "thanks" },
  ]);
});

Deno.test("messages carry attached files and images", async () => {
  const t = await setup();
  const url = "data:image/png;base64,iVBORw0KGgo=";
  const res = await t.call("POST", `${t.ai}/chats`, {
    text: "what is this?",
    attachments: [
      { kind: "file", name: "list.csv", text: "a,b\n1,2" },
      { kind: "image", name: "shot.png", url },
    ],
    ...CONTEXT,
  });
  assertEquals(res.status, 200);
  const s = await state(t, res.data[0].data.id);
  assertEquals(s.items[0].attachments, [
    { kind: "file", name: "list.csv" },
    { kind: "image", name: "shot.png", url },
  ]);
  assertMatch(s.items.at(-1).text, /I see 1 image/);
  assertEquals(aiBody.messages[1].content[1].text, "Attached file “list.csv”:\n```\na,b\n1,2\n```");
  const bad = await t.call("POST", `${t.ai}/chats`, {
    attachments: [{ kind: "image", name: "x", url: "javascript:alert(1)" }],
  });
  assertEquals(bad.status, 400);
});

Deno.test("imports a chat the device kept before", async () => {
  const t = await setup();
  const updatedAt = Date.parse("2026-03-01T10:00:00Z");
  const res = await t.call("POST", `${t.ai}/chats/import`, {
    title: "Old chat",
    updatedAt,
    items: [
      { kind: "user", text: "hi" },
      { kind: "assistant", text: "Hello!" },
      {
        kind: "change",
        id: "c1",
        change: "entries",
        summary: "1 day changed",
        undo: [
          { method: "POST", path: "/entries", body: { ops: [] } },
          { method: "GET", path: "https://evil.test" },
        ],
      },
      { kind: "bogus" },
    ],
    history: [{ role: "user", content: "hi" }, { role: "assistant", content: "Hello!" }],
  });
  assertEquals(res.status, 201, JSON.stringify(res.data));
  const id = res.data.chat.id;
  assertEquals(res.data.chat.updatedAt, new Date(updatedAt).toISOString());
  const s = await state(t, id);
  assertEquals(shown(s.items), ["user: hi", "assistant: Hello!", "change"]);
  assertEquals(s.items[2].undo, [{ method: "POST", path: "/entries", body: { ops: [] } }]);
  await t.call("POST", `${t.ai}/chats/${id}/messages`, { text: "again", ...CONTEXT });
  assertEquals(aiBody.messages.slice(1).map((m: any) => m.content), ["hi", "Hello!", "again"]);
});
