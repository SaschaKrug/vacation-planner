import {
  CalendarDays,
  Check,
  CircleAlert,
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
import { type DragEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import type { Item, ItemAttachment } from "@/features/chat/store";
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

  useEffect(() => {
    chat.loadSettings();
  }, [chat]);

  // Follow the answer as it streams in.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.rev]);

  const settings = chat.settings;
  const ready = settings?.configured;

  const send = (value = text) => {
    if ((!value.trim() && !attachments.length) || pending.length || chat.busy) {
      return;
    }
    chat.send(value, attachments);
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
        {current?.items.map((item, i) => (
          <ItemView
            key={i}
            item={item}
            onUndo={(id) => chat.undo(current.id, id)}
          />
        ))}
        {chat.busy && current?.items.at(-1)?.kind === "user" && (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label={t("chat.thinking")}
          />
        )}
      </div>

      <form
        className="shrink-0 border-t p-3"
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
              placeholder={ready ? t("chat.placeholder") : t("chat.setup_first")}
              className="max-h-40 min-h-9 resize-none border-0 bg-transparent p-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
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
            {chat.busy
              ? (
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
              )
              : (
                <Button
                  type="submit"
                  size="icon"
                  aria-label={t("chat.send")}
                  disabled={!ready || pending.length > 0 ||
                    (!text.trim() && !attachments.length)}
                >
                  <SendHorizontal />
                </Button>
              )}
          </div>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
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
};

function toolLabel(item: Item & { kind: "tool" }) {
  const a = item.args ?? {};
  if (item.name === "web_search") {
    return t("chat.tool.web_search", { q: String(a.query ?? "") });
  }
  if (item.name === "fetch_page") {
    let host = String(a.url ?? "");
    try {
      host = new URL(host).hostname;
    } catch {
      // keep as is
    }
    return t("chat.tool.fetch_page", { host });
  }
  return t(`chat.tool.${item.name}`);
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
  if (item.kind === "error") {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-gap/30 bg-gap/10 px-3 py-2 text-gap">
        <CircleAlert className="mt-0.5 size-4 shrink-0" /> {item.text}
      </p>
    );
  }
  if (item.kind === "tool") {
    const Icon = TOOL_ICONS[item.name] ?? Sparkles;
    return (
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        title={item.summary}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{toolLabel(item)}</span>
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
