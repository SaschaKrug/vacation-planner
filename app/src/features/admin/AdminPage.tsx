import { ExternalLink, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, Navigate, NavLink, useParams } from "react-router";
import { toast } from "sonner";
import { confirm } from "@/components/confirm";
import { CopyField } from "@/components/CopyField";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/features/settings/SettingsPage";
import { refreshMe } from "@/features/auth/RequireAuth";
import { StandalonePage } from "@/layout/StandalonePage";
import { type AdminFamily, type AdminUser, api, type ApiError } from "@/lib/api";
import { type MemberRole, useAuth } from "@/lib/auth";
import { getLang, type Lang, LANGS, t, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TABS = ["users", "families"] as const;

function failed(err: unknown) {
  const e = err as ApiError;
  toast(
    e.status === 409 ? t("account.email_taken") : t("admin.failed", { msg: e.message }),
  );
}

function setupUrl(token: string) {
  return `${location.origin}/#/setup/${token}`;
}

function roleLabel(role: MemberRole) {
  return t(role === "editor" ? "members.editor" : "members.viewer");
}

/** /admin/users and /admin/families: accounts, families and who is a member where. */
export function AdminPage() {
  useLang();
  const { tab = "users" } = useParams();
  const { me } = useAuth();
  if (!me?.user.isAdmin) return <Navigate to="/" replace />;
  if (!TABS.includes(tab as typeof TABS[number])) {
    return <Navigate to="/admin" replace />;
  }

  return (
    <StandalonePage wide>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("nav.admin")}</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/">{t("account.back")}</Link>
        </Button>
      </div>
      <nav className="mb-6 flex gap-1 border-b" aria-label={t("nav.admin")}>
        {TABS.map((id) => (
          <NavLink
            key={id}
            to={`/admin/${id}`}
            className={({ isActive }) =>
              cn(
                "-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground",
                (isActive || (id === "users" && tab === "users")) &&
                  "border-primary text-foreground",
              )}
          >
            {t(`admin.${id}`)}
          </NavLink>
        ))}
      </nav>
      {tab === "users" ? <UsersTab /> : <FamiliesTab />}
    </StandalonePage>
  );
}

