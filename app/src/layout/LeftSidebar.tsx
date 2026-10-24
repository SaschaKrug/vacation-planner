import {
  CalendarDays,
  Check,
  ChevronsUpDown,
  CircleHelp,
  Link2,
  Plus,
  Settings,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { api, ApiError } from "@/lib/api";
import { getLang, t } from "@/lib/i18n";
import { useRecentFamilies } from "@/lib/recent";
import { setHelpOpen } from "@/lib/ui";

/** Turns a pasted link (new /f/<id>/… or old ?s=<id>) or a bare id into the family id. */
export function tokenFromInput(value: string): string {
  const v = value.trim();
  try {
    const url = new URL(v);
    return url.pathname.match(/\/f\/([A-Za-z0-9]+)/)?.[1] ??
      url.searchParams.get("s") ?? v;
  } catch {
    return v; // not a URL, use as id
  }
}

export function LeftSidebar() {
  const store = usePlanner();
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
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function accessLabel(access: string | undefined) {
  if (access === "view") return t("family.view_only");
  if (access === "calendar") return t("family.calendar_only");
  return "";
}

function FamilySwitcher() {
  const store = usePlanner();
  const recent = useRecentFamilies();
  const navigate = useNavigate();
  const [openLink, setOpenLink] = useState(false);
  const [creating, setCreating] = useState(false);
  const name = store.family?.name ?? t("family.loading");

  async function create() {
    setCreating(true);
    try {
      const data = await api.createFamily({
        lang: getLang(),
        year: store.year,
      });
      navigate(`/f/${data.family.id}/vacation`);
    } catch (err) {
      const e = err as ApiError;
      toast(
        e.status === 429 ? t("toast.rate_limited") : t("toast.create_failed", { msg: e.message }),
      );
    } finally {
      setCreating(false);
    }
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
                  {accessLabel(store.family?.access) || t("app.title")}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-64" align="start" side="bottom">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t("family.recent")}
            </DropdownMenuLabel>
            {recent.map((f) => (
              <DropdownMenuItem
                key={f.token}
                onSelect={() => navigate(`/f/${f.token}/vacation`)}
              >
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {f.readOnly && (
                  <span className="text-xs text-muted-foreground">
                    {t("family.view_only")}
                  </span>
                )}
                {f.token === store.token && <Check className="size-4" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={creating} onSelect={create}>
              <Plus className="size-4" /> {t("family.new")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setOpenLink(true)}>
              <Link2 className="size-4" /> {t("family.open")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <OpenFamilyDialog open={openLink} onOpenChange={setOpenLink} />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function OpenFamilyDialog(
  { open, onOpenChange }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  },
) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const token = tokenFromInput(value);
            if (!token) return;
            onOpenChange(false);
            setValue("");
            navigate(`/f/${token}/vacation`);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("family.open_title")}</DialogTitle>
            <DialogDescription>{t("family.open_help")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("landing.open_placeholder")}
          />
          <DialogFooter>
            <Button type="submit">{t("landing.open")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
