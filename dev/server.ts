// Local development server: serves web/ and the API with an in-memory store.
//   deno task dev                ->  http://localhost:8787
//   deno task dev --persist      keep the data in .dev/data.json across restarts
//   deno task dev --seed         add a demo planner if there is none yet
//   deno task dev --rate-limit   enforce low rate limits, to see the app's 429 handling
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { createHandler, type RateLimits } from "../supabase/functions/_shared/handler.ts";
import { MemoryRateLimiter } from "../supabase/functions/_shared/rate_limit.ts";
import { MemoryStore } from "../supabase/functions/_shared/store.ts";

const args = parseArgs(Deno.args, { boolean: ["persist", "seed", "rate-limit"] });
const port = Number(Deno.env.get("PORT") ?? 8787);
const origin = `http://localhost:${port}`;
const root = new URL("../web/", import.meta.url);
const dataDir = new URL("../.dev/", import.meta.url);
const dataFile = new URL("data.json", dataDir);
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
};

// Low enough to hit by hand: a few new planners, or a minute of fast clicking.
const DEV_LIMITS: RateLimits = {
  create: { max: 3, seconds: 60 },
  createAll: { max: 10, seconds: 60 },
  write: { max: 30, seconds: 60 },
};

const store = new MemoryStore();
if (args.persist) {
  try {
    store.restore(JSON.parse(await Deno.readTextFile(dataFile)));
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

const api = createHandler(
  store,
  args["rate-limit"] ? { rateLimiter: new MemoryRateLimiter(), limits: DEV_LIMITS } : {},
);

// Writes run one after another, each with the latest data; rename keeps the file whole.
let saving = Promise.resolve();
function save() {
  saving = saving.then(async () => {
    await Deno.mkdir(dataDir, { recursive: true });
    const tmp = new URL("data.json.tmp", dataDir);
    await Deno.writeTextFile(tmp, JSON.stringify(store.snapshot(), null, 1));
    await Deno.rename(tmp, dataFile);
  }).catch((e) => console.error("Saving .dev/data.json failed:", e));
}

async function handleApi(req: Request) {
  const res = await api(req);
  if (args.persist && !["GET", "HEAD", "OPTIONS"].includes(req.method)) save();
  return res;
}

/** Fills a demo planner through the API, so it is built exactly like one made in the app. */
async function seed() {
  const call = async (method: string, path: string, body: unknown) => {
    const res = await handleApi(
      new Request(`${origin}/api${path}`, {
        method,
        headers: { "content-type": "application/json", "x-forwarded-for": "seed" },
        body: JSON.stringify(body),
      }),
    );
    const data = await res.json();
    if (!res.ok) throw new Error(`Seeding failed: ${method} ${path}: ${data.error}`);
    return data;
  };
  const y = new Date().getFullYear();
  const { session } = await call("POST", "/sessions", {
    name: "Demo family",
    year: y,
    types: [
      { name: "Holiday", color: "#f59e0b", role: "day_off" },
      { name: "Vacation Mom", color: "#22c55e", role: "covers" },
      { name: "Vacation Dad", color: "#3b82f6", role: "covers" },
      { name: "Day care closed", color: "#8b5cf6", role: "needs_cover" },
      { name: "Sick", color: "#ef4444", role: "none" },
    ],
  });
  const s = `/sessions/${session.id}`;
  await call("POST", `${s}/types/copy`, { from: y, to: y + 1 });
  // Aug 20/21 and Dec 24 stay uncovered, so the coverage check has something to show.
  await call("POST", `${s}/entries`, {
    ops: [
      { action: "add", type: "holiday", dates: [`${y}-01-01`, `${y}-12-25`, `${y}-12-26`] },
      { action: "add", type: "day care closed", from: `${y}-08-03`, to: `${y}-08-21` },
      { action: "add", type: "day care closed", from: `${y}-12-24`, to: `${y}-12-31` },
      { action: "add", type: "vacation mom", from: `${y}-08-03`, to: `${y}-08-14` },
      { action: "add", type: "vacation dad", from: `${y}-08-17`, to: `${y}-08-19` },
      { action: "add", type: "vacation dad", from: `${y}-12-28`, to: `${y}-12-31` },
      { action: "add", type: "sick", from: `${y}-03-09`, to: `${y}-03-11` },
      { action: "add", type: "holiday", dates: [`${y + 1}-01-01`] },
      { action: "add", type: "vacation mom", from: `${y + 1}-01-04`, to: `${y + 1}-01-08` },
    ].map((op) => op.from ? { ...op, skipWeekends: true } : op),
  });
  await call("POST", `${s}/notes`, {
    ops: [
      { icon: "🎄", comment: "Christmas", from: `${y}-12-24`, to: `${y}-12-26` },
      { icon: "🎂", comment: "Birthday", date: `${y}-05-17` },
      { icon: "🎆", comment: "New Year's Eve", date: `${y}-12-31` },
    ],
  });
}

if (args.seed && store.sessions.size === 0) await seed();

Deno.serve({ port, onListen: () => listPlanners() }, async (req) => {
  const { pathname } = new URL(req.url);
  if (pathname === "/api" || pathname.startsWith("/api/")) return handleApi(req);
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

function listPlanners() {
  const flags = [
    args.persist && "data in .dev/data.json",
    args["rate-limit"] && "low rate limits",
  ].filter(Boolean);
  console.log(`Vacation planner on ${origin}${flags.length ? ` (${flags.join(", ")})` : ""}`);
  for (const s of store.sessions.values()) {
    console.log(`  ${s.name}: edit ${origin}/?s=${s.id}  view ${origin}/?s=${s.read_id}`);
  }
}
