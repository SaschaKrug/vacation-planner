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

Deno.test("localizes gap summaries and descriptions in German", () => {
  const type = (id: string, name: string, role: "covers" | "needs_cover") => ({
    session_id: "s",
    id,
    name,
    color: "#000000",
    role,
    position: 0,
  });
  const input = {
    calendarName: "Test",
    uidPrefix: "r",
    types: [type("k", "Kita zu", "needs_cover"), type("v", "Urlaub", "covers")],
    entries: new Map([
      // Mon + Tue not covered, then Sat + Sun vacation (0 workdays).
      ["2026-08-03", ["k"]],
      ["2026-08-04", ["k"]],
      ["2026-08-08", ["v"]],
      ["2026-08-09", ["v"]],
    ]),
    gaps: true,
    now: new Date("2026-10-11T12:00:00Z"),
  };
  const de = buildIcs({ ...input, lang: "de" });
  assert(de.includes("SUMMARY:⚠ Nicht abgedeckt: Kita zu\r\n"));
  assert(de.includes("DESCRIPTION:⚠ Nicht abgedeckt: Kita zu: 2 Tage (2 Arbeitstage)"));
  assert(de.includes("DESCRIPTION:Urlaub: 2 Tage (0 Arbeitstage)\r\n"));

  const en = buildIcs(input);
  assert(en.includes("SUMMARY:⚠ Not covered: Kita zu\r\n"));
  assert(en.includes("DESCRIPTION:Urlaub: 2 days (0 workdays)\r\n"));
  assertEquals(buildIcs({ ...input, lang: "en" }), en);
});
