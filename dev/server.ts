// Local development server: serves the built app (app/dist) and the API with an in-memory store.
//   deno task dev                ->  http://localhost:8787 (run `npm run build` in app/ first,
//                                    or `npm run dev` there for the app with hot reload)
//   deno task dev --persist      keep the data in .dev/data.json across restarts
//   deno task dev --seed         add a demo family if there is none yet
//   deno task dev --rate-limit   enforce low rate limits, to see the app's 429 handling
//   deno task dev --mock-ai      a scripted AI endpoint at /mock-ai/v1, and the demo family
//                                (with --seed) uses it, so the chat works without a key
// The AI assistant may reach localhost here (e.g. Ollama at http://localhost:11434/v1).
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import {
  ADMIN_EMAIL,
  authEnv,
  ensureAdmin,
  issueToken,
} from "../supabase/functions/_shared/auth.ts";
import { createHandler, type RateLimits } from "../supabase/functions/_shared/handler.ts";
import { MemoryRateLimiter } from "../supabase/functions/_shared/rate_limit.ts";
import { devSecret } from "../supabase/functions/_shared/secrets.ts";
import { MemoryStore } from "../supabase/functions/_shared/store.ts";
import { mockAi } from "./mock_ai.ts";

const args = parseArgs(Deno.args, { boolean: ["persist", "seed", "rate-limit", "mock-ai"] });
const port = Number(Deno.env.get("PORT") ?? 8787);
const origin = `http://localhost:${port}`;
const root = new URL("../app/dist/", import.meta.url);
const dataDir = new URL("../.dev/", import.meta.url);
const dataFile = new URL("data.json", dataDir);
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  json: "application/json",
  png: "image/png",
  woff2: "font/woff2",
};

// Low enough to hit by hand: a few new families, or a minute of fast clicking.
const DEV_LIMITS: RateLimits = {
  create: { max: 3, seconds: 60 },
  createAll: { max: 10, seconds: 60 },
  write: { max: 30, seconds: 60 },
  ai: { max: 10, seconds: 60 },
  aiFamily: { max: 30, seconds: 60 },
  login: { max: 10, seconds: 60 },
  loginAccount: { max: 10, seconds: 60 },
};

