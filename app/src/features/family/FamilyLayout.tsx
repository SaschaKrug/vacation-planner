import { useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ChatStore, pageOf } from "@/features/chat/store";
import { FinanceStore } from "@/features/finance/store";
import { PlannerStore } from "@/features/vacation/store";
import { refreshMe } from "@/features/auth/RequireAuth";
import { forgetFamily } from "@/lib/auth";
import { t, useLang } from "@/lib/i18n";
import { readFlag, writeFlag } from "@/lib/storage";
import { ChatPanel } from "@/layout/ChatPanel";
import { LeftSidebar } from "@/layout/LeftSidebar";
import { HelpDialog } from "@/features/vacation/HelpDialog";
import { ChatContext, FinanceContext, PlannerContext, usePlanner } from "./context";

const SIDEBAR_KEY = "fp-sidebar-collapsed";

/** Everything under /f/:token: one PlannerStore for the family, the navigation on the left,
 *  the page in the middle and the AI chat on the right. */
export function FamilyLayout() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const year = Number(params.get("y")) || new Date().getFullYear();
  // A new store per family; the year in the URL only matters when it opens.
  const store = useMemo(
    () => new PlannerStore(token, year, (msg) => toast(msg)),
    [token],
  );

  const finance = useMemo(() => new FinanceStore(token), [token]);
  const chat = useMemo(
    () =>
      new ChatStore(
        token,
        (kind) => {
          // The assistant changed something: show it right away.
          if (kind === "categories") finance.refreshCategories();
          else if (kind === "benchmark") finance.loadOverview();
          else if (kind === "transactions") finance.refresh();
          else store.load({ quiet: true });
        },
        () => ({
          page: pageOf(location.pathname),
          year: store.year,
        }),
      ),
    [token, store, finance],
  );

  useEffect(() => {
    store.open();
    const unload = (e: BeforeUnloadEvent) => {
      if (store.pending) e.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("beforeunload", unload);
      store.close();
    };
  }, [store]);

  return (
    <PlannerContext.Provider value={store}>
      <FinanceContext.Provider value={finance}>
        <ChatContext.Provider value={chat}>
          <FamilyShell />
        </ChatContext.Provider>
      </FinanceContext.Provider>
    </PlannerContext.Provider>
  );
}

function FamilyShell() {
  const store = usePlanner();
  useLang();
  const [sidebarOpen, setSidebarOpen] = useState(() => !readFlag(SIDEBAR_KEY));

  useEffect(() => {
    document.title = store.family ? `${store.family.name} · ${t("app.title")}` : t("app.title");
  });

  useEffect(() => {
    if (!store.notFound) return;
    // Not (or no longer) a member: the start page opens another family, so not this one.
    forgetFamily(store.token);
    refreshMe();
    toast(t("toast.not_found"));
  }, [store.notFound, store.token]);

  if (store.notFound) return <Navigate to="/" replace />;

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={(open) => {
        setSidebarOpen(open);
        writeFlag(SIDEBAR_KEY, !open);
      }}
    >
      <LeftSidebar />
      <SidebarInset className="min-w-0">
        <Outlet />
      </SidebarInset>
      {!store.readOnly && <ChatPanel />}
      <HelpDialog />
    </SidebarProvider>
  );
}
