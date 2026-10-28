import dns from "node:dns";

import { applyPendingMigrations } from "@/lib/db/migrate";

/**
 * Everything that has to happen once, before the first request is served.
 *
 * `src/instrumentation.ts` is the only caller, and it reaches this module
 * through a single dynamic `import()` for a bundler reason: webpack compiles the
 * instrumentation hook for the **edge** runtime too and resolves its imports
 * statically, so anything reachable from there drags `node:fs` and
 * `better-sqlite3` into a runtime that has neither. `next.config.ts` cuts
 * exactly this specifier out of the edge compilation -- which is why the startup
 * sequence lives behind **one** module boundary. Adding another startup step
 * here costs nothing; adding another import to `instrumentation.ts` breaks
 * `next dev`.
 *
 * Migrations come first, and later steps (the admin bootstrap in phase 3,
 * resetting stale AI chat leases in phase 4) go after them, because they query
 * tables that do not exist on a fresh database until migrations have run.
 */
export async function runStartupTasks(): Promise<void> {
  /**
   * Node's default DNS result order is "verbatim". Docker's default bridge
   * network gives containers no IPv6 route, so a dual-stack host whose AAAA
   * record sorts first makes every outgoing `fetch()` (the AI assistant's model
   * calls, web search and page reads) pay for a failed IPv6 attempt first.
   */
  dns.setDefaultResultOrder("ipv4first");

  applyPendingMigrations();
}
