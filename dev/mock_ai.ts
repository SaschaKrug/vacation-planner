// A scripted stand-in for an OpenAI-compatible API, so the assistant can be tried without a key
// (deno task dev --mock-ai) and tested. It picks a tool from keywords in the last message and
// answers in OpenAI's streaming format:
//   "vacation 2026-08-03 to 2026-08-07"  -> change_entries (the first "covers" type)
//   "calendar"                            -> get_calendar for this month
//   "spend" / "finance"                   -> finance_summary for this year
//   "add category <name>"                 -> manage_categories (add)
//   "delete category <name>"              -> manage_categories (delete)
//   "search <words>"                      -> web_search
//   a URL                                 -> fetch_page
//   "keep looking"                        -> get_calendar again and again, until tools are off
//   "say nothing"                         -> get_calendar, then no words until tools are off
//   "stay silent"                         -> no words at all
//   "take your time"                      -> answers after 200 ms
// Asked to sort transactions into categories (the categorize prompt), it picks the category
// whose id or name occurs in a row's payee or description, searching the web once for a payee
// it can't place.
// After a tool result it says what happened; anything else is echoed. A message with images
// (content parts) gets "I see 2 images." before the echo.

type Part = { type: string; text?: string };
type Msg = { role: string; content: string | null | Part[]; tool_calls?: unknown[] };

/** A message's text: the string, or its text parts joined. */
function textOf(content: Msg["content"]) {
  if (!Array.isArray(content)) return String(content ?? "");
  return content.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
}

function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

function reply(stream: boolean, content: string, call?: { name: string; args: unknown }) {
  const toolCall = call && {
    id: `call_${crypto.randomUUID().slice(0, 8)}`,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  };
  if (!stream) {
    return Response.json({
      choices: [{
        index: 0,
        message: { role: "assistant", content, ...(toolCall ? { tool_calls: [toolCall] } : {}) },
        finish_reason: toolCall ? "tool_calls" : "stop",
      }],
    });
  }
  let body = "";
  for (const word of content.match(/\S+\s*/g) ?? []) body += chunk({ content: word });
  if (toolCall) {
    // Arguments arrive in pieces, like real servers send them.
    const args = toolCall.function.arguments;
    body += chunk({
      tool_calls: [{
        index: 0,
        id: toolCall.id,
        type: "function",
        function: { name: call!.name, arguments: "" },
      }],
    });
    for (let i = 0; i < args.length; i += 12) {
      body += chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 12) } }] });
    }
  }
  body += chunk({}, toolCall ? "tool_calls" : "stop") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

/** The categorize prompt: a category whose id or name occurs in a row's payee or description,
 *  else in what a web search for its payee found; unknown payees are searched once. */
