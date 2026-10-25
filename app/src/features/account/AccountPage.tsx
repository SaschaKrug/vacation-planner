import { KeyRound, LogOut, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { confirm } from "@/components/confirm";
import { CopyField } from "@/components/CopyField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, SettingsCard } from "@/features/settings/SettingsPage";
import { StandalonePage } from "@/layout/StandalonePage";
import { signOut } from "@/layout/UserMenu";
import { api, apiBase, type ApiError, type ApiToken, type Passkey } from "@/lib/api";
import { needsSetup, setMe, useAuth, type User } from "@/lib/auth";
import { getLang, t, useLang } from "@/lib/i18n";
import { addPasskey, cancelled, deviceName, passkeysSupported } from "@/lib/passkeys";

const MIN_PASSWORD = 8;

function date(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(getLang()) : "–";
}

/** The account: on the first visit after a setup link (or with the initial admin password)
 *  only what's needed to sign in again; otherwise profile, passkeys, password, API tokens. */
export function AccountPage() {
  useLang();
  const { me } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  if (!me) return null;
  const { user } = me;
  // Came from a setup link: a new password doesn't need the old one.
  const reset = params.get("reset") === "1";

  if (needsSetup(user)) {
    return (
      <StandalonePage>
        <SetupAccount user={user} reset={reset} />
      </StandalonePage>
    );
  }

  return (
    <StandalonePage>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("user.account")}
        </h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/">{t("account.back")}</Link>
        </Button>
      </div>
      <div className="space-y-6">
        <ProfileCard user={user} />
        <PasskeysCard user={user} />
        <PasswordCard user={user} reset={reset} />
        <TokensCard />
        <Button
          variant="outline"
          onClick={async () => {
            await signOut();
            navigate("/login");
          }}
        >
          <LogOut /> {t("user.sign_out")}
        </Button>
      </div>
    </StandalonePage>
  );
}

/** First things first: the initial password replaced, or a first passkey or password. */
function SetupAccount({ user, reset }: { user: User; reset: boolean }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const finish = () => navigate("/", { replace: true });

  if (user.mustChangePassword) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("account.change_title")}
        </h1>
        <p className="mt-3 text-muted-foreground">{t("account.change_lead")}</p>
        <div className="mt-6 rounded-xl border bg-card p-5 shadow-xs">
          <PasswordForm
            needCurrent
            submit={t("account.save_password")}
            onDone={finish}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">
        {t("account.setup_title", { name: user.name || user.email })}
      </h1>
      <p className="mt-3 text-muted-foreground">
        {t(reset ? "account.reset_lead" : "account.setup_lead", {
          email: user.email,
        })}
      </p>
      {passkeysSupported() && (
        <div className="mt-6 rounded-xl border bg-card p-5 shadow-xs">
          <h2 className="font-semibold">{t("account.passkey_title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("account.passkey_help")}
          </p>
          <Button
            className="mt-4"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await addPasskey(deviceName());
                finish();
              } catch (err) {
                if (!cancelled(err)) {
                  toast(
                    t("account.passkey_failed", {
                      msg: (err as Error).message,
                    }),
                  );
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            <KeyRound /> {t("account.passkey_create")}
          </Button>
        </div>
      )}
      <div className="mt-6 rounded-xl border bg-card p-5 shadow-xs">
        <h2 className="font-semibold">
          {t(passkeysSupported() ? "account.or_password" : "account.password")}
        </h2>
        <div className="mt-4">
          <PasswordForm submit={t("account.save_password")} onDone={finish} />
        </div>
      </div>
    </>
  );
}

/** New password (twice), and the current one if needed. */
function PasswordForm(
  { needCurrent = false, submit, onDone }: {
    needCurrent?: boolean;
    submit: string;
    onDone?: () => void;
  },
) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      return setError(t("account.password_short", { n: MIN_PASSWORD }));
    }
    if (password !== repeat) return setError(t("account.password_mismatch"));
    setBusy(true);
    setError("");
    try {
      setMe(await api.setPassword(password, needCurrent ? current : undefined));
      setCurrent("");
      setPassword("");
      setRepeat("");
      toast(t("account.password_saved"));
      onDone?.();
    } catch (err) {
      const e = err as ApiError;
      setError(e.status === 403 ? t("account.current_wrong") : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-3" onSubmit={save}>
      {needCurrent && (
        <Field label={t("account.current_password")}>
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
      )}
      <Field
        label={t("account.new_password")}
        help={t("account.password_help", { n: MIN_PASSWORD })}
      >
        <Input
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label={t("account.repeat_password")}>
        <Input
          type="password"
          autoComplete="new-password"
          required
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="justify-self-start" disabled={busy}>
        {submit}
      </Button>
    </form>
  );
}

