// The app's AI chats, kept on the server: each user has their own chats per family, stored with
// what they show (items) and what the model gets back (messages). A turn doesn't run in the
// app's request but in the background: it goes on when the app is closed, and before the
// platform's time limit it hands itself on to a new invocation of the function. The app, on any
// device, follows it: live from the invocation that runs the turn, else from the database. A
// turn runs as long as the model works on; when the chat gets too long for the model's context
// window, its older part is condensed into a summary (see context.ts), kept with the messages.
// Messages written while a turn runs wait in the chat's queue; once the turn is over (answered,
// stopped or failed), the next one starts a new turn, in a new invocation like a hand-off.
//
// Routes under /families/{id}/ai/chats:
//   GET                    the user's chats
//   POST                   a new chat with its first message (streams, like the ones below)
//   GET    {chat}          the chat with its items
//   DELETE {chat}
//   GET    {chat}/events?since=rev   follows the chat: the items changed since `rev`, live text,
//                          then "end" once no turn runs (or "reconnect": ask again)
//   POST   {chat}/messages a message; streams the answer like events
//   POST   {chat}/queue    a message while a turn runs: it goes next (or now, if none runs)
//   POST   {chat}/unqueue  takes back a message that waits
//   POST   {chat}/answer   the answer to the assistant's question; streams like events
//   POST   {chat}/stop     stops the running turn
//   POST   {chat}/undone   a change of the chat was undone (the model hears it next time)
//   POST   import          a chat this device kept from before chats were stored
//   POST   {chat}/resume   internal: a turn handing itself on (its token is the key)

import type { AiEnv } from "../ai.ts";
import type { Ctx } from "../context.ts";
import { CORS, HttpError, json, NO_STORE, objectOf, randomToken, readBody } from "../http.ts";
import type { ChatRow, FamilyRow, Store } from "../store.ts";
import {
  type ChatContext,
  cleanContext,
  cleanMessage,
  cleanParts,
  DEADLINE_MS,
  type Emit,
  HAND_OFF_MS,
  PAGES,
  runChat,
  sseResponse,
  windowHistory,
} from "./chat.ts";
import { type StoredMessage, type SummaryMark, viewOf } from "./context.ts";
import type { ChatMessage, ContentPart, Provider, ToolCall } from "./provider.ts";
import type { ToolContext } from "./tools.ts";

/** What a turn needs from the family's AI settings. */
export interface Turn {
  provider: Provider;
  system: string;
  ctx: ToolContext;
  writes: boolean;
  search: boolean;
  /** The model's context window in tokens. */
  window: number;
}

export type Prepare = (
  store: Store,
  family: FamilyRow,
  context: ChatContext,
  signal: AbortSignal,
) => Promise<Turn>;

type Env = AiEnv & { prepare: Prepare };

/** What the chat shows, in order (the app renders these). */
export type Item =
  | { kind: "user"; text: string; attachments?: Attachment[] }
  | { kind: "assistant"; text: string }
  | {
    kind: "tool";
    id: string;
    name: string;
    args: unknown;
    status: "running" | "ok" | "error";
    summary?: string;
    /** The start of what the model got back. */
    result?: string;
    /** It was running when its turn broke off. */
    interrupted?: boolean;
  }
  | {
    kind: "change";
    id: string;
    change: string;
    summary: string;
    undo: unknown[];
    undone?: boolean;
  }
  | {
    kind: "question";
    id: string;
    question: string;
    options: string[];
    multiple: boolean;
    answer?: { selected: string[]; text?: string };
    skipped?: boolean;
  }
  /** The older part of the chat was condensed for the model from here on. */
  | { kind: "compacted" }
  | { kind: "error"; text: string };

type Attachment = { kind: "image" | "file"; name: string; url?: string };
type UserItem = Item & { kind: "user" };

/** A message that waits for the running turn to end: what the chat shows, what the model gets,
 *  and where the user was. */
interface Queued {
  id: string;
  item: UserItem;
  content: ChatMessage["content"];
  context: ChatContext;
}
type ToolItem = Item & { kind: "tool" };
type QuestionItem = Item & { kind: "question" };

/** What a running turn does right now. */
type Activity =
  | { kind: "thinking" | "writing" | "tool" | "compacting" }
  | { kind: "retrying"; attempt: number; max: number };

/** A turn that doesn't renew its hold on the chat for this long is taken over. */
const LEASE_MS = 30_000;
const HEARTBEAT_MS = 5_000;
/** Streaming text is saved at most this often. */
const SAVE_MS = 700;
/** How often followers without the live turn look for news. */
const POLL_MS = 1000;
/** A follower's stream ends after this (well within the platform's limit); the app asks again. */
const STREAM_MS = 100_000;
/** Times a failed step is tried again before the turn gives up. */
const MAX_RETRIES = 5;
const RETRY_MS = 1000;
/** A retry this long after the invocation started goes to a new one, with time for the step. */
const LOCAL_RETRY_MS = 30_000;
/** Chats per user and family; the oldest go. */
const MAX_CHATS = 100;
const MAX_TITLE = 60;
const MAX_TEXT = 20_000;
const MAX_ATTACHMENTS = 4;
/** Messages that can wait in a chat at once. */
const MAX_QUEUE = 10;
/** Characters of a tool result the chat shows (copying a chat includes them). */
const MAX_RESULT_SHOWN = 2000;
/** Imported chats: items and messages kept (the newest). */
const MAX_IMPORT_ITEMS = 1000;
const MAX_IMPORT_MESSAGES = 400;
const IMAGE_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

const STOPPED = "(stopped)";
/** What the model learns about a question the user didn't answer. */
const SKIPPED = JSON.stringify({
  skipped: true,
  note: "The user didn't pick an answer and wrote a new message instead, which may answer it.",
});
/** What the model learns about a tool that was running when its turn broke off. */
const INTERRUPTED = JSON.stringify({
  error: "Interrupted: this may or may not have been done. Check before doing it again.",
});
const GAVE_UP = "The assistant stopped answering.";

/** What a follower gets from the turn that runs in this invocation. */
type Live =
  | { type: "items"; items: { seq: number; item: Item }[] }
  | { type: "delta"; seq: number; text: string }
  | { type: "chat"; chat: Summary }
  | { type: "end" };

type Summary = ReturnType<typeof summaryOf>;
/** How full the model's context is: tokens in use, and the window. */
type Usage = { used: number; max: number };

