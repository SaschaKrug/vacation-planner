import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Lang, LANGS, setLang, t, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { UserMenu } from "./UserMenu";

/** A page outside of a family (sign-in, account, administration): the app's name on top, the
 *  user menu (or the language when signed out), and the content in a column. */
export function StandalonePage(
  { children, signedIn = true, wide = false }: {
    children: ReactNode;
    signedIn?: boolean;
    /** A wider column, for lists. */
    wide?: boolean;
  },
) {
  const lang = useLang();
  return (
    <div className="min-h-svh">
      <header className="flex items-center gap-2.5 px-4 py-3 sm:px-5">
        <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8 rounded-lg" />
          <span className="truncate font-semibold">{t("app.title")}</span>
        </Link>
        {signedIn
          ? <UserMenu compact />
          : (
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
          )}
      </header>
      <main
        className={cn(
          "mx-auto w-full px-4 pt-6 pb-12 sm:px-5 sm:pt-10",
          wide ? "max-w-4xl" : "max-w-xl",
        )}
      >
        {children}
      </main>
    </div>
  );
}
