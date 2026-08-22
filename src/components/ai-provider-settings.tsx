"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type {
  AiCredentialSource,
  AiProvider,
  AiSettingsResponse,
  OpenRouterModelChoice,
  OpenRouterModelDiscoveryRequest,
} from "@/contracts/api";
import {
  discoverOpenRouterModelChoices,
  getAiSettings,
  updateAiSettings,
} from "@/lib/client/api";
import { Button, Field, StateNotice, cn, inputClass, selectClass } from "./ui";

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

function discoveryInput(
  settings: AiSettingsResponse | null,
  provider: AiProvider | null,
  credentialSource: AiCredentialSource | null,
  apiKey: string,
): OpenRouterModelDiscoveryRequest | null {
  if (!settings || provider !== "openrouter" || !credentialSource) return null;
  if (credentialSource === "platform") {
    return settings.platformCredentials.openrouter
      ? { credentialSource: "platform" }
      : null;
  }
  const enteredKey = apiKey.trim();
  if (enteredKey.length >= 8) {
    return { credentialSource: "household", apiKey: enteredKey };
  }
  const savedHouseholdKey =
    settings.provider === "openrouter" &&
    settings.credentialSource === "household" &&
    settings.credentialConfigured;
  return savedHouseholdKey ? { credentialSource: "household" } : null;
}