/** The admin data, loaded once and after every change. */
function useAdminData() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [families, setFamilies] = useState<AdminFamily[] | null>(null);
  const reload = useCallback(async () => {
    try {
      const [u, f] = await Promise.all([api.adminUsers(), api.adminFamilies()]);
      setUsers(u);
      setFamilies(f);
    } catch (err) {
      failed(err);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { users, families, reload };
}

function Row({ children }: { children: ReactNode }) {
  return <li className="flex items-start gap-3 px-4 py-3">{children}</li>;
}

// ------------------------------------------------------------------------------ users

function UsersTab() {
  const { me } = useAuth();
  const { users, reload } = useAdminData();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [link, setLink] = useState<{ name: string; token: string } | null>(
    null,
  );

  async function newLink(user: AdminUser) {
    try {
      const { setupToken } = await api.adminSetupLink(user.id);
      setLink({ name: user.name || user.email, token: setupToken });
      reload();
    } catch (err) {
      failed(err);
    }
  }

  async function remove(user: AdminUser) {
    const ok = await confirm(
      t("admin.user_delete_confirm", { name: user.name || user.email }),
      t("account.delete"),
    );
    if (!ok) return;
    try {
      await api.adminDeleteUser(user.id);
      reload();
    } catch (err) {
      failed(err);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("admin.users_help")}</p>
        <Button onClick={() => setCreating(true)}>
          <Plus /> {t("admin.user_new")}
        </Button>
      </div>
      {users && (
        <ul className="divide-y rounded-xl border bg-card">
          {users.map((user) => (
            <Row key={user.id}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-medium">
                    {user.name || user.email}
                  </span>
                  {user.name && (
                    <span className="truncate text-sm text-muted-foreground">
                      {user.email}
                    </span>
                  )}
                  {user.isAdmin && <Badge variant="secondary">{t("admin.admin")}</Badge>}
                  {user.id === me?.user.id && <Badge variant="outline">{t("admin.you")}</Badge>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {signInText(user)}
                </div>
                {user.families.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {user.families.map((f) => (
                      <Badge
                        key={f.id}
                        variant="outline"
                        className="font-normal"
                      >
                        {f.name} · {roleLabel(f.role)}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("admin.actions")}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(user)}>
                    {t("admin.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => newLink(user)}>
                    {t("admin.setup_link")}
                  </DropdownMenuItem>
                  {user.id !== me?.user.id && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => remove(user)}
                      >
                        <Trash2 className="size-4" /> {t("account.delete")}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </Row>
          ))}
        </ul>
      )}
      <UserDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(user, token) => {
          setCreating(false);
          reload();
          if (token) setLink({ name: user.name || user.email, token });
        }}
      />
      <UserDialog
        user={editing ?? undefined}
        self={editing?.id === me?.user.id}
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
          refreshMe();
        }}
      />
      <Dialog open={!!link} onOpenChange={(open) => !open && setLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.link_title")}</DialogTitle>
            <DialogDescription>
              {t("admin.link_help", { name: link?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <CopyField
            value={link ? setupUrl(link.token) : ""}
            label={t("admin.link_title")}
          />
          <DialogFooter>
            <Button onClick={() => setLink(null)}>{t("account.done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** How the user signs in, or that the setup is still open. */
function signInText(user: AdminUser): string {
  const ways = [
    user.passkeys ? t("admin.passkeys", { n: user.passkeys }) : "",
    user.hasPassword ? t("account.password") : "",
  ].filter(Boolean);
  const how = ways.length
    ? ways.join(" · ")
    : t(user.setupPending ? "admin.setup_pending" : "admin.not_set_up");
  return user.lastSignIn
    ? `${how} · ${
      t("admin.last_sign_in", {
        date: new Date(user.lastSignIn).toLocaleDateString(getLang()),
      })
    }`
    : how;
}

/** New user (then their setup link), or changes to one. */
function UserDialog(
  { user, self = false, open, onOpenChange, onSaved }: {
    user?: AdminUser;
    self?: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: (user: AdminUser, setupToken?: string) => void;
  },
) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setEmail(user?.email ?? "");
    setName(user?.name ?? "");
    setIsAdmin(user?.isAdmin ?? false);
  }, [open, user]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (user) {
        onSaved(await api.adminUpdateUser(user.id, { email, name, isAdmin }));
      } else {
        const res = await api.adminCreateUser({ email, name, isAdmin });
        onSaved(res.user, res.setupToken);
      }
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={save}>
          <DialogHeader>
            <DialogTitle>
              {t(user ? "admin.user_edit" : "admin.user_new")}
            </DialogTitle>
            {!user && <DialogDescription>{t("admin.user_new_help")}</DialogDescription>}
          </DialogHeader>
          <Field label={t("auth.email")} help={t("admin.email_help")}>
            <Input
              autoFocus
              required
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={t("account.name")}>
            <Input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="font-medium">{t("admin.admin")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("admin.admin_help")}
              </span>
            </span>
            <Switch
              checked={isAdmin}
              disabled={self}
              onCheckedChange={setIsAdmin}
            />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {t(user ? "account.save" : "admin.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------ families

function FamiliesTab() {
  const { me } = useAuth();
  const { users, families, reload } = useAdminData();
  const [creating, setCreating] = useState(false);
  const [membersOf, setMembersOf] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<AdminFamily | null>(null);

  async function remove(family: AdminFamily) {
    if (
      !(await confirm(
        t("admin.family_delete_confirm", { name: family.name }),
        t("account.delete"),
      ))
    ) {
      return;
    }
    try {
      await api.adminDeleteFamily(family.id);
      reload();
      refreshMe();
    } catch (err) {
      failed(err);
    }
  }

  const editing = families?.find((f) => f.id === membersOf);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("admin.families_help")}
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus /> {t("family.new")}
        </Button>
      </div>
      {families && families.length === 0 && (
        <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {t("admin.no_families")}
        </p>
      )}
      {families && families.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card">
          {families.map((family) => {
            const mine = family.members.some((m) => m.userId === me?.user.id);
            return (
              <Row key={family.id}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{family.name}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {family.members.length
                      ? family.members.map((m) => (
                        <Badge
                          key={m.userId}
                          variant="outline"
                          className="font-normal"
                        >
                          {m.name || m.email} · {roleLabel(m.role)}
                        </Badge>
                      ))
                      : (
                        <span className="text-xs text-muted-foreground">
                          {t("admin.no_members")}
                        </span>
                      )}
                  </div>
                </div>
                {mine && (
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    aria-label={t("admin.open")}
                  >
                    <Link to={`/f/${family.id}/vacation`}>
                      <ExternalLink />
                    </Link>
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("admin.actions")}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setMembersOf(family.id)}>
                      {t("members.title")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setRenaming(family)}
                    >
                      {t("admin.rename")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => remove(family)}
                    >
                      <Trash2 className="size-4" /> {t("account.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Row>
            );
          })}
        </ul>
      )}
      <NewFamilyDialog
        users={users ?? []}
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => {
          setCreating(false);
          reload();
          refreshMe();
        }}
      />
      <RenameDialog
        family={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={() => {
          setRenaming(null);
          reload();
          refreshMe();
        }}
      />
      {editing && (
        <MembersDialog
          family={editing}
          users={users ?? []}
          onClose={() => setMembersOf(null)}
          onChanged={() => {
            reload();
            refreshMe();
          }}
        />
      )}
    </>
  );
}

function RenameDialog(
  { family, onClose, onRenamed }: {
    family: AdminFamily | null;
    onClose: () => void;
    onRenamed: () => void;
  },
) {
  const [name, setName] = useState("");
  useEffect(() => setName(family?.name ?? ""), [family]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!family || !name.trim()) return;
    if (name.trim() === family.name) return onClose();
    try {
      await api.adminRenameFamily(family.id, name.trim());
      onRenamed();
    } catch (err) {
      failed(err);
    }
  }

  return (
    <Dialog open={!!family} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={save}>
          <DialogHeader>
            <DialogTitle>{t("admin.rename")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            required
            maxLength={80}
            aria-label={t("settings.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <DialogFooter>
            <Button type="submit">{t("account.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A role, or (with `none`) not a member. */
function RoleSelect(
  { value, onChange, none = false }: {
    value: MemberRole | "";
    onChange: (role: MemberRole | "") => void;
    none?: boolean;
  },
) {
  return (
    <Select
      value={value || "none"}
      onValueChange={(v) => onChange(v === "none" ? "" : v as MemberRole)}
    >
      <SelectTrigger className="w-36" aria-label={t("members.role")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {none && <SelectItem value="none">{t("admin.not_member")}</SelectItem>}
        <SelectItem value="editor">{t("members.editor")}</SelectItem>
        <SelectItem value="viewer">{t("members.viewer")}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function NewFamilyDialog(
  { users, open, onOpenChange, onCreated }: {
    users: AdminUser[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: () => void;
  },
) {
  const [name, setName] = useState("");
  const [lang, setLangValue] = useState<Lang>(getLang());
  const [roles, setRoles] = useState<Record<string, MemberRole | "">>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName("");
    setLangValue(getLang());
    setRoles({});
  }, [open]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const members = Object.entries(roles).filter(([, role]) => role)
        .map(([userId, role]) => ({ userId, role: role as MemberRole }));
      await api.adminCreateFamily({ name: name.trim(), lang, members });
      onCreated();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <form className="grid gap-4" onSubmit={create}>
          <DialogHeader>
            <DialogTitle>{t("family.new")}</DialogTitle>
            <DialogDescription>{t("admin.family_new_help")}</DialogDescription>
          </DialogHeader>
          <Field label={t("settings.name")}>
            <Input
              autoFocus
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            label={t("settings.language")}
            help={t("admin.family_lang_help")}
          >
            <Select value={lang} onValueChange={(v) => setLangValue(v as Lang)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LANGS).map(([code, label]) => (
                  <SelectItem key={code} value={code}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("members.title")}>
            <ul className="divide-y rounded-lg border">
              {users.map((user) => (
                <li key={user.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {user.name || user.email}
                  </span>
                  <RoleSelect
                    none
                    value={roles[user.id] ?? ""}
                    onChange={(role) => setRoles({ ...roles, [user.id]: role })}
                  />
                </li>
              ))}
            </ul>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{t("admin.create")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MembersDialog(
  { family, users, onClose, onChanged }: {
    family: AdminFamily;
    users: AdminUser[];
    onClose: () => void;
    onChanged: () => void;
  },
) {
  const [adding, setAdding] = useState("");
  const [role, setRole] = useState<MemberRole>("editor");
  const others = users.filter((u) => !family.members.some((m) => m.userId === u.id));

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      onChanged();
    } catch (err) {
      failed(err);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("admin.members_of", { name: family.name })}
          </DialogTitle>
          <DialogDescription>{t("members.roles_help")}</DialogDescription>
        </DialogHeader>
        {family.members.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {family.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {m.name || m.email}
                </span>
                <RoleSelect
                  value={m.role}
                  onChange={(next) =>
                    next && run(() =>
                      api.adminSetMember(family.id, m.userId, next)
                    )}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("members.remove")}
                  onClick={() => run(() => api.adminRemoveMember(family.id, m.userId))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {others.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={adding} onValueChange={setAdding}>
              <SelectTrigger
                className="min-w-0 flex-1"
                aria-label={t("members.add")}
              >
                <SelectValue placeholder={t("admin.pick_user")} />
              </SelectTrigger>
              <SelectContent>
                {others.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name || u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <RoleSelect value={role} onChange={(r) => r && setRole(r)} />
            <Button
              variant="outline"
              disabled={!adding}
              onClick={() =>
                run(async () => {
                  await api.adminSetMember(family.id, adding, role);
                  setAdding("");
                })}
            >
              <Plus /> {t("members.add")}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>{t("account.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
