import { Copy, Download, Upload } from "lucide-react";
import { useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { confirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { usePlanner } from "@/features/family/context";
import { today } from "@/features/vacation/store";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Field, SettingsCard } from "./SettingsPage";

function rateLimited(err: ApiError) {
  return err.status === 429 ? t("toast.rate_limited") : undefined;
}

export function DataSection() {
  const store = usePlanner();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const family = store.family;
  if (!family) return null;

  /** Downloads the family (all years, without its links) as a JSON file for Import. */
  async function exportFile() {
    if (store.pending) return toast(t("toast.wait_saving"));
    try {
      const data = await api.exportFamily(store.token);
      const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${family!.name.replace(/[\\/:*?"<>|]+/g, "-")} ${today}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch (err) {
      toast(t("toast.export_failed", { msg: (err as Error).message }));
    }
  }

  async function importFile(file: File) {
    if (store.pending) return toast(t("toast.wait_saving"));
    let data: { format?: string } | undefined;
    try {
      data = JSON.parse(await file.text());
    } catch {
      // handled below
    }
    // "vacation-planner": files exported before the rename.
    if (
      !data ||
      !["family-planner", "vacation-planner"].includes(data.format ?? "")
    ) {
      return toast(t("toast.import_invalid"));
    }
    if (
      !(await confirm(
        t("import.confirm", { name: family!.name, file: file.name }),
        t("menu.import"),
      ))
    ) {
      return;
    }
    try {
      await store.importFile(data);
      toast(t("data.imported"));
    } catch (err) {
      const e = err as ApiError;
      toast(rateLimited(e) ?? t("toast.import_failed", { msg: e.message }));
    }
  }

  /** Copies the family (all years) into a new one, with the user as its editor, and opens it.
   *  Viewers can clone too, which gives them an editable copy. */
  async function clone() {
    if (store.pending) return toast(t("toast.wait_saving"));
    if (
      !(await confirm(
        t("clone.confirm", { name: family!.name }),
        t("menu.clone"),
      ))
    ) return;
    try {
      // Names are limited to 80 characters; leave room for the " (copy)" suffix.
      const copy = t("clone.name", { name: family!.name.slice(0, 70) });
      const data = await api.cloneFamily(store.token, copy);
      navigate(`/f/${data.family.id}/vacation?y=${store.year}`);
    } catch (err) {
      const e = err as ApiError;
      toast(rateLimited(e) ?? t("toast.clone_failed", { msg: e.message }));
    }
  }

  return (
    <SettingsCard title={t("settings.data")} scope="family">
      <Field label={t("menu.export")} help={t("data.export_help")}>
        <Button
          variant="outline"
          className="justify-self-start"
          onClick={exportFile}
        >
          <Download /> {t("menu.export")}
        </Button>
      </Field>
      {!store.readOnly && (
        <Field label={t("menu.import")} help={t("data.import_help")}>
          <Button
            variant="outline"
            className="justify-self-start"
            onClick={() => fileRef.current?.click()}
          >
            <Upload /> {t("menu.import")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // picking the same file again fires "change" again
              if (file) {
                importFile(file);
              }
            }}
          />
        </Field>
      )}
      <Field label={t("menu.clone")} help={t("data.clone_help")}>
        <Button
          variant="outline"
          className="justify-self-start"
          onClick={clone}
        >
          <Copy /> {t("menu.clone")}
        </Button>
      </Field>
    </SettingsCard>
  );
}
