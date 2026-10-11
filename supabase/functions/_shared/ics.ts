// Builds an iCalendar (RFC 5545) feed that Apple Calendar / iCloud can
// subscribe to. Consecutive days of the same entry type become one
// all-day event.

import { addDays, consecutiveRuns, isWeekend } from "./dates.ts";
import type { TypeRow } from "./store.ts";

export interface IcsInput {
  calendarName: string;
  uidPrefix: string;
  types: TypeRow[];
  /** day -> type ids */
  entries: Map<string, string[]>;
  /** Only these type ids become events (all types if omitted). */
  include?: Set<string>;
  /** Adds a warning event for weekdays that need cover but have none. */
  gaps?: boolean;
  now?: Date;
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Folds a content line to max. 75 octets per line (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + n > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compact = (d: string) => d.replace(/-/g, "");

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function gapDays(types: TypeRow[], entries: Map<string, string[]>): string[] {
  const role = new Map(types.map((t) => [t.id, t.role]));
  const out: string[] = [];
  for (const [day, ids] of entries) {
    if (isWeekend(day)) continue;
    const roles = ids.map((id) => role.get(id));
    if (!roles.includes("needs_cover")) continue;
    if (roles.includes("covers") || roles.includes("day_off")) continue;
    out.push(day);
  }
  return out.sort();
}

function workdays(days: string[]): number {
  return days.filter((d) => !isWeekend(d)).length;
}

export function buildIcs(input: IcsInput): string {
  const now = input.now ?? new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//vacation-planner//Year Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + escapeText(input.calendarName),
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  const event = (uid: string, run: string[], summary: string) => {
    const n = run.length;
    const description = n === 1 ? summary : `${summary}: ${n} days (${workdays(run)} workdays)`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compact(run[0])}`,
      `DTEND;VALUE=DATE:${compact(addDays(run[n - 1], 1))}`,
      "SUMMARY:" + escapeText(summary),
      "DESCRIPTION:" + escapeText(description),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  };

  for (const type of input.types) {
    if (input.include && !input.include.has(type.id)) continue;
    const days = [...input.entries].filter(([, ids]) => ids.includes(type.id))
      .map(([day]) => day).sort();
    for (const run of consecutiveRuns(days)) {
      event(`${input.uidPrefix}-${type.id}-${run[0]}@vacation-planner`, run, type.name);
    }
  }

  if (input.gaps) {
    const needs = input.types.filter((t) => t.role === "needs_cover").map((t) => t.name);
    const label = "⚠ Not covered" + (needs.length ? ": " + needs.join(", ") : "");
    for (const run of consecutiveRuns(gapDays(input.types, input.entries))) {
      event(`${input.uidPrefix}-gap-${run[0]}@vacation-planner`, run, label);
    }
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
