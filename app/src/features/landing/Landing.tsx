import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StandalonePage } from "@/layout/StandalonePage";
import { api, ApiError } from "@/lib/api";
import { lastFamily, useAuth } from "@/lib/auth";
import { getLang, t, useLang } from "@/lib/i18n";
import { refreshMe } from "@/features/auth/RequireAuth";

/** Creates a family with the user as its editor and opens it. */
export async function createFamily(
  navigate: (to: string) => void,
  year: number,
) {
  try {
    const data = await api.createFamily({ lang: getLang(), year });
    await refreshMe();
    navigate(`/f/${data.family.id}/vacation`);
  } catch (err) {
    const e = err as ApiError;
    toast(
      e.status === 429 ? t("toast.rate_limited") : t("toast.create_failed", { msg: e.message }),
    );
  }
}

/** The start page: opens the family used last on this device (or the first one); without
 *  any, says how to get one. Old links (?s=<id>&y=<year>) go to that family. */
export function Landing() {
  useLang();
  const [params] = useSearchParams();
  const { me } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const legacy = params.get("s");
  if (legacy) {
    const y = params.get("y");
    return <Navigate to={`/f/${legacy}/vacation${y ? `?y=${y}` : ""}`} replace />;
  }
  const families = me?.families ?? [];
  const last = lastFamily();
  const open = families.find((f) => f.id === last) ?? families[0];
  if (open) return <Navigate to={`/f/${open.id}/vacation`} replace />;

  return (
    <StandalonePage>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        {t("home.welcome", { name: me?.user.name || me?.user.email || "" })}
      </h1>
      <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
        {t("home.no_family", { email: me?.user.email ?? "" })}
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Button
          size="lg"
          className="h-12 px-6 text-base"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await createFamily(navigate, new Date().getFullYear());
            setBusy(false);
          }}
        >
          {t("landing.create")}
        </Button>
        {me?.user.isAdmin && (
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-12 px-6 text-base"
          >
            <Link to="/admin">
              <ShieldCheck /> {t("nav.admin")}
            </Link>
          </Button>
        )}
      </div>
    </StandalonePage>
  );
}
