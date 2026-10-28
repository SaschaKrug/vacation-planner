import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePlanner } from "@/features/family/context";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** The bar at the top of every family page: sidebar toggle, title, the page's own controls
 *  and the save status. */
export function PageHeader(
  { title, children, className }: {
    title: string;
    children?: ReactNode;
    className?: string;
  },
) {
  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur",
        className,
      )}
    >
      <SidebarTrigger />
      <Separator orientation="vertical" className="mx-1 h-5!" />
      <h1 className="truncate font-semibold max-sm:hidden">{title}</h1>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2">
        {children}
      </div>
      <SyncStatus />
    </header>
  );
}

/** A dot (green = saved, amber = busy, red = offline); its text only shows while busy. */
export function SyncStatus() {
  const { sync } = usePlanner();
  if (!sync.key) return null;
  const state = sync.error ? "error" : sync.key.replace("sync.", "");
  const busy = ["saving", "loading", "updating"].includes(state);
  const text = t(sync.key);
  return (
    <span
      className={cn(
        "ml-1 inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground",
        sync.error && "text-gap",
      )}
      title={text}
    >
      <span
        className={cn(
          "size-[7px] shrink-0 rounded-full bg-ok",
          busy && "animate-pulse bg-amber-500",
          sync.error && "bg-gap",
        )}
      />
      <span
        className={cn(state === "saved" ? "sr-only" : "max-sm:sr-only")}
        aria-live="polite"
      >
        {text}
      </span>
    </span>
  );
}
