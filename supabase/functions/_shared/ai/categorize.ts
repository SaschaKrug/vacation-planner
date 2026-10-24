// Sorts transactions into the family's categories with its AI model: the rows go to the model in
// batches, with the categories and how the family sorted similar payees before; the answer is a
// JSON object of row number -> category id. Only categories that fit (income / expense) count.

import { HttpError } from "../http.ts";
import type { Lang } from "../ics.ts";
import type { CategoryRow, TransactionRow } from "../store.ts";
import type { NetOptions } from "./net.ts";
import { type Provider, streamChat } from "./provider.ts";

/** Rows per model request, and requests at once. */
const BATCH = 50;
const PARALLEL = 4;
/** Already sorted payees shown as examples. */
const MAX_EXAMPLES = 60;

export const MARKER = "You sort bank transactions into categories.";

const LANGUAGES: Record<Lang, string> = { en: "English", de: "German" };

/** Whether a category may hold a transaction of this amount. */
export function fits(c: CategoryRow, amountCents: number): boolean {
  if (c.kind === "both" || amountCents === 0) return true;
  return (c.kind === "income") === amountCents > 0;
}

function oneLine(s: string, max: number) {
  return s.replace(/[\s|]+/g, " ").trim().slice(0, max);
}

function rowLine(n: number, t: TransactionRow) {
  return `${n} | ${t.day} | ${(t.amount_cents / 100).toFixed(2)} | ${oneLine(t.payee, 80)} | ${
    oneLine(t.description, 160)
  }`;
}

/** The newest category per payee, from rows that have one: how this family sorts. */
function examples(sorted: TransactionRow[], categories: CategoryRow[]): string[] {
  const ids = new Set(categories.map((c) => c.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of sorted) {
    const payee = oneLine(t.payee || t.description, 80);
    const key = payee.toLowerCase();
    if (!t.category_id || !ids.has(t.category_id) || !payee || seen.has(key)) continue;
    seen.add(key);
    out.push(`${payee} -> ${t.category_id}`);
    if (out.length >= MAX_EXAMPLES) break;
  }
  return out;
}

export function categorizePrompt(
  categories: CategoryRow[],
  sorted: TransactionRow[],
  lang: Lang,
): string {
  const ex = examples(sorted, categories);
  return [
    MARKER,
    `The statements are probably ${LANGUAGES[lang]}. Each row is: number | date | amount ` +
    "(negative = money going out) | payee | description.",
    "Categories (id: name, for which amounts):",
    ...categories.map((c) =>
      `- ${c.id}: ${c.icon ? c.icon + " " : ""}${c.name} (${
        c.kind === "both" ? "income and expenses" : c.kind === "income" ? "income" : "expenses"
      })`
    ),
    ...(ex.length ? ["How the family sorted earlier transactions (payee -> id):", ...ex] : []),
    'Answer with one JSON object and nothing else: {"<row number>": "<category id>"}. Use only ' +
    "the ids above, only categories that fit the amount, and null when you aren't fairly sure.",
  ].join("\n");
}

/** The JSON object in a model's answer (which may wrap it in a code fence or prose). */
export function parseAnswer(content: string): Record<string, unknown> {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) return {};
  try {
    const data = JSON.parse(content.slice(start, end + 1));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

async function ask(
  provider: Provider,
  system: string,
  rows: TransactionRow[],
  net: NetOptions,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: rows.map((t, i) => rowLine(i + 1, t)).join("\n") },
  ];
  for await (const ev of streamChat(provider, { messages, temperature: 0 }, net, signal)) {
    if (ev.type === "done") return parseAnswer(ev.content);
  }
  return {};
}

/**
 * The category the model picked for each row (rows it left open are missing). `sorted` are the
 * family's transactions that already have a category, newest first, as examples.
 */
export async function suggestCategories(opts: {
  provider: Provider;
  net: NetOptions;
  categories: CategoryRow[];
  rows: TransactionRow[];
  sorted: TransactionRow[];
  lang: Lang;
  signal?: AbortSignal;
}): Promise<Map<string, string>> {
  const { provider, net, categories, rows, signal } = opts;
  if (!provider.model) throw new HttpError(400, "Pick a model first");
  if (!categories.length) throw new HttpError(400, "There are no categories yet");
  const system = categorizePrompt(categories, opts.sorted, opts.lang);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const batches: TransactionRow[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));

  const out = new Map<string, string>();
  for (let i = 0; i < batches.length; i += PARALLEL) {
    const answers = await Promise.all(
      batches.slice(i, i + PARALLEL).map((b) => ask(provider, system, b, net, signal)),
    );
    answers.forEach((answer, j) => {
      const batch = batches[i + j];
      for (const [key, value] of Object.entries(answer)) {
        const row = batch[Number(key) - 1];
        const ref = typeof value === "string" ? value.trim() : "";
        const category = byId.get(ref) ?? byName.get(ref.toLowerCase());
        if (row && category && fits(category, row.amount_cents)) out.set(row.id, category.id);
      }
    });
  }
  return out;
}
