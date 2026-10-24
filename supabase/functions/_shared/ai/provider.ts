// A client for OpenAI-compatible chat APIs (OpenAI, Azure-style proxies, OpenRouter, Mistral,
// Groq, Ollama, LM Studio, vLLM …): the model list and streamed chat completions with tools.

import { HttpError } from "../http.ts";
import { type NetOptions, readLimited, safeFetch } from "./net.ts";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A piece of a user message: text, or an image as a data URL. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | ContentPart[]; // parts only in user messages
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Provider {
  baseUrl: string; // e.g. https://api.openai.com/v1
  apiKey: string;
  model: string;
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "done"; content: string; toolCalls: ToolCall[]; finish: string | null };

function headers(p: Provider): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}),
  };
}

function endpoint(p: Provider, path: string) {
  return p.baseUrl.replace(/\/+$/, "") + path;
}

async function failure(res: Response, what: string): Promise<HttpError> {
  const text = await readLimited(res, 4000).catch(() => "");
  let message = text.trim().slice(0, 300);
  try {
    const data = JSON.parse(text);
    message = data?.error?.message ?? data?.message ?? data?.error ?? message;
  } catch {
    // not JSON
  }
  return new HttpError(502, `${what}: ${res.status} ${String(message).slice(0, 300)}`.trim());
}

/** The ids of the models the endpoint offers, sorted. */
export async function listModels(p: Provider, net: NetOptions): Promise<string[]> {
  const res = await safeFetch(
    endpoint(p, "/models"),
    { headers: headers(p), timeoutMs: 15000 },
    net,
  );
  if (!res.ok) throw await failure(res, "The AI endpoint refused the model list");
  let data: { data?: { id?: unknown }[]; models?: { id?: unknown; name?: unknown }[] };
  try {
    data = JSON.parse(await readLimited(res, 2_000_000));
  } catch {
    throw new HttpError(502, "The AI endpoint didn't answer with a model list");
  }
  const list = data.data ?? data.models ?? [];
  return [...new Set(list.map((m) => String(m.id ?? (m as { name?: unknown }).name ?? "")))]
    .filter(Boolean).sort();
}

/**
 * One chat completion, streamed: yields text as it arrives, then the whole message with its
 * tool calls. Servers that don't stream (they answer with JSON) work too.
 */
export async function* streamChat(
  p: Provider,
  body: { messages: ChatMessage[]; tools?: ToolSpec[]; temperature?: number },
  net: NetOptions,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await safeFetch(endpoint(p, "/chat/completions"), {
    method: "POST",
    headers: headers(p),
    body: JSON.stringify({
      model: p.model,
      messages: body.messages,
      ...(body.tools?.length ? { tools: body.tools, tool_choice: "auto" } : {}),
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      stream: true,
    }),
    signal,
    timeoutMs: 120000,
  }, net);
  if (!res.ok) throw await failure(res, "The AI endpoint refused the request");

  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream")) {
    // No streaming: one JSON answer.
    const data = JSON.parse(await readLimited(res, 4_000_000));
    const message = data?.choices?.[0]?.message ?? {};
    const content = typeof message.content === "string" ? message.content : "";
    if (content) yield { type: "text", delta: content };
    yield {
      type: "done",
      content,
      toolCalls: (message.tool_calls ?? []).map(normalizeCall),
      finish: data?.choices?.[0]?.finish_reason ?? null,
    };
    return;
  }

  let content = "";
  let finish: string | null = null;
  const calls: ToolCall[] = [];
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        if (chunk.error) {
          throw new HttpError(502, `The AI endpoint failed: ${chunk.error.message ?? chunk.error}`);
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;
        const delta = choice.delta ?? {};
        if (typeof delta.content === "string" && delta.content) {
          content += delta.content;
          yield { type: "text", delta: delta.content };
        }
        for (const tc of delta.tool_calls ?? []) {
          const i = typeof tc.index === "number" ? tc.index : calls.length;
          calls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
          if (tc.id) calls[i].id = tc.id;
          if (tc.function?.name) calls[i].function.name += tc.function.name;
          if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: "done", content, toolCalls: calls.filter(Boolean).map(normalizeCall), finish };
}

let callSeq = 0;

function normalizeCall(
  c: Partial<ToolCall> & { function?: Partial<ToolCall["function"]> },
): ToolCall {
  const args = c.function?.arguments as unknown;
  return {
    id: c.id || `call_${Date.now().toString(36)}_${callSeq++}`,
    type: "function",
    function: {
      name: c.function?.name ?? "",
      // Some servers send the arguments as an object instead of a JSON string.
      arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
    },
  };
}
