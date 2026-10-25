// One chat turn: the system prompt, the tool loop against the family's AI endpoint, and the
// events streamed to the app (server-sent events).

import { HttpError, objectOf } from "../http.ts";
import type { AccountRow, CategoryRow, FamilyRow, TypeRow } from "../store.ts";
import {
  type ChatMessage,
  type ContentPart,
  type Provider,
  streamChat,
  type ToolCall,
} from "./provider.ts";
import { MAX_TOOL_RESULT, runTool, type ToolContext, toolsFor } from "./tools.ts";

/** Model calls per answer (across hand-offs); the last one gets no tools, so the model answers
 *  with what it has. */
const MAX_STEPS = 30;
const OUT_OF_STEPS = "(Stopped: too many steps in one answer.)";
const MAX_MESSAGES = 80;
/** An answer or tool result in the history. */
const MAX_CONTENT = 20_000;
/** Attachments: parts per message, a typed or attached text, images per message and per chat. */
const MAX_PARTS = 10;
const MAX_FILE_TEXT = 60_000;
const MAX_IMAGE_URL = 2_000_000;
const IMAGES_PER_MESSAGE = 4;
const MAX_IMAGES = 8;
const IMAGE_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const OLD_IMAGE = "(an earlier image, no longer sent)";
/** Edge Functions run at most 150 s (free plan): after this, a request hands the turn back to
 *  the app, which goes on with a new request ("continue"). */
const HAND_OFF_MS = 90_000;

const WRAP_UP = `

## Out of steps
You can't use tools any more in this answer. Answer now with what you found and did so far,
and say what is still open, so the user can ask you to go on.`;

export type Emit = (event: string, data: unknown) => void;

const LANGUAGES: Record<string, string> = { en: "English", de: "German (Deutsch)" };
const ROLE_TEXT: Record<string, string> = {
  needs_cover: "needs cover",
  covers: "covers",
  day_off: "day off",
  none: "normal",
};

export function systemPrompt(input: {
  family: FamilyRow;
  types: TypeRow[];
  categories: CategoryRow[];
  accounts: AccountRow[];
  currency: string;
  today: string;
  year: number;
  page: string;
  lang: string;
  writes: boolean;
  search: boolean;
}): string {
  const { family, today, year } = input;
  const weekday = new Date(today + "T00:00:00Z").toLocaleDateString("en", {
    weekday: "long",
    timeZone: "UTC",
  });
  const types = input.types.filter((t) => t.year === year);
  const typeList = types.length
    ? types.map((t) => `- ${t.id}: “${t.name}” (${ROLE_TEXT[t.role]})`).join("\n")
    : "- (none yet)";
  const cats = input.categories.length
    ? input.categories.map((c) => `${c.id} (“${c.name}”, ${c.kind})`).join(", ")
    : "(none)";
  const accounts = input.accounts.length
    ? input.accounts.map((a) => `${a.id} (“${a.name}”)`).join(", ")
    : "(none)";
  return `You are the assistant inside the Family Planner of the family “${family.name}”.
Today is ${today} (${weekday}). The user is looking at the ${input.page} page, year ${year}.
Answer in ${LANGUAGES[input.lang] ?? "the user's language"}, briefly and friendly.

## Vacation calendar
A year calendar where each day can hold several entries of entry types; every year has its own
types. Roles drive the coverage check: a weekday with a "needs cover" entry (e.g. day care
closed) is a gap unless it also has a "covers" (e.g. a parent's vacation) or "day off" entry
(e.g. a public holiday). Days can also have one note (emoji icon and/or comment).
Entry types in ${year}:
${typeList}

## Finances
A transactions log in ${input.currency}. Amounts in tools are integer cents, negative for money
going out (-4599 = −45.99). Categories: ${cats}. Accounts: ${accounts}.
Transactions on different accounts that are one transfer between the family's own accounts
(500 out of checking, 500 into savings) are linked as a transfer (same transferId); totals count
a transfer once by its net, so moving money between accounts counts nothing.

## How to work
- Use the tools to look things up; don't guess what's in the calendar or the finances.
${
    input.writes
      ? `- Read before you change. Make small, clearly requested changes directly. Before bigger
  ones (more than 31 days, deleting types or categories, deleting or many transactions) say
  what you'll do and ask; the tools refuse until you call them again with "confirmed": true
  after the user agreed.
- If a fitting category is missing, you can add it with manage_categories.
- After a change, say in one sentence what changed. The user can undo it in the chat.`
      : "- You can only read: changing anything is switched off in the settings."
  }
${
    input.search
      ? "- For facts from the web (school and public holidays, opening times, prices), search, read the best sources with fetch_page, and name them."
      : "- Web search isn't set up; you can still read pages with fetch_page when the user gives a URL."
  }
- Call tools that don't depend on each other together, and put many changes into one call's
  ops: an answer can only take a limited number of steps.
- Dates are YYYY-MM-DD. Keep answers short; use Markdown lists only where they help.`;
}

