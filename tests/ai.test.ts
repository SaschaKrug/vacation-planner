import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { mockAi } from "../dev/mock_ai.ts";
import { htmlToText, isPrivateAddress } from "../supabase/functions/_shared/ai/net.ts";
import { createHandler, type HandlerOptions } from "../supabase/functions/_shared/handler.ts";
import { MemoryRateLimiter } from "../supabase/functions/_shared/rate_limit.ts";
import { devSecret } from "../supabase/functions/_shared/secrets.ts";
import { MemoryStore } from "../supabase/functions/_shared/store.ts";

const BASE = "http://localhost/functions/v1/api";
const AI = "https://mock.test/v1";
const KEY = "sk-test-1234567890abcd";

/** The outside world: the mock AI, a web page, a redirect to a private address, Tavily. */
const requests: string[] = [];
const fakeFetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  requests.push(url.href);
  if (url.href.startsWith(AI)) return mockAi(new Request(url, init));
  if (url.hostname === "pages.test") {
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
    return Promise.resolve(Response.json({
      results: [{ title: "Ferien Bayern 2027", url: "https://pages.test/ferien", content: "…" }],
    }));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}) as typeof fetch;

function setup(options: HandlerOptions = {}) {
  const store = new MemoryStore();
  const handler = createHandler(store, {
    aiSecret: devSecret(),
    fetch: fakeFetch,
    resolve: () => Promise.resolve(["93.184.216.34"]),
    ...options,
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handler(
      new Request(BASE + path, {
        method,
        headers: { "x-forwarded-for": "203.0.113.9", "content-type": "application/json" },
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
  return { call, store };
}

async function family(options: HandlerOptions = {}) {
  const t = setup(options);
  const res = await t.call("POST", "/families", { year: 2026 });
  const f = res.data.family as { id: string; readId: string };
  return { ...t, f, ai: `/families/${f.id}/ai` };
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
    serverReady: true,
  });
  const row = (await t.store.getAiSettings(t.f.id))!;
  assert(row.api_key_enc.startsWith("v1:") && !row.api_key_enc.includes(KEY));
  // Only the fields given change; "" removes a key.
  const cleared = await t.call("PUT", `${t.ai}/settings`, { apiKey: "" });
  assertEquals([cleared.data.hasKey, cleared.data.model], [false, "mock-large"]);

  assertEquals((await t.call("GET", `/families/${t.f.readId}/ai/settings`)).status, 403);
  assertEquals((await t.call("PUT", `${t.ai}/settings`, { searchProvider: "bing" })).status, 400);
  assertEquals((await t.call("PUT", `${t.ai}/settings`, { apiKey: "has space" })).status, 400);
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
  assertEquals(list.data.models, ["mock-large", "mock-small"]);
  assertEquals((await t.call("POST", `${t.ai}/test`)).status, 400); // nothing saved yet
  await t.call("PUT", `${t.ai}/settings`, { baseUrl: AI, apiKey: KEY, model: "mock-small" });
  const test = await t.call("POST", `${t.ai}/test`);
  assertEquals([test.data.ok, test.data.model], [true, "mock-small"]);
  assertMatch(test.data.reply, /Mock reply/);
});

Deno.test("the assistant changes the calendar and the change can be undone", async () => {
  const t = await configured();
  const ev = await chat(t, "Add vacation from 2026-08-03 to 2026-08-07");
  const names = ev.map((e) => e.event);
  assertEquals(names.filter((n) => n !== "text"), [
    "tool",
    "tool_result",
    "change",
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

  // The history for the next turn: the call, its (shortened) result and the answer.
  const added = ev.find((e) => e.event === "messages")!.data.messages;
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

Deno.test("big changes need the user's confirmation first", async () => {
  const t = await configured();
  const ev = await chat(t, "vacation 2026-01-01 to 2026-03-31");
  const result = ev.find((e) => e.event === "tool_result")!.data;
  assertEquals(result.ok, false);
  assertMatch(result.summary, /Ask the user to confirm/);
  assert(!ev.some((e) => e.event === "change"));
  assertEquals((await t.call("GET", `/families/${t.f.id}/entries?year=2026`)).data, {});
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
  const added = page.find((e) => e.event === "messages")!.data.messages;
  const tool = JSON.parse(added[1].content);
  assertEquals(tool.title, "School holidays 2027");
  assert(tool.text.includes("Summer: Aug 2 – Sep 13") && !tool.text.includes("evil"));

  for (const url of ["http://169.254.169.254/latest/meta-data", "https://redirect.test/"]) {
    const ev = await chat(t, `read ${url}`);
    const res = ev.find((e) => e.event === "tool_result")!.data;
    assertEquals(res.ok, false, url);
    assertMatch(res.summary, /[Pp]rivate/);
  }
  assert(!requests.some((r) => r.includes("169.254")));
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

Deno.test("chat needs settings, the edit link and a clean history", async () => {
  const t = await family();
  const msg = { messages: [{ role: "user", content: "hi" }] };
  assertEquals((await t.call("POST", `${t.ai}/chat`, msg)).status, 400); // not set up
  await t.call("PUT", `${t.ai}/settings`, { baseUrl: AI, model: "mock-large" });
  assertEquals((await t.call("POST", `/families/${t.f.readId}/ai/chat`, msg)).status, 403);
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

Deno.test("limits AI requests per client", async () => {
  const t = await configured({
    rateLimiter: new MemoryRateLimiter(),
    limits: {
      create: { max: 9, seconds: 60 },
      createAll: { max: 9, seconds: 60 },
      write: { max: 99, seconds: 60 },
      ai: { max: 2, seconds: 60 },
      aiFamily: { max: 99, seconds: 60 },
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
