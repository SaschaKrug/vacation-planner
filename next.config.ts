import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const config: NextConfig = {
  // The Docker image copies .next/standalone; without this the image would
  // need the full node_modules tree.
  output: "standalone",
  // Without this pin, Next infers the workspace root by walking up to the
  // topmost ancestor with a lockfile -- which can be an unrelated one above the
  // checkout -- and then nests the absolute path under .next/standalone instead
  // of putting server.js at its root, which the Dockerfile assumes.
  outputFileTracingRoot: __dirname,

  // better-sqlite3 is a native addon. Bundling it breaks the .node binding
  // resolution, so it must stay external and be require()d at runtime. This
  // covers the *node* server bundle only; the edge layer needs the hook below.
  serverExternalPackages: ["better-sqlite3"],

  /**
   * Cut the startup module out of the **edge** compilation.
   *
   * Webpack builds `src/instrumentation.ts` for both runtimes and resolves its
   * imports statically -- including a dynamic `import()` behind a
   * `NEXT_RUNTIME !== "nodejs"` guard. The edge layer would therefore pull in
   * `@/lib/startup` -> `@/lib/db/client` -> `node:fs` and `better-sqlite3`, and
   * the compilation fails: in `next dev` that is a **500 on every route**,
   * while `next build` and `next start` stay green. Measured in Yana.
   *
   * The single specifier is the contract with `src/instrumentation.ts` (pinned
   * by `src/instrumentation.test.ts`). `IgnorePlugin`, not `resolve.alias`:
   * Next resolves the `@/*` paths with its own plugin before alias matching.
   * Turbopack ignores this hook, which is why `dev` and `build` are both pinned
   * to `--webpack`.
   */
  webpack(webpackConfig, { nextRuntime, webpack }) {
    if (nextRuntime === "edge") {
      webpackConfig.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@\/lib\/startup$/ }));
    }
    return webpackConfig;
  },
};

// Injects next-intl's request-config module (src/i18n/request.ts) into the
// server bundle so getLocale()/getTranslations() can find it.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(config);