/** A turn running in this invocation, for followers to listen to. */
class LocalRun {
  readonly abort = new AbortController();
  readonly listeners = new Set<(e: Live) => void>();
  /** The chat's items as the turn has them (followers start with the ones it changed). */
  items: Item[] = [];
  touched = new Set<number>();
  summary: Summary | null = null;
  ended = false;
  /** Has the turn look at the chat again now (its queue changed). */
  refresh = () => {};

  publish(e: Live) {
    if (e.type === "chat") this.summary = e.chat;
    for (const fn of this.listeners) fn(e);
  }
}

/** The turns running in this invocation (instance), by chat id. */
const runs = new Map<string, LocalRun>();

export function summaryOf(c: ChatRow) {
  return {
    id: c.id,
    title: c.title,
    status: c.status,
    activity: c.status === "running" ? c.activity : null,
    usage: (c.usage ?? null) as Usage | null,
    /** The page the chat belongs to (null for a chat from before chats kept one). */
    page: ((c.context as Partial<ChatContext> | null)?.page ?? null) as string | null,
    queued: queuedOf(c),
    updatedAt: c.updated_at,
  };
}

/** Where the user is, for a message to `chat`: the chat stays on its page (moving it is a
 *  request of its own); a chat without one takes the user's. */
function onPage(chat: ChatRow, context: ChatContext): ChatContext {
  const page = (chat.context as Partial<ChatContext> | null)?.page;
  return page ? { ...context, page } : context;
}

/** The messages that wait, as the chat shows them (attachments by name only). */
function queuedOf(c: ChatRow) {
  return ((c.queue ?? []) as unknown as Queued[]).map(({ id, item }) => ({
    id,
    text: item.text,
    ...(item.attachments?.length
      ? { attachments: item.attachments.map(({ kind, name }) => ({ kind, name })) }
      : {}),
  }));
}

const leaseUntil = (env: Env) => new Date(Date.now() + (env.leaseMs ?? LEASE_MS)).toISOString();

/** A running turn nobody holds any more (its invocation died). */
const stale = (c: ChatRow) =>
  c.status === "running" && (!c.run_until || Date.parse(c.run_until) < Date.now());

/** Resolves after `ms`, or as soon as `signal` aborts. */
function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}

/** The turn is over: answered, or a question waits for the user. */
function over(items: Item[], messages: StoredMessage[]) {
  const last = messages.at(-1);
  return !last || (last.role === "assistant" && !last.tool_calls?.length) ||
    !!openQuestion(items, messages);
}

/** What a new message adds: a question that waits stays unanswered, the changes undone since are
 *  told (so the assistant doesn't assume they are still there), then the message itself. */
function withMessage(
  shown: Item[],
  messages: StoredMessage[],
  notes: string[],
  message: { content: ChatMessage["content"]; item: Item },
) {
  const add: { messages: ChatMessage[]; items: { seq: number; item: Item }[] } = {
    messages: [],
    items: [],
  };
  const q = openQuestion(shown, messages);
  if (q) {
    add.items.push({ seq: shown.indexOf(q), item: { ...q, skipped: true } });
    add.messages.push({ role: "tool", tool_call_id: q.id, content: SKIPPED });
  }
  for (const note of notes) {
    add.messages.push(
      { role: "user", content: `(I undid this change: ${note})` },
      { role: "assistant", content: "OK." },
    );
  }
  add.messages.push({ role: "user", content: message.content });
  add.items.push({ seq: shown.length, item: message.item });
  return add;
}

/** The question that waits for its answer: the last one, unanswered, while the history ends
 *  with its call. */
function openQuestion(items: Item[], messages: StoredMessage[]): QuestionItem | undefined {
  const q = items.findLast((it) => it.kind === "question");
  if (q?.kind !== "question" || q.answer || q.skipped) return undefined;
  const last = messages.at(-1);
  const asked = messages.findLast((m) => m.tool_calls?.some((c) => c.id === q.id));
  const answered = messages.some((m) => m.role === "tool" && m.tool_call_id === q.id);
  return asked && !answered && last?.role !== "user" ? q : undefined;
}

/** Starts the turn in the background; the chat must be claimed for `token`. */
function startRun(
  store: Store,
  env: Env,
  base: string,
  chat: ChatRow,
  token: string,
  takeover = false,
) {
  const run = new LocalRun();
  runs.set(chat.id, run);
  const runner = new Runner(store, env, base, run, chat.id, token);
  env.background(
    runner.drive(takeover).catch((err) => console.error("A chat turn failed:", err)).finally(
      () => {
        if (runs.get(chat.id) === run) runs.delete(chat.id);
        run.ended = true;
        run.publish({ type: "end" });
      },
    ),
  );
}

/** Takes over a turn whose invocation died, and runs it on here. */
/** Takes over a turn whose invocation died: a new invocation runs it on (with the platform's
 *  whole time limit, which the request that noticed may have used up). */
async function takeOver(store: Store, env: Env, base: string, chat: ChatRow) {
  const token = randomToken(32);
  const claimed = await store.claimChat(chat.id, token, leaseUntil(env), "resume");
  if (claimed) await handOn(env, base, claimed, token, true);
}

/** Starts the turn of the messages that wait in an idle chat: a new invocation takes the next
 *  one. The chat after, or null if no turn started (none wait, or one runs already). */
async function kick(store: Store, env: Env, base: string, chat: ChatRow) {
  if (chat.status !== "idle" || !chat.queue?.length) return null;
  const token = randomToken(32);
  const claimed = await store.claimChat(chat.id, token, leaseUntil(env), "start");
  if (claimed) await handOn(env, base, claimed, token);
  return claimed;
}

/** Has a new invocation of the function run the chat's turn (POST .../resume with the turn's
 *  token). If none takes it, whoever looks at the chat takes it over once its hold runs out. */
async function handOn(env: Env, base: string, chat: ChatRow, token: string, takeover = false) {
  const url = `${base}/families/${encodeURIComponent(chat.family_id)}/ai/chats/${
    encodeURIComponent(chat.id)
  }/resume`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await env.selfFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, takeover }),
      });
      await res.body?.cancel();
      // Taken (or by now someone else's, or gone).
      if (res.ok || res.status === 404 || res.status === 409) return;
    } catch (err) {
      console.error("Handing the chat turn on failed:", err);
    }
    await pause(attempt * 1000);
  }
}

type Outcome =
  | { kind: "done" | "handoff" | "stopped" | "lost" }
  | { kind: "retry"; message: string };

/** Runs a chat's turn in this invocation: the tool loop (runChat), with what it does saved as
 *  items and messages, until it is answered, waits for an answer, is stopped, or is handed on. */
