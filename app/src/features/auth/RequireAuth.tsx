import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { needsSetup, setMe, useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";

/** Loads the account again (e.g. after someone added the user to a family). */
export async function refreshMe() {
  try {
    setMe(await api.me());
  } catch {
    // a 401 signs out by itself; offline keeps what we have
  }
}

/** Everything but the sign-in pages: without a session, off to sign in (and back here after
 *  it); an account that isn't set up yet goes to its account page first. */
export function RequireAuth() {
  const { token, me } = useAuth();
  const location = useLocation();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token || me) return;
    let stale = false;
    setError("");
    api.me().then((data) => !stale && setMe(data)).catch((err: ApiError) => {
      if (!stale && err.status !== 401) setError(err.message);
    });
    return () => {
      stale = true;
    };
  }, [token, me, attempt]);

  // Families someone else added this user to show up when the app comes back to the front.
  useEffect(() => {
    if (!token) return;
    const onVisible = () => document.visibilityState === "visible" && refreshMe();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [token]);

  if (!token) {
    const next = location.pathname + location.search;
    return (
      <Navigate
        to={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`}
        replace
      />
    );
  }
  if (!me) {
    return (
      <div className="grid min-h-svh place-items-center p-6 text-center text-sm text-muted-foreground">
        {error
          ? (
            <div className="grid justify-items-center gap-3">
              <p>{t("auth.load_failed", { msg: error })}</p>
              <Button
                variant="outline"
                onClick={() => setAttempt((n) => n + 1)}
              >
                {t("auth.retry")}
              </Button>
            </div>
          )
          : t("family.loading")}
      </div>
    );
  }
  if (needsSetup(me.user) && location.pathname !== "/account") {
    return <Navigate to="/account" replace />;
  }
  return <Outlet />;
}