function OpenRouterModelField({
  id,
  label,
  value,
  models,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  models: OpenRouterModelChoice[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const selectedChoice = models.some((model) => model.id === value)
    ? value
    : "";

  return (
    <Field
      label={label}
      htmlFor={id}
      hint="Choose a loaded model or enter a custom OpenRouter model ID."
    >
      <div className="flex flex-col gap-3">
        {models.length > 0 ? (
          <select
            id={`${id}-choice`}
            className={selectClass}
            aria-label={`${label} choices`}
            value={selectedChoice}
            disabled={disabled}
            onChange={(event) => {
              if (event.target.value) onChange(event.target.value);
            }}
          >
            <option value="">Choose from {models.length} loaded models</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} — {model.id}
              </option>
            ))}
          </select>
        ) : null}
        <input
          id={id}
          className={inputClass}
          autoComplete="off"
          maxLength={160}
          placeholder={
            models.length > 0 ? "Or enter a custom model ID" : "Model ID"
          }
          required
          spellCheck={false}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </Field>
  );
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
  const [openRouterModels, setOpenRouterModels] = useState<
    OpenRouterModelChoice[] | null
  >(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const discoveryGeneration = useRef(0);

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

  const loadOpenRouterModels = useCallback(
    async (input: OpenRouterModelDiscoveryRequest) => {
      const generation = ++discoveryGeneration.current;
      setModelsLoading(true);
      setModelsError(null);
      try {
        const result = await discoverOpenRouterModelChoices(input);
        if (generation !== discoveryGeneration.current) return;
        setOpenRouterModels(result.models);
      } catch (caught) {
        if (generation !== discoveryGeneration.current) return;
        setOpenRouterModels(null);
        setModelsError(
          caught instanceof Error
            ? caught.message
            : "OpenRouter model choices could not be loaded.",
        );
      } finally {
        if (generation === discoveryGeneration.current) {
          setModelsLoading(false);
        }
      }
    },
    [],
  );

  const selectedDiscoveryInput = useMemo(
    () =>
      discoveryInput(
        settings,
        draft?.provider ?? null,
        draft?.credentialSource ?? null,
        apiKey,
      ),
    [apiKey, draft?.credentialSource, draft?.provider, settings],
  );

  useEffect(() => {
    if (!settings?.canEdit || draft?.provider !== "openrouter") return;
    const input = selectedDiscoveryInput;
    if (!input) return;
    const delay = input.apiKey ? 700 : 0;
    const timeout = window.setTimeout(() => {
      void loadOpenRouterModels(input);
    }, delay);
    return () => {
      window.clearTimeout(timeout);
      discoveryGeneration.current += 1;
    };
  }, [draft?.provider, loadOpenRouterModels, selectedDiscoveryInput, settings?.canEdit]);

  if (apiMode !== "connected") {
    return (
      <>
        <div className="row min-h-[50px] px-1">
          <span className="bd flex-1">Local demo assistants</span>
          <span className="m text-[10.5px] text-[var(--ink-4)]">in use</span>
        </div>
        <div className="row min-h-[50px] px-1">
          <span className="bd flex-1 text-[var(--ink-4)]">
            Connect Supabase to choose OpenAI or OpenRouter
          </span>
          <span className="m text-[10.5px] text-[var(--ink-6)]">owner only</span>
        </div>
      </>
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
    setOpenRouterModels(null);
    setModelsError(null);
    setModelsLoading(false);
    discoveryGeneration.current += 1;
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
    <div>
      <div className="row min-h-[50px] px-1">
        <span className="bd min-w-0 flex-1 truncate">
          {settings
            ? `${providerLabel(settings.provider)} · ${settings.visionModelId}`
            : "AI provider"}
        </span>
        <span
          className={cn(
            "m flex-none text-[10.5px]",
            settings?.credentialConfigured ? "text-[var(--ink-4)]" : "text-[var(--time)]",
          )}
        >
          {settings ? (settings.credentialConfigured ? "in use" : "needs key") : "loading"}
        </span>
      </div>
      <div className="row min-h-0 px-1 py-3">
        <p className="bd text-[12px] text-[var(--ink-6)]">
          Applies to photo analysis, meal-intent parsing, and match explanations for everyone in this
          household.
        </p>
      </div>

      {loading ? (
        <p className="m px-1 py-4 text-[11px] text-[var(--ink-4)]" role="status">
          loading provider settings…
        </p>
      ) : error && !draft ? (
        <div className="px-1 py-4">
          <StateNotice title="Provider settings unavailable" tone="error">
            {error}
          </StateNotice>
        </div>
      ) : settings && draft ? (
        <form className="flex flex-col gap-6 px-1 py-6" onSubmit={save}>
          {!settings.canEdit ? (
            <StateNotice title="Owner-managed setting" tone="neutral">
              Only the household owner can change the provider, models, or
              billing credential. Members can see the current processing route.
            </StateNotice>
          ) : null}

          <Field
            label="Provider"
            htmlFor="ai-provider"
            hint="API keys and model choices belong to the provider selected here."
          >
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

          <fieldset disabled={!settings.canEdit || saving}>
            <legend className="ml">Credential source</legend>
            <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
              <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-[13.5px] font-light">
                <input
                  type="radio"
                  name="ai-credential-source"
                  value="platform"
                  checked={draft.credentialSource === "platform"}
                  onChange={() => {
                    setDraft({ ...draft, credentialSource: "platform" });
                    setApiKey("");
                    setOpenRouterModels(null);
                    setModelsError(null);
                    discoveryGeneration.current += 1;
                    setSaved(false);
                  }}
                />
                Platform key
              </label>
              <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-[13.5px] font-light">
                <input
                  type="radio"
                  name="ai-credential-source"
                  value="household"
                  checked={draft.credentialSource === "household"}
                  disabled={!settings.householdCredentialsAvailable}
                  onChange={() => {
                    setDraft({ ...draft, credentialSource: "household" });
                    setOpenRouterModels(null);
                    setModelsError(null);
                    discoveryGeneration.current += 1;
                    setSaved(false);
                  }}
                />
                Household key
              </label>
            </div>
          </fieldset>

          {draft.credentialSource === "platform" ? (
            <div className="flex flex-col gap-4">
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
              label={
                settings.credentialSource === "household" &&
                settings.provider === draft.provider
                  ? `Replace ${providerLabel(draft.provider)} API key`
                  : `${providerLabel(draft.provider)} API key`
              }
              htmlFor="ai-api-key"
              hint={
                householdCredentialNeedsReplacement
                  ? "A new key is required for this provider. Compatible model choices load automatically after entry."
                  : "Leave blank to retain the encrypted household key. Model choices load from the saved key, which is never shown again."
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
                  setOpenRouterModels(null);
                  setModelsError(null);
                  setSaved(false);
                }}
                required={householdCredentialNeedsReplacement}
              />
            </Field>
          )}

          {draft.provider === "openrouter" ? (
            <>
              <div className="grid gap-6 sm:grid-cols-2">
                <OpenRouterModelField
                  id="ai-vision-model"
                  label="Vision model"
                  value={draft.visionModelId}
                  models={
                    openRouterModels?.filter((model) => model.supportsVision) ??
                    []
                  }
                  disabled={!settings.canEdit || saving}
                  onChange={(visionModelId) => {
                    setDraft({ ...draft, visionModelId });
                    setSaved(false);
                  }}
                />
                <OpenRouterModelField
                  id="ai-recipe-model"
                  label="Recipe model"
                  value={draft.recipeModelId}
                  models={openRouterModels ?? []}
                  disabled={!settings.canEdit || saving}
                  onChange={(recipeModelId) => {
                    setDraft({ ...draft, recipeModelId });
                    setSaved(false);
                  }}
                />
              </div>

              {settings.canEdit ? (
                <div className="border-t border-[var(--hairline)] pt-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="bd text-[12px] text-[var(--ink-6)]" role="status">
                      {modelsLoading
                        ? "Loading compatible models from OpenRouter…"
                        : modelsError
                          ? "Model choices did not load."
                        : openRouterModels
                          ? openRouterModels.length > 0
                            ? `${openRouterModels.length} structured-output models loaded; ${openRouterModels.filter((model) => model.supportsVision).length} accept photos.`
                            : "OpenRouter returned no compatible structured-output models for this account."
                          : selectedDiscoveryInput
                            ? "Ready to load model choices from OpenRouter."
                            : "Enter an OpenRouter key to load model choices."}
                    </p>
                    <Button
                      type="button"
                      size="small"
                      variant="secondary"
                      className="w-full flex-none sm:w-auto"
                      busy={modelsLoading}
                      disabled={!selectedDiscoveryInput || saving}
                      onClick={() => {
                        if (selectedDiscoveryInput) {
                          void loadOpenRouterModels(selectedDiscoveryInput);
                        }
                      }}
                    >
                      {openRouterModels ? "Reload models" : "Load models"}
                    </Button>
                  </div>
                  {modelsError ? (
                    <div className="mt-4">
                      <StateNotice title="Model choices unavailable" tone="warning">
                        {modelsError} You can still enter model IDs manually.
                      </StateNotice>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Vision model ID" htmlFor="ai-vision-model">
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
          )}

          <p className="bd text-[12px] text-[var(--ink-6)]">
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
            <Button className="self-start" type="submit" busy={saving}>
              Save AI provider
            </Button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