class Runner {
  private chat!: ChatRow;
  private items: Item[] = [];
  private messages: StoredMessage[] = [];
  private activity: Activity | null = null;
  private usage: Usage | null = null;
  private retries = 0;
  private queue: Promise<void> = Promise.resolve();
  private failed = false;
  private dirty = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private beating = true;
  /** The step that is running: runChat sends its messages once it is done. */
  private step = { text: "", calls: [] as ToolCall[], results: new Map<string, string>() };
  /** Where the step's text goes. */
  private answer: number | null = null;

  constructor(
    private store: Store,
    private env: Env,
    private base: string,
    private run: LocalRun,
    private id: string,
    private token: string,
  ) {
    run.refresh = () => this.renew();
  }

  private get signal() {
    return this.run.abort.signal;
  }

  /** Saves in order; after a failed save the turn can't go on (it ends as "lost"). */
  private write(fn: () => Promise<unknown>) {
    this.queue = this.queue.then(async () => {
      if (this.failed) return;
      try {
        await fn();
      } catch (err) {
        console.error("Saving the chat failed:", err);
        this.failed = true;
        this.run.abort.abort("lost");
      }
    });
    return this.queue;
  }

  private set(seq: number, item: Item) {
    this.items[seq] = item;
    this.dirty.add(seq);
    this.run.touched.add(seq);
    this.run.publish({ type: "items", items: [{ seq, item }] });
  }

  private add(item: Item): number {
    const seq = this.items.length;
    this.set(seq, item);
    return seq;
  }