const store = new MemoryStore();
if (args.persist) {
  try {
    store.restore(JSON.parse(await Deno.readTextFile(dataFile)));
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

// The key that encrypts the AI keys: kept in .dev/ with --persist, so saved keys stay readable.
const secretFile = new URL("ai-secret", dataDir);
let aiSecret = devSecret();
if (args.persist) {
  try {
    aiSecret = (await Deno.readTextFile(secretFile)).trim();
  } catch {
    await Deno.mkdir(dataDir, { recursive: true });
    await Deno.writeTextFile(secretFile, aiSecret);
  }
}

const api = createHandler(store, {
  ...(args["rate-limit"] ? { rateLimiter: new MemoryRateLimiter(), limits: DEV_LIMITS } : {}),
  aiSecret,
  allowPrivateNetwork: true,
});

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

// The admin of a new installation (admin/admin), as the API would make it on the first
// request; old snapshots' families go to it.
await ensureAdmin(store, authEnv({}));
if (args.persist) save();

/** Fills a demo family through the API, so it is built exactly like one made in the app. The
 *  admin makes it, and is its editor. */
async function seed() {
  const admin = await store.findUserByEmail(ADMIN_EMAIL);
  if (!admin) throw new Error(`Seeding needs the "${ADMIN_EMAIL}" account`);
  const { token, row } = await issueToken(store, admin.id, "session");
  // The admin may still have to change the initial password; the seed doesn't wait for that.
  const mustChange = admin.must_change_password;
  await store.updateUser(admin.id, { must_change_password: false });
  const call = async (method: string, path: string, body: unknown) => {
    const res = await handleApi(
      new Request(`${origin}/api${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "seed",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }),
    );
    const data = await res.json();
    if (!res.ok) throw new Error(`Seeding failed: ${method} ${path}: ${data.error}`);
    return data;
  };
  const y = new Date().getFullYear();
  const { family } = await call("POST", "/families", {
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
  const s = `/families/${family.id}`;
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
  // Six months of household money, so the finance page has something to show: a checking
  // account, and savings that get a monthly transfer (the latest one isn't combined yet, so
  // "Find transfers" has something to suggest).
  await call("POST", `${s}/finance/accounts`, {
    name: "Checking",
    color: "#3b82f6",
    icon: "🏦",
    openingCents: 250000,
  });
  await call("POST", `${s}/finance/accounts`, {
    name: "Savings",
    color: "#22c55e",
    icon: "🐷",
    openingCents: 1000000,
  });
  const ops: Record<string, unknown>[] = [];
  const now = new Date();
  for (let k = 5; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    ops.push(
      { date: `${m}-01`, amountCents: 385000, payee: "Employer GmbH", categoryId: "salary" },
      { date: `${m}-01`, amountCents: -142000, payee: "Landlord", categoryId: "housing" },
      { date: `${m}-03`, amountCents: -9800, payee: "Power & Water Co.", categoryId: "utilities" },
      { date: `${m}-15`, amountCents: 25000, payee: "Child benefit", categoryId: "other-income" },
    );
    for (const day of ["05", "12", "19", "26"]) {
      ops.push({
        date: `${m}-${day}`,
        amountCents: -(8000 + ((k * 7 + Number(day)) % 9) * 1100),
        payee: "Supermarket",
        categoryId: "groceries",
      });
    }
    ops.push({
      date: `${m}-20`,
      amountCents: -(4500 + k * 900),
      payee: "Gas station",
      categoryId: "mobility",
    });
    if (k % 2 === 0) {
      ops.push({ date: `${m}-22`, amountCents: -6990, payee: "Toy store", categoryId: "kids" });
    }
    const transferId = k ? crypto.randomUUID() : null;
    ops.push(
      { date: `${m}-02`, amountCents: -50000, payee: "Savings", transferId },
      {
        date: `${m}-03`,
        amountCents: 50000,
        payee: "From checking",
        accountId: "savings",
        transferId,
      },
    );
  }
  ops.push({
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-02`,
    amountCents: -2350,
    payee: "Bakery",
  });
  // An Amazon "Splitbuchung" last month whose order lines the bank lists too, not combined yet,
  // so "Auto-combine" has a split booking to find.
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-10`;
  ops.push(
    { date: last, amountCents: -4498, payee: "Amazon Payments", description: "Splitbuchung" },
    { date: last, amountCents: -2999, payee: "Amazon.de", description: "Order 1 Book" },
    { date: last, amountCents: -1999, payee: "Amazon.de", description: "Order 2 Toy" },
    { date: last, amountCents: 500, payee: "Amazon.de", description: "Voucher" },
  );
  await call("POST", `${s}/finance/transactions`, {
    ops: ops.filter((o) => (o.date as string) <= new Date().toISOString().slice(0, 10))
      .map((o) => ({ accountId: "checking", ...o })),
  });
  await store.deleteTokens(admin.id, { id: row.id });
  await store.updateUser(admin.id, { must_change_password: mustChange });
}

if (args.seed && store.families.size === 0) await seed();
if (args["mock-ai"]) {
  // Point every family without AI settings at the mock.
  for (const f of store.families.values()) {
    if (await store.getAiSettings(f.id)) continue;
    await store.saveAiSettings({
      family_id: f.id,
      base_url: `${origin}/mock-ai/v1`,
      model: "mock-large",
      api_key_enc: "",
      search_provider: "none",
      search_key_enc: "",
      allow_writes: true,
      context_window: 0,
      updated_at: new Date().toISOString(),
    });
  }
  if (args.persist) save();
}

Deno.serve({ port, onListen: () => listFamilies() }, async (req) => {
  const { pathname } = new URL(req.url);
  if (pathname === "/api" || pathname.startsWith("/api/")) return handleApi(req);
  if (args["mock-ai"] && pathname.startsWith("/mock-ai/")) return mockAi(req);
  const file = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  if (file.includes("..")) return new Response("Bad request", { status: 400 });
  // The app routes in the browser (/f/<id>/vacation …): paths without a file extension get
  // index.html, like GitHub Pages does with 404.html.
  const path = /\.[a-z0-9]+$/i.test(file) ? file : "index.html";
  try {
    const body = await Deno.readFile(new URL(path, root));
    const ext = path.split(".").pop() ?? "";
    return new Response(body, {
      headers: { "content-type": TYPES[ext] ?? "application/octet-stream" },
    });
  } catch {
    if (path === "index.html") {
      return new Response("app/dist is missing: run `npm ci && npm run build` in app/", {
        status: 503,
      });
    }
    return new Response("Not found", { status: 404 });
  }
});

function listFamilies() {
  const flags = [
    args.persist && "data in .dev/data.json",
    args["rate-limit"] && "low rate limits",
    args["mock-ai"] && "mock AI at /mock-ai/v1",
  ].filter(Boolean);
  console.log(`Family Planner on ${origin}${flags.length ? ` (${flags.join(", ")})` : ""}`);
  for (const f of store.families.values()) console.log(`  ${f.name}: ${origin}/f/${f.id}`);
  const admin = [...store.users.values()].find((u) => u.email === ADMIN_EMAIL);
  if (admin?.must_change_password) {
    console.log(`Sign in as "${ADMIN_EMAIL}" with the password "admin" (to be changed then).`);
  }
}
