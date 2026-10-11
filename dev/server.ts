// Local development server: serves web/ and the API with an in-memory store.
//   deno task dev   ->  http://localhost:8787
import { createHandler } from "../supabase/functions/_shared/handler.ts";
import { MemoryStore } from "../supabase/functions/_shared/store.ts";

const api = createHandler(new MemoryStore());
const root = new URL("../web/", import.meta.url);
const port = Number(Deno.env.get("PORT") ?? 8787);
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
};

Deno.serve({ port }, async (req) => {
  const { pathname } = new URL(req.url);
  if (pathname === "/api" || pathname.startsWith("/api/")) return api(req);
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  if (file.includes("..")) return new Response("Bad request", { status: 400 });
  try {
    const body = await Deno.readFile(new URL(file, root));
    const ext = file.split(".").pop() ?? "";
    return new Response(body, {
      headers: { "content-type": TYPES[ext] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
});
