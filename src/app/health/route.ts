import { connection } from "next/server";

import { getDb } from "@/lib/db/client";

export async function GET() {
  // SELECT 1 succeeds even against an empty, freshly-created database, so a
  // prerendered response here would bake a permanent { status: "ok" } that never
  // touches the database again -- exactly what this check exists to catch.
  // connection() opts the route out of prerendering. Outside the `try` on
  // purpose: the prerender bail-out is itself a thrown error, and catching it
  // would turn it into a 503 and reinstate a static answer.
  await connection();
  try {
    // Prove the database is reachable, not just that Node is up.
    getDb().get("SELECT 1");
    return Response.json({ status: "ok" });
  } catch (error) {
    // Logged, not returned: this route is unauthenticated, and the available
    // messages carry absolute server paths (mkdirSync's EACCES) and driver
    // internals. The operator reads the container log; the caller gets a status.
    console.error("Health check failed: the database is not reachable", error);
    return Response.json({ status: "error" }, { status: 503 });
  }
}