  private saveItems() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.dirty.size) return;
    const rows = [...this.dirty].map((seq) => ({ seq, item: this.items[seq] }));
    this.dirty.clear();
    this.write(async () => {
      if (await this.store.putChatItems(this.id, rows) === null) throw new Error("Chat gone");
    });
  }

  private saveSoon() {
    this.timer ??= setTimeout(() => this.saveItems(), SAVE_MS);
  }

  private addMessages(list: StoredMessage[]) {
    const rows = list.map((message, i) => ({
      seq: this.messages.length + i,
      message: message as unknown as Record<string, unknown>,
    }));
    this.messages.push(...list);
    this.write(() => this.store.addChatMessages(this.id, rows));
  }

  /** Holds on to the chat a little longer and saves what the turn does; notices a stop. */
  private renew() {
    return this.write(async () => {
      const row = await this.store.updateChat(this.id, {
        run_until: leaseUntil(this.env),
        activity: this.activity,
        retries: this.retries,
        usage: this.usage,
      }, this.token);
      if (!row) return this.run.abort.abort("lost");
      const seen = (c: ChatRow) => JSON.stringify([queuedOf(c), summaryOf(c).page]);
      const before = seen(this.chat);
      this.chat = row;
      if (row.stop) this.run.abort.abort("stop");
      // A message was queued or taken back, or the chat moved, meanwhile: followers see it.
      if (seen(row) !== before) this.publishChat();
    });
  }

  private publishChat() {
    this.run.publish({
      type: "chat",
      chat: summaryOf({ ...this.chat, activity: this.activity, usage: this.usage }),
    });
  }

  private doing(activity: Activity) {
    if (JSON.stringify(activity) === JSON.stringify(this.activity)) return;
    this.activity = activity;
    this.publishChat();
    this.renew();
  }

  async drive(takeover: boolean) {
    const started = Date.now();
    const [chat, itemRows, messageRows] = await Promise.all([
      this.store.getChat(this.id),
      this.store.listChatItems(this.id),
      this.store.listChatMessages(this.id),
    ]);
    if (!chat || chat.run_token !== this.token) return;
    this.chat = chat;
    for (const r of itemRows) this.items[r.seq] = r.item as Item;
    this.run.items = this.items;
    this.messages = messageRows.map((r) => r.message as unknown as StoredMessage);
    this.activity = chat.activity as Activity | null;
    this.usage = chat.usage as Usage | null;
    // A turn taken over from an invocation that died counts as a failed try.
    this.retries = chat.retries + (takeover ? 1 : 0);
    const beat = setInterval(() => {
      if (this.beating) this.renew();
    }, HEARTBEAT_MS);
    try {
      await this.loop(started);
    } finally {
      clearInterval(beat);
      clearTimeout(this.timer);
    }
  }

  private async loop(started: number) {
    this.repair();
    if (this.chat.stop) return this.finish(STOPPED);
    if (this.retries > MAX_RETRIES) return this.fail(GAVE_UP);
    // Started for a message that waited: the turn is about it.
    if (over(this.items, this.messages) && !(await this.next())) return this.finish();
    this.doing({ kind: "thinking" });
    const family = (await this.store.listFamilies([this.chat.family_id]))[0];
    if (!family) return;
    let turn: Turn;
    try {
      turn = await this.env.prepare(
        this.store,
        family,
        this.chat.context as unknown as ChatContext,
        this.signal,
      );
    } catch (err) {
      return this.fail(err instanceof HttpError ? err.message : "The assistant failed");
    }
    for (;;) {
      // Answered already, or a question waits for the user.
      if (over(this.items, this.messages)) return this.finish();
      const elapsed = Date.now() - started;
      const outcome = await this.go(
        turn,
        (this.env.handOffMs ?? HAND_OFF_MS) - elapsed,
        (this.env.deadlineMs ?? DEADLINE_MS) - elapsed,
      );
      switch (outcome.kind) {
        case "done":
          return this.finish();
        case "stopped":
          return this.finish(STOPPED);
        case "lost":
          return;
        case "handoff":
          return this.handOff();
        case "retry":
          if (++this.retries > MAX_RETRIES) return this.fail(outcome.message);
          this.doing({ kind: "retrying", attempt: this.retries, max: MAX_RETRIES });
          await pause(this.retries * (this.env.retryMs ?? RETRY_MS), this.signal);
          if (this.signal.aborted) {
            if (this.signal.reason === "stop") await this.finish(STOPPED);
            return;
          }
          if (Date.now() - started > LOCAL_RETRY_MS) return this.handOff();
          this.doing({ kind: "thinking" });
      }
    }
  }

  /** Takes the next message that waits, and the turn goes on with it; false if none waits. */
  private async next(): Promise<boolean> {
    const chat = await this.store.getChat(this.id);
    for (const q of (chat?.queue ?? []) as unknown as Queued[]) {
      // Taken back meanwhile: the next one.
      const row = await this.store.unqueueChatMessage(this.id, q.id);
      if (!row) continue;
      const add = withMessage(this.items, this.messages, row.notes, q);
      for (const { seq, item } of add.items) this.set(seq, item);
      this.addMessages(add.messages);
      this.saveItems();
      await this.write(async () => {
        const after = await this.store.updateChat(
          this.id,
          { context: { ...onPage(row, q.context) }, notes: [] },
          this.token,
        );
        if (!after) return this.run.abort.abort("lost");
        this.chat = after;
      });
      this.publishChat();
      return true;
    }
    return false;
  }

  /** Runs the tool loop until it ends, and keeps what it does. */
  private async go(turn: Turn, handOffMs: number, deadlineMs: number): Promise<Outcome> {
    // Set by the events (a closure, so TypeScript doesn't narrow it).
    let outcome = { kind: "lost" } as Outcome;
    this.step = { text: "", calls: [], results: new Map() };
    this.answer = null;
    const tools = new Map<string, number>();
    const emit: Emit = (event, raw) => {
      const data = raw as any;
      switch (event) {
        case "text": {
          this.doing({ kind: "writing" });
          this.answer ??= this.newAnswer();
          const it = this.items[this.answer] as Item & { kind: "assistant" };
          this.items[this.answer] = { ...it, text: it.text + data.delta };
          this.dirty.add(this.answer);
          this.run.publish({ type: "delta", seq: this.answer, text: data.delta });
          this.step.text += data.delta;
          this.saveSoon();
          break;
        }
        case "tool":
          this.answer = null; // text after the tool goes into a new bubble
          this.step.calls.push({
            id: data.id,
            type: "function",
            function: { name: data.name, arguments: JSON.stringify(data.args) },
          });
          tools.set(
            data.id,
            this.add({
              kind: "tool",
              id: data.id,
              name: data.name,
              args: data.args,
              status: "running",
            }),
          );
          this.saveItems();
          this.doing({ kind: "tool" });
          break;
        case "tool_result": {
          this.step.results.set(data.id, JSON.stringify({ ok: data.ok, summary: data.summary }));
          const seq = tools.get(data.id);
          if (seq !== undefined) {
            const it = this.items[seq] as ToolItem;
            this.set(seq, { ...it, status: data.ok ? "ok" : "error", summary: data.summary });
          }
          this.saveItems();
          // Once its tools are done, the model reads the results and decides what's next.
          if (![...tools.values()].some((s) => (this.items[s] as ToolItem).status === "running")) {
            this.doing({ kind: "thinking" });
          }
          break;
        }
        case "change":
          this.add({
            kind: "change",
            id: data.id,
            change: data.kind,
            summary: data.summary,
            undo: data.undo,
          });
          this.saveItems();
          break;
        case "question":
          this.answer = null;
          this.add({ kind: "question", ...data });
          this.saveItems();
          outcome = { kind: "done" };
          break;
        case "messages": {
          const list = data.messages as ChatMessage[];
          for (const m of list) {
            const seq = m.role === "tool" ? tools.get(m.tool_call_id ?? "") : undefined;
            if (seq !== undefined && typeof m.content === "string") {
              this.set(seq, { ...this.items[seq] as ToolItem, result: shorten(m.content) });
            }
          }
          this.addMessages(list);
          this.saveItems();
          this.answer = null;
          this.step = { text: "", calls: [], results: new Map() };
          this.retries = 0;
          break;
        }
        case "usage":
          if (data.used === this.usage?.used && data.max === this.usage?.max) break;
          this.usage = { used: data.used, max: data.max };
          this.publishChat();
          this.renew();
          break;
        case "compacting":
          this.doing({ kind: "compacting" });
          break;
        case "compacted": {
          // The summary stands for the messages before the newest `keep` (summaries aside).
          let from = this.messages.length;
          for (let n = data.keep; n > 0;) if (this.messages[--from].role !== "summary") n--;
          const mark: SummaryMark = {
            role: "summary",
            content: data.summary,
            ...(data.request !== undefined ? { request: data.request } : {}),
            from,
          };
          this.addMessages([mark]);
          this.answer = null;
          this.add({ kind: "compacted" });
          this.saveItems();
          this.doing({ kind: "thinking" });
          break;
        }
        case "done":
          outcome = { kind: "done" };
          break;
        case "continue":
          outcome = data.retry ? { kind: "retry", message: data.message } : { kind: "handoff" };
          break;
      }
    };
    const at = this.messages.findLastIndex((m) => m.role === "summary");
    await runChat({
      ...turn,
      history: viewOf(this.messages),
      summary: at < 0 ? null : this.messages[at] as SummaryMark,
      emit,
      signal: this.signal,
      handOffMs: Math.max(0, handOffMs),
      deadlineMs: Math.max(1, deadlineMs),
    });
    if (this.signal.aborted) {
      if (this.signal.reason !== "stop") return { kind: "lost" };
      this.recover();
      return { kind: "stopped" };
    }
    if (outcome.kind === "retry") this.recover();
    return outcome;
  }

  /** Where new text goes: a blank answer left by a step that broke off, else a new one. */
  private newAnswer(): number {
    const last = this.items.at(-1);
    return last?.kind === "assistant" && !last.text ? this.items.length - 1 : this.add({
      kind: "assistant",
      text: "",
    });
  }

  /** After a step broke off: keep what it did, so it isn't done twice. */
  private recover() {
    const { calls, text, results } = this.step;
    if (calls.length) {
      // Its tools ran (some maybe only partly): tell the model what is known about them.
      this.addMessages([
        { role: "assistant", content: text || null, tool_calls: calls },
        ...calls.map((call): ChatMessage => ({
          role: "tool",
          tool_call_id: call.id,
          content: results.get(call.id) ?? INTERRUPTED,
        })),
      ]);
      this.interruptTools();
    } else if (this.answer !== null) {
      // Only text so far: the step runs again, so its text goes.
      this.set(this.answer, { kind: "assistant", text: "" });
    }
    this.answer = null;
    this.step = { text: "", calls: [], results: new Map() };
    this.saveItems();
  }

  private interruptTools() {
    this.items.forEach((it, seq) => {
      if (it?.kind === "tool" && it.status === "running") {
        this.set(seq, { ...it, status: "error", interrupted: true });
      }
    });
  }

  /** At the start: what an invocation that died left behind. Its step's tools are told to the
   *  model like after a failed step, and text it was writing goes (the step runs again). */
  private repair() {
    const known = new Set(this.messages.flatMap((m) => m.tool_calls?.map((c) => c.id) ?? []));
    const turn = this.items.findLastIndex((it) => it?.kind === "user");
    const lost = this.items.slice(turn + 1).filter((it): it is ToolItem =>
      it?.kind === "tool" && !known.has(it.id)
    );
    if (lost.length) {
      this.addMessages([
        {
          role: "assistant",
          content: null,
          tool_calls: lost.map((it) => ({
            id: it.id,
            type: "function" as const,
            function: { name: it.name, arguments: JSON.stringify(it.args ?? {}) },
          })),
        },
        ...lost.map((it): ChatMessage => ({
          role: "tool",
          tool_call_id: it.id,
          content: it.status === "running"
            ? INTERRUPTED
            : JSON.stringify({ ok: it.status === "ok", summary: it.summary }),
        })),
      ]);
    }
    this.interruptTools();
    const last = this.items.at(-1);
    const answered = this.messages.at(-1)?.role === "assistant" &&
      !this.messages.at(-1)?.tool_calls?.length;
    if (last?.kind === "assistant" && last.text && !answered) {
      this.set(this.items.length - 1, { kind: "assistant", text: "" });
    }
    this.saveItems();
  }

  /** Ends a turn that has no answer (stopped, failed) with `note`, so the history stays valid
   *  for the next one. */
  private close(note: string) {
    const last = this.messages.at(-1);
    if (last && (last.role !== "assistant" || last.tool_calls?.length)) {
      this.addMessages([{ role: "assistant", content: note }]);
    }
  }

  private fail(message: string) {
    this.add({ kind: "error", text: message });
    return this.finish(`(No answer: ${message})`);
  }

  /** Saves everything and lets go of the chat: no turn runs any more. */
  private async finish(note?: string) {
    if (note) this.close(note);
    this.saveItems();
    this.beating = false;
    const after: { row: ChatRow | null } = { row: null };
    await this.write(async () => {
      after.row = await this.store.updateChat(this.id, {
        status: "idle",
        run_token: null,
        run_until: null,
        stop: false,
        activity: null,
        retries: 0,
      }, this.token);
    });
    // Messages wait: the next turn starts (in a new invocation, with its whole time).
    const next = after.row && await kick(this.store, this.env, this.base, after.row);
    const row = next ?? after.row;
    if (row) this.run.publish({ type: "chat", chat: summaryOf(row) });
  }

  /** Time is nearly up: a new invocation goes on with the turn (with the same token). */
  private async handOff() {
    this.saveItems();
    this.beating = false;
    await this.write(() =>
      this.store.updateChat(this.id, {
        run_until: leaseUntil(this.env),
        activity: this.activity,
        retries: this.retries,
        usage: this.usage,
      }, this.token)
    );
    if (!this.failed) await handOn(this.env, this.base, this.chat, this.token);
  }
}

