import { Copy } from "lucide-react";
import { copyText } from "@/components/CopyField";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePlanner } from "@/features/family/context";
import { api } from "@/lib/api";
import { getLang, t } from "@/lib/i18n";
import { SettingsCard } from "./SettingsPage";

export function IntegrationsSection() {
  const store = usePlanner();
  if (!store.family) return null;
  const prompt = t(
    store.readOnly ? "ai.prompt_text_readonly" : "ai.prompt_text",
    {
      url: api.agentUrl(store.token),
    },
  );

  return (
    <>
      <SettingsCard
        title={t("integrations.ai")}
        scope="family"
        description={t("ai.intro")}
      >
        {store.readOnly && <p className="text-sm text-muted-foreground">{t("ai.readonly")}</p>}
        <div className="grid gap-1.5">
          <div className="text-sm font-medium">{t("ai.quickstart")}</div>
          <div className="text-xs text-muted-foreground">
            {t("ai.quickstart_help")}
          </div>
          <Textarea
            readOnly
            value={prompt}
            aria-label={t("ai.prompt")}
            className="min-h-20 bg-muted text-[13px] [overflow-wrap:anywhere]"
          />
        </div>
        <Button onClick={() => copyText(prompt)}>
          <Copy /> {t("ai.copy")}
        </Button>
        {!store.readOnly && <p className="text-xs text-muted-foreground">{t("ai.warning")}</p>}
      </SettingsCard>
      <SettingsCard
        title={t("integrations.api")}
        scope="family"
        description={t("api.intro")}
      >
        <pre className="overflow-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed">{apiDocs(store)}</pre>
      </SettingsCard>
    </>
  );
}

/** Ready-to-run curl examples for this family. */
function apiDocs(store: ReturnType<typeof usePlanner>) {
  const base = api.calendarUrl("x").replace(
    /\/families\/x\/calendar\.ics$/,
    "",
  );
  const id = store.readOnly ? "<edit-id>" : store.family!.id;
  const type = store.types.find((x) => x.role === "covers") ?? store.types[0];
  const typeRef = type?.id ?? "vacation";
  const y = store.year;
  const lang = getLang();
  return `BASE=${base}
FAMILY=${id}

# ${t("api.read")}
curl "$BASE/families/$FAMILY?year=${y}"

# ${t("api.add", { name: type?.name ?? t("api.ex_vacation") })}
curl -X POST "$BASE/families/$FAMILY/entries" \\
  -H "content-type: application/json" \\
  -d '{"action":"add","type":"${typeRef}","from":"${y}-08-03","to":"${y}-08-14","skipWeekends":true}'

# ${t("api.ops")}
curl -X POST "$BASE/families/$FAMILY/entries" \\
  -H "content-type: application/json" \\
  -d '{"ops":[
        {"action":"remove","type":"${typeRef}","dates":["${y}-08-07"]},
        {"action":"set","types":["${typeRef}"],"dates":["${y}-12-24","${y}-12-31"]},
        {"action":"clear","from":"${y}-01-01","to":"${y}-01-06"}
      ]}'

# ${t("api.notes")}
curl -X POST "$BASE/families/$FAMILY/notes" \\
  -H "content-type: application/json" \\
  -d '{"ops":[
        {"action":"set","dates":["${y}-12-25"],"icon":"🎄","comment":"${t("api.ex_note")}"},
        {"action":"clear","dates":["${y}-12-31"]}
      ]}'

# ${t("api.types")}
curl "$BASE/families/$FAMILY/types?year=${y}"
curl -X POST "$BASE/families/$FAMILY/types?year=${y}" -H "content-type: application/json" \\
  -d '{"name":"${t("api.ex_needs")}","color":"#8b5cf6","role":"needs_cover"}'
curl -X PATCH "$BASE/families/$FAMILY/types/${typeRef}?year=${y}" \\
  -H "content-type: application/json" -d '{"name":"${t("api.ex_rename")}","color":"#22c55e"}'
curl -X DELETE "$BASE/families/$FAMILY/types/<type-id>?year=${y}"
curl -X POST "$BASE/families/$FAMILY/types/copy" -H "content-type: application/json" \\
  -d '{"from":${y},"to":${y + 1}}'

# ${t("api.feed")}
curl "$BASE/families/${store.family!.feedId}/calendar.ics"

# ${t("api.new")}
curl -X POST "$BASE/families" -H "content-type: application/json" \\
  -d '{"name":"${t("api.ex_planner", { year: y })}"${lang === "en" ? "" : `,"lang":"${lang}"`}}'`;
}
