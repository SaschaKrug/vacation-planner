import type { MessageKeys, Messages, NestedKeyOf } from "next-intl";

import type enMessages from "../../messages/en.json";

/**
 * Makes catalog keys a compiler-checked type instead of plain `string`, as in
 * Yana: without it, `t("hom.title")` is a valid call that renders the raw key
 * path to the user, and src/i18n/messages.test.ts (which only compares the two
 * catalogs to each other) cannot notice.
 *
 * next-intl 4 reads the shape from `AppConfig`; the widely-copied
 * `declare global { interface IntlMessages }` form is next-intl 3 and does
 * nothing here.
 *
 * Two details this depends on and that will break it silently if changed:
 *
 * 1. This file must stay a *module* -- the imports above are what make it one.
 *    A `.d.ts` with no top-level import/export is a global script, and
 *    `declare module "next-intl"` inside one *replaces* next-intl's types
 *    wholesale instead of augmenting them.
 * 2. en.json is the reference catalog; de.json is held to it by
 *    src/i18n/messages.test.ts, which asserts the two define identical keys.
 */
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof enMessages;
    Locale: "en" | "de";
  }
}

/**
 * Every dotted path in the catalogs whose value is a message (not a nested
 * group). Exported so a value that is *later* passed to `t()` can be typed at
 * its source -- casting at the call site would defeat the augmentation.
 */
export type CatalogKey = MessageKeys<Messages, NestedKeyOf<Messages>>;

/** The same, relative to one top-level namespace: NamespaceKey<"home">. */
export type NamespaceKey<Namespace extends keyof Messages> = MessageKeys<
  Messages[Namespace],
  NestedKeyOf<Messages[Namespace]>
>;
