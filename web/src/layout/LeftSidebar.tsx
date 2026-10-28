import {
  CalendarDays,
  Check,
  ChevronsUpDown,
  CircleHelp,
  Plus,
  Settings,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { usePlanner } from "@/features/family/context";
import { createFamily } from "@/features/landing/Landing";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { setHelpOpen } from "@/lib/ui";
import { UserMenu } from "./UserMenu";

export function LeftSidebar() {
  const store = usePlanner();
  const { me } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const base = `/f/${store.token}`;
  const closeOnMobile = () => isMobile && setOpenMobile(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <FamilySwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("nav.planning")}</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <NavLink to={`${base}/vacation`} onClick={closeOnMobile}>
                {({ isActive }) => (
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={t("nav.vacation")}
                  >
                    <span>
                      <CalendarDays />
                      <span>{t("nav.vacation")}</span>
                    </span>
                  </SidebarMenuButton>
                )}
              </NavLink>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <NavLink to={`${base}/finance`} onClick={closeOnMobile}>
                {({ isActive }) => (
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={t("nav.finance")}
                  >
                    <span>
                      <Wallet />
                      <span>{t("nav.finance")}</span>
                    </span>
                  </SidebarMenuButton>
                )}
              </NavLink>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t("nav.help")}
              onClick={() => {
                closeOnMobile();
                setHelpOpen(true);
              }}
            >
              <CircleHelp />
              <span>{t("nav.help")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <NavLink to={`${base}/settings`} onClick={closeOnMobile}>
              {({ isActive }) => (
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  tooltip={t("nav.settings")}
                >
                  <span>
                    <Settings />
                    <span>{t("nav.settings")}</span>
                  </span>
                </SidebarMenuButton>
              )}
            </NavLink>
          </SidebarMenuItem>
          {me?.user.isAdmin && (
            <SidebarMenuItem>
              <NavLink to="/admin" onClick={closeOnMobile}>
                <SidebarMenuButton asChild tooltip={t("nav.admin")}>
                  <span>
                    <ShieldCheck />
                    <span>{t("nav.admin")}</span>
                  </span>
                </SidebarMenuButton>
              </NavLink>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function FamilySwitcher() {
  const store = usePlanner();
  const { me } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const name = store.family?.name ?? t("family.loading");

  async function create() {
    setCreating(true);
    await createFamily(navigate, store.year);
    setCreating(false);
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent"
              tooltip={t("family.switch")}
            >
              <img
                src="/favicon.svg"
                alt=""
                className="size-8 shrink-0 rounded-lg"
              />
              <div className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {store.readOnly && store.family ? t("family.view_only") : t("app.title")}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-64" align="start" side="bottom">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t("family.yours")}
            </DropdownMenuLabel>
            {me?.families.map((f) => (
              <DropdownMenuItem
                key={f.id}
                onSelect={() => navigate(`/f/${f.id}/vacation`)}
              >
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {f.role === "viewer" && (
                  <span className="text-xs text-muted-foreground">
                    {t("family.view_only")}
                  </span>
                )}
                {f.id === store.token && <Check className="size-4" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={creating} onSelect={create}>
              <Plus className="size-4" /> {t("family.new")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
