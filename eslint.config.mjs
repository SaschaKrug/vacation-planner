import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Appended last so it wins on formatting rules -- Prettier owns formatting,
  // ESLint owns everything else.
  prettier,
  /**
   * Server-only modules, enforced rather than merely documented (Yana's rule).
   * A feature's `queries.ts` reaches `getDb()`, so importing one constant from
   * it drags `better-sqlite3` into the browser bundle and the build fails with
   * an opaque bundler error. `import type` is fine: it is erased before
   * bundling. Extend the `group` list when another server-only shape appears.
   */
  {
    files: ["src/components/**", "src/features/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/lib/db/*", "**/lib/*/queries"],
              allowTypeImports: true,
              message:
                "Database modules are server-only (they reach getDb() and better-sqlite3). " +
                "Call a server action or an API route instead, or use `import type`.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Project-specific:
    "node_modules/**",
    "drizzle/**",
    "data/**",
    "docs/**",
    // The Supabase version of the app, linted by `deno lint` until it is
    // deleted at the end of the migration (docs/nextjs-migration-plan.md).
    "web/**",
    "supabase/**",
    "dev/**",
    "tests/**",
  ]),
]);

export default eslintConfig;
