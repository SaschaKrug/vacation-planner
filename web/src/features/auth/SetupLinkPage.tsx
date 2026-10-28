import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { StandalonePage } from "@/layout/StandalonePage";
import { api, ApiError } from "@/lib/api";
import { clearSession, type Me, setSession } from "@/lib/auth";
import { t, useLang } from "@/lib/i18n";

// A link works once: React's development double effects must not use it up twice.
const opened = new Map<string, Promise<Me & { token: string }>>();

/** /setup/<token>: a one-time link from an admin. It signs in, then the account page asks for
 *  a passkey or a password (a new one without the old one, for a forgotten password). */
export function SetupLinkPage() {
  useLang();
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let pending = opened.get(token);
    if (!pending) {
      pending = api.openSetupLink(token);
      opened.set(token, pending);
    }
    pending.then(({ token: session, ...me }) => {
      // Whoever was signed in on this device before, it's this account now.
      clearSession();
      setSession(session, me);
      navigate(`/account?reset=${me.user.hasPassword ? 1 : 0}`, {
        replace: true,
      });
    }).catch((err: ApiError) => setError(err.message));
  }, [token, navigate]);

  return (
    <StandalonePage signedIn={false}>
      <div className="mx-auto max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("setup.title")}
        </h1>
        {error
          ? (
            <>
              <p role="alert" className="mt-4 text-destructive">{error}</p>
              <Button asChild variant="outline" className="mt-6">
                <Link to="/login">{t("auth.sign_in")}</Link>
              </Button>
            </>
          )
          : <p className="mt-4 text-muted-foreground">{t("family.loading")}</p>}
      </div>
    </StandalonePage>
  );
}