/** `text` within `max`: refused in the new message, cut in older ones so they don't block
 *  the chat. */
function fit(text: string, max: number, isNew: boolean, error: string) {
  if (text.length <= max) return text;
  if (isNew) throw new HttpError(400, `${error} (max. ${max.toLocaleString("en")} characters)`);
  return text.slice(0, max) + "…(truncated)";
}

/** The app's history, checked: user, assistant and tool messages, newest kept (but all of the
 *  current turn). It ends with the user's message, or with tool results to `cont`inue a turn. */
export function cleanHistory(raw: unknown, cont = false): ChatMessage[] {
  if (!Array.isArray(raw) || !raw.length) {
    throw new HttpError(400, "messages must be a non-empty array");
  }
  const turn = raw.findLastIndex((m) => (m as { role?: unknown } | null)?.role === "user");
  const from = Math.max(
    0,
    turn < 0 ? raw.length - MAX_MESSAGES : Math.min(raw.length - MAX_MESSAGES, turn),
  );
  const out: ChatMessage[] = raw.slice(from).map((m, i): ChatMessage => {
    const o = objectOf(m, "Each message");
    if (!["user", "assistant", "tool"].includes(o.role as string)) {
      throw new HttpError(400, "role must be user, assistant or tool");
    }
    // Only the user's newest message is checked strictly; older ones are cut.
    const isNew = from + i === turn;
    let content: ChatMessage["content"];
    if (Array.isArray(o.content)) {
      if (o.role !== "user") throw new HttpError(400, "Only user messages can have parts");
      content = cleanParts(o.content, isNew);
    } else {
      content = o.content === null || o.content === undefined ? null : String(o.content);
      // A typed message may be as long as an attached text.
      const max = o.role === "user" ? MAX_FILE_TEXT : MAX_CONTENT;
      if (content) content = fit(content, max, isNew, "A message is too long");
    }
    const msg: ChatMessage = { role: o.role as ChatMessage["role"], content };
    if (o.role === "assistant" && Array.isArray(o.tool_calls) && o.tool_calls.length) {
      msg.tool_calls = o.tool_calls.slice(0, 20).map((c) => {
        const call = objectOf(c, "tool call");
        const fn = objectOf(call.function, "tool call function");
        return {
          id: String(call.id ?? ""),
          type: "function" as const,
          function: { name: String(fn.name ?? ""), arguments: String(fn.arguments ?? "{}") },
        };
      });
    }
    if (o.role === "tool") msg.tool_call_id = String(o.tool_call_id ?? "");
    return msg;
  });
  // Cut to a clean start: the first message must be the user's (no orphaned tool results).
  while (out.length && out[0].role !== "user") out.shift();
  if (cont && out.at(-1)?.role !== "tool") {
    throw new HttpError(400, "To continue, the last message must be a tool result");
  }
  if (!cont && (!out.length || out.at(-1)!.role !== "user")) {
    throw new HttpError(400, "The last message must be the user's");
  }
  // Only the newest images go to the model, so the request stays bounded.
  let images = 0;
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (!Array.isArray(m.content)) continue;
    m.content = m.content.map((p): ContentPart =>
      p.type === "image_url" && ++images > MAX_IMAGES ? { type: "text", text: OLD_IMAGE } : p
    );
  }
  return out;
}

/** A user message's parts: text (typed or an attached file) and images as data URLs. */
function cleanParts(raw: unknown[], isNew: boolean): ContentPart[] {
  if (!raw.length || raw.length > MAX_PARTS) {
    throw new HttpError(400, `A message needs 1 to ${MAX_PARTS} parts`);
  }
  const parts = raw.map((r): ContentPart => {
    const p = objectOf(r, "Each part");
    if (p.type === "text") {
      if (typeof p.text !== "string") throw new HttpError(400, "A text part needs text");
      return { type: "text", text: fit(p.text, MAX_FILE_TEXT, isNew, "A text is too long") };
    }
    if (p.type === "image_url") {
      const url = (p.image_url as { url?: unknown } | null)?.url;
      if (typeof url !== "string" || url.length > MAX_IMAGE_URL || !IMAGE_URL.test(url)) {
        throw new HttpError(400, "An image must be a PNG, JPEG, WebP or GIF data URL (max. 2 MB)");
      }
      return { type: "image_url", image_url: { url } };
    }
    throw new HttpError(400, "A part must be text or image_url");
  });
  if (parts.filter((p) => p.type === "image_url").length > IMAGES_PER_MESSAGE) {
    throw new HttpError(400, `At most ${IMAGES_PER_MESSAGE} images per message`);
  }
  return parts;
}

