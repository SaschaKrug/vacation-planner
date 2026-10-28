import { LogOut, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { confirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { refreshMe } from "@/features/auth/RequireAuth";
import { usePlanner } from "@/features/family/context";
import { api, type ApiError, type Member } from "@/lib/api";
import type { MemberRole } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { SettingsCard } from "./SettingsPage";

function RoleSelect(
  { value, onChange, label }: {
    value: MemberRole;
    onChange: (role: MemberRole) => void;
    label: string;
  },
) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as MemberRole)}>
      <SelectTrigger className="w-32 shrink-0" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="editor">{t("members.editor")}</SelectItem>
        <SelectItem value="viewer">{t("members.viewer")}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Who belongs to the family: editors add people by the email of their account, change
 *  roles and remove members; everyone can leave. */
export function MembersSection() {
  const store = usePlanner();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("editor");
  const edit = !store.readOnly;

  useEffect(() => {
    api.members(store.token).then(setMembers).catch((err: ApiError) =>
      toast(t("members.failed", { msg: err.message }))
    );
  }, [store.token]);

  async function change(action: () => Promise<Member[]>) {
    try {
      setMembers(await action());
      return true;
    } catch (err) {
      const e = err as ApiError;
      toast(
        e.status === 404 ? t("members.no_account") : t("members.failed", { msg: e.message }),
      );
      return false;
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await change(() => api.addMember(store.token, email.trim(), role))) {
      setEmail("");
    }
  }

  async function remove(member: Member) {
    if (member.you) {
      if (
        !(await confirm(
          t("members.leave_confirm", { name: store.family?.name ?? "" }),
          t("members.leave"),
        ))
      ) {
        return;
      }
      if (await change(() => api.removeMember(store.token, member.userId))) {
        await refreshMe();
        navigate("/", { replace: true });
      }
      return;
    }
    const name = member.name || member.email;
    if (
      !(await confirm(
        t("members.remove_confirm", { name }),
        t("members.remove"),
      ))
    ) return;
    await change(() => api.removeMember(store.token, member.userId));
  }

  return (
    <SettingsCard
      title={t("members.title")}
      scope="family"
      description={t("members.roles_help")}
    >
      {members && (
        <ul className="divide-y rounded-lg border">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {m.name || m.email}
                  {m.you && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      {t("members.you")}
                    </span>
                  )}
                </div>
                {m.name && (
                  <div className="truncate text-xs text-muted-foreground">
                    {m.email}
                  </div>
                )}
              </div>
              {edit
                ? (
                  <RoleSelect
                    value={m.role}
                    label={t("members.role")}
                    onChange={(next) =>
                      change(() => api.setMemberRole(store.token, m.userId, next))}
                  />
                )
                : (
                  <span className="text-sm text-muted-foreground">
                    {t(
                      m.role === "editor" ? "members.editor" : "members.viewer",
                    )}
                  </span>
                )}
              {(edit || m.you) && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t(m.you ? "members.leave" : "members.remove")}
                  title={t(m.you ? "members.leave" : "members.remove")}
                  onClick={() => remove(m)}
                >
                  {m.you ? <LogOut /> : <Trash2 />}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <form className="flex flex-wrap gap-2" onSubmit={add}>
          <Input
            className="min-w-0 flex-1 basis-48"
            type="text"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder={t("members.email")}
            aria-label={t("members.email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <RoleSelect
            value={role}
            onChange={setRole}
            label={t("members.role")}
          />
          <Button type="submit" variant="outline">
            <Plus /> {t("members.add")}
          </Button>
        </form>
      )}
    </SettingsCard>
  );
}
