"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Cloud, KeyRound, Sparkles } from "lucide-react";

import type {
  AiCredentialSource,
  AiProvider,
  AiSettingsResponse,
} from "@/contracts/api";
import { getAiSettings, updateAiSettings } from "@/lib/client/api";
import {
  Badge,
  Button,
  Card,
  Field,
  inputClass,
  selectClass,
  StateNotice,
} from "./ui";

type Draft = {
  provider: AiProvider;
  visionModelId: string;
  recipeModelId: string;
  credentialSource: AiCredentialSource;
};

function toDraft(settings: AiSettingsResponse): Draft {
  return {
    provider: settings.provider,
    visionModelId: settings.visionModelId,
    recipeModelId: settings.recipeModelId,
    credentialSource: settings.credentialSource,
  };
}

function providerLabel(provider: AiProvider) {
  return provider === "openrouter" ? "OpenRouter" : "OpenAI";
}

export function AiProviderSettings({
  apiMode,
}: {
  apiMode: "connected" | "demo";
}) {
  const [settings, setSettings] = useState<AiSettingsResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(apiMode === "connected");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (apiMode !== "connected") return;
    let cancelled = false;
    void getAiSettings()
      .then((value) => {
        if (cancelled) return;
        setSettings(value);
        setDraft(toDraft(value));
        setError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setError("AI provider settings could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiMode]);

  if (apiMode !== "connected") {
    return (
      <Card className="mt-4">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Sparkles className="size-5 text-[var(--leaf)]" aria-hidden="true" />
          AI provider
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          This device-only demo uses built-in local assistants. Connect Supabase
          to configure OpenAI or OpenRouter for a household.
        </p>
      </Card>
    );
  }

  function selectProvider(provider: AiProvider) {
    if (!settings || !draft) return;
    const defaults = settings.modelDefaults[provider];
    setDraft({
      ...draft,
      provider,
      visionModelId: defaults.visionModelId ?? "",
      recipeModelId: defaults.recipeModelId ?? "",
    });
    setApiKey("");
    setSaved(false);
  }

  function credentialAction() {
    if (!settings || !draft) return "retain" as const;
    if (draft.credentialSource === "platform") {
      return settings.credentialSource === "household" ||
        settings.provider !== draft.provider
        ? ("clear" as const)
        : ("retain" as const);
    }
    if (apiKey.trim()) return "replace" as const;
    return "retain" as const;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings || !draft || !settings.canEdit) return;
    const action = credentialAction();
    const householdCredentialNeedsReplacement =
      draft.credentialSource === "household" &&
      (settings.credentialSource !== "household" ||
        settings.provider !== draft.provider);
    if (householdCredentialNeedsReplacement && !apiKey.trim()) {
      setError(
        "Enter a new API key when choosing household credentials or changing their provider.",
      );
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await updateAiSettings({
        ...draft,
        credentialAction: action,
        expectedVersion: settings.version,
        ...(action === "replace" ? { apiKey: apiKey.trim() } : {}),
      });
      setSettings(next);
      setDraft(toDraft(next));
      setSaved(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "AI provider settings could not be saved.",
      );
    } finally {
      // The credential lives only in component memory for this one request.
      setApiKey("");
      setSaving(false);
    }
  }

  const selectedPlatformAvailable = draft
    ? settings?.platformCredentials[draft.provider] ?? false
    : false;
  const householdCredentialNeedsReplacement = Boolean(
    settings &&
      draft?.credentialSource === "household" &&
      (settings.credentialSource !== "household" ||
        settings.provider !== draft.provider),
  );

  return (
    <Card className="mt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <Sparkles className="size-5 text-[var(--leaf)]" aria-hidden="true" />
            AI provider
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Applies to photo analysis, meal-intent parsing, and match
            explanations for everyone in this household.
          </p>
        </div>
        {settings ? (
          <Badge tone={settings.credentialConfigured ? "green" : "orange"}>
            {settings.credentialConfigured ? "Ready" : "Needs key"}
          </Badge>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-[var(--muted)]" role="status">
          Loading provider settings…
        </p>
      ) : error && !draft ? (
        <div className="mt-4">
          <StateNotice title="Provider settings unavailable" tone="error">
            {error}
          </StateNotice>
        </div>
      ) : settings && draft ? (
        <form className="mt-4 space-y-4" onSubmit={save}>
          {!settings.canEdit ? (
            <StateNotice title="Owner-managed setting" tone="neutral">
              Only the household owner can change the provider, models, or
              billing credential. Members can see the current processing route.
            </StateNotice>
          ) : null}

          <Field label="Provider" htmlFor="ai-provider">
            <select
              id="ai-provider"
              className={selectClass}
              value={draft.provider}
              disabled={!settings.canEdit || saving}
              onChange={(event) =>
                selectProvider(event.target.value as AiProvider)
              }
            >
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Vision model ID"
              htmlFor="ai-vision-model"
              hint={draft.provider === "openrouter" ? "For example, provider/model-name." : undefined}
            >
              <input
                id="ai-vision-model"
                className={inputClass}
                maxLength={160}
                required
                spellCheck={false}
                value={draft.visionModelId}
                disabled={!settings.canEdit || saving}
                onChange={(event) => {
                  setDraft({ ...draft, visionModelId: event.target.value });
                  setSaved(false);
                }}
              />
            </Field>
            <Field label="Recipe model ID" htmlFor="ai-recipe-model">
              <input
                id="ai-recipe-model"
                className={inputClass}
                maxLength={160}
                required
                spellCheck={false}
                value={draft.recipeModelId}
                disabled={!settings.canEdit || saving}
                onChange={(event) => {
                  setDraft({ ...draft, recipeModelId: event.target.value });
                  setSaved(false);
                }}
              />
            </Field>
          </div>

          <fieldset disabled={!settings.canEdit || saving}>
            <legend className="text-sm font-bold">Credential source</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-[var(--line)] bg-white px-3 text-sm font-bold">
                <input
                  type="radio"
                  name="ai-credential-source"
                  value="platform"
                  checked={draft.credentialSource === "platform"}
                  onChange={() => {
                    setDraft({ ...draft, credentialSource: "platform" });
                    setApiKey("");
                    setSaved(false);
                  }}
                />
                <Cloud className="size-4 text-[var(--leaf)]" aria-hidden="true" />
                Platform key
              </label>
              <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-[var(--line)] bg-white px-3 text-sm font-bold">
                <input
                  type="radio"
                  name="ai-credential-source"
                  value="household"
                  checked={draft.credentialSource === "household"}
                  disabled={!settings.householdCredentialsAvailable}
                  onChange={() => {
                    setDraft({ ...draft, credentialSource: "household" });
                    setSaved(false);
                  }}
                />
                <KeyRound className="size-4 text-[var(--leaf)]" aria-hidden="true" />
                Household key
              </label>
            </div>
          </fieldset>

          {draft.credentialSource === "platform" ? (
            <div className="space-y-2">
              <StateNotice
                title={`${providerLabel(draft.provider)} platform key ${selectedPlatformAvailable ? "available" : "missing"}`}
                tone={selectedPlatformAvailable ? "success" : "warning"}
              >
                The deployment operator manages this key. It is never sent to
                the browser.
              </StateNotice>
              {settings.credentialSource === "household" ? (
                <StateNotice title="Household key will be cleared" tone="warning">
                  Saving this platform route permanently removes the encrypted
                  household credential.
                </StateNotice>
              ) : null}
            </div>
          ) : (
            <Field
              label={settings.credentialSource === "household" ? "Replace API key" : "API key"}
              htmlFor="ai-api-key"
              hint={
                householdCredentialNeedsReplacement
                  ? "A new key is required for this provider."
                  : "Leave blank to retain the encrypted household key. Saved keys are never shown again."
              }
            >
              <input
                id="ai-api-key"
                className={inputClass}
                type="password"
                autoComplete="new-password"
                maxLength={1024}
                spellCheck={false}
                value={apiKey}
                disabled={!settings.canEdit || saving}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setSaved(false);
                }}
                required={householdCredentialNeedsReplacement}
              />
            </Field>
          )}

          <p className="text-xs leading-5 text-[var(--muted)]">
            OpenRouter routes requests to the selected model&apos;s underlying
            provider. An owner may change this household route later; members
            should review the current route before a first photo scan.
          </p>

          {error ? (
            <StateNotice title="Provider settings not saved" tone="error">
              {error}
            </StateNotice>
          ) : null}
          {saved ? (
            <StateNotice title="Provider settings saved" tone="success">
              New AI requests will use this route. Already-running work keeps the
              configuration resolved when that job started.
            </StateNotice>
          ) : null}

          {settings.canEdit ? (
            <Button className="w-full" type="submit" busy={saving}>
              Save AI provider
            </Button>
          ) : null}
        </form>
      ) : null}
    </Card>
  );
}
