import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { t } from "@/lib/i18n";
import { readFlag, writeFlag } from "@/lib/storage";

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
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Sparkles className="size-4" /> {t("chat.title")}
              </SheetTitle>
              <SheetDescription>{t("chat.soon")}</SheetDescription>
            </SheetHeader>
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
      <header className="flex h-14 items-center gap-2 border-b px-4">
        <Sparkles className="size-4 text-primary" />
        <h2 className="flex-1 font-semibold">{t("chat.title")}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("chat.close")}
          onClick={() => setOpen(false)}
        >
          <X />
        </Button>
      </header>
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {t("chat.soon")}
      </div>
    </aside>
  );
}
