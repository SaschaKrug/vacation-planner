import { useTranslations } from "next-intl";

/**
 * A placeholder until phase 5 puts the app shell here. Synchronous on purpose:
 * a page body that awaits nothing cannot suspend (see CLAUDE.md's streaming
 * pattern), and this one reads nothing but the catalog.
 */
export default function HomePage() {
  const t = useTranslations("home");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="text-2xl font-semibold">{t("heading")}</h1>
        <p className="text-sm text-muted-foreground">{t("building")}</p>
      </div>
    </main>
  );
}