const shorten = (s: string) =>
  s.length > MAX_RESULT_SHOWN ? s.slice(0, MAX_RESULT_SHOWN) + "…(truncated)" : s;

/** Streams a chat: the items changed since revision `since`, the turn live while it runs here
 *  (else what it saved, polled), until no turn runs ("end") or the stream is long enough
 *  ("reconnect"). A turn whose invocation died is taken over. */
async function follow(
  store: Store,
  env: Env,
  base: string,
  id: string,
  since: number,
  emit: Emit,
  gone: AbortSignal,
) {
  const until = Date.now() + (env.streamMs ?? STREAM_MS);
  let shown = "";
  const show = (s: Summary) => {
    const text = JSON.stringify(s);
    if (text !== shown) emit("chat", s);
    shown = text;
  };
  while (!gone.aborted) {
    const chat = await store.getChat(id);
    if (!chat) return emit("end", { deleted: true });
    if (chat.rev > since) {
      const rows = await store.listChatItems(id, since);
      emit("items", { rev: chat.rev, items: rows.map(({ seq, item }) => ({ seq, item })) });
      since = chat.rev;
    }
    show(summaryOf(chat));
    const run = runs.get(id);
    if (run && !run.ended) {
      await listen(run, emit, show, gone, until);
      if (Date.now() >= until) return emit("reconnect", {});
      continue;
    }
    if (chat.status !== "running") {
      // Messages wait without a turn (the invocation that ended the last one died): it starts.
      if (await kick(store, env, base, chat)) continue;
      return emit("end", {});
    }
    if (stale(chat)) {
      await takeOver(store, env, base, chat);
      continue;
    }
    if (Date.now() >= until) return emit("reconnect", {});
    await pause(env.pollMs ?? POLL_MS, gone);
  }
}

/** Passes on what the turn running here does, until it ends (or the stream does). */
function listen(
  run: LocalRun,
  emit: Emit,
  show: (s: Summary) => void,
  gone: AbortSignal,
  until: number,
) {
  return new Promise<void>((resolve) => {
    const listener = (e: Live) => {
      if (e.type === "end") done();
      else if (e.type === "items") emit("items", { items: e.items });
      else if (e.type === "delta") emit("delta", { seq: e.seq, text: e.text });
      else show(e.chat);
    };
    const timer = setTimeout(done, Math.max(0, until - Date.now()));
    function done() {
      run.listeners.delete(listener);
      clearTimeout(timer);
      gone.removeEventListener("abort", done);
      resolve();
    }
    gone.addEventListener("abort", done, { once: true });
    // What the turn did so far, then what it does.
    const items = [...run.touched].sort((a, b) => a - b).map((seq) => ({
      seq,
      item: run.items[seq],
    }));
    if (items.length) emit("items", { items });
    if (run.summary) show(run.summary);
    run.listeners.add(listener);
  });
}

/** Routes /families/{id}/ai/chats/...; the turn's setup comes from `prepare`. */
export function handleChats(ctx: Ctx, aiEnv: AiEnv, prepare: Prepare): Promise<Response> {
  const env: Env = { ...aiEnv, prepare };
  const [id, action, ...more] = ctx.rest.slice(2);
  const target = id === undefined ? "" : id === "import" ? "import" : ":id";
  const route = `${ctx.method} ${target}${action === undefined ? "" : `/${action}`}`;
  if (more.length) return Promise.reject(new HttpError(404, "Not found"));
  switch (route) {
    case "GET ":
      return list(ctx);
    case "POST ":
      return send(ctx, env, null);
    case "POST import":
      return importChat(ctx);
    case "GET :id":
      return get(ctx, env, id);
    case "DELETE :id":
      return remove(ctx, id);
    case "GET :id/events":
      return events(ctx, env, id);
    case "POST :id/messages":
      return send(ctx, env, id);
    case "POST :id/queue":
      return queue(ctx, env, id);
    case "POST :id/unqueue":
      return unqueue(ctx, id);
    case "POST :id/answer":
      return answer(ctx, env, id);
    case "POST :id/stop":
      return stop(ctx, env, id);
    case "POST :id/undone":
      return undone(ctx, id);
    case "POST :id/page":
      return move(ctx, id);
    case "POST :id/resume":
      return resume(ctx, env, id);
  }
  return Promise.reject(new HttpError(404, "Not found"));
}

