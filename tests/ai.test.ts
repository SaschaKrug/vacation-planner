import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { mockAi } from "../dev/mock_ai.ts";
import { parseAnswer } from "../supabase/functions/_shared/ai/categorize.ts";
import { htmlToText, isPrivateAddress } from "../supabase/functions/_shared/ai/net.ts";
import { runTool } from "../supabase/functions/_shared/ai/tools.ts";
import { similarKey } from "../supabase/functions/_shared/finance.ts";
import { createHandler, type HandlerOptions } from "../supabase/functions/_shared/handler.ts";
import { MemoryRateLimiter } from "../supabase/functions/_shared/rate_limit.ts";
import { devSecret } from "../supabase/functions/_shared/secrets.ts";
import { MemoryStore } from "../supabase/functions/_shared/store.ts";
import { addMember, addUser, TEST_ITERATIONS } from "./helpers.ts";

const BASE = "http://localhost/functions/v1/api";
const AI = "https://mock.test/v1";
const KEY = "sk-test-1234567890abcd";

/** The outside world: the mock AI, a web page, a redirect to a private address, Tavily. */
const requests: string[] = [];
/** The last request body the mock AI got. */
let aiBody: any = null;
const fakeFetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  requests.push(url.href);
  if (url.href.startsWith(AI)) {
    aiBody = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    return mockAi(new Request(url, init));
  }
  if (url.hostname === "pages.test") {
    if (url.pathname === "/long") {
      return Promise.resolve(
        new Response(
          `<html><body><p>${"Opening times and prices. ".repeat(300)}</p></body></html>`,
          {
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        ),
      );
    }
    return Promise.resolve(
      new Response(
        "<html><head><title>School holidays 2027</title><script>evil()</script></head>" +
          "<body><nav>Menu</nav><h1>Bavaria</h1><p>Summer: Aug 2 &ndash; Sep 13</p></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" } },
      ),
    );
  }
  if (url.hostname === "redirect.test") {
    return Promise.resolve(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
    );
  }
  if (url.hostname === "api.tavily.com") {
    const query = JSON.parse(String(init?.body ?? "{}")).query ?? "";
    if (/zorbex/i.test(query)) {
      return Promise.resolve(Response.json({
        results: [{ title: "Zorbex", url: "https://zorbex.test", content: "A leisure park" }],
      }));
    }
    return Promise.resolve(Response.json({
      results: [{ title: "Ferien Bayern 2027", url: "https://pages.test/ferien", content: "…" }],
    }));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}) as typeof fetch;

