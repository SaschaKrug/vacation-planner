import {
  CalendarDays,
  Check,
  CircleAlert,
  Clock,
  Copy,
  FileText,
  Globe,
  History,
  ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Search,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Wallet,
  X,
} from "lucide-react";
import { type DragEvent, Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { copyText } from "@/components/CopyField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChat } from "@/features/family/context";
import { Markdown } from "@/features/chat/Markdown";
import {
  ACCEPT,
  type Attachment,
  kindOf,
  MAX_ATTACHMENTS,
  readAttachment,
} from "@/features/chat/attachments";
import { type Item, type ItemAttachment, type QuestionItem, visible } from "@/features/chat/store";
import type { ChatQueued } from "@/lib/api";
import { toolDetail, toolLabel } from "@/features/chat/tools";
import { transcript } from "@/features/chat/transcript";
import { useIsMobile } from "@/hooks/use-mobile";
import { getLang, t } from "@/lib/i18n";
import { readFlag, writeFlag } from "@/lib/storage";
import { cn } from "@/lib/utils";

const OPEN_KEY = "fp-chat-open";

/** The right sidebar: the AI chat, collapsed to a ✨ rail by default (Ctrl/⌘+J toggles it).
 *  Phones open it as a sheet. */
export function ChatPanel() {
  const isMobile = useIsMobile();
  const [open, setOpenState] = useState(() => readFlag(OPEN_KEY));
  const [sheetOpen, setSheetOpen] = useState(false);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    writeFlag(OPEN_KEY, next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "j"
      ) {
        e.preventDefault();
        if (isMobile) setSheetOpen((v) => !v);
        else setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (isMobile) {
    return (
      <>
        <Button
          size="icon"
          className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+9rem)] z-30 size-11 rounded-full shadow-lg"
          aria-label={t("chat.open")}
          onClick={() => setSheetOpen(true)}
        >
          <Sparkles />
        </Button>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent
            side="right"
            className="w-full gap-0 p-0 sm:max-w-md [&>button]:hidden"
          >
            <SheetTitle className="sr-only">{t("chat.title")}</SheetTitle>
            <ChatView onClose={() => setSheetOpen(false)} />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  if (!open) {
    return (
      <aside className="sticky top-0 flex h-svh w-12 shrink-0 flex-col items-center border-l bg-sidebar py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("chat.open")}
              onClick={() => setOpen(true)}
            >
              <Sparkles />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{t("chat.open")}</TooltipContent>
        </Tooltip>
      </aside>
    );
  }

  return (
    <aside
      className="sticky top-0 flex h-svh w-[380px] shrink-0 flex-col border-l bg-sidebar"
      aria-label={t("chat.title")}
    >
      <ChatView onClose={() => setOpen(false)} />
    </aside>
  );
}

function ChatView({ onClose }: { onClose: () => void }) {
  const chat = useChat();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Files still being read or shrunk.
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = chat.current;
  /** Copies items of the open chat, with every tool call's arguments and result. */
  const copy = (items: Item[]) => {
    if (current) copyText(transcript(items, (id) => chat.toolResult(current, id)));
  };

  useEffect(() => {
    chat.loadSettings();
    chat.loadChats();
    // Back on the page: catch up with what happened meanwhile (also on other devices).
    const onVisible = () => {
      if (document.visibilityState === "visible") chat.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [chat]);

  // Follow the answer as it streams in.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.rev]);

  const settings = chat.settings;
  const ready = settings?.configured;

  const filled = !!text.trim() || attachments.length > 0;
  // While the assistant answers, a message waits and goes next (once the chat has its id).
  const canSend = !!ready && !pending.length && (!chat.busy || !!current?.id);

  const send = (value = text) => {
    if ((!value.trim() && !attachments.length) || !canSend) return;
    const files = attachments;
    chat.send(value, files).catch(() => {
      // It couldn't wait: back in the box, to send again.
      setText((v) => v || value);
      setAttachments((list) => (list.length ? list : files));
    });
    setText("");
    setAttachments([]);
  };

  const attach = (files: File[]) => {
    if (!ready) return;
    const ok = files.filter((f) => {
      if (kindOf(f)) return true;
      toast(t("chat.attach_unsupported", { name: f.name }));
      return false;
    });
    const room = MAX_ATTACHMENTS - attachments.length - pending.length;
    if (ok.length > room) toast(t("chat.attach_limit", { n: MAX_ATTACHMENTS }));
    for (const file of ok.slice(0, Math.max(0, room))) {
      const id = crypto.randomUUID();
      setPending((p) => [...p, { id, name: file.name }]);
      readAttachment(file)
        .then((a) => setAttachments((list) => [...list, a]))
        .catch((err) => toast((err as Error).message))
        .finally(() => setPending((p) => p.filter((x) => x.id !== id)));
    }
  };

  const hasFiles = (e: DragEvent) => ready && e.dataTransfer.types.includes("Files");

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (
          !e.currentTarget.contains(e.relatedTarget as Node | null)
        ) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        attach(Array.from(e.dataTransfer.files));
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/85 text-sm font-medium">
          <Paperclip className="mr-2 size-4 text-primary" /> {t("chat.drop")}
        </div>
      )}
      <header className="flex h-14 shrink-0 items-center gap-1 border-b px-3">
        <Sparkles className="mx-1 size-4 text-primary" />
        <h2 className="min-w-0 flex-1 truncate font-semibold">
          {current?.title ?? t("chat.title")}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("chat.copy.chat")}
          title={t("chat.copy.chat")}
          disabled={!current?.items.length}
          onClick={() => current && copy(visible(current.items))}
        >
          <Copy />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("chat.history")}
              title={t("chat.history")}
            >
              <History />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t("chat.history")}
            </DropdownMenuLabel>
            {!chat.chats.length && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                {t("chat.no_history")}
              </div>
            )}
            {chat.chats.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onSelect={() => chat.open(c.id)}
              >
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                {c.status === "running" && (
                  <Loader2
                    className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                    aria-label={t("chat.thinking")}
                  />
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(c.updatedAt).toLocaleDateString(getLang(), {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <button
                  type="button"
                  className="rounded p-0.5 opacity-60 hover:opacity-100"
                  aria-label={t("chat.delete")}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    chat.remove(c.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => chat.newChat()}>
              <Plus className="size-4" /> {t("chat.new")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("chat.new")}
          title={t("chat.new")}
          onClick={() => chat.newChat()}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("chat.close")}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm"
        aria-live="polite"
      >
        {settings && !ready && <SetupHint />}
        {chat.settingsError && <p className="text-gap">{chat.settingsError}</p>}
        {ready && !current?.items.length && <Suggestions onPick={send} />}
        {current && visible(current.items).map((item, i, items) => {
          // An answer is everything between two messages of the user; once it's complete it
          // gets a copy button.
          const next = items[i + 1];
          const complete = item.kind !== "user" &&
            (next ? next.kind === "user" : !chat.busy);
          let start = i;
          while (complete && start > 0 && items[start - 1].kind !== "user") start--;
          return (
            <Fragment key={i}>
              <ItemView item={item} onUndo={(id) => chat.undo(current.id, id)} />
              {complete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mt-2 size-7 text-muted-foreground"
                  aria-label={t("chat.copy.answer")}
                  title={t("chat.copy.answer")}
                  onClick={() => copy(items.slice(start, i + 1))}
                >
                  <Copy className="size-3.5" />
                </Button>
              )}
            </Fragment>
          );
        })}
        {chat.busy && <ActivityLine />}
        {current?.queued.map((q) => (
          <QueuedMessage
            key={q.id}
            item={q}
            onRemove={() => chat.unqueue(q.id)}
          />
        ))}
      </div>

      <form
        className="shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="rounded-xl border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/40">
          {(attachments.length > 0 || pending.length > 0) && (
            <div className="flex flex-wrap gap-2 p-1 pb-2">
              {attachments.map((a, i) => (
                <PendingChip
                  key={i}
                  attachment={a}
                  onRemove={() => setAttachments((list) => list.filter((x) => x !== a))}
                />
              ))}
              {pending.map((p) => (
                <div
                  key={p.id}
                  className="flex size-12 items-center justify-center rounded-md border bg-muted"
                  role="status"
                  aria-label={t("chat.attach_processing", { name: p.name })}
                  title={p.name}
                >
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-1">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                attach(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground"
              aria-label={t("chat.attach")}
              title={t("chat.attach")}
              disabled={!ready}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip />
            </Button>
            <Textarea
              rows={1}
              value={text}
              disabled={!ready}
              aria-label={t("chat.placeholder")}
              placeholder={!ready
                ? t("chat.setup_first")
                : chat.busy
                ? t("chat.placeholder_queue")
                : t("chat.placeholder")}
              className="max-h-40 min-h-9 resize-none border-0 bg-transparent p-1.5 shadow-none placeholder:truncate focus-visible:ring-0 dark:bg-transparent"
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                // Screenshots arrive as image files; plain text pastes as usual.
                const images = Array.from(e.clipboardData.files).filter((f) =>
                  f.type.startsWith("image/")
                );
                if (!images.length) return;
                e.preventDefault();
                attach(images);
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {chat.busy && (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                aria-label={t("chat.stop")}
                title={t("chat.stop")}
                onClick={() => chat.stop()}
              >
                <Square className="fill-current" />
              </Button>
            )}
            {(!chat.busy || filled) && (
              <Button
                type="submit"
                size="icon"
                aria-label={chat.busy ? t("chat.queue") : t("chat.send")}
                title={chat.busy ? t("chat.queue") : undefined}
                disabled={!canSend || !filled}
              >
                <SendHorizontal />
              </Button>
            )}
          </div>
        </div>
        <ContextMeter />
        {/* Keyboard hints mean nothing on a touch screen. */}
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground pointer-coarse:hidden">
          {t("chat.hint")}
        </p>
      </form>
    </div>
  );
}

function SetupHint() {
  const chat = useChat();
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="font-medium">{t("chat.setup_title")}</p>
      <p className="mt-1 text-muted-foreground">{t("chat.setup_text")}</p>
      <Button size="sm" className="mt-3" asChild>
        <Link to={`/f/${chat.token}/settings/ai`}>
          {t("chat.setup_button")}
        </Link>
      </Button>
    </div>
  );
}

function Suggestions({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">{t("chat.intro")}</p>
      {["chat.example_gaps", "chat.example_holidays", "chat.example_spending"]
        .map((k) => (
          <button
            key={k}
            type="button"
            className="block w-full rounded-lg border bg-card px-3 py-2 text-left hover:bg-accent"
            onClick={() => onPick(t(k))}
          >
            {t(k)}
          </button>
        ))}
    </div>
  );
}

const TOOL_ICONS: Record<string, typeof Search> = {
  web_search: Search,
  fetch_page: Globe,
  get_calendar: CalendarDays,
  change_entries: CalendarDays,
  set_notes: CalendarDays,
  manage_entry_types: CalendarDays,
  list_transactions: Wallet,
  finance_summary: Wallet,
  manage_categories: Wallet,
  change_transactions: Wallet,
  combine_transfers: Wallet,
};

/** After this long without a new piece of text, the model is busy with its next step. */
const WRITING_PAUSE = 2000;

/** What the assistant is doing right now, under the chat while it answers. */
function ActivityLine() {
  const chat = useChat();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const a = chat.activity;
  if (!a) return null;
  const running = (chat.current?.items ?? []).filter(
    (it): it is Item & { kind: "tool" } => it.kind === "tool" && it.status === "running",
  );
  let text = t("chat.thinking");
  if (a.kind === "retrying") {
    text = t("chat.status.retrying", { n: a.attempt, max: a.max });
  } else if (a.kind === "compacting") {
    text = t("chat.status.compacting");
  } else if (a.kind === "tool" && running.length) {
    const more = running.length > 1 ? ` (+${running.length - 1})` : "";
    text = `${toolLabel(running.at(-1)!)}${more}…`;
  } else if (a.kind === "writing" && now - a.at < WRITING_PAUSE) {
    text = t("chat.status.writing");
  }
  const secs = Math.floor((now - a.at) / 1000);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <Loader2 className="size-3.5 shrink-0 animate-spin" />
      <span className="min-w-0 truncate">{text}</span>
      {secs >= 5 && <span className="shrink-0 tabular-nums opacity-70">{secs} s</span>}
    </div>
  );
}

/** How much of the model's context window the open chat uses; the server condenses the older
 *  messages before it is full (the bar turns amber when that is near). */
function ContextMeter() {
  const chat = useChat();
  const usage = chat.current?.usage;
  if (!usage?.max) return null;
  const pct = Math.min(100, Math.round((usage.used / usage.max) * 100));
  const format = new Intl.NumberFormat(getLang(), {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const label = t("chat.context", {
    used: format.format(usage.used),
    max: format.format(usage.max),
    pct,
  });
  return (
    <div
      className="mt-1.5 flex items-center gap-2 px-1 text-[11px] text-muted-foreground"
      title={t("chat.context_help")}
    >
      <div
        className="h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={usage.max}
        aria-valuenow={Math.min(usage.used, usage.max)}
      >
        <div
          className={cn("h-full rounded-full bg-primary/70", pct >= 70 && "bg-amber-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 tabular-nums">{label}</span>
    </div>
  );
}

/** An attachment in the composer, with a remove button. */
function PendingChip(
  { attachment: a, onRemove }: { attachment: Attachment; onRemove: () => void },
) {
  return (
    <div className="relative">
      {a.kind === "image"
        ? (
          <img
            src={a.url}
            alt={a.name}
            className="size-12 rounded-md border object-cover"
          />
        )
        : (
          <div
            className="flex h-12 max-w-40 items-center gap-1.5 rounded-md border bg-muted px-2 text-xs"
            title={a.name}
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{a.name}</span>
          </div>
        )}
      <button
        type="button"
        className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
        aria-label={t("chat.remove_attachment", { name: a.name })}
        title={t("chat.remove_attachment", { name: a.name })}
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/** An attachment in a sent message: an image (click for full size) or a file chip. */
function SentAttachment({ attachment: a }: { attachment: ItemAttachment }) {
  if (a.kind === "image" && a.url) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <button type="button" className="block cursor-zoom-in" title={a.name}>
            <img
              src={a.url}
              alt={a.name}
              className="max-h-40 max-w-40 rounded-lg bg-background object-cover"
            />
          </button>
        </DialogTrigger>
        <DialogContent className="p-2 sm:max-w-4xl">
          <DialogTitle className="sr-only">{a.name}</DialogTitle>
          <img
            src={a.url}
            alt={a.name}
            className="max-h-[85vh] w-full rounded object-contain"
          />
        </DialogContent>
      </Dialog>
    );
  }
  const Icon = a.kind === "image" ? ImageIcon : FileText;
  return (
    <div
      className={cn(
        "flex max-w-full items-center gap-1.5 rounded-md bg-primary-foreground/15 px-2 py-1 text-xs",
        a.kind === "image" && "opacity-75",
      )}
      title={a.kind === "image" ? t("chat.image_gone") : a.name}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{a.name}</span>
    </div>
  );
}

/** A message that waits for the answer to end (it goes next); it can be taken back until then. */
function QueuedMessage({ item, onRemove }: { item: ChatQueued; onRemove: () => void }) {
  const local = item.id.startsWith("local-");
  return (
    <div className="ml-8 flex items-start gap-2 rounded-2xl rounded-br-md border border-dashed border-primary/50 bg-primary/5 px-3 py-2">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="size-3 shrink-0" /> {t("chat.queued")}
        </div>
        {!!item.attachments?.length && (
          <div className="flex flex-wrap gap-1.5">
            {item.attachments.map((a, i) => {
              const Icon = a.kind === "image" ? ImageIcon : FileText;
              return (
                <div
                  key={i}
                  className="flex max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs"
                  title={a.name}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="min-w-0 truncate">{a.name}</span>
                </div>
              );
            })}
          </div>
        )}
        {item.text && <div className="whitespace-pre-wrap">{item.text}</div>}
      </div>
      <button
        type="button"
        className="-mr-1 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
        aria-label={t("chat.unqueue")}
        title={t("chat.unqueue")}
        disabled={local}
        onClick={onRemove}
      >
        {local ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
      </button>
    </div>
  );
}

function ItemView(
  { item, onUndo }: { item: Item; onUndo: (id: string) => void },
) {
  if (item.kind === "user") {
    return (
      <div className="ml-8 space-y-2 rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground">
        {!!item.attachments?.length && (
          <div className="flex flex-wrap gap-2">
            {item.attachments.map((a, i) => <SentAttachment key={i} attachment={a} />)}
          </div>
        )}
        {item.text && <div className="whitespace-pre-wrap">{item.text}</div>}
      </div>
    );
  }
  if (item.kind === "assistant") return <Markdown text={item.text} />;
  if (item.kind === "question") return <QuestionCard item={item} />;
  if (item.kind === "compacted") {
    return (
      <div
        className="flex items-center gap-2 text-[11px] text-muted-foreground"
        title={t("chat.context_help")}
      >
        <div className="h-px flex-1 bg-border" />
        <span className="text-center">{t("chat.compacted")}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  }
  if (item.kind === "error") {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-gap/30 bg-gap/10 px-3 py-2 text-gap">
        <CircleAlert className="mt-0.5 size-4 shrink-0" /> {item.text}
      </p>
    );
  }
  if (item.kind === "tool") {
    const Icon = TOOL_ICONS[item.name] ?? Sparkles;
    const label = toolLabel(item);
    const detail = toolDetail(item);
    return (
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        title={[label, detail, item.interrupted ? t("chat.interrupted") : item.summary]
          .filter(Boolean).join("\n")}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {label}
          {detail && <span className="opacity-70">{` · ${detail}`}</span>}
        </span>
        {item.status === "running" && <Loader2 className="size-3 shrink-0 animate-spin" />}
        {item.status === "ok" && <Check className="size-3 shrink-0" />}
        {item.status === "error" && <CircleAlert className="size-3 shrink-0 text-gap" />}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-card px-3 py-2",
        item.undone && "opacity-60",
      )}
    >
      <Check className="size-4 shrink-0 text-ok" />
      <span className={cn("min-w-0 flex-1", item.undone && "line-through")}>
        {item.summary}
      </span>
      {item.undone
        ? (
          <span className="text-xs text-muted-foreground">
            {t("chat.undone")}
          </span>
        )
        : (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => onUndo(item.id)}
          >
            <Undo2 /> {t("finance.undo")}
          </Button>
        )}
    </div>
  );
}

/** A question of the assistant: a click on an option answers it (or, with several to pick,
 *  ticks it), and an own answer can be written instead or as well. Once answered, it shows
 *  what was picked. */
function QuestionCard({ item }: { item: QuestionItem }) {
  const chat = useChat();
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const open = chat.openQuestion()?.id === item.id;
  const active = open && !chat.busy;
  const chosen = item.answer?.selected ?? picked;
  const submit = (selected: string[]) => chat.answer(selected, text);
  const toggle = (o: string) =>
    setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="font-medium whitespace-pre-wrap">{item.question}</p>
      {open && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t(item.multiple ? "chat.question.pick_several" : "chat.question.pick_one")}
        </p>
      )}
      <div className="mt-2 space-y-1.5" role="group" aria-label={item.question}>
        {item.options.map((o) => {
          const on = chosen.includes(o);
          return (
            <button
              key={o}
              type="button"
              disabled={!active}
              aria-pressed={item.multiple ? on : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left enabled:hover:bg-accent disabled:cursor-default",
                on && "border-primary bg-primary/10",
                !open && !on && "opacity-60",
              )}
              onClick={() => (item.multiple ? toggle(o) : submit([o]))}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center border",
                  item.multiple ? "rounded-sm" : "rounded-full",
                  on && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {on && <Check className="size-3" />}
              </span>
              <span className="min-w-0 flex-1">{o}</span>
            </button>
          );
        })}
      </div>
      {open && (
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit(item.multiple ? picked : []);
          }}
        >
          <Input
            value={text}
            disabled={!active}
            placeholder={t("chat.question.own")}
            aria-label={t("chat.question.own")}
            className="h-8"
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            className="h-8"
            disabled={!active ||
              (!text.trim() && !(item.multiple && picked.length))}
          >
            {t("chat.question.send")}
          </Button>
        </form>
      )}
      {item.answer?.text && (
        <div className="mt-2 ml-8 rounded-2xl rounded-br-md bg-primary px-3 py-2 whitespace-pre-wrap text-primary-foreground">
          {item.answer.text}
        </div>
      )}
      {item.skipped && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("chat.question.skipped")}
        </p>
      )}
    </div>
  );
}