/** The user's chat in the family (editors only, like the whole assistant). */
async function ownChat({ store, load, requireUser }: Ctx, id: string) {
  const { family } = await load("edit");
  const { user } = requireUser();
  const chat = await store.getChat(id);
  if (!chat || chat.family_id !== family.id || chat.user_id !== user.id) {
    throw new HttpError(404, "Chat not found");
  }
  return { family, user, chat };
}

const streamHeaders = { ...CORS, ...NO_STORE };

async function list({ store, load, requireUser }: Ctx) {
  const { family } = await load("edit");
  const chats = await store.listChats(family.id, requireUser().user.id);
  return json({ chats: chats.map(summaryOf) }, 200, NO_STORE);
}

async function get(ctx: Ctx, env: Env, id: string) {
  let { chat } = await ownChat(ctx, id);
  const rows = await ctx.store.listChatItems(id);
  if (stale(chat)) await takeOver(ctx.store, env, ctx.publicBase, chat);
  else chat = await kick(ctx.store, env, ctx.publicBase, chat) ?? chat;
  return json(
    {
      chat: summaryOf(chat),
      rev: chat.rev,
      items: rows.map((r) => r.item),
    },
    200,
    NO_STORE,
  );
}

async function remove(ctx: Ctx, id: string) {
  await ownChat(ctx, id);
  runs.get(id)?.abort.abort("lost");
  await ctx.store.deleteChat(id);
  return json({ ok: true });
}

async function events(ctx: Ctx, env: Env, id: string) {
  await ownChat(ctx, id);
  const since = Number(ctx.url.searchParams.get("since") ?? 0);
  return sseResponse(
    (emit, gone) =>
      follow(ctx.store, env, ctx.publicBase, id, Number.isFinite(since) ? since : 0, emit, gone),
    streamHeaders,
  );
}

/** The text and attachments of a message: what the chat shows, and the model's content (the
 *  text, then the text files, then the images). */
function userMessage(body: Record<string, unknown>) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length > MAX_TEXT) throw new HttpError(400, "The message is too long");
  const raw = body.attachments ?? [];
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) {
    throw new HttpError(400, `attachments must be a list of at most ${MAX_ATTACHMENTS}`);
  }
  const attachments = raw.map((r) => {
    const a = objectOf(r, "Each attachment");
    const name = typeof a.name === "string" && a.name.trim() ? a.name.trim().slice(0, 200) : "file";
    if (a.kind === "image" && typeof a.url === "string") return { kind: "image", name, url: a.url };
    if (a.kind === "file" && typeof a.text === "string") {
      return { kind: "file", name, text: a.text };
    }
    throw new HttpError(400, "An attachment is an image (url) or a file (text)");
  });
  if (!text && !attachments.length) throw new HttpError(400, "The message is empty");
  const parts: ContentPart[] = [];
  if (text) parts.push({ type: "text", text });
  for (const a of attachments) {
    if (a.kind === "file") {
      parts.push({ type: "text", text: `Attached file “${a.name}”:\n\`\`\`\n${a.text}\n\`\`\`` });
    }
  }
  for (const a of attachments) {
    if (a.kind === "image") parts.push({ type: "image_url", image_url: { url: a.url! } });
  }
  const item: Item = { kind: "user", text };
  if (attachments.length) {
    item.attachments = attachments.map((a) =>
      a.kind === "image"
        ? { kind: "image", name: a.name, url: a.url }
        : { kind: "file", name: a.name }
    );
  }
  return {
    content: attachments.length ? cleanParts(parts) : text,
    item,
    title: (text || attachments[0].name).slice(0, MAX_TITLE),
  };
}

/** Starts a turn on a chat that is claimed for `token`: saves the new messages and items,
 *  runs the turn and streams it. If saving fails, the chat is let go again. */
async function begin(
  ctx: Ctx,
  env: Env,
  chat: ChatRow,
  token: string,
  add: { messages: ChatMessage[]; items: { seq: number; item: Item }[]; context: ChatContext },
) {
  const { store } = ctx;
  let rev: number | null;
  let row: ChatRow | null;
  try {
    const messages = await store.listChatMessages(chat.id);
    await store.addChatMessages(
      chat.id,
      add.messages.map((m, i) => ({
        seq: messages.length + i,
        message: m as unknown as Record<string, unknown>,
      })),
    );
    rev = await store.putChatItems(chat.id, add.items);
    row = await store.updateChat(chat.id, { context: { ...add.context }, notes: [] }, token);
    if (rev === null || !row) throw new HttpError(404, "Chat not found");
  } catch (err) {
    await store.updateChat(chat.id, { status: "idle", run_token: null, run_until: null }, token)
      .catch(() => {});
    throw err;
  }
  startRun(store, env, ctx.publicBase, row, token);
  const summary = summaryOf(row);
  const since = rev;
  return sseResponse(async (emit, gone) => {
    emit("chat", summary);
    emit("items", { rev: since, items: add.items });
    await follow(store, env, ctx.publicBase, chat.id, since, emit, gone);
  }, streamHeaders);
}

/** POST /ai/chats {text, attachments?, page, year, lang, today} starts a chat; POST
 *  /ai/chats/{id}/messages adds a message (while no turn runs). A question that waits for its
 *  answer stays unanswered. */
