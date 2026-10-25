// The AI chats of one family: kept on the server, which also runs the turns (they go on when
// the app is closed, and every device sees the same chats). The app lists the chats, shows the
// open one, and follows it while a turn runs: what changed, and the answer as it is written.
// A message written meanwhile waits on the server and goes next once the answer is done.

import { toast } from "sonner";
import type { Attachment } from "@/features/chat/attachments";
import {
  type AiSettings,
  api,
  ApiError,
  type ChatActivity,
  type ChatEvent,
  type ChatInput,
  type ChatQuestion,
  type ChatQueued,
  type ChatSummary,
  type ChatUsage,
  type UndoStep,
} from "@/lib/api";
import { getLang, t } from "@/lib/i18n";
import { read } from "@/lib/storage";

export type ChangeKind = "entries" | "notes" | "types" | "categories" | "transactions";

/** An attachment as the chat shows it: images with their data URL. */
export interface ItemAttachment {
  kind: "image" | "file";
  name: string;
  url?: string;
}

/** What the chat shows: messages, tool activity and changes (with undo). */
export type Item =
  | { kind: "user"; text: string; attachments?: ItemAttachment[] }
  | { kind: "assistant"; text: string }
  | {
    kind: "tool";
    id: string;
    name: string;
    args: Record<string, unknown>;
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
    change: ChangeKind;
    summary: string;
    undo: UndoStep[];
    undone?: boolean;
  }
  | (ChatQuestion & {
    kind: "question";
    /** What the user picked and wrote; `skipped` when they wrote a new message instead. */
    answer?: { selected: string[]; text?: string };
    skipped?: boolean;
  })
  /** From here on, the model gets the earlier part of the chat as a summary. */
  | { kind: "compacted" }
  | { kind: "error"; text: string };

export type QuestionItem = Item & { kind: "question" };

/** What a running turn is doing right now, for the status line under the chat; `at` is when
 *  this device learned it. */
export type Activity = ChatActivity & { at: number };

/** The open chat. `id` is "" until the server named a new chat. */
export interface Chat {
  id: string;
  title: string;
  status: ChatSummary["status"];
  items: Item[];
  /** The items are saved up to this revision (the server sends what changed since). */
  rev: number;
  /** How full the model's context is. */
  usage: ChatUsage | null;
  /** Messages waiting for the running turn to end (ids starting with "local-" are on their
   *  way to the server). */
  queued: ChatQueued[];
}

/** A follow request: how it gets the chat's events. */
type Follow = (onEvent: (e: ChatEvent<Item>) => void, signal: AbortSignal) => Promise<void>;

/** Retries of a broken-off stream wait a little longer each time, up to this. */
const MAX_PAUSE = 10_000;

/** Resolves after `ms`, or as soon as `signal` aborts. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
    String(d.getDate()).padStart(2, "0")
  }`;
};

/** The messages that wait as the server says, then the ones still on their way to it. */
const queuedOf = (chat: ChatSummary, before: ChatQueued[]) => [
  ...(chat.queued ?? []),
  ...before.filter((q) => q.id.startsWith("local-")),
];

/** Items the chat shows: blank answers (left by a step that is tried again) aren't. */
export const visible = (items: Item[]) =>
  items.filter((it) => it && !(it.kind === "assistant" && !it.text));

export class ChatStore {
  settings: AiSettings | null = null;
  settingsError: string | null = null;
  /** The user's chats, the latest first. */
  chats: ChatSummary[] = [];
  currentId: string | null = null;
  /** The open chat, once loaded (or a new one being started). */
  current: Chat | null = null;
  /** Set while a turn runs; `at` is when it last changed. */
  activity: Activity | null = null;
  rev = 0;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private listing: Promise<void> | null = null;
  /** Following the open chat (its stream). */
  private following: AbortController | null = null;
  /** A message is on its way to the server. */
  private sending = false;
  /** Changes this device has seen, so it reloads the data only for new ones. */
  private seen = new Set<string>();