/** `call` is signed in as the family's editor; `as(token)` calls as someone else. */
async function setup(options: HandlerOptions = {}) {
  const store = new MemoryStore();
  const handler = createHandler(store, {
    aiSecret: devSecret(),
    fetch: fakeFetch,
    resolve: () => Promise.resolve(["93.184.216.34"]),
    passwordIterations: TEST_ITERATIONS,
    ...options,
  });
  const as = (token: string) => async (method: string, path: string, body?: unknown) => {
    const res = await handler(
      new Request(BASE + path, {
        method,
        headers: {
          "x-forwarded-for": "203.0.113.9",
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch { /* sse */ }
    return { status: res.status, data, headers: res.headers };
  };
  const { token } = await addUser(store, "editor@test");
  return { call: as(token), as, store };
}

/** A family, and `view`: a call as a viewer of it. */
async function family(options: HandlerOptions = {}) {
  const t = await setup(options);
  const res = await t.call("POST", "/families", { year: 2026 });
  const f = res.data.family as { id: string };
  const viewer = await addUser(t.store, "viewer@test");
  await addMember(t.store, f.id, viewer.user.id, "viewer");
  return { ...t, f, view: t.as(viewer.token), ai: `/families/${f.id}/ai` };
}

async function configured(options: HandlerOptions = {}, settings: Record<string, unknown> = {}) {
  const t = await family(options);
  const res = await t.call("PUT", `${t.ai}/settings`, {
    baseUrl: AI,
    apiKey: KEY,
    model: "mock-large",
    ...settings,
  });
  assertEquals(res.status, 200);
  return t;
}

function events(sse: string) {
  return sse.split("\n\n").filter((b) => b.trim()).map((block) => {
    const event = /^event: (.*)$/m.exec(block)?.[1] ?? "";
    const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "{}");
    return { event, data };
  }).filter((e) => e.event !== "ping");
}

/** The events but how full the context is (sent before and after every model call). */
const names = (ev: { event: string }[]) => ev.map((e) => e.event).filter((n) => n !== "usage");

/** What the app adds to its history: the messages of every step. */
function addedOf(ev: { event: string; data: any }[]) {
  return ev.filter((e) => e.event === "messages").flatMap((e) => e.data.messages);
}

async function chat(t: Awaited<ReturnType<typeof configured>>, text: string, extra = {}) {
  const res = await t.call("POST", `${t.ai}/chat`, {
    messages: [{ role: "user", content: text }],
    today: "2026-03-10",
    year: 2026,
    lang: "en",
    ...extra,
  });
  assertEquals(res.status, 200, res.data);
  assertMatch(res.headers.get("content-type") ?? "", /text\/event-stream/);
  return events(res.data);
}

Deno.test("stores the AI settings with the keys encrypted and never returns them", async () => {
  const t = await family();
  const empty = await t.call("GET", `${t.ai}/settings`);
  assertEquals([empty.data.configured, empty.data.hasKey, empty.data.serverReady], [
    false,
    false,
    true,
  ]);

  const res = await t.call("PUT", `${t.ai}/settings`, {
    baseUrl: AI + "/",
    apiKey: KEY,
    model: "mock-large",
    searchProvider: "tavily",
    searchKey: "tvly-abcdef9876",
    allowWrites: false,
  });
  assertEquals(res.data, {
    configured: true,
    baseUrl: AI,
    model: "mock-large",
    hasKey: true,
    keyHint: "abcd",
    searchProvider: "tavily",
    hasSearchKey: true,
    searchKeyHint: "9876",
    allowWrites: false,
    contextWindow: 0,
    serverReady: true,
  });
  const row = (await t.store.getAiSettings(t.f.id))!;
  assert(row.api_key_enc.startsWith("v1:") && !row.api_key_enc.includes(KEY));
  // Only the fields given change; "" removes a key.
  const cleared = await t.call("PUT", `${t.ai}/settings`, { apiKey: "" });
  assertEquals([cleared.data.hasKey, cleared.data.model], [false, "mock-large"]);

  assertEquals((await t.view("GET", `/families/${t.f.id}/ai/settings`)).status, 403);
  assertEquals((await t.call("PUT", `${t.ai}/settings`, { searchProvider: "bing" })).status, 400);
  assertEquals((await t.call("PUT", `${t.ai}/settings`, { apiKey: "has space" })).status, 400);
  // The model's context window: a number of tokens, or 0 to find it out.
  const window = await t.call("PUT", `${t.ai}/settings`, { contextWindow: 32000 });
  assertEquals(window.data.contextWindow, 32000);
  for (const contextWindow of [-1, 500, 1.5, "32000", 20_000_000]) {
    assertEquals(
      (await t.call("PUT", `${t.ai}/settings`, { contextWindow })).status,
      400,
      String(contextWindow),
    );
  }
});

Deno.test("without AI_CONFIG_KEY keys can't be saved", async () => {
  const t = await family({ aiSecret: undefined });
  const res = await t.call("PUT", `${t.ai}/settings`, { baseUrl: AI, apiKey: KEY });
  assertEquals(res.status, 503);
  assertEquals((await t.call("GET", `${t.ai}/settings`)).data.serverReady, false);
  // A keyless endpoint (e.g. a local model) still works.
  assertEquals((await t.call("PUT", `${t.ai}/settings`, { baseUrl: AI, model: "m" })).status, 200);
});

Deno.test("refuses AI endpoints and pages on private networks", async () => {
  for (
    const host of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.10",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "localhost",
      "intranet",
      "2130706433",
      "printer.local",
    ]
  ) {
    assert(isPrivateAddress(host), host);
  }
  for (const host of ["93.184.216.34", "api.openai.com", "2606:4700::1111"]) {
    assert(!isPrivateAddress(host), host);
  }
  const t = await family();
  for (const baseUrl of ["http://localhost:11434/v1", "http://10.0.0.5/v1", "ftp://x.test/v1"]) {
    assertEquals((await t.call("PUT", `${t.ai}/settings`, { baseUrl })).status, 400, baseUrl);
  }
  // A public name that resolves to a private address.
  const sneaky = await family({ resolve: () => Promise.resolve(["10.0.0.7"]) });
  assertEquals(
    (await sneaky.call("PUT", `${sneaky.ai}/settings`, { baseUrl: "https://evil.test/v1" })).status,
    400,
  );
  // Local development may use a local model.
  const dev = await family({ allowPrivateNetwork: true });
  assertEquals(
    (await dev.call("PUT", `${dev.ai}/settings`, { baseUrl: "http://localhost:11434/v1" })).status,
    200,
  );
});

Deno.test("lists the endpoint's models and tests the connection", async () => {
  const t = await family();
  // The form can ask before anything is saved.
  const list = await t.call("POST", `${t.ai}/models`, { baseUrl: AI, apiKey: KEY });
  assertEquals(list.data.models, ["mock-large", "mock-small", "mock-tiny"]);
  assertEquals((await t.call("POST", `${t.ai}/test`)).status, 400); // nothing saved yet
  await t.call("PUT", `${t.ai}/settings`, { baseUrl: AI, apiKey: KEY, model: "mock-small" });
  const test = await t.call("POST", `${t.ai}/test`);
  assertEquals([test.data.ok, test.data.model], [true, "mock-small"]);
  assertMatch(test.data.reply, /Mock reply/);
});

Deno.test("the assistant changes the calendar and the change can be undone", async () => {
  const t = await configured();
  const ev = await chat(t, "Add vacation from 2026-08-03 to 2026-08-07");
  assertEquals(names(ev).filter((n) => n !== "text"), [
    "tool",
    "tool_result",
    "change",
    "messages",
    "messages",
    "done",
  ]);
  const tool = ev.find((e) => e.event === "tool")!.data;
  assertEquals(tool.name, "change_entries");
  const change = ev.find((e) => e.event === "change")!.data;
  assertEquals([change.kind, change.summary], ["entries", "5 days changed"]);
  const entries = (await t.call("GET", `/families/${t.f.id}/entries?year=2026`)).data;
  assertEquals(Object.keys(entries).length, 5);
  assertEquals(entries["2026-08-03"], ["vacation"]);
  const text = ev.filter((e) => e.event === "text").map((e) => e.data.delta).join("");
  assertMatch(text, /Done: 5 days changed/);
  // How full the context is: the window from the endpoint's model list, the tokens it reported.
  assert(aiBody.stream_options.include_usage);
  const usage = ev.filter((e) => e.event === "usage").map((e) => e.data);
  assert(usage.length >= 4);
  assert(usage.every((u) => u.max === 64000 && u.used > 1000 && u.used < 64000));

  // The history for the next turn: the call, its (shortened) result and the answer.
  const added = addedOf(ev);
  assertEquals(added.map((m: any) => m.role), ["assistant", "tool", "assistant"]);
  assertEquals(added[1].tool_call_id, added[0].tool_calls[0].id);

  // Undo through the family's own API.
  for (const step of change.undo) {
    assertEquals(
      (await t.call(step.method, `/families/${t.f.id}${step.path}`, step.body)).status,
      200,
    );
  }
  assertEquals((await t.call("GET", `/families/${t.f.id}/entries?year=2026`)).data, {});

  // The next turn sends the whole history back.
  const next = await t.call("POST", `${t.ai}/chat`, {
    messages: [{ role: "user", content: "Add vacation from 2026-08-03 to 2026-08-07" }, ...added, {
      role: "user",
      content: "thanks",
    }],
  });
  assertMatch(next.data, /Mock reply: thanks/);
});

Deno.test("the assistant is told which page the user is on and keeps to it", async () => {
  const t = await configured();
  await chat(t, "hello", { page: "finance" });
  const system = aiBody.messages[0].content;
  assertMatch(system, /## Current page\nThe user is on the finance page, which shows the finances/);
  assertMatch(system, /don't suggest calendar entries/);
  await chat(t, "hello");
  assertMatch(
    aiBody.messages[0].content,
    /on the vacation page, which shows the vacation calendar/,
  );
});

Deno.test("big changes need the user's confirmation first", async () => {
  const t = await configured();
  const ev = await chat(t, "vacation 2026-01-01 to 2026-03-31");
  const result = ev.find((e) => e.event === "tool_result")!.data;
  assertEquals(result.ok, false);
  assertMatch(result.summary, /Ask the user to confirm/);
  assert(!ev.some((e) => e.event === "change"));
  assertEquals((await t.call("GET", `/families/${t.f.id}/entries?year=2026`)).data, {});
});

Deno.test("the assistant asks a question and goes on with the answer", async () => {
  const t = await configured({}, { allowWrites: false });
  const user = { role: "user", content: "ask several" };
  const ev = await chat(t, user.content);
  // The model is told to ask rather than guess.
  assertMatch(aiBody.messages[0].content, /## Ask instead of guessing/);
  // The question ends the turn, without the call's result: that is the user's answer.
  assertEquals(names(ev).filter((n) => n !== "text"), [
    "messages",
    "question",
    "done",
  ]);
  const added = addedOf(ev);
  assertEquals(added.length, 1);
  const call = added[0].tool_calls[0];
  assertEquals(call.function.name, "ask_user");
  assertEquals(ev.find((e) => e.event === "question")!.data, {
    id: call.id,
    question: "Where would you like to go?",
    options: ["Beach", "Mountains", "City"],
    multiple: true,
  });

  // The app adds the answer as the result and continues the turn.
  const answer = { selected: ["Beach", "City"], ownAnswer: "A lake" };
  const history = [user, ...added, {
    role: "tool",
    tool_call_id: call.id,
    content: JSON.stringify(answer),
  }];
  const res = await t.call("POST", `${t.ai}/chat`, { messages: history, continue: true });
  assertEquals(res.status, 200, res.data);
  const next = events(res.data);
  assert(next.some((e) => e.event === "done"));
  assertEquals(
    next.filter((e) => e.event === "text").map((e) => e.data.delta).join(""),
    "You answered: Beach, City, A lake.",
  );
});

Deno.test("questions need a text and 2 to 8 different options", async () => {
  const ask = (args: unknown) =>
    runTool("ask_user", JSON.stringify(args), {} as any, new Set(["ask_user"]));
  const ok = await ask({ question: " Which one? ", options: ["A", " B", "A", ""] });
  assertEquals(ok.ok, true);
  assertEquals(ok.question, { question: "Which one?", options: ["A", "B"], multiple: false });
  for (
    const bad of [
      { question: "", options: ["A", "B"] },
      { question: "Which?", options: ["A", "A"] },
      { question: "Which?", options: "A, B" },
      { question: "Which?", options: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] },
      { question: "Which?", options: ["A", "B".repeat(151)] },
    ]
  ) {
    const res = await ask(bad);
    assertEquals(res.ok, false, JSON.stringify(bad));
    assertEquals(res.question, undefined);
  }
});

Deno.test("with changes switched off, the assistant only gets read tools", async () => {
  const t = await configured({}, { allowWrites: false });
  const ev = await chat(t, "Add vacation from 2026-08-03 to 2026-08-07");
  assert(!ev.some((e) => e.event === "tool"));
  assertEquals((await t.call("GET", `/families/${t.f.id}/entries?year=2026`)).data, {});
  // Reading still works.
  const read = await chat(t, "what's in my calendar?");
  assertEquals(read.find((e) => e.event === "tool")!.data.name, "get_calendar");
});

Deno.test("the assistant searches the web and reads pages, but not private ones", async () => {
  const t = await configured({}, { searchProvider: "tavily", searchKey: "tvly-key" });
  const search = await chat(t, "search school holidays Bavaria 2027");
  assertEquals(search.find((e) => e.event === "tool")!.data.name, "web_search");
  assertEquals(search.find((e) => e.event === "tool_result")!.data.ok, true);

  const page = await chat(t, "read https://pages.test/ferien please");
  const added = addedOf(page);
  const tool = JSON.parse(added[1].content);
  assertEquals(tool.title, "School holidays 2027");
  assert(tool.text.includes("Summer: Aug 2 – Sep 13") && !tool.text.includes("evil"));

  // The app gets the whole tool result (it shortens them itself once the turn is over).
  const long = await chat(t, "read https://pages.test/long please");
  const longTool = addedOf(long)[1].content;
  assert(longTool.length > 7000 && !longTool.includes("…(truncated)"));

  for (const url of ["http://169.254.169.254/latest/meta-data", "https://redirect.test/"]) {
    const ev = await chat(t, `read ${url}`);
    const res = ev.find((e) => e.event === "tool_result")!.data;
    assertEquals(res.ok, false, url);
    assertMatch(res.summary, /[Pp]rivate/);
  }
  assert(!requests.some((r) => r.includes("169.254")));
});

Deno.test("an endpoint that doesn't know stream_options is asked without it", async () => {
  const t = await configured({}, { baseUrl: AI + "/strict" });
  const before = requests.length;
  const ev = await chat(t, "hello");
  assertMatch(ev.filter((e) => e.event === "text").map((e) => e.data.delta).join(""), /hello/);
  assertEquals(aiBody.stream_options, undefined);
  // Refused once, then asked without it (also from now on).
  assertEquals(requests.slice(before).filter((r) => r.endsWith("/chat/completions")).length, 2);
  await chat(t, "again");
  assertEquals(requests.slice(before).filter((r) => r.endsWith("/chat/completions")).length, 3);
  // Without the endpoint's numbers, the context in use is estimated.
  const usage = ev.filter((e) => e.event === "usage").map((e) => e.data);
  assert(usage.length && usage.every((u) => u.used > 1000 && u.max === 64000));
});

Deno.test("a long task runs on as long as the model works, without a limit of steps", async () => {
  const t = await configured();
  const ev = await chat(t, "keep looking 60 times");
  assertEquals(ev.filter((e) => e.event === "tool").length, 60);
  assertEquals(aiBody.tool_choice, "auto");
  const added = addedOf(ev);
  assertEquals(added.at(-1), { role: "assistant", content: "Done looking: 60 times." });
  assert(ev.some((e) => e.event === "done"));
  assert(!ev.some((e) => e.event === "compacted")); // it all fits
});

Deno.test("a conversation too long for the context is condensed, not cut off", async () => {
  const t = await configured({}, { contextWindow: 12000 });
  const user = { role: "user", content: "keep looking 40 times" };
  const ev = await chat(t, user.content);
  // It looked 40 times in all: the summary keeps count of the looks it condensed.
  assertEquals(ev.filter((e) => e.event === "tool").length, 40);
  assertEquals(addedOf(ev).at(-1), { role: "assistant", content: "Done looking: 40 times." });
  const compacted = ev.filter((e) => e.event === "compacted").map((e) => e.data);
  assert(compacted.length >= 1);
  assertMatch(compacted[0].summary, /^Looked \d+ times/);
  // The user's request stays word for word with the summary.
  assertEquals(compacted[0].request, user.content);
  assert(
    ev.findIndex((e) => e.event === "compacting") < ev.findIndex((e) => e.event === "compacted"),
  );
  // The model got the summary first, then the newest messages (from a call, not a result).
  const [, summary, next] = aiBody.messages;
  assertEquals(summary.role, "user");
  assertMatch(summary.content, /condensed[\s\S]*Looked \d+ times[\s\S]*keep looking 40 times$/);
  assertEquals(next.role, "assistant");
  // The context never got full.
  const usage = ev.filter((e) => e.event === "usage").map((e) => e.data);
  assert(usage.every((u) => u.max === 12000 && u.used < 12000), JSON.stringify(usage));
});

Deno.test("when the endpoint says the context is full, the conversation is condensed", async () => {
  // The model list doesn't tell this model's window (10,000): only its error does.
  const t = await configured({}, { model: "mock-tiny" });
  const ev = await chat(t, "keep looking 50 times");
  assertEquals(addedOf(ev).at(-1), { role: "assistant", content: "Done looking: 50 times." });
  assert(ev.some((e) => e.event === "compacted"));
  assert(!ev.some((e) => e.event === "continue"));
  const usage = ev.filter((e) => e.event === "usage").map((e) => e.data);
  assertEquals(usage[0].max, 128000);
  assertEquals(usage.at(-1).max, 10000);
});

Deno.test("near the time limit, the turn is handed on to the next request", async () => {
  const t = await configured({ aiHandOffMs: 0 });
  const user = { role: "user", content: "keep looking" };
  // Each request takes one step, then hands off.
  let ev = await chat(t, "keep looking");
  assertEquals(names(ev), ["tool", "tool_result", "messages", "continue"]);
  const history: unknown[] = [user, ...addedOf(ev)];
  assertEquals(history.length, 3);
  let rounds = 1;
  for (;;) {
    const res = await t.call("POST", `${t.ai}/chat`, { messages: history, continue: true });
    assertEquals(res.status, 200, res.data);
    ev = events(res.data);
    history.push(...addedOf(ev));
    rounds++;
    if (!ev.some((e) => e.event === "continue")) break;
    assertEquals(ev.filter((e) => e.event === "tool").length, 1);
  }
  // It looked 30 times, one step per request, then answered.
  assertEquals(rounds, 31);
  assert(ev.some((e) => e.event === "done"));
  assertEquals(history.at(-1), { role: "assistant", content: "Done looking: 30 times." });
  assertEquals(history.length, 1 + 30 * 2 + 1);

  // A long turn keeps its user message, even past the history limit.
  const turn = history.slice(0, -1);
  const long = [...turn, ...turn.slice(1, 41)];
  const res = await t.call("POST", `${t.ai}/chat`, { messages: long, continue: true });
  assertEquals(res.status, 200, res.data);
  assertEquals(aiBody.messages.length, 1 + long.length);
  assertEquals(aiBody.messages[1], user);

  // Continuing needs tool results last; a new turn needs the user's message last.
  const bad = [
    { messages: [user], continue: true },
    { messages: turn.slice(0, 2), continue: true },
    { messages: turn },
  ];
  for (const body of bad) {
    assertEquals((await t.call("POST", `${t.ai}/chat`, body)).status, 400, JSON.stringify(body));
  }
});

Deno.test("a model that ends without a word is asked again for its answer", async () => {
  const t = await configured();
  let ev = await chat(t, "say nothing");
  assertEquals(aiBody.tool_choice, "none");
  assert(aiBody.messages[0].content.includes("## Answer now"));
  assertEquals(
    ev.filter((e) => e.event === "text").map((e) => e.data.delta).join(""),
    "Here is the calendar.",
  );
  let added = addedOf(ev);
  assertEquals(added.map((m: { role: string }) => m.role), ["assistant", "tool", "assistant"]);
  assertEquals(added.at(-1), { role: "assistant", content: "Here is the calendar." });
  assert(ev.some((e) => e.event === "done"));

  // Still nothing after five tries: the chat says so instead of ending blank.
  const before = requests.length;
  ev = await chat(t, "stay silent");
  assertEquals(requests.length - before, 6);
  assertEquals(ev.find((e) => e.event === "text")?.data.delta, "(The model gave no answer.)");
  added = addedOf(ev);
  assertEquals(added, [{ role: "assistant", content: "(The model gave no answer.)" }]);
  assert(ev.some((e) => e.event === "done"));
});

Deno.test("a failed or too slow model call hands the step back to be tried again", async () => {
  // Too slow: cut off before the platform would stop the request.
  let t = await configured({ aiDeadlineMs: 50 });
  let ev = (await chat(t, "take your time")).filter((e) => e.event !== "usage");
  assertEquals(names(ev), ["continue"]);
  assertEquals(ev[0].data.retry, true);
  assertMatch(ev[0].data.message, /took too long/);

  // Failed after a step: that step is kept, and the turn goes on from its tool results.
  t = await configured();
  const user = { role: "user", content: "keep looking, then fail" };
  const res = await t.call("POST", `${t.ai}/chat`, { messages: [user] });
  ev = events(res.data).filter((e) => e.event !== "usage");
  assertEquals(names(ev), ["tool", "tool_result", "messages", "continue"]);
  assertEquals(ev[3].data.retry, true);
  assertMatch(ev[3].data.message, /refused the request: 503/);
  const history = [user, ...addedOf(ev)];
  assertEquals(history.at(-1)!.role, "tool");
  const again = await t.call("POST", `${t.ai}/chat`, { messages: history, continue: true });
  assertEquals(again.status, 200, again.data);
});

Deno.test("the assistant reads the finances", async () => {
  const t = await configured();
  await t.call("POST", `/families/${t.f.id}/finance/transactions`, {
    ops: [{ date: "2026-02-01", amountCents: 100000 }, { date: "2026-02-02", amountCents: -2500 }],
  });
  const ev = await chat(t, "how much did we spend?");
  assertEquals(ev.find((e) => e.event === "tool")!.data.name, "finance_summary");
  const text = ev.filter((e) => e.event === "text").map((e) => e.data.delta).join("");
  assertMatch(text, /Income 1000, expenses 25/);
});

Deno.test("the assistant calculates and analyzes the finances, also read-only", async () => {
  const t = await configured({}, { allowWrites: false });
  await t.call("POST", `/families/${t.f.id}/finance/transactions`, {
    ops: [
      { date: "2026-02-01", amountCents: -2500, categoryId: "groceries" },
      { date: "2026-02-03", amountCents: -1500, categoryId: "groceries" },
    ],
  });
  const calc = await chat(t, "calculate round(1199.1 * 12 * 1.19, 2)");
  assertEquals(calc.find((e) => e.event === "tool")!.data.name, "calculate");
  const text = (ev: typeof calc) =>
    ev.filter((e) => e.event === "text").map((e) => e.data.delta).join("");
  assertMatch(text(calc), /= 17123\.15/);

  const analyze = await chat(t, "analyze category");
  assertEquals(analyze.find((e) => e.event === "tool")!.data.args.groupBy, ["category"]);
  assertMatch(text(analyze), /1 groups, 40 spent/);
});

Deno.test("the assistant adds categories, with undo, and deletes them only when confirmed", async () => {
  const t = await configured();
  const ev = await chat(t, "add category Pets");
  assertEquals(ev.find((e) => e.event === "tool")!.data.name, "manage_categories");
  const change = ev.find((e) => e.event === "change")!.data;
  assertEquals([change.kind, change.summary], ["categories", "Added the category “Pets”"]);
  const cats = async () => (await t.call("GET", `/families/${t.f.id}/finance`)).data.categories;
  const pets = (await cats()).find((c: any) => c.name === "Pets");
  assertEquals([pets.id, pets.kind, pets.icon], ["pets", "expense", "🐾"]);

  // Undo through the family's own API.
  for (const step of change.undo) {
    assertEquals(
      (await t.call(step.method, `/families/${t.f.id}${step.path}`, step.body)).status,
      200,
    );
  }
  assert(!(await cats()).some((c: any) => c.name === "Pets"));

  // Deleting needs the user's OK.
  await chat(t, "add category Pets");
  const del = await chat(t, "delete category Pets");
  const result = del.find((e) => e.event === "tool_result")!.data;
  assertEquals(result.ok, false);
  assertMatch(result.summary, /Ask the user to confirm/);
  assert((await cats()).some((c: any) => c.name === "Pets"));

  // Read-only chats can't add any.
  const ro = await configured({}, { allowWrites: false });
  assert(!(await chat(ro, "add category Pets")).some((e) => e.event === "tool"));
});

/** Adds transactions; returns their ids in order. */
async function addTransactions(t: Awaited<ReturnType<typeof family>>, ops: unknown[]) {
  const res = await t.call("POST", `/families/${t.f.id}/finance/transactions`, { ops });
  assertEquals(res.status, 200, res.data);
  return res.data.added as string[];
}

async function categoryOf(t: Awaited<ReturnType<typeof family>>, ids: string[]) {
  const res = await t.call("GET", `/families/${t.f.id}/finance/transactions?limit=1000`);
  const byId = new Map(res.data.transactions.map((x: any) => [x.id, x.categoryId]));
  return ids.map((id) => byId.get(id));
}

Deno.test("sorts uncategorized transactions into fitting categories, with undo", async () => {
  const t = await configured();
  const ids = await addTransactions(t, [
    { date: "2026-02-01", amountCents: -4520, payee: "Supermarket", description: "groceries" },
    { date: "2026-02-02", amountCents: -1200, payee: "City", description: "Mobility pass" },
    // Income can't go to an expense category, whatever the model says.
    { date: "2026-02-03", amountCents: 900, payee: "Groceries refund" },
    { date: "2026-02-04", amountCents: -999, payee: "Something odd" },
    // Already sorted: stays as it is, and is shown to the model as an example.
    { date: "2026-01-15", amountCents: -5000, payee: "Pharmacy", categoryId: "health" },
  ]);
  const res = await t.call("POST", `${t.ai}/categorize`, { from: "2026-02-01", to: "2026-02-28" });
  assertEquals(res.status, 200, res.data);
  assertEquals([res.data.changed, res.data.considered, res.data.remaining], [2, 4, 0]);
  assertEquals(await categoryOf(t, ids), ["groceries", "mobility", null, null, "health"]);
  assertEquals(aiBody.temperature, 0);
  assertMatch(aiBody.messages[0].content, /Pharmacy -> health/);
  assertMatch(aiBody.messages[1].content, /^1 \| 2026-02-04 \| -9\.99 \| Something odd \| $/m);

  const undo = await t.call("POST", `/families/${t.f.id}/finance/transactions`, {
    ops: res.data.inverse,
  });
  assertEquals(undo.status, 200);
  assertEquals(await categoryOf(t, ids), [null, null, null, null, "health"]);
});

Deno.test("categorizes given transactions, or a range page by page", async () => {
  const t = await configured();
  const ids = await addTransactions(
    t,
    Array.from({ length: 205 }, (_, i) => ({
      date: "2026-03-01",
      amountCents: -100 - i,
      payee: i % 2 ? "Unknown shop" : "Leisure park",
    })),
  );
  const one = await t.call("POST", `${t.ai}/categorize`, { ids: ids.slice(0, 2) });
  assertEquals([one.data.changed, one.data.considered, one.data.remaining], [1, 2, 0]);

  // 204 left open: 200 now, the rest on the next call (skipping the ones left uncategorized).
  const first = await t.call("POST", `${t.ai}/categorize`, {});
  assertEquals([first.data.considered, first.data.remaining], [200, 4]);
  const left = first.data.considered - first.data.changed;
  const next = await t.call("POST", `${t.ai}/categorize`, { skip: left });
  assertEquals([next.data.considered, next.data.remaining], [4, 0]);
  const cats = await categoryOf(t, ids);
  assertEquals(cats.filter((c) => c === "leisure").length, 103);
  assertEquals(cats.filter((c) => c === null).length, 102);
});

Deno.test("sorts like similar transactions without AI", async () => {
  const t = await family(); // no AI settings
  const ids = await addTransactions(t, [
    { date: "2026-01-02", amountCents: -3000, payee: "REWE Markt 1234", categoryId: "groceries" },
    { date: "2026-01-09", amountCents: -2000, payee: "Rewe Markt 99", categoryId: "groceries" },
    { date: "2026-01-10", amountCents: -900, payee: "Kiosk", categoryId: "leisure" },
    { date: "2026-01-11", amountCents: -900, payee: "Kiosk", categoryId: "shopping" },
    { date: "2026-02-01", amountCents: -4520, payee: "REWE MARKT 5678" },
    // The family sorted the kiosk both ways: no clear answer.
    { date: "2026-02-02", amountCents: -800, payee: "Kiosk" },
    // Money back from the supermarket doesn't go into an expense category.
    { date: "2026-02-03", amountCents: 500, payee: "Rewe Markt 1" },
  ]);
  requests.length = 0;
  const res = await t.call("POST", `${t.ai}/categorize`, { from: "2026-02-01" });
  assertEquals(res.status, 200, res.data);
  assertEquals([res.data.changed, res.data.matched, res.data.ai], [1, 1, false]);
  assertEquals(res.data.assignments[0].source, "similar");
  assertEquals((await categoryOf(t, ids)).slice(4), ["groceries", null, null]);
  assertEquals(requests.length, 0);
  assertEquals(
    similarKey({ payee: "", description: "SEPA 4711 Stadtwerke München GmbH" }),
    "sepa stadtwerke münchen",
  );
});

Deno.test("looks up unknown payees on the web when search is set up", async () => {
  const t = await configured({}, { searchProvider: "tavily", searchKey: "tvly-key" });
  const ids = await addTransactions(t, [
    { date: "2026-02-01", amountCents: -2400, payee: "Zorbex" },
  ]);
  requests.length = 0;
  const res = await t.call("POST", `${t.ai}/categorize`, {});
  assertEquals([res.data.changed, res.data.matched], [1, 0]);
  assertEquals(await categoryOf(t, ids), ["leisure"]);
  assert(requests.some((r) => r.startsWith("https://api.tavily.com")));
  // The model got the search results back, and could have searched more.
  assertEquals(aiBody.tool_choice, "auto");
  assertMatch(aiBody.messages[0].content, /web_search/);
  assertEquals(aiBody.messages.at(-1).role, "tool");
});

Deno.test("categorizing needs the edit link and valid input", async () => {
  const t = await family();
  assertEquals((await t.view("POST", `/families/${t.f.id}/ai/categorize`, {})).status, 403);
  assertEquals((await t.call("POST", `${t.ai}/categorize`, { ids: ["x"] })).status, 400);
  assertEquals((await t.call("POST", `${t.ai}/categorize`, { from: "March" })).status, 400);
  assertEquals((await t.call("POST", `${t.ai}/categorize`, { skip: -1 })).status, 400);
  // Nothing to do: no request to the model.
  requests.length = 0;
  const none = await t.call("POST", `${t.ai}/categorize`, {});
  assertEquals([none.status, none.data.considered, requests.length], [200, 0, 0]);
});

Deno.test("reads the model's answer even when it is wrapped", () => {
  assertEquals(parseAnswer('Sure!\n```json\n{"1": "groceries", "2": null}\n```'), {
    "1": "groceries",
    "2": null,
  });
  assertEquals(parseAnswer("no idea"), {});
  assertEquals(parseAnswer("[1, 2]"), {});
});

Deno.test("chat needs settings, the edit link and a clean history", async () => {
  const t = await family();
  const msg = { messages: [{ role: "user", content: "hi" }] };
  assertEquals((await t.call("POST", `${t.ai}/chat`, msg)).status, 400); // not set up
  await t.call("PUT", `${t.ai}/settings`, { baseUrl: AI, model: "mock-large" });
  assertEquals((await t.view("POST", `/families/${t.f.id}/ai/chat`, msg)).status, 403);
  assertEquals((await t.call("POST", `${t.ai}/chat`, { messages: [] })).status, 400);
  assertEquals(
    (await t.call("POST", `${t.ai}/chat`, { messages: [{ role: "system", content: "x" }] })).status,
    400,
  );
  assertEquals(
    (await t.call("POST", `${t.ai}/chat`, {
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }],
    })).status,
    400,
  );
});

Deno.test("user messages can carry attached files and images", async () => {
  const t = await configured();
  // A 1×1 PNG.
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk" +
    "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const image = { type: "image_url", image_url: { url: png, detail: "low" } };
  const ev = await chat(t, "", {
    messages: [{ role: "user", content: [{ type: "text", text: "what is this?" }, image] }],
  });
  const text = ev.filter((e) => e.event === "text").map((e) => e.data.delta).join("");
  assertMatch(text, /I see 1 image\. Mock reply: what is this\?/);
  // Only url is passed on.
  assertEquals(aiBody.messages[1].content[1], { type: "image_url", image_url: { url: png } });

  const bad = [
    [{
      role: "user",
      content: [{ type: "image_url", image_url: { url: "https://x.test/a.png" } }],
    }],
    [{
      role: "user",
      content: [{ type: "image_url", image_url: { url: "data:image/svg+xml;base64,AA==" } }],
    }],
    [{ role: "user", content: [{ type: "audio", audio: "x" }] }],
    [{ role: "user", content: [] }],
    [{ role: "user", content: [{ type: "text", text: 5 }] }],
    [{ role: "user", content: [{ type: "text", text: "x".repeat(60_001) }] }],
    [{ role: "user", content: Array(5).fill(image) }],
    [{ role: "user", content: "hi" }, { role: "assistant", content: [image] }, {
      role: "user",
      content: "and?",
    }],
  ];
  for (const messages of bad) {
    assertEquals(
      (await t.call("POST", `${t.ai}/chat`, { messages })).status,
      400,
      JSON.stringify(messages).slice(0, 120),
    );
  }

  // Of 10 images in the history only the newest 8 reach the model.
  const messages = [
    { role: "user", content: [image, image, { type: "text", text: "first" }] },
    { role: "assistant", content: "ok" },
    { role: "user", content: [image, image, image, image] },
    { role: "assistant", content: "ok" },
    { role: "user", content: [{ type: "text", text: "last" }, image, image, image, image] },
  ];
  const res = await t.call("POST", `${t.ai}/chat`, { messages });
  assertMatch(res.data, /I see 4 images\. Mock reply: last/);
  const sent = aiBody.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []);
  assertEquals(sent.filter((p: any) => p.type === "image_url").length, 8);
  assertEquals(aiBody.messages[1].content.slice(0, 2), [
    { type: "text", text: "(an earlier image, no longer sent)" },
    { type: "text", text: "(an earlier image, no longer sent)" },
  ]);
});

Deno.test("limits AI requests per client", async () => {
  const t = await configured({
    rateLimiter: new MemoryRateLimiter(),
    limits: {
      create: { max: 9, seconds: 60 },
      createAll: { max: 9, seconds: 60 },
      write: { max: 99, seconds: 60 },
      ai: { max: 2, seconds: 60 },
      aiFamily: { max: 99, seconds: 60 },
      login: { max: 99, seconds: 60 },
      loginAccount: { max: 99, seconds: 60 },
    },
  });
  const ok = await t.call("POST", `${t.ai}/test`);
  assertEquals(ok.status, 200);
  await t.call("POST", `${t.ai}/test`);
  assertEquals((await t.call("POST", `${t.ai}/test`)).status, 429);
  // Settings don't count.
  assertEquals((await t.call("PUT", `${t.ai}/settings`, { model: "x" })).status, 200);
});

Deno.test("turns HTML into readable text", () => {
  const { title, text } = htmlToText(
    "<title>A &amp; B</title><style>p{}</style><ul><li>One</li><li>Two&nbsp;&#x2603;</li></ul>",
  );
  assertEquals(title, "A & B");
  assertEquals(text, "- One\n- Two ☃");
});