async function send(ctx: Ctx, env: Env, id: string | null) {
  const { store, req } = ctx;
  const body = await readBody(req);
  const message = userMessage(body);
  const context = cleanContext(body);
  const token = randomToken(32);
  let chat: ChatRow;
  let family: FamilyRow;
  if (id === null) {
    const { family: f } = await ctx.load("edit");
    family = f;
    await checkSetUp(store, family.id);
    const now = new Date().toISOString();
    chat = {
      id: crypto.randomUUID(),
      family_id: family.id,
      user_id: ctx.requireUser().user.id,
      title: message.title,
      status: "running",
      run_token: token,
      run_until: leaseUntil(env),
      stop: false,
      retries: 0,
      context: { ...context },
      activity: null,
      notes: [],
      usage: null,
      queue: [],
      rev: 0,
      created_at: now,
      updated_at: now,
    };
    await store.createChat(chat);
    // Only the newest chats are kept.
    const all = await store.listChats(family.id, chat.user_id);
    for (const old of all.slice(MAX_CHATS)) await store.deleteChat(old.id);
  } else {
    const own = await ownChat(ctx, id);
    family = own.family;
    await checkSetUp(store, family.id);
    const claimed = await store.claimChat(id, token, leaseUntil(env), "start");
    if (!claimed) throw new HttpError(409, "The assistant is still answering in this chat");
    chat = claimed;
  }
  const [items, messages] = await Promise.all([
    store.listChatItems(chat.id),
    store.listChatMessages(chat.id),
  ]);
  const add = withMessage(
    items.map((r) => r.item as Item),
    messages.map((r) => r.message as unknown as StoredMessage),
    chat.notes,
    message,
  );
  return begin(ctx, env, chat, token, { ...add, context: onPage(chat, context) });
}

/** POST /ai/chats/{id}/queue {text, attachments?, page, year, lang, today}: a message written
 *  while the assistant answers. It waits and goes next once the turn is over; if none runs, it
 *  starts one right away. Answers 202 with the chat (follow it to see the turn). */
async function queue(ctx: Ctx, env: Env, id: string) {
  const { store, req } = ctx;
  const body = await readBody(req);
  const message = userMessage(body);
  const { family, chat } = await ownChat(ctx, id);
  await checkSetUp(store, family.id);
  if (chat.queue.length >= MAX_QUEUE) {
    throw new HttpError(409, "Too many messages wait already");
  }
  const entry: Queued = {
    id: crypto.randomUUID(),
    item: message.item as UserItem,
    content: message.content,
    context: onPage(chat, cleanContext(body)),
  };
  const row = await store.queueChatMessage(id, entry as unknown as Record<string, unknown>);
  if (!row) throw new HttpError(404, "Chat not found");
  runs.get(id)?.refresh();
  // No turn runs (any more): the message starts one.
  const started = await kick(store, env, ctx.publicBase, row);
  return json({ chat: summaryOf(started ?? row), id: entry.id }, 202);
}

/** POST /ai/chats/{id}/unqueue {id}: takes back a message that waits (unless its turn started
 *  already); answers with the chat. */
async function unqueue(ctx: Ctx, id: string) {
  const body = await readBody(ctx.req);
  const { chat } = await ownChat(ctx, id);
  const row = typeof body.id === "string" ? await ctx.store.unqueueChatMessage(id, body.id) : null;
  if (row) runs.get(id)?.refresh();
  return json({ chat: summaryOf(row ?? chat) });
}

async function checkSetUp(store: Store, familyId: string) {
  const row = await store.getAiSettings(familyId);
  if (!row?.base_url || !row.model) throw new HttpError(400, "The AI assistant isn't set up yet");
}

/** POST /ai/chats/{id}/answer {id, selected, text?, page, year, lang, today}: the user's answer
 *  to the waiting question (picked options and/or an own answer); the turn goes on. */
async function answer(ctx: Ctx, env: Env, id: string) {
  const { store, req } = ctx;
  const body = await readBody(req);
  const selected = Array.isArray(body.selected)
    ? body.selected.filter((s): s is string => typeof s === "string").slice(0, 8)
    : [];
  const own = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  if (!selected.length && !own) throw new HttpError(400, "Pick an answer or write one");
  const { family } = await ownChat(ctx, id);
  await checkSetUp(store, family.id);
  const token = randomToken(32);
  const chat = await store.claimChat(id, token, leaseUntil(env), "start");
  if (!chat) throw new HttpError(409, "The assistant is still answering in this chat");
  try {
    const [items, messages] = await Promise.all([
      store.listChatItems(id),
      store.listChatMessages(id),
    ]);
    const shown = items.map((r) => r.item as Item);
    const q = openQuestion(shown, messages.map((r) => r.message as unknown as ChatMessage));
    if (!q || q.id !== body.id) throw new HttpError(409, "This question doesn't wait any more");
    const picked = selected.filter((s) => q.options.includes(s));
    const answer = { selected: picked, ...(own ? { text: own } : {}) };
    if (!picked.length && !own) throw new HttpError(400, "Pick an answer or write one");
    return await begin(ctx, env, chat, token, {
      messages: [{
        role: "tool",
        tool_call_id: q.id,
        content: JSON.stringify({
          ...(picked.length ? { selected: picked } : {}),
          ...(own ? { ownAnswer: own } : {}),
        }),
      }],
      items: [{ seq: shown.indexOf(q), item: { ...q, answer } }],
      context: onPage(chat, cleanContext(body)),
    });
  } catch (err) {
    await store.updateChat(id, { status: "idle", run_token: null, run_until: null }, token)
      .catch(() => {});
    throw err;
  }
}

/** POST /ai/chats/{id}/page {page}: moves the chat to another page; its next turn is about
 *  that page. Answers with the chat. */
async function move(ctx: Ctx, id: string) {
  const body = await readBody(ctx.req);
  if (!PAGES.includes(body.page as string)) throw new HttpError(400, "Unknown page");
  const { chat } = await ownChat(ctx, id);
  const row = await ctx.store.updateChat(id, { context: { ...chat.context, page: body.page } });
  if (!row) throw new HttpError(404, "Chat not found");
  runs.get(id)?.refresh();
  return json({ chat: summaryOf(row) });
}

/** POST /ai/chats/{id}/stop: the running turn stops after what it is doing; it ends with what
 *  it did so far. */
async function stop(ctx: Ctx, env: Env, id: string) {
  const { chat } = await ownChat(ctx, id);
  if (chat.status !== "running") return json({ chat: summaryOf(chat) });
  const row = await ctx.store.updateChat(id, { stop: true });
  runs.get(id)?.abort.abort("stop");
  // Nobody runs it any more: taken over, it ends right away.
  if (row && stale(row)) await takeOver(ctx.store, env, ctx.publicBase, row);
  return json({ chat: summaryOf(row ?? chat) });
}

