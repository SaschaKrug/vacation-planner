// The AI chat of one family on this device: the chats (kept in localStorage), the one that is
// open, sending a message and showing the streamed answer, and undoing changes.

import { toast } from "sonner";
import { type Attachment, keepImages, toParts } from "@/features/chat/attachments";
import { type AiSettings, api, type ChatEvent, type ChatMessage, type UndoStep } from "@/lib/api";
import { getLang, t } from "@/lib/i18n";
import { read, write } from "@/lib/storage";

export type ChangeKind = "entries" | "notes" | "types" | "categories" | "transactions";

/** An attachment as the chat shows it: images keep their data URL unless storage was full. */
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
  }
  | {
    kind: "change";
    id: string;
    change: ChangeKind;
    summary: string;
    undo: UndoStep[];
    undone?: boolean;
  }
  | { kind: "error"; text: string };

export interface Chat {
  id: string;
  title: string;
  updatedAt: number;
  /** What the server gets back on the next turn. */
  history: ChatMessage[];
  items: Item[];
}

const MAX_CHATS = 20;
/** Images sent along with a request (the server keeps no more either). */
const MAX_IMAGES = 8;
/** Characters of a tool result kept in the saved history (the server sends them in full). */
const MAX_TOOL_RESULT = 2000;

/** A chat without its image data, for when storage is full. */
const withoutImages = (c: Chat): Chat => ({
  ...c,
  history: keepImages(c.history, 0, "(an image that is no longer stored)"),
  items: c.items.map((it) =>
    it.kind === "user" && it.attachments
      ? {
        ...it,
        attachments: it.attachments.map((a) => ({
          kind: a.kind,
          name: a.name,
        })),
      }
      : it
  ),
});
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
    String(d.getDate()).padStart(2, "0")
  }`;
};

export class ChatStore {
  settings: AiSettings | null = null;
  settingsError: string | null = null;
  chats: Chat[];
  currentId: string | null = null;
  busy = false;
  rev = 0;
  private listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    readonly token: string,
    /** Called after the assistant (or an undo) changed something, to reload it. */
    private onChange: (kind: ChangeKind) => void,
    /** The page and year the user looks at, sent along with every message. */
    private context: () => { page: string; year: number },
  ) {
    this.chats = read<Chat[]>(this.key, []).filter((c) => c && Array.isArray(c.items));
  }

  private get key() {
    return `fp-chats:${this.token}`;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRev = () => this.rev;

  private emit() {
    this.rev++;
    for (const fn of this.listeners) fn();
  }

  private save() {
    // Newest first; if storage is full, store the chats without images (this session keeps
    // them), then drop the oldest chats until it fits.
    this.chats.sort((a, b) => b.updatedAt - a.updatedAt);
    this.chats = this.chats.slice(0, MAX_CHATS);
    if (this.store(this.chats)) return;
    const lean = this.chats.map(withoutImages);
    for (let n = lean.length; n > 0; n--) {
      if (this.store(lean.slice(0, n))) return;
    }
    write(this.key, []);
  }

  private store(chats: Chat[]) {
    try {
      localStorage.setItem(this.key, JSON.stringify(chats));
      return true;
    } catch {
      return false; // too big (or blocked)
    }
  }

  get current(): Chat | undefined {
    return this.chats.find((c) => c.id === this.currentId);
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

  newChat() {
    this.stop();
    this.currentId = null;
    this.emit();
  }

  open(id: string) {
    this.stop();
    this.currentId = id;
    this.emit();
  }

  remove(id: string) {
    this.chats = this.chats.filter((c) => c.id !== id);
    if (this.currentId === id) this.currentId = null;
    this.save();
    this.emit();
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
  }

  async send(text: string, attachments: Attachment[] = []) {
    const message = text.trim();
    if ((!message && !attachments.length) || this.busy) return;
    let chat = this.current;
    if (!chat) {
      chat = {
        id: crypto.randomUUID(),
        title: (message || attachments[0].name).slice(0, 60),
        updatedAt: Date.now(),
        history: [],
        items: [],
      };
      this.chats.unshift(chat);
      this.currentId = chat.id;
    }
    const c = chat;
    const item: Item = { kind: "user", text: message };
    if (attachments.length) {
      item.attachments = attachments.map((a) =>
        a.kind === "image"
          ? { kind: a.kind, name: a.name, url: a.url }
          : { kind: a.kind, name: a.name }
      );
    }
    c.items = [...c.items, item];
    c.history = [...c.history, {
      role: "user",
      content: attachments.length ? toParts(message, attachments) : message,
    }];
    c.updatedAt = Date.now();
    this.busy = true;
    this.save();
    this.emit();

    // One controller for the whole turn, so stopping also ends a chain of continued requests.
    const abort = new AbortController();
    this.abort = abort;
    const start = c.history.length; // where this turn's answer begins
    let more = false;
    let ended = false; // the request ended with "done", "error" or "continue"
    let answer: Item & { kind: "assistant" } | null = null;
    const update = (fn: (items: Item[]) => Item[]) => {
      c.items = fn([...c.items]);
      this.emit();
    };
    const onEvent = (e: ChatEvent) => {
      switch (e.event) {
        case "text":
          if (!answer) {
            answer = { kind: "assistant", text: "" };
            update((items) => [...items, answer!]);
          }
          answer.text += e.data.delta;
          update((items) => items);
          break;
        case "tool":
          answer = null; // text after the tool goes into a new bubble
          update((
            items,
          ) => [...items, { kind: "tool", ...e.data, status: "running" }]);
          break;
        case "tool_result":
          update((items) =>
            items.map((it) =>
              it.kind === "tool" && it.id === e.data.id
                ? {
                  ...it,
                  status: e.data.ok ? "ok" : "error",
                  summary: e.data.summary,
                }
                : it
            )
          );
          break;
        case "change":
          update((items) => [...items, {
            kind: "change",
            id: e.data.id,
            change: e.data.kind,
            summary: e.data.summary,
            undo: e.data.undo,
          }]);
          this.onChange(e.data.kind);
          break;
        case "messages":
          c.history = [...c.history, ...e.data.messages];
          break;
        case "done":
          ended = true;
          break;
        case "continue":
          more = true;
          ended = true;
          break;
        case "error":
          ended = true;
          update((
            items,
          ) => [...items, { kind: "error", text: e.data.message }]);
          break;
      }
    };

    // The server may hand the turn off ("continue") before it runs out of time: carry on with
    // the next request until one ends without it.
    const body = { lang: getLang(), today: today(), ...this.context() };
    for (let first = true; first || (more && !abort.signal.aborted); first = false) {
      more = false;
      ended = false;
      try {
        await api.chat(
          this.token,
          {
            messages: keepImages(
              c.history,
              MAX_IMAGES,
              "(an earlier image, no longer sent)",
            ),
            ...body,
            ...(first ? {} : { continue: true }),
          },
          onEvent,
          abort.signal,
        );
        if (!ended && !abort.signal.aborted) {
          // The connection closed before the server said how the turn ended (it was stopped,
          // e.g. at the time limit, or the network dropped): say so instead of ending blank.
          update((items) => [...items, { kind: "error", text: t("chat.cut_off") }]);
        }
      } catch (err) {
        more = false;
        c.items = [...c.items, { kind: "error", text: (err as Error).message }];
        // The server never saw this turn's answer: drop the message from the history so the
        // next one starts cleanly (it stays visible).
        if (first && c.history.at(-1)?.role === "user") c.history = c.history.slice(0, -1);
      }
    }
    const last = c.history.at(-1);
    if (last && (last.role !== "assistant" || last.tool_calls?.length)) {
      // Stopped before the answer: keep the history valid for the next turn.
      c.history = [...c.history, { role: "assistant", content: "(stopped)" }];
    }
    // Keep only the start of this turn's tool results.
    c.history = c.history.map((m, i) =>
      i >= start && m.role === "tool" && typeof m.content === "string" &&
        m.content.length > MAX_TOOL_RESULT
        ? { ...m, content: m.content.slice(0, MAX_TOOL_RESULT) + "…(truncated)" }
        : m
    );
    this.busy = false;
    this.abort = null;
    c.updatedAt = Date.now();
    this.save();
    this.emit();
  }

  async undo(chatId: string, changeId: string) {
    const chat = this.chats.find((c) => c.id === chatId);
    const item = chat?.items.find((it) => it.kind === "change" && it.id === changeId);
    if (!chat || !item || item.kind !== "change" || item.undone) return;
    try {
      await api.undo(this.token, item.undo);
      chat.items = chat.items.map((
        it,
      ) => (it === item ? { ...item, undone: true } : it));
      // Tell the assistant, so it doesn't assume the change is still there.
      chat.history = [
        ...chat.history,
        { role: "user", content: `(I undid this change: ${item.summary})` },
        { role: "assistant", content: "OK." },
      ];
      this.save();
      this.emit();
      this.onChange(item.change);
      toast(t("chat.undone"));
    } catch (err) {
      toast(t("chat.undo_failed", { msg: (err as Error).message }));
    }
  }
}