function categorize(stream: boolean, system: string, messages: Msg[], canSearch: boolean) {
  const categories = [...system.matchAll(/^- ([a-z0-9-]+): (?:[^\w\s]\S* )?([^(\n]+?) \(/gmu)];
  const match = (text: string) =>
    categories.find(([, id, name]) => text.includes(id) || text.includes(name.toLowerCase()))
      ?.[1] ?? null;
  const found = new Map<string, string>();
  for (const m of messages.filter((m) => m.role === "tool")) {
    const result = JSON.parse(textOf(m.content));
    found.set(result.query, JSON.stringify(result.results ?? []).toLowerCase());
  }
  const answer: Record<string, string | null> = {};
  const unknown: string[] = [];
  for (const line of textOf(messages[1].content).split("\n")) {
    const [n, , , payee = "", description = ""] = line.split(" | ");
    answer[n] = match(`${payee} ${description}`.toLowerCase()) ??
      match(found.get(payee) ?? "");
    if (!answer[n] && payee && !found.has(payee)) unknown.push(payee);
  }
  if (canSearch && unknown.length && !found.size) {
    return reply(stream, "", { name: "web_search", args: { query: unknown[0] } });
  }
  return reply(stream, "```json\n" + JSON.stringify(answer) + "\n```");
}

export async function mockAi(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/^.*\/v1/, "");
  if (req.method === "GET" && path === "/models") {
    return Response.json({ data: [{ id: "mock-large" }, { id: "mock-small" }] });
  }
  if (req.method !== "POST" || path !== "/chat/completions") {
    return Response.json({ error: { message: "Not found" } }, { status: 404 });
  }
  const body = await req.json();
  const messages: Msg[] = body.messages ?? [];
  const last = messages.at(-1)!;
  const stream = body.stream === true;
  const tools = new Set(
    (body.tools ?? []).map((t: { function: { name: string } }) => t.function.name),
  );

  const system = textOf(messages[0]?.content);
  if (system.startsWith("You sort bank transactions into categories.")) {
    return categorize(
      stream,
      system,
      messages,
      tools.has("web_search") && body.tool_choice !== "none",
    );
  }

  const asked = textOf(messages.findLast((m) => m.role === "user")?.content ?? "");
  if (/stay silent/i.test(asked)) return reply(stream, "");
  if (/say nothing/i.test(asked)) {
    if (body.tool_choice === "none") return reply(stream, "Here is the calendar.");
    if (last.role === "tool") return reply(stream, "");
    return reply(stream, "", {
      name: "get_calendar",
      args: { from: "2026-01-01", to: "2026-01-31" },
    });
  }
  if (/take your time/i.test(asked)) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 200);
      req.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(req.signal.reason);
      });
    });
    return reply(stream, "Sorry for the wait.");
  }
  if (/keep looking/i.test(asked)) {
    if (body.tool_choice === "none") return reply(stream, "Out of steps: here is what I have.");
    return reply(stream, "", {
      name: "get_calendar",
      args: { from: "2026-01-01", to: "2026-01-31" },
    });
  }

  if (last.role === "tool") {
    const result = JSON.parse(textOf(last.content) || "{}");
    if (result.error) return reply(stream, `That didn't work: ${result.error}`);
    const text = result.changed !== undefined
      ? `Done: ${result.changed} days changed.`
      : result.results
      ? `I found ${result.results.length} results, e.g. ${result.results[0]?.title ?? "nothing"}.`
      : result.title !== undefined
      ? `The page is called “${result.title}”.`
      : result.incomeCents !== undefined
      ? `Income ${result.incomeCents / 100}, expenses ${result.expenseCents / 100}.`
      : `Here is what I found: ${JSON.stringify(result).slice(0, 200)}`;
    return reply(stream, text);
  }

  const text = textOf(last.content);
  const images = Array.isArray(last.content)
    ? last.content.filter((p) => p.type === "image_url").length
    : 0;
  const lower = text.toLowerCase();
  const today = /Today is (\d{4}-\d{2}-\d{2})/.exec(system)?.[1] ??
    new Date().toISOString().slice(0, 10);
  const dates = text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const url = /https?:\/\/\S+/.exec(text)?.[0];

  if (/vacation|urlaub/.test(lower) && dates.length && tools.has("change_entries")) {
    const type = /- ([a-z0-9-]+): “[^”]*” \(covers\)/.exec(system)?.[1] ?? "vacation";
    return reply(stream, "I'll add that.", {
      name: "change_entries",
      args: {
        ops: [{
          action: "add",
          type,
          from: dates[0],
          to: dates[1] ?? dates[0],
          skipWeekends: true,
        }],
      },
    });
  }
  if (/calendar|kalender/.test(lower)) {
    const month = today.slice(0, 7);
    return reply(stream, "", {
      name: "get_calendar",
      args: { from: `${month}-01`, to: `${month}-28` },
    });
  }
  const category = /^(add|delete) category (.+)$/i.exec(text);
  if (category && tools.has("manage_categories")) {
    const [, action, name] = category;
    return reply(stream, "", {
      name: "manage_categories",
      args: action.toLowerCase() === "add"
        ? { action: "add", name, icon: "🐾" }
        : { action: "delete", category: name },
    });
  }
  if (/spen[dt]|finance|ausgegeben|finanzen/.test(lower)) {
    const year = today.slice(0, 4);
    return reply(stream, "", {
      name: "finance_summary",
      args: { from: `${year}-01-01`, to: `${year}-12-31` },
    });
  }
  if (url) return reply(stream, "", { name: "fetch_page", args: { url } });
  if (/^(search|suche)\b/.test(lower) && tools.has("web_search")) {
    return reply(stream, "", { name: "web_search", args: { query: text.replace(/^\S+\s*/, "") } });
  }
  const seen = images ? `I see ${images} image${images > 1 ? "s" : ""}. ` : "";
  return reply(stream, `${seen}Mock reply: ${text}`);
}
