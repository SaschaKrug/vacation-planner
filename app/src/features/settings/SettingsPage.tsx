import { Database, Laptop, Palette, Plug, Share2, Users, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, NavLink, useParams } from "react-router";
import { usePlanner } from "@/features/family/context";
import { t, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/layout/PageHeader";
import { DataSection } from "./DataSection";
import { FinanceSection } from "./FinanceSection";
import { GeneralSection } from "./GeneralSection";
import { IntegrationsSection } from "./IntegrationsSection";
import { SharingSection } from "./SharingSection";
import { VacationSection } from "./VacationSection";

const SECTIONS = [
  { id: "general", icon: Palette, Component: GeneralSection },
  { id: "sharing", icon: Share2, Component: SharingSection },
  { id: "vacation", icon: Users, Component: VacationSection },
  { id: "finance", icon: Wallet, Component: FinanceSection },
  { id: "integrations", icon: Plug, Component: IntegrationsSection },
  { id: "data", icon: Database, Component: DataSection },
] as const;

/** All settings of the family and of this device, one section at a time. */
export function SettingsPage() {
  const { section = "general" } = useParams();
  const store = usePlanner();
  useLang();
  const current = SECTIONS.find((s) => s.id === section);
  if (!current) return <Navigate to={`/f/${store.token}/settings`} replace />;
  const { Component } = current;

  return (
    <>
      <PageHeader title={t("settings.title")} />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:flex-row md:p-6">
        <nav
          className="-mx-4 flex shrink-0 gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:w-48 md:flex-col md:px-0"
          aria-label={t("settings.title")}
        >
          {SECTIONS.map(({ id, icon: Icon }) => (
            <NavLink
              key={id}
              to={`/f/${store.token}/settings/${id}`}
              end={id !== "general"}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground",
                  (isActive || (id === "general" && section === "general")) &&
                    "bg-accent text-foreground",
                )}
            >
              <Icon className="size-4" /> {t(`settings.${id}`)}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-6">
          {store.readOnly && store.family && (
            <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
              {t("settings.readonly")}
            </p>
          )}
          <Component />
        </div>
      </div>
    </>
  );
}

/** A card with a title and whether it applies to the whole family or only this device. */
export function SettingsCard(
  { title, scope, description, children }: {
    title: string;
    scope?: "family" | "device";
    description?: ReactNode;
    children: ReactNode;
  },
) {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {description && (
            <div className="mt-1 text-sm text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        {scope && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {scope === "family" ? <Users className="size-3" /> : <Laptop className="size-3" />}
            {t(
              scope === "family" ? "settings.family_scope" : "settings.device_scope",
            )}
          </span>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** A labeled row inside a settings card. */
export function Field(
  { label, help, children }: {
    label: string;
    help?: ReactNode;
    children: ReactNode;
  },
) {
  return (
    <div className="grid gap-1.5">
      <div className="text-sm font-medium">{label}</div>
      {children}
      {help && <div className="text-xs text-muted-foreground">{help}</div>}
    </div>
  );
}
