// The AI chat of one family on this device: the chats (kept in localStorage), the one that is
// open, sending a message and showing the streamed answer, and undoing changes.

import { toast } from "sonner";
import { type AiSettings, api, type ChatEvent, type ChatMessage, type UndoStep } from "@/lib/api";
import { getLang, t } from "@/lib/i18n";
import { read, write } from "@/lib/storage";

export type ChangeKind = "entries" | "notes" | "types" | "transactions";

/** What the chat shows: messages, tool activity and changes (with undo). */
export type Item =
  | { kind: "user"; text: string }
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
    // Newest first; if storage is full, drop the oldest chats until it fits.
    this.chats.sort((a, b) => b.updatedAt - a.updatedAt);
    this.chats = this.chats.slice(0, MAX_CHATS);
    for (let n = this.chats.length; n > 0; n--) {
      try {
        localStorage.setItem(this.key, JSON.stringify(this.chats.slice(0, n)));
        return;
      } catch {
        // too big: try with fewer chats
      }
    }
    write(this.key, []);
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

  async send(text: string) {
    const message = text.trim();
    if (!message || this.busy) return;
    let chat = this.current;
    if (!chat) {
      chat = {
        id: crypto.randomUUID(),
        title: message.slice(0, 60),
        updatedAt: Date.now(),
        history: [],
        items: [],
      };
      this.chats.unshift(chat);
      this.currentId = chat.id;
    }
    const c = chat;
    c.items = [...c.items, { kind: "user", text: message }];
    c.history = [...c.history, { role: "user", content: message }];
    c.updatedAt = Date.now();
    this.busy = true;
    this.save();
    this.emit();

    this.abort = new AbortController();
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
          update((items) => [...items, { kind: "tool", ...e.data, status: "running" }]);
          break;
        case "tool_result":
          update((items) =>
            items.map((it) =>
              it.kind === "tool" && it.id === e.data.id
                ? { ...it, status: e.data.ok ? "ok" : "error", summary: e.data.summary }
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
        case "error":
          update((items) => [...items, { kind: "error", text: e.data.message }]);
          break;
      }
    };

    try {
      await api.chat(
        this.token,
        { messages: c.history, lang: getLang(), today: today(), ...this.context() },
        onEvent,
        this.abort.signal,
      );
    } catch (err) {
      c.items = [...c.items, { kind: "error", text: (err as Error).message }];
      // The server never saw this turn's answer: drop the message from the history so the
      // next one starts cleanly (it stays visible).
      if (c.history.at(-1)?.role === "user") c.history = c.history.slice(0, -1);
    }
    if (c.history.at(-1)?.role === "user") {
      // Stopped before the answer: keep the history valid for the next turn.
      c.history = [...c.history, { role: "assistant", content: "(stopped)" }];
    }
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
      chat.items = chat.items.map((it) => (it === item ? { ...item, undone: true } : it));
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
