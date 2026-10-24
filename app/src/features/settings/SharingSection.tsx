import { CalendarPlus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/confirm";
import { CopyField } from "@/components/CopyField";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { usePlanner } from "@/features/family/context";
import { api } from "@/lib/api";
import { getLang, t } from "@/lib/i18n";
import { Field, SettingsCard } from "./SettingsPage";

export function familyUrl(token: string) {
  return `${location.origin}/f/${token}/vacation`;
}

export function SharingSection() {
  const store = usePlanner();
  const family = store.family;
  if (!family) return null;
  const edit = !store.readOnly;

  async function rotate(
    link: "view" | "feed" | "legacy",
    message: string,
    action: string,
  ) {
    if (!(await confirm(message, action))) return;
    try {
      await store.rotateLink(link);
      toast(t(link === "legacy" ? "share.legacy_removed" : "share.rotated"));
    } catch (err) {
      toast(t("share.rotate_failed", { msg: (err as Error).message }));
    }
  }

  return (
    <>
      <SettingsCard title={t("share.title")} scope="family">
        {edit && family.id && (
          <Field label={t("share.edit")} help={t("share.edit_help")}>
            <CopyField value={familyUrl(family.id)} label={t("share.edit")} />
          </Field>
        )}
        <Field label={t("share.view")} help={t("share.view_help")}>
          {
            /* The view id of a planner from before families only opens the calendar, so it
              doesn't get to see the new view id: it shares itself. */
          }
          <CopyField
            value={familyUrl(family.readId ?? store.token)}
            label={t("share.view")}
          />
          {edit && (
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                rotate(
                  "view",
                  t("share.rotate_view_confirm"),
                  t("share.rotate"),
                )}
            >
              <RefreshCw /> {t("share.rotate")}
            </Button>
          )}
        </Field>
        {edit && family.legacyId && (
          <Field label={t("share.legacy")} help={t("share.legacy_help")}>
            <CopyField
              value={familyUrl(family.legacyId)}
              label={t("share.legacy")}
            />
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                rotate(
                  "legacy",
                  t("share.legacy_confirm"),
                  t("share.legacy_remove"),
                )}
            >
              <Trash2 /> {t("share.legacy_remove")}
            </Button>
          </Field>
        )}
      </SettingsCard>
      <FeedCard
        rotate={edit
          ? () => rotate("feed", t("share.rotate_feed_confirm"), t("share.rotate"))
          : undefined}
      />
    </>
  );
}

function FeedCard({ rotate }: { rotate?: () => void }) {
  const store = usePlanner();
  const types = store.types;
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [gaps, setGaps] = useState(() => types.some((x) => x.role === "needs_cover"));
  const [notes, setNotes] = useState(true);
  if (!store.family) return null;

  const params: Record<string, string> = {};
  const included = types.filter((x) => !excluded.has(x.id));
  if (included.length !== types.length) {
    params.types = included.map((x) => x.id).join(",");
  }
  if (gaps) params.gaps = "1";
  if (notes) params.notes = "1";
  if (getLang() !== "en") params.lang = getLang();
  const url = api.calendarUrl(store.family.feedId, params);

  return (
    <SettingsCard
      title={t("share.feed")}
      scope="family"
      description={<>{t("share.icloud_help")} {t("share.feed_help")}</>}
    >
      <fieldset className="rounded-lg border px-4 pt-2 pb-3">
        <legend className="px-1.5 text-xs font-semibold text-muted-foreground">
          {t("share.include")}
        </legend>
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1.5">
          {types.map((type) => (
            <label
              key={type.id}
              className="inline-flex items-center gap-2 text-sm"
            >
              <Checkbox
                checked={!excluded.has(type.id)}
                onCheckedChange={(on) => {
                  const next = new Set(excluded);
                  if (on) next.delete(type.id);
                  else next.add(type.id);
                  setExcluded(next);
                }}
              />
              {type.name}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={gaps} onCheckedChange={(v) => setGaps(!!v)} /> {t("share.gaps")}
        </label>
        <label className="mt-1.5 flex items-center gap-2 text-sm">
          <Checkbox checked={notes} onCheckedChange={(v) => setNotes(!!v)} /> {t("share.notes")}
        </label>
      </fieldset>
      <CopyField value={url} label={t("share.feed")} />
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={url.replace(/^https?:/, "webcal:")}>
            <CalendarPlus /> {t("share.subscribe")}
          </a>
        </Button>
        {rotate && (
          <Button variant="outline" onClick={rotate}>
            <RefreshCw /> {t("share.rotate")}
          </Button>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-primary">
          {t("share.howto")}
        </summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
          {/* Our own strings, with <b>/<i> markup. */}
          <li dangerouslySetInnerHTML={{ __html: t("share.howto_ios") }} />
          <li dangerouslySetInnerHTML={{ __html: t("share.howto_mac") }} />
          <li dangerouslySetInnerHTML={{ __html: t("share.howto_sync") }} />
        </ol>
      </details>
    </SettingsCard>
  );
}