  constructor(
    readonly token: string,
    /** Called after the assistant (or an undo) changed something, to reload it. */
    private onChange: (kind: ChangeKind) => void,
    /** The page and year the user looks at, sent along with every message. */
    private context: () => { page: string; year: number },
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRev = () => this.rev;

  private emit() {
    this.rev++;
    for (const fn of this.listeners) fn();
  }

  /** A turn runs in the open chat (or a message is on its way). */
  get busy(): boolean {
    return this.sending || this.current?.status === "running";
  }

  /** Loads the AI settings once (to know whether the assistant is set up). */
  loadSettings(force = false) {
    if (this.loading && !force) return this.loading;
    this.loading = (async () => {
      try {
        this.settings = await api.aiSettings(this.token);
        this.settingsError = null;
      } catch (err) {
        this.settingsError = (err as Error).message;
      }
      this.emit();
    })();
    return this.loading;
  }

  setSettings(settings: AiSettings) {
    this.settings = settings;
    this.emit();
  }

  /** Loads the list of chats (first moving chats this device kept before to the server). */
  loadChats() {
    this.listing ??= (async () => {
      try {
        await this.importLocal();
        this.chats = await api.chats(this.token);
        this.emit();
      } catch {
        // Offline or not allowed: the list stays as it is.
      } finally {
        this.listing = null;
      }
    })();
    return this.listing;
  }

  /** Back on the page (another device may have chatted meanwhile): the list and the open chat
   *  catch up. */
  refresh() {
    this.loadChats();
    if (this.current?.id && !this.following) this.follow(this.current.id);
  }

  /** Chats from before they were stored on the server, kept in this browser: moved there. */
  private async importLocal() {
    const key = `fp-chats:${this.token}`;
    const local = read<unknown[]>(key, []);
    if (!Array.isArray(local) || !local.length) return;
    for (const chat of local) {
      try {
        await api.importChat(this.token, chat);
      } catch (err) {
        // Kept for the next try unless the server refused the chat itself.
        if (!(err instanceof ApiError) || !err.status || err.status >= 500 || err.status === 429) {
          return;
        }
      }
    }
    try {
      localStorage.removeItem(key);
    } catch {
      // storage blocked
    }
  }

  newChat() {
    this.unfollow();
    this.currentId = null;
    this.current = null;
    this.activity = null;
    this.emit();
  }

  /** Opens a chat (a running turn goes on either way). */
  async open(id: string) {
    if (id === this.currentId && this.current) return;
    this.unfollow();
    this.currentId = id;
    this.current = null;
    this.activity = null;
    this.emit();
    try {
      const s = await api.chat<Item>(this.token, id);
      if (this.currentId !== id) return;
      for (const it of s.items) if (it?.kind === "change") this.seen.add(it.id);
      this.current = {
        id,
        title: s.chat.title,
        status: s.chat.status,
        items: s.items,
        rev: s.rev,
        usage: s.chat.usage ?? null,
        queued: s.chat.queued ?? [],
      };
      this.summary(s.chat);
      this.emit();
      if (s.chat.status === "running") this.follow(id);
    } catch (err) {
      if (this.currentId !== id) return;
      if (err instanceof ApiError && err.status === 404) {
        this.chats = this.chats.filter((c) => c.id !== id);
        this.currentId = null;
      }
      toast((err as Error).message);
      this.emit();
    }
  }

  async remove(id: string) {
    try {
      await api.deleteChat(this.token, id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        toast((err as Error).message);
        return;
      }
    }
    this.chats = this.chats.filter((c) => c.id !== id);
    if (this.currentId === id) this.newChat();
    this.emit();
  }

  /** Stops the open chat's turn; it ends with what it did so far. */
  async stop() {
    const id = this.current?.id;
    if (!id) return;
    try {
      await api.stopChat(this.token, id);
      if (!this.following) this.follow(id);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  private input(): Omit<ChatInput, "text" | "attachments"> {
    return { lang: getLang(), today: today(), ...this.context() };
  }

  /** Sends a message; while a turn runs, it waits and goes next (rejects if it couldn't). */
  async send(text: string, attachments: Attachment[] = []) {
    const message = text.trim();
    if (!message && !attachments.length) return;
    if (this.busy) {
      return this.enqueue({
        id: `local-${crypto.randomUUID()}`,
        text: message,
        ...(attachments.length
          ? { attachments: attachments.map((a) => ({ kind: a.kind, name: a.name })) }
          : {}),
      }, this.inputOf(message, attachments));
    }
    const item: Item = { kind: "user", text: message };
    if (attachments.length) {
      item.attachments = attachments.map((a) =>
        a.kind === "image"
          ? { kind: a.kind, name: a.name, url: a.url }
          : { kind: a.kind, name: a.name }
      );
    }
    const input = this.inputOf(message, attachments);
    // Shown right away; the server sends it back at the same position.
    if (!this.current) {
      this.current = {
        id: "",
        title: (message || attachments[0].name).slice(0, 60),
        status: "idle",
        items: [],
        rev: 0,
        usage: null,
        queued: [],
      };
    }
    const c = this.current;
    // A new message instead of an answer: the question stays unanswered.
    const open = this.openQuestion();
    if (open) c.items = c.items.map((it) => (it === open ? { ...open, skipped: true } : it));
    c.items = [...c.items, item];
    const id = c.id;
    await this.start(
      id || null,
      (onEvent, signal) =>
        id
          ? api.sendMessage<Item>(this.token, id, input, onEvent, signal)
          : api.startChat<Item>(this.token, input, onEvent, signal),
    );
  }

  private inputOf(text: string, attachments: Attachment[]): ChatInput {
    return {
      ...this.input(),
      text,
      attachments: attachments.map((a) =>
        a.kind === "image"
          ? { kind: "image", name: a.name, url: a.url }
          : { kind: "file", name: a.name, text: a.text }
      ),
    };
  }

  /** A message while the open chat's turn runs: shown as waiting right away, kept on the
   *  server, which sends it once the turn is over. */
  private async enqueue(shown: ChatQueued, input: ChatInput) {
    const c = this.current;
    if (!c?.id) {
      // A new chat gets its id with the first answer: nothing to wait in yet.
      toast(t("chat.queue_wait"));
      throw new Error(t("chat.queue_wait"));
    }
    c.queued = [...c.queued, shown];
    this.emit();
    try {
      const r = await api.queueMessage(this.token, c.id, input);
      this.summary(r.chat);
      c.queued = queuedOf(r.chat, c.queued.filter((q) => q !== shown));
      c.status = r.chat.status;
      // The turn was over by then: the message started the next one.
      if (this.current === c && r.chat.status === "running" && !this.following) this.follow(c.id);
    } catch (err) {
      c.queued = c.queued.filter((q) => q !== shown);
      toast((err as Error).message);
      throw err;
    } finally {
      this.emit();
    }
  }

  /** Takes back a waiting message of the open chat (unless its turn started already). */
  async unqueue(id: string) {
    const c = this.current;
    if (!c?.id || id.startsWith("local-")) return;
    c.queued = c.queued.filter((q) => q.id !== id);
    this.emit();
    try {
      const r = await api.unqueueMessage(this.token, c.id, id);
      c.queued = queuedOf(r.chat, c.queued);
    } catch (err) {
      toast((err as Error).message);
    }
    this.emit();
  }

  /** The open chat's question that waits for an answer (the turn goes on with it). */
  openQuestion(): QuestionItem | undefined {
    const items = this.current?.items ?? [];
    const i = items.findLastIndex((it) => it?.kind === "question");
    const q = items[i];
    if (q?.kind !== "question" || q.answer || q.skipped || this.busy) return undefined;
    return items.slice(i + 1).some((it) => it?.kind === "user") ? undefined : q;
  }

  /** Answers the open question of the current chat, and the assistant goes on. */
  async answer(selected: string[], text: string) {
    const c = this.current;
    const q = this.openQuestion();
    const own = text.trim();
    if (!c?.id || !q || this.busy || (!selected.length && !own)) return;
    const answer = { selected, ...(own ? { text: own } : {}) };
    c.items = c.items.map((it) => (it === q ? { ...q, answer } : it));
    await this.start(c.id, (onEvent, signal) =>
      api.answerQuestion<Item>(
        this.token,
        c.id,
        { ...this.input(), id: q.id, ...answer },
        onEvent,
        signal,
      ));
  }

  /** Sends a message (or an answer) with `request`, then follows the turn. */
  private async start(id: string | null, request: Follow) {
    this.sending = true;
    this.activity = { kind: "thinking", at: Date.now() };
    this.emit();
    await this.follow(id, request);
  }

  private unfollow() {
    this.following?.abort();
    this.following = null;
  }

  /**
   * Follows a chat until no turn runs in it: with `first` (a message being sent), then with
   * follow requests from what this device has. The server runs the turn either way, so a
   * stream that breaks off is simply asked for again.
   */
  private async follow(id: string | null, first?: Follow) {
    this.unfollow();
    const abort = new AbortController();
    this.following = abort;
    let chatId = id;
    let request = first;
    for (let failures = 0; !abort.signal.aborted;) {
      let end = false;
      let heard = false;
      const onEvent = (e: ChatEvent<Item>) => {
        if (abort.signal.aborted) return;
        heard = true;
        if (e.event === "chat") chatId ??= e.data.id;
        if (e.event === "end") end = true;
        if (chatId) this.apply(chatId, e);
      };
      try {
        if (request) {
          const r = request;
          request = undefined;
          await r(onEvent, abort.signal);
        } else if (chatId) {
          await api.followChat<Item>(
            this.token,
            chatId,
            this.current?.rev ?? 0,
            onEvent,
            abort.signal,
          );
        } else break;
      } catch (err) {
        if (first && !heard && this.sending) {
          // The message didn't get through: the chat says so (it stays visible).
          this.sending = false;
          this.failed((err as Error).message);
          if (!(err instanceof ApiError && err.status)) this.loadChats(); // maybe it did
          break;
        }
        // Refused (the chat is gone, or no longer ours): following won't help.
        const status = err instanceof ApiError ? err.status : undefined;
        if (status && status < 500 && status !== 429) break;
        failures++;
      }
      this.sending = false;
      if (abort.signal.aborted || end) break;
      // Reconnect at once after a good stream, else a little later each time.
      if (heard) failures = 0;
      else await pause(Math.min(MAX_PAUSE, 1000 * 2 ** failures), abort.signal);
    }
    if (this.following === abort) {
      this.following = null;
      this.sending = false;
      if (this.current?.id === chatId && this.current?.status !== "running") this.activity = null;
      this.emit();
    }
  }

  private failed(text: string) {
    if (this.current) {
      this.current.items = [...this.current.items, { kind: "error", text }];
      if (!this.current.id) this.current.status = "idle";
    }
    this.activity = null;
    this.emit();
  }

  /** Keeps a chat's summary in the list (the latest first). */
  private summary(s: ChatSummary) {
    this.chats = [s, ...this.chats.filter((c) => c.id !== s.id)].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  /** What a chat's stream says. */
  private apply(id: string, e: ChatEvent<Item>) {
    // A new chat gets its id with the first event.
    if (this.current && !this.current.id && e.event === "chat" && this.currentId === null) {
      this.current.id = id;
      this.currentId = id;
    }
    const c = this.current?.id === id ? this.current : null;
    switch (e.event) {
      case "chat": {
        this.summary(e.data);
        if (!c) break;
        c.title = e.data.title;
        c.status = e.data.status;
        c.usage = e.data.usage ?? c.usage;
        c.queued = queuedOf(e.data, c.queued);
        const a = e.data.activity;
        if (!a || e.data.status !== "running") this.activity = null;
        else if (JSON.stringify({ ...this.activity, at: 0 }) !== JSON.stringify({ ...a, at: 0 })) {
          this.activity = { ...a, at: Date.now() };
        }
        break;
      }
      case "items":
        if (!c) break;
        c.items = [...c.items];
        for (const { seq, item } of e.data.items) {
          c.items[seq] = item;
          if (item?.kind === "change" && !this.seen.has(item.id)) {
            this.seen.add(item.id);
            this.onChange(item.change);
          }
        }
        if (e.data.rev !== undefined) c.rev = Math.max(c.rev, e.data.rev);
        break;
      case "delta": {
        const it = c?.items[e.data.seq];
        if (!c || it?.kind !== "assistant") break;
        c.items = [...c.items];
        c.items[e.data.seq] = { ...it, text: it.text + e.data.text };
        this.activity = { kind: "writing", at: Date.now() };
        break;
      }
      case "end":
        if (e.data.deleted) {
          this.chats = this.chats.filter((x) => x.id !== id);
          if (c) this.newChat();
        } else if (c) {
          c.status = "idle";
          this.activity = null;
        }
        break;
    }
    this.emit();
  }

  /** A tool call's result, as far as the chat keeps it. */
  toolResult(chat: Chat, id: string): string | undefined {
    const item = chat.items.find((it) => it?.kind === "tool" && it.id === id);
    return item?.kind === "tool" ? item.result : undefined;
  }

  async undo(chatId: string, changeId: string) {
    const chat = this.current?.id === chatId ? this.current : null;
    const item = chat?.items.find((it) => it?.kind === "change" && it.id === changeId);
    if (!chat || !item || item.kind !== "change" || item.undone) return;
    try {
      await api.undo(this.token, item.undo);
      chat.items = chat.items.map((it) => (it === item ? { ...item, undone: true } : it));
      this.emit();
      this.onChange(item.change);
      toast(t("chat.undone"));
    } catch (err) {
      toast(t("chat.undo_failed", { msg: (err as Error).message }));
      return;
    }
    // Tell the assistant, so it doesn't assume the change is still there.
    await api.chatUndone(this.token, chatId, changeId).catch(() => {});
  }
}