/**
 * Runs the tool loop and emits: "text" {delta}, "tool" {id, name, args}, "tool_result"
 * {id, name, ok, summary}, "change" {id, kind, summary, undo}, "messages" {messages} (what the
 * app appends to its history) and "done", "error" {message} or "continue" {}: time is nearly
 * up, so the app sends the history again with `continue: true` and the turn goes on there.
 */
export async function runChat(opts: {
  provider: Provider;
  system: string;
  history: ChatMessage[];
  ctx: ToolContext;
  writes: boolean;
  search: boolean;
  emit: Emit;
  signal?: AbortSignal;
  /** When to hand off to a new request (tests). Default: HAND_OFF_MS. */
  handOffMs?: number;
}) {
  const { provider, ctx, emit, signal } = opts;
  const tools = toolsFor({ writes: opts.writes, search: opts.search });
  const allowed = new Set(tools.map((t) => t.function.name));
  const messages: ChatMessage[] = [{ role: "system", content: opts.system }, ...opts.history];
  const added: ChatMessage[] = [];
  const started = Date.now();
  const handOffMs = opts.handOffMs ?? HAND_OFF_MS;
  const push = (m: ChatMessage) => {
    messages.push(m);
    added.push(m);
  };
  // Steps count across requests: the tool rounds since the user's message.
  const turn = opts.history.findLastIndex((m) => m.role === "user");
  const used = opts.history.slice(turn + 1).filter((m) => m.tool_calls?.length).length;

  try {
    for (let step = used;; step++) {
      // Every request takes at least one step, then hands off before time runs out.
      if (step > used && Date.now() - started >= handOffMs) {
        emit("messages", { messages: added });
        emit("continue", {});
        return;
      }
      const last = step >= MAX_STEPS - 1;
      const body = last
        ? { messages: [{ ...messages[0], content: opts.system + WRAP_UP }, ...messages.slice(1)] }
        : { messages };
      let content = "";
      let calls: ToolCall[] = [];
      const stream = streamChat(
        provider,
        { ...body, tools, toolChoice: last ? "none" : "auto" },
        ctx.net,
        signal,
      );
      for await (const ev of stream) {
        if (ev.type === "text") emit("text", { delta: ev.delta });
        else {
          content = ev.content;
          calls = ev.toolCalls.filter((c) => c.function.name);
        }
      }
      if (last && !content) {
        // A server that ignores tool_choice "none" may still only call tools.
        content = OUT_OF_STEPS;
        emit("text", { delta: content });
      }
      if (!calls.length || last) {
        push({ role: "assistant", content });
        break;
      }
      push({ role: "assistant", content: content || null, tool_calls: calls });
      for (const call of calls) {
        let args: unknown = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = call.function.arguments;
        }
        emit("tool", { id: call.id, name: call.function.name, args });
        const res = await runTool(call.function.name, call.function.arguments, ctx, allowed);
        emit("tool_result", {
          id: call.id,
          name: call.function.name,
          ok: res.ok,
          summary: res.summary,
        });
        if (res.change) emit("change", { id: call.id, ...res.change });
        const text = JSON.stringify(res.result);
        const content = text.length > MAX_TOOL_RESULT
          ? text.slice(0, MAX_TOOL_RESULT) + "…(truncated)"
          : text;
        push({ role: "tool", tool_call_id: call.id, content });
      }
    }
    emit("messages", { messages: added });
    emit("done", {});
  } catch (err) {
    if (signal?.aborted) return;
    const message = err instanceof HttpError ? err.message : "The assistant failed";
    if (!(err instanceof HttpError)) console.error(err);
    // Keep what happened so far (changes may have been made) and report the error.
    emit("messages", { messages: added });
    emit("error", { message });
  }
}

/** A Response that streams the events of `run` as server-sent events. */
export function sseResponse(
  run: (emit: Emit) => Promise<void>,
  headers: Record<string, string>,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (event, data) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // the client went away
        }
      };
      // A comment line every 15 s keeps proxies from closing a quiet connection.
      const ping = setInterval(() => emit("ping", {}), 15000);
      try {
        await run(emit);
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(body, {
    headers: {
      ...headers,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      "x-accel-buffering": "no",
    },
  });
}
