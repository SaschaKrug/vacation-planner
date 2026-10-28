import path from "node:path";

import { defineConfig } from "vitest/config";

// Two projects, as in Yana, because the two kinds of test need environments
// that cannot be merged: the library tests open a real better-sqlite3 file and
// must run in `node`, component tests need a DOM. **The file extension picks
// the project** -- `.test.ts` is node, `.test.tsx` is jsdom. Everything shared
// -- the `@` alias above all -- lives at the root and reaches both projects
// through `extends: true`.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  test: {
    // 20s / 30s against Vitest's 5s / 10s defaults, and the tests are not slow:
    // what does not fit the defaults on a 2-core shared CI runner is the
    // one-time *cold* work in front of an assertion (re-importing the graph and
    // better-sqlite3's native binding after `vi.resetModules()`, building a
    // jsdom environment). Measured in Yana; see its vitest.config.ts. Never
    // paper over a timeout with `retry`.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          // .ts only: a component test is .tsx and belongs to "dom".
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["src/test/setup.ts"],
        },
      },
    ],
  },
});
