import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlanner } from "@/features/family/context";
import { type Lang, LANGS, setLang, t, useLang } from "@/lib/i18n";
import { setTheme, type Theme, useTheme } from "@/lib/theme";
import { Field, SettingsCard } from "./SettingsPage";

export function GeneralSection() {
  const store = usePlanner();
  const lang = useLang();
  const theme = useTheme();
  const saved = store.family?.name ?? "";
  const [name, setName] = useState(saved);
  useEffect(() => setName(saved), [saved]);

  const save = () => {
    const next = name.trim();
    if (!next) setName(saved);
    else if (next !== saved) store.rename(next);
  };

  return (
    <>
      {!store.readOnly && (
        <SettingsCard title={t("settings.name")} scope="family">
          <Field label={t("settings.name")} help={t("settings.name_help")}>
            <Input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </Field>
        </SettingsCard>
      )}
      <SettingsCard title={t("settings.theme")} scope="device">
        <Field label={t("settings.language")}>
          <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LANGS).map(([code, label]) => (
                <SelectItem key={code} value={code}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("settings.theme")}>
          <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["system", "light", "dark"] as const).map((v) => (
                <SelectItem key={v} value={v}>{t(`theme.${v}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </SettingsCard>
    </>
  );
}
