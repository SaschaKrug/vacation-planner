import { CircleCheck, CircleX, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useChat, usePlanner } from "@/features/family/context";
import { type AiSettings, type AiSettingsPatch, api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Field, SettingsCard } from "./SettingsPage";

const PRESETS: [string, string][] = [
  ["OpenAI", "https://api.openai.com/v1"],
  ["OpenRouter", "https://openrouter.ai/api/v1"],
  ["Mistral", "https://api.mistral.ai/v1"],
  ["Groq", "https://api.groq.com/openai/v1"],
  ["Ollama (local)", "http://localhost:11434/v1"],
];

export function AiSection() {
  const planner = usePlanner();
  const chat = useChat();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[] | null>(null);
  const [searchProvider, setSearchProvider] = useState<
    AiSettings["searchProvider"]
  >("none");
  const [searchKey, setSearchKey] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "models" | "test">("");
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const token = planner.token;

  const apply = (s: AiSettings) => {
    setSettings(s);
    setBaseUrl(s.baseUrl);
    setModel(s.model);
    setSearchProvider(s.searchProvider);
    setApiKey("");
    setSearchKey("");
    chat.setSettings(s);
  };

  useEffect(() => {
    if (planner.readOnly) return;
    api.aiSettings(token).then(apply).catch((err) => toast((err as Error).message));
    // Load once per family.
  }, [token, planner.readOnly]);

  if (planner.readOnly) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("ai_settings.edit_only")}
      </p>
    );
  }
  if (!settings) {
    return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  }

  async function save(patch: AiSettingsPatch = {}) {
    setBusy("save");
    try {
      const body: AiSettingsPatch = {
        baseUrl,
        model,
        searchProvider,
        ...patch,
      };
      if (apiKey) body.apiKey = apiKey;
      if (searchKey) body.searchKey = searchKey;
      apply(await api.saveAiSettings(token, body));
      toast(t("ai_settings.saved"));
    } catch (err) {
      toast(t("ai_settings.save_failed", { msg: (err as Error).message }));
    }
    setBusy("");
  }

  async function loadModels() {
    setBusy("models");
    try {
      const res = await api.aiModels(token, {
        baseUrl,
        ...(apiKey ? { apiKey } : {}),
      });
      setModels(res.models);
      if (!model && res.models.length) setModel(res.models[0]);
      if (!res.models.length) toast(t("ai_settings.no_models"));
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy("");
  }

  async function runTest() {
    setBusy("test");
    setTest(null);
    try {
      const res = await api.aiTest(token);
      setTest({
        ok: true,
        text: t("ai_settings.test_ok", {
          model: res.model,
          reply: res.reply || "…",
        }),
      });
    } catch (err) {
      setTest({ ok: false, text: (err as Error).message });
    }
    setBusy("");
  }

  const dirty = baseUrl !== settings.baseUrl || model !== settings.model ||
    !!apiKey ||
    searchProvider !== settings.searchProvider || !!searchKey;

  return (
    <>
      {!settings.serverReady && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {t("ai_settings.server_not_ready")}
        </p>
      )}
      <SettingsCard
        title={t("ai_settings.endpoint")}
        scope="family"
        description={t("ai_settings.endpoint_help")}
      >
        <Field
          label={t("ai_settings.base_url")}
          help={t("ai_settings.base_url_help")}
        >
          <Input
            value={baseUrl}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setModels(null);
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([name, url]) => (
              <Button
                key={name}
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  setBaseUrl(url);
                  setModels(null);
                }}
              >
                {name}
              </Button>
            ))}
          </div>
        </Field>
        <Field
          label={t("ai_settings.api_key")}
          help={settings.hasKey
            ? t("ai_settings.key_saved", { hint: settings.keyHint })
            : t("ai_settings.key_help")}
        >
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={settings.hasKey ? `••••••••${settings.keyHint}` : "sk-…"}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {settings.hasKey && (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => save({ apiKey: "" })}
              >
                {t("ai_settings.remove_key")}
              </Button>
            )}
          </div>
        </Field>
        <Field
          label={t("ai_settings.model")}
          help={t("ai_settings.model_help")}
        >
          <div className="flex gap-2">
            {models?.length
              ? (
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("ai_settings.pick_model")} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-80">
                    {[...new Set([model, ...models].filter(Boolean))].map((
                      m,
                    ) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              )
              : (
                <Input
                  value={model}
                  placeholder="gpt-4.1-mini"
                  spellCheck={false}
                  onChange={(e) => setModel(e.target.value)}
                />
              )}
            <Button
              variant="outline"
              disabled={!baseUrl || !!busy}
              onClick={loadModels}
            >
              {busy === "models" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t("ai_settings.load_models")}
            </Button>
          </div>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!!busy || !dirty} onClick={() => save()}>
            {busy === "save" && <Loader2 className="animate-spin" />} {t("note.save")}
          </Button>
          <Button
            variant="outline"
            disabled={!!busy || !settings.configured || dirty}
            onClick={runTest}
          >
            {busy === "test" && <Loader2 className="animate-spin" />} {t("ai_settings.test")}
          </Button>
          {test && (
            <span
              className={`inline-flex items-center gap-1.5 text-sm ${
                test.ok ? "text-ok" : "text-gap"
              }`}
            >
              {test.ok ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}{" "}
              {test.text}
            </span>
          )}
        </div>
      </SettingsCard>

      <SettingsCard
        title={t("ai_settings.search")}
        scope="family"
        description={t("ai_settings.search_help")}
      >
        <Field label={t("ai_settings.search_provider")}>
          <Select
            value={searchProvider}
            onValueChange={(v) => setSearchProvider(v as AiSettings["searchProvider"])}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {t("ai_settings.search_off")}
              </SelectItem>
              <SelectItem value="tavily">Tavily</SelectItem>
              <SelectItem value="brave">Brave Search</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {searchProvider !== "none" && (
          <Field
            label={t("ai_settings.search_key")}
            help={settings.hasSearchKey
              ? t("ai_settings.key_saved", { hint: settings.searchKeyHint })
              : undefined}
          >
            <Input
              type="password"
              autoComplete="off"
              value={searchKey}
              placeholder={settings.hasSearchKey ? `••••••••${settings.searchKeyHint}` : ""}
              onChange={(e) => setSearchKey(e.target.value)}
            />
          </Field>
        )}
        <Button
          className="justify-self-start"
          disabled={!!busy || !dirty}
          onClick={() => save()}
        >
          {t("note.save")}
        </Button>
      </SettingsCard>

      <SettingsCard title={t("ai_settings.permissions")} scope="family">
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            {t("ai_settings.allow_writes")}
            <span className="block text-xs text-muted-foreground">
              {t("ai_settings.allow_writes_help")}
            </span>
          </span>
          <Switch
            checked={settings.allowWrites}
            onCheckedChange={(v) => save({ allowWrites: v })}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {t("ai_settings.privacy")}
        </p>
      </SettingsCard>
    </>
  );
}
