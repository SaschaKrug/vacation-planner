import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StandalonePage } from "@/layout/StandalonePage";
import { api, ApiError, isConfigured } from "@/lib/api";
import { type Me, needsSetup, setSession, useAuth } from "@/lib/auth";
import { t, useLang } from "@/lib/i18n";
import {
  cancelled,
  passkeysSupported,
  signInWithPasskey,
  stopPasskeyAutofill,
} from "@/lib/passkeys";

/** Where to go after signing in: back where the user wanted to go (only paths of this app). */
function nextPath(params: URLSearchParams): string {
  const next = params.get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function errorText(err: unknown): string {
  const e = err as ApiError;
  if (e.status === 429) return t("toast.rate_limited");
  if (e.status === 401) {
    return e.message.includes("passkey") ? t("auth.passkey_unknown") : t("auth.wrong");
  }
  return t("auth.failed", { msg: e.message });
}

/** Sign in with a passkey (button, or the email field's autofill) or email and password. */
export function LoginPage() {
  useLang();
  const { token } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const passkeys = passkeysSupported();

  const done = (me: Me) =>
    navigate(needsSetup(me.user) ? "/account" : nextPath(params), {
      replace: true,
    });

  // Passkeys offered in the email field's suggestions, where the browser supports it.
  useEffect(() => {
    if (!passkeys || token) return;
    // It runs in the background: only the server's answer to a picked passkey is news (the
    // browser may not support it, or there's no passkey to offer).
    signInWithPasskey(true).then(done).catch((err) => {
      if (err instanceof ApiError) setError(errorText(err));
    });
    return () => stopPasskeyAutofill();
  }, []);

  if (token) return <Navigate to={nextPath(params)} replace />;

  async function withPassword(e: React.FormEvent) {
    e.preventDefault();
    stopPasskeyAutofill();
    setBusy(true);
    setError("");
    try {
      const { token, ...me } = await api.login(email, password);
      setSession(token, me);
      done(me);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function withPasskey() {
    stopPasskeyAutofill();
    setBusy(true);
    setError("");
    try {
      done(await signInWithPasskey());
    } catch (err) {
      if (!cancelled(err)) setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <StandalonePage signedIn={false}>
      <div className="mx-auto max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {t("auth.title")}
        </h1>
        <p className="mt-2 text-muted-foreground">{t("auth.lead")}</p>
        {!isConfigured() && (
          <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {t("landing.config_warning")}
          </p>
        )}
        {passkeys && (
          <>
            <Button
              size="lg"
              className="mt-7 h-11 w-full text-base"
              disabled={busy}
              onClick={withPasskey}
            >
              <KeyRound /> {t("auth.passkey")}
            </Button>
            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground uppercase">
              <span className="h-px flex-1 bg-border" />
              {t("auth.or_password")}
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}
        <form
          className={passkeys ? "grid gap-4" : "mt-7 grid gap-4"}
          onSubmit={withPassword}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="login-email">{t("auth.email")}</Label>
            <Input
              id="login-email"
              autoComplete="username webauthn"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="login-password">{t("auth.password")}</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant={passkeys ? "outline" : "default"}
            disabled={busy}
          >
            {t("auth.sign_in")}
          </Button>
        </form>
        <p className="mt-8 text-sm text-muted-foreground">
          {t("auth.no_account")}
        </p>
      </div>
    </StandalonePage>
  );
}
