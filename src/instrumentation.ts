/**
 * Next's startup hook: `register()` runs **once per server instance**, before
 * the first request is served (`next dev`, `next start`, and the standalone
 * server the Dockerfile ships alike). It is the only place in this app that
 * runs code at boot rather than per request; the steps themselves live in
 * `runStartupTasks()` (`src/lib/startup.ts`). This is the single migration
 * path -- there is no entrypoint script and no `drizzle-kit migrate` step.
 *
 * It does **not** run during `next build`: Next's `registerInstrumentation()`
 * returns early when `NEXT_PHASE === "phase-production-build"`, which keeps a
 * build from creating and migrating a database on the build machine.
 *
 * **A failed startup kills the process.** Left to Next, the standalone server
 * logs the failure and then stays up answering 500 to every route -- a running
 * container serving nothing, which no restart policy notices. `process.exit(1)`
 * makes it die instead. No `NODE_ENV` branch: `next dev` already exits with
 * code 1 when `register()` throws (measured in Yana).
 */
export async function register(): Promise<void> {
  // Node runtime only: the edge runtime has no better-sqlite3.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // One dynamic import, one specifier -- `next.config.ts` cuts exactly this one
  // out of the edge compilation, because webpack follows it regardless of the
  // guard above. Do not add a second import to this file; add the step to
  // `runStartupTasks()` instead. `src/instrumentation.test.ts` fails if this
  // list ever stops matching the regexp in `next.config.ts`.
  const { runStartupTasks } = await import("@/lib/startup");

  try {
    await runStartupTasks();
  } catch (error) {
    // Logged before exiting: Next's own wrapper renames the message, and
    // nothing would print the original once the process is on its way out.
    console.error("Family Planner could not complete startup (migrations).", error);

    process.exit(1);

    // Unreachable in production. Kept so the failure is still a rejection under
    // a test that stubs process.exit.
    throw error;
  }
}