/** POST /ai/chats/{id}/undone {id}: the app undid the change `id` of the chat. */
async function undone(ctx: Ctx, id: string) {
  const { store, req } = ctx;
  const body = await readBody(req);
  const { chat } = await ownChat(ctx, id);
  const items = await store.listChatItems(id);
  const row = items.find((r) => r.item.kind === "change" && r.item.id === body.id);
  if (!row) throw new HttpError(404, "Change not found");
  const item = row.item as Item & { kind: "change" };
  if (item.undone) return json({ ok: true });
  await store.putChatItems(id, [{ seq: row.seq, item: { ...item, undone: true } }]);
  // A turn running here has the item too.
  const run = runs.get(id);
  if (run?.items[row.seq]) run.items[row.seq] = { ...item, undone: true };
  await store.updateChat(id, { notes: [...chat.notes, item.summary] });
  return json({ ok: true });
}

/** POST /ai/chats/{id}/resume {token, takeover?}: a turn handing itself on to this invocation
 *  (`takeover`: from one that died). */
async function resume(ctx: Ctx, env: Env, id: string) {
  const { store, req, token: familyId } = ctx;
  const body = await readBody(req);
  const chat = await store.getChat(id);
  if (
    !chat || chat.family_id !== familyId || typeof body.token !== "string" || !body.token ||
    chat.run_token !== body.token
  ) {
    throw new HttpError(404, "Not found");
  }
  const claimed = await store.claimChat(id, body.token, leaseUntil(env), "resume");
  if (!claimed) throw new HttpError(409, "The turn is gone");
  startRun(store, env, ctx.publicBase, claimed, body.token, body.takeover === true);
  return json({ ok: true }, 202);
}

/** POST /ai/chats/import {title, updatedAt, items, history}: a chat the app kept on the device
 *  before chats were stored here. */
async function importChat(ctx: Ctx) {
  const { store, req } = ctx;
  const { family } = await ctx.load("edit");
  const user = ctx.requireUser().user;
  const body = await readBody(req);
  const items = cleanItems(body.items);
  let history: ChatMessage[] = [];
  try {
    history = windowHistory(
      (Array.isArray(body.history) ? body.history : []).slice(-MAX_IMPORT_MESSAGES).map(
        cleanMessage,
      ),
    );
  } catch {
    // Not usable for the model: the chat is shown, and the next turn starts without it.
  }
  if (!items.length) throw new HttpError(400, "The chat is empty");
  const last = history.at(-1);
  if (last && (last.role !== "assistant" || last.tool_calls?.length)) {
    history.push({ role: "assistant", content: STOPPED });
  }
  const updated = typeof body.updatedAt === "number" && Number.isFinite(body.updatedAt)
    ? new Date(Math.min(body.updatedAt, Date.now())).toISOString()
    : new Date().toISOString();
  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim().slice(0, MAX_TITLE)
    : "Chat";
  const chat: ChatRow = {
    id: crypto.randomUUID(),
    family_id: family.id,
    user_id: user.id,
    title,
    status: "idle",
    run_token: null,
    run_until: null,
    stop: false,
    retries: 0,
    context: {},
    activity: null,
    notes: [],
    usage: null,
    queue: [],
    rev: 0,
    created_at: updated,
    updated_at: updated,
  };
  await store.createChat(chat);
  await store.addChatMessages(
    chat.id,
    history.map((m, seq) => ({ seq, message: m as unknown as Record<string, unknown> })),
  );
  await store.putChatItems(chat.id, items.map((item, seq) => ({ seq, item })));
  // It keeps the time it was last used, so it sorts among the others.
  const row = await store.updateChat(chat.id, { updated_at: updated });
  return json({ chat: summaryOf(row ?? chat) }, 201);
}

/** Undo steps of an imported change: requests on the family's own API, as the app makes them. */
function cleanUndo(raw: unknown): unknown[] {
  if (!Array.isArray(raw) || JSON.stringify(raw).length > 200_000) return [];
  return raw.slice(0, 50).filter((s) =>
    s && typeof s === "object" && ["POST", "PATCH", "DELETE"].includes(s.method) &&
    typeof s.path === "string" && /^\/[\w\-/?=&.%]*$/.test(s.path) && !s.path.includes("..")
  ).map((s) => ({
    method: s.method,
    path: s.path,
    ...(s.body !== undefined ? { body: s.body } : {}),
  }));
}

const str = (v: unknown, max = MAX_TEXT) => (typeof v === "string" ? v.slice(0, max) : "");

/** Items of an imported chat: only what the app can show, with the expected fields. */
function cleanItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "items must be a list");
  return raw.slice(-MAX_IMPORT_ITEMS).flatMap((r): Item[] => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    switch (o.kind) {
      case "user": {
        const attachments = (Array.isArray(o.attachments) ? o.attachments : []).slice(0, 8)
          .filter((a) => a && typeof a === "object").map((a): Attachment => {
            const url = str(a.url, 2_000_000);
            return {
              kind: a.kind === "image" ? "image" : "file",
              name: str(a.name, 200) || "file",
              ...(a.kind === "image" && IMAGE_URL.test(url) ? { url } : {}),
            };
          });
        return [{
          kind: "user",
          text: str(o.text),
          ...(attachments.length ? { attachments } : {}),
        }];
      }
      case "assistant":
        return [{ kind: "assistant", text: str(o.text) }];
      case "error":
        return [{ kind: "error", text: str(o.text, 2000) }];
      case "tool":
        return [{
          kind: "tool",
          id: str(o.id, 200),
          name: str(o.name, 100),
          args: o.args && typeof o.args === "object" && JSON.stringify(o.args).length < 20_000
            ? o.args
            : {},
          status: o.status === "ok" ? "ok" : "error",
          ...(typeof o.summary === "string" ? { summary: str(o.summary, 2000) } : {}),
        }];
      case "change":
        return [{
          kind: "change",
          id: str(o.id, 200),
          change: str(o.change, 40),
          summary: str(o.summary, 2000),
          undo: cleanUndo(o.undo),
          ...(o.undone === true ? { undone: true } : {}),
        }];
      case "question": {
        const options = (Array.isArray(o.options) ? o.options : []).map((v) => str(v, 500))
          .slice(0, 8);
        const a = o.answer as { selected?: unknown; text?: unknown } | undefined;
        return [{
          kind: "question",
          id: str(o.id, 200),
          question: str(o.question, 2000),
          options,
          multiple: o.multiple === true,
          ...(a && typeof a === "object"
            ? {
              answer: {
                selected: (Array.isArray(a.selected) ? a.selected : []).map((v) => str(v, 500))
                  .slice(0, 8),
                ...(typeof a.text === "string" ? { text: str(a.text) } : {}),
              },
            }
            : { skipped: true }),
        }];
      }
    }
    return [];
  });
}
