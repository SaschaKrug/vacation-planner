// How the chat names a tool call: what it does ("Reading transactions") and, in a few words,
// what it is about ("March 2026 · “Amazon”"), from the arguments the model passed.

import type { Item } from "@/features/chat/store";
import { getLang, t } from "@/lib/i18n";

type ToolItem = Item & { kind: "tool" };
type Args = Record<string, unknown>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const date = (v: unknown) => (typeof v === "string" && DATE_RE.test(v) ? v : "");
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(getLang(), { ...opts, timeZone: "UTC" });
const DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
const lastOfMonth = (d: string) =>
  new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate();

/** A day range in short: "2026", "March 2026", "3 – 7 Aug 2026", "from 1 Mar 2026". */
export function span(from: string, to: string): string {
  if (from && to) {
    if (from > to) [from, to] = [to, from];
    if (from.endsWith("-01-01") && to.endsWith("-12-31")) {
      const a = from.slice(0, 4), b = to.slice(0, 4);
      return a === b ? a : `${a} – ${b}`;
    }
    if (
      from.slice(0, 7) === to.slice(0, 7) && from.endsWith("-01") &&
      +to.slice(8) === lastOfMonth(to)
    ) {
      return fmt({ month: "long", year: "numeric" }).format(utc(from));
    }
    if (from === to) return fmt(DAY).format(utc(from));
    return fmt(DAY).formatRange(utc(from), utc(to));
  }
  if (from) return t("chat.detail.since", { d: fmt(DAY).format(utc(from)) });
  if (to) return t("chat.detail.until", { d: fmt(DAY).format(utc(to)) });
  return "";
}

/** The days a list of ops touches, as one range. */
function opsSpan(ops: Args[]): string {
  const days = ops.flatMap((o) => [
    ...(Array.isArray(o.dates) ? o.dates.map(date) : []),
    date(o.from),
    date(o.to),
  ]).filter(Boolean).sort();
  return days.length ? span(days[0], days.at(-1)!) : "";
}

const quoted = (v: string) => (getLang() === "de" ? `„${v}“` : `“${v}”`);
/** An id or name the model passed: names are shown, ids (uuids) aren't worth reading. */
const named = (v: unknown) => {
  const s = str(v);
  return s && !UUID_RE.test(s) ? s : "";
};

/** What the tool is doing, e.g. "Reading transactions". */
export function toolLabel(item: ToolItem): string {
  const a = item.args ?? {};
  if (item.name === "web_search") {
    return t("chat.tool.web_search", { q: String(a.query ?? "") });
  }
  if (item.name === "fetch_page") {
    let host = String(a.url ?? "");
    try {
      host = new URL(host).hostname;
    } catch {
      // keep as is
    }
    return t("chat.tool.fetch_page", { host });
  }
  return t(`chat.tool.${item.name}`);
}

/** What the call is about, in a few words ("" when there is nothing to add). */
export function toolDetail(item: ToolItem): string {
  const a: Args = item.args ?? {};
  const ops = (Array.isArray(a.ops) ? a.ops : []).filter(
    (o): o is Args => !!o && typeof o === "object",
  );
  const parts: string[] = [];
  switch (item.name) {
    case "get_calendar":
    case "finance_summary":
    case "combine_transfers":
      parts.push(span(date(a.from), date(a.to)));
      break;
    case "analyze_calendar": {
      parts.push(span(date(a.from), date(a.to)));
      const types = (Array.isArray(a.types) ? a.types : [a.types]).map(named).filter(Boolean);
      parts.push(types.slice(0, 2).join(", ") + (types.length > 2 ? " …" : ""));
      break;
    }
    case "calculate": {
      const list = Array.isArray(a.expressions) ? a.expressions : [a.expressions ?? a.expression];
      const first = str(list[0]);
      parts.push(first.length > 40 ? first.slice(0, 40) + "…" : first);
      if (list.length > 1) parts.push(`+${list.length - 1}`);
      break;
    }
    case "analyze_transactions":
    case "list_transactions": {
      parts.push(span(date(a.from), date(a.to)));
      if (str(a.q)) parts.push(quoted(str(a.q)));
      if (str(a.account) === "none") parts.push(t("finance.no_account"));
      else parts.push(named(a.account));
      if (str(a.category) === "none") parts.push(t("finance.uncategorized"));
      else parts.push(named(a.category));
      if (a.kind === "income") parts.push(t("finance.income"));
      if (a.kind === "expense") parts.push(t("finance.expenses"));
      if (a.kind === "transfer") parts.push(t("finance.transfers"));
      const offset = Math.floor(Number(a.offset)) || 0;
      if (offset > 0) parts.push(t("chat.detail.from_row", { n: offset + 1 }));
      break;
    }
    case "change_entries": {
      const types = [
        ...new Set(
          ops.flatMap((o) => [o.type, ...(Array.isArray(o.types) ? o.types : [])].map(named)),
        ),
      ].filter(Boolean);
      parts.push(opsSpan(ops));
      parts.push(types.slice(0, 2).join(", ") + (types.length > 2 ? " …" : ""));
      break;
    }
    case "set_notes":
      parts.push(opsSpan(ops));
      break;
    case "change_transactions": {
      // A delete op can name many transactions.
      const n = ops.reduce(
        (sum, o) => sum + (o.action === "delete" && Array.isArray(o.ids) ? o.ids.length : 1),
        0,
      );
      if (n) parts.push(t("chat.detail.changes", { n }));
      break;
    }
    case "manage_entry_types":
      if (a.action === "copy_year") {
        parts.push(`${a.from} → ${a.to}`);
      } else {
        const name = named(a.name) || named(a.type);
        if (name) parts.push(quoted(name));
        if (a.year) parts.push(String(a.year));
      }
      break;
    case "manage_categories": {
      const name = named(a.name) || named(a.category);
      if (name) parts.push(quoted(name));
      break;
    }
  }
  return parts.filter(Boolean).join(" · ");
}
