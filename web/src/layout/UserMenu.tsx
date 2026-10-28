import { ChevronsUpDown, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useNavigate } from "react-router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import { clearSession, useAuth, type User } from "@/lib/auth";
import { t } from "@/lib/i18n";

/** Up to two letters of the name (or the email). */
function initials(user: User): string {
  const words = (user.name || user.email).split(/[\s@._-]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

/** Signs out on the server (ends the session) and on this device. */
export async function signOut() {
  try {
    await api.logout();
  } catch {
    // offline: the token is forgotten here anyway
  }
  clearSession();
}

/** The signed-in user with Account, Administration (admins) and Sign out. `compact`: only
 *  the avatar (page headers); otherwise a sidebar row with name and email. */
export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { me } = useAuth();
  const navigate = useNavigate();
  if (!me) return null;
  const { user } = me;
  const avatar = (
    <Avatar size="sm" className="size-8">
      <AvatarFallback className="bg-primary/10 font-medium text-primary">
        {initials(user)}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact
          ? (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label={t("user.menu")}
            >
              {avatar}
            </Button>
          )
          : (
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent"
              tooltip={user.name || user.email}
            >
              {avatar}
              <div className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate font-medium">
                  {user.name || user.email}
                </span>
                {user.name && (
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                )}
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="min-w-56"
        align="end"
        side={compact ? "bottom" : "top"}
      >
        <DropdownMenuLabel className="font-normal">
          <div className="truncate font-medium">{user.name || user.email}</div>
          {user.name && (
            <div className="truncate text-xs text-muted-foreground">
              {user.email}
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/account")}>
          <UserRound className="size-4" /> {t("user.account")}
        </DropdownMenuItem>
        {user.isAdmin && (
          <DropdownMenuItem onSelect={() => navigate("/admin")}>
            <ShieldCheck className="size-4" /> {t("nav.admin")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await signOut();
            navigate("/login");
          }}
        >
          <LogOut className="size-4" /> {t("user.sign_out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