function ProfileCard({ user }: { user: User }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(user.name);
    setEmail(user.email);
  }, [user.name, user.email]);
  const changed = name.trim() !== user.name ||
    email.trim().toLowerCase() !== user.email;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setMe(await api.updateMe({ name, email }));
      toast(t("account.saved"));
    } catch (err) {
      const e = err as ApiError;
      toast(
        e.status === 409 ? t("account.email_taken") : t("account.save_failed", { msg: e.message }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard title={t("account.profile")}>
      <form className="grid gap-3" onSubmit={save}>
        <Field label={t("account.name")}>
          <Input
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t("auth.email")} help={t("account.email_help")}>
          <Input
            value={email}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Button
          type="submit"
          className="justify-self-start"
          disabled={busy || !changed}
        >
          {t("account.save")}
        </Button>
      </form>
    </SettingsCard>
  );
}

function PasskeysCard({ user }: { user: User }) {
  const [list, setList] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = () => api.passkeys().then(setList).catch(() => setList([]));
  useEffect(() => {
    reload();
  }, [user.passkeys]);

  async function add() {
    setBusy(true);
    try {
      await addPasskey(deviceName());
      toast(t("account.passkey_added"));
    } catch (err) {
      if (!cancelled(err)) {
        toast(t("account.passkey_failed", { msg: (err as Error).message }));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(passkey: Passkey) {
    if (
      !(await confirm(
        t("account.passkey_delete_confirm", { name: passkey.name }),
        t("account.delete"),
      ))
    ) {
      return;
    }
    try {
      await api.deletePasskey(passkey.id);
      setMe(await api.me());
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function rename(passkey: Passkey, name: string) {
    if (!name.trim() || name === passkey.name) return;
    try {
      await api.renamePasskey(passkey.id, name.trim());
      reload();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <SettingsCard
      title={t("account.passkeys")}
      description={t("account.passkeys_help")}
    >
      {list && list.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <Input
                  defaultValue={p.name}
                  aria-label={t("account.name")}
                  maxLength={80}
                  className="h-8 border-transparent px-1 shadow-none hover:border-input"
                  onBlur={(e) => rename(p, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                <div className="px-1 text-xs text-muted-foreground">
                  {t("account.used", {
                    created: date(p.createdAt),
                    used: date(p.lastUsedAt),
                  })}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("account.delete")}
                disabled={!user.hasPassword && list.length === 1}
                onClick={() => remove(p)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {passkeysSupported()
        ? (
          <Button
            variant="outline"
            className="justify-self-start"
            disabled={busy}
            onClick={add}
          >
            <Plus /> {t("account.passkey_add")}
          </Button>
        )
        : (
          <p className="text-sm text-muted-foreground">
            {t("account.passkey_unsupported")}
          </p>
        )}
    </SettingsCard>
  );
}

function PasswordCard({ user, reset }: { user: User; reset: boolean }) {
  async function remove() {
    if (
      !(await confirm(
        t("account.password_remove_confirm"),
        t("account.password_remove"),
      ))
    ) return;
    try {
      setMe(await api.removePassword());
    } catch (err) {
      toast((err as Error).message);
    }
  }
  return (
    <SettingsCard
      title={t("account.password")}
      description={t(
        user.hasPassword ? "account.password_set" : "account.password_none",
      )}
    >
      <PasswordForm
        needCurrent={user.hasPassword && !reset}
        submit={t(
          user.hasPassword ? "account.change_password" : "account.save_password",
        )}
      />
      {user.hasPassword && user.passkeys > 0 && (
        <Button
          variant="ghost"
          className="justify-self-start text-destructive"
          onClick={remove}
        >
          {t("account.password_remove")}
        </Button>
      )}
    </SettingsCard>
  );
}

function TokensCard() {
  const [list, setList] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const reload = () => api.apiTokens().then(setList).catch(() => setList([]));
  useEffect(() => {
    reload();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const token = await api.createApiToken(name.trim());
      setCreated(token.token);
      setName("");
      reload();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function remove(token: ApiToken) {
    if (
      !(await confirm(
        t("account.token_delete_confirm", { name: token.name }),
        t("account.delete"),
      ))
    ) {
      return;
    }
    await api.deleteApiToken(token.id).catch((err) => toast(err.message));
    reload();
  }

  return (
    <SettingsCard
      title={t("account.tokens")}
      description={
        <span>
          {t("account.tokens_help")} <code className="text-xs">{apiBase()}</code>
        </span>
      }
    >
      {list && list.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {list.map((token) => (
            <li key={token.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{token.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t("account.used", {
                    created: date(token.createdAt),
                    used: date(token.lastUsedAt),
                  })}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("account.delete")}
                onClick={() => remove(token)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex gap-2" onSubmit={create}>
        <Input
          value={name}
          maxLength={80}
          placeholder={t("account.token_name")}
          aria-label={t("account.token_name")}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="outline">
          <Plus /> {t("account.token_create")}
        </Button>
      </form>
      <Dialog
        open={!!created}
        onOpenChange={(open) => !open && setCreated(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("account.token_created")}</DialogTitle>
            <DialogDescription>{t("account.token_once")}</DialogDescription>
          </DialogHeader>
          <CopyField value={created ?? ""} label={t("account.tokens")} />
          <p className="text-xs text-muted-foreground">
            <code>Authorization: Bearer {"<token>"}</code>
          </p>
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>
              {t("account.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
