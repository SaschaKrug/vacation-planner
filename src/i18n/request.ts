import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { getRequestConfig } from "next-intl/server";

import { FALLBACK_LOCALE, negotiateLocale, type AppLocale } from "@/i18n/locale";

/**
 * The request's locale, from the browser's `Accept-Language`.
 *
 * Until accounts arrive (phase 3) there is no stored preference to read, so the
 * header is the whole answer. Phase 5 puts the user's language in their
 * settings row, as Yana does; from then on a stored preference wins outright and
 * this negotiation only serves signed-out pages such as /login.
 *
 * Wrapped and falling back: this runs in the *root* layout via getLocale(), so
 * a throw here would be a 500 on every route.
 */
async function browserLocale(): Promise<AppLocale> {
  try {
    return negotiateLocale((await headers()).get("accept-language"));
  } catch (error) {
    // Next's own control flow first: during `next build`, headers() throws the
    // prerender bail-out that marks the route dynamic, and swallowing it here
    // would log it as a failure (and could bake a static page).
    unstable_rethrow(error);
    console.error(`Could not read Accept-Language; falling back to "${FALLBACK_LOCALE}".`, error);
    return FALLBACK_LOCALE;
  }
}

export default getRequestConfig(async () => {
  const locale = await browserLocale();
  return {
    locale,
    // An explicit time zone, because next-intl otherwise falls back to the
    // *environment's* zone -- the container's on the server, the visitor's in
    // the browser -- so a date formatted on both sides can disagree after
    // hydration. `TZ` so an operator sets it like everything else.
    timeZone: process.env.TZ || "UTC",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
