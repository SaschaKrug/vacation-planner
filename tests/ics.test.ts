import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildIcs, escapeText, foldLine } from "../supabase/functions/_shared/ics.ts";

Deno.test("escapes text values", () => {
  assertEquals(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
});

Deno.test("folds long lines at 75 octets", () => {
  const folded = foldLine("SUMMARY:" + "ä".repeat(60));
  for (const line of folded.split("\r\n")) {
    assert(new TextEncoder().encode(line).length <= 75);
  }
  assertEquals(folded.replace(/\r\n /g, ""), "SUMMARY:" + "ä".repeat(60));
});

Deno.test("merges consecutive days, also across months", () => {
  const ics = buildIcs({
    calendarName: "Test",
    uidPrefix: "r",
    types: [{
      session_id: "s",
      id: "v",
      name: "Vacation",
      color: "#000000",
      role: "covers",
      position: 0,
    }],
    entries: new Map([
      ["2026-01-30", ["v"]],
      ["2026-01-31", ["v"]],
      ["2026-02-01", ["v"]],
      ["2026-02-05", ["v"]],
    ]),
    now: new Date("2026-10-11T12:00:00Z"),
  });
  assertEquals(ics.match(/BEGIN:VEVENT/g)!.length, 2);
  assert(ics.includes("DTSTART;VALUE=DATE:20260130\r\nDTEND;VALUE=DATE:20260202"));
  assert(ics.includes("DTSTAMP:20261011T120000Z"));
  assert(ics.includes("UID:r-v-2026-01-30@vacation-planner"));
  assert(ics.endsWith("END:VCALENDAR\r\n"));
});
