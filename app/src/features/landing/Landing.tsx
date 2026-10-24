import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { tokenFromInput } from "@/layout/LeftSidebar";
import { api, ApiError, isConfigured } from "@/lib/api";
import { getLang, type Lang, LANGS, setLang, t, useLang } from "@/lib/i18n";
import { useRecentFamilies } from "@/lib/recent";

/** The start page: create a family, reopen one from this device, or open a link. Old links
 *  (?s=<id>&y=<year>) are forwarded to the family's vacation page. */
export function Landing() {
  const [params] = useSearchParams();
  const lang = useLang();
  const recent = useRecentFamilies();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState("");

  const legacy = params.get("s");
  if (legacy) {
    const y = params.get("y");
    return <Navigate to={`/f/${legacy}/vacation${y ? `?y=${y}` : ""}`} replace />;
  }

  async function create() {
    setBusy(true);
    try {
      const data = await api.createFamily({
        lang: getLang(),
        year: new Date().getFullYear(),
      });
      navigate(`/f/${data.family.id}/vacation`);
    } catch (err) {
      const e = err as ApiError;
      toast(
        e.status === 429 ? t("toast.rate_limited") : t("toast.create_failed", { msg: e.message }),
      );
      setBusy(false);
    }
  }

  return (
    <div className="min-h-svh">
      <header className="flex items-center gap-2.5 px-5 py-3">
        <img src="/favicon.svg" alt="" className="size-8 rounded-lg" />
        <span className="flex-1 font-semibold">{t("app.title")}</span>
        <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
          <SelectTrigger className="w-32" aria-label={t("lang.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(LANGS).map(([code, label]) => (
              <SelectItem key={code} value={code}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>
      <main className="mx-auto max-w-2xl px-5 pt-12 pb-12 sm:pt-16">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {t("landing.title")}
        </h1>
        <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
          {t("landing.lead")}
        </p>
        <Button
          size="lg"
          className="mt-7 h-12 px-6 text-base"
          disabled={busy || !isConfigured()}
          onClick={create}
        >
          {t("landing.create")}
        </Button>
        {!isConfigured() && (
          <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {t("landing.config_warning")}
          </p>
        )}
        {recent.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t("landing.recent")}
            </h2>
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {recent.map((f) => (
                <li key={f.token}>
                  <Link
                    to={`/f/${f.token}/vacation`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent"
                  >
                    <span className="truncate font-medium">
                      {f.name}
                      {f.readOnly && (
                        <span className="text-muted-foreground">
                          {t("landing.view_only")}
                        </span>
                      )}
                    </span>
                    <small className="shrink-0 text-muted-foreground">
                      {new Date(f.at).toLocaleDateString(lang)}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            const token = tokenFromInput(value);
            if (token) navigate(`/f/${token}/vacation`);
          }}
        >
          <label
            htmlFor="open-input"
            className="mb-2 block text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {t("landing.open_label")}
          </label>
          <div className="flex gap-2">
            <Input
              id="open-input"
              autoComplete="off"
              placeholder={t("landing.open_placeholder")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button type="submit" variant="outline">{t("landing.open")}</Button>
          </div>
        </form>
      </main>
    </div>
  );
}
