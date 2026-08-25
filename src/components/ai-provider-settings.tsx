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
  AiProvider,
  AiSettingsResponse,
  OpenRouterModelChoice,
} from "@/contracts/api";
import {
  ApiClientError,
  discoverOpenRouterModelChoices,
  getAiSettings,
  updateAiSettings,
} from "@/lib/client/api";
import { Button, Field, StateNotice, cn, inputClass, selectClass } from "./ui";

type Draft = {
  provider: AiProvider;
  visionModelId: string;
  recipeModelId: string;
};

function toDraft(settings: AiSettingsResponse): Draft {
  return {
    provider: settings.provider,
    visionModelId: settings.visionModelId,
    recipeModelId: settings.recipeModelId,
  };
}

function providerLabel(provider: AiProvider) {
  return provider === "openrouter" ? "OpenRouter" : "OpenAI";
}

function discoveryInput(
  settings: AiSettingsResponse | null,
  provider: AiProvider | null,
  apiKey: string,
): { apiKey?: string } | null {
  if (!settings || provider !== "openrouter") return null;
  const enteredKey = apiKey.trim();
  if (enteredKey.length >= 8) {
    return { apiKey: enteredKey };
  }
  const savedHouseholdKey =
    settings.provider === "openrouter" && settings.credentialConfigured;
  return savedHouseholdKey ? {} : null;
}

const MODEL_RESULT_LIMIT = 20;

function searchableModelText(model: OpenRouterModelChoice) {
  return `${model.name} ${model.id}`.toLocaleLowerCase("en-US");
}

function modelMatches(model: OpenRouterModelChoice, query: string) {
  const terms = query
    .trim()
    .toLocaleLowerCase("en-US")
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return true;
  const searchable = searchableModelText(model);
  return terms.every((term) => searchable.includes(term));
}

function contextLabel(contextLength: number | null) {
  if (!contextLength) return null;
  if (contextLength >= 1_000_000) {
    return `${(contextLength / 1_000_000).toFixed(contextLength % 1_000_000 ? 1 : 0)}m context`;
  }
  if (contextLength >= 1_000) return `${Math.round(contextLength / 1_000)}k context`;
  return `${contextLength} context`;
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
  const [query, setQuery] = useState("");
  const selected = models.find((model) => model.id === value) ?? null;
  const matchingModels = useMemo(
    () => models.filter((model) => modelMatches(model, query)),
    [models, query],
  );
  const visibleModels = matchingModels.slice(0, MODEL_RESULT_LIMIT);
  const searchLabel = `Search ${label.toLocaleLowerCase("en-US")}s`;

  return (
    <Field
      label={label}
      htmlFor={models.length ? `${id}-search` : id}
      hint="Search loaded models by provider, name, or ID. Custom OpenRouter IDs remain available below."
    >
      <div className="flex flex-col gap-3">
        {selected ? (
          <div className="rounded-[18px] bg-[var(--ground-tint)] px-4 py-3">
            <p className="ml !text-[var(--sage)]">selected</p>
            <p className="nm mt-1.5 text-[14px]">{selected.name}</p>
            <p className="m mt-1 break-all text-[10.5px] text-[var(--ink-5)]">
              {selected.id}
            </p>
          </div>
        ) : value ? (
          <div className="rounded-[18px] bg-[var(--ground-tint)] px-4 py-3">
            <p className="ml !text-[var(--sage)]">custom selection</p>
            <p className="m mt-1.5 break-all text-[11px] text-[var(--ink-2)]">{value}</p>
          </div>
        ) : null}

        {models.length > 0 ? (
          <>
            <input
              id={`${id}-search`}
              type="search"
              className={inputClass}
              aria-label={searchLabel}
              autoComplete="off"
              placeholder={`Search ${models.length} models`}
              value={query}
              disabled={disabled}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div
              className="max-h-[17rem] overflow-y-auto rounded-[18px] bg-[var(--ground)] p-1.5"
              aria-label={`${label} search results`}
            >
              {visibleModels.length ? (
                visibleModels.map((model) => {
                  const active = model.id === value;
                  const metadata = [
                    contextLabel(model.contextLength),
                    model.supportsVision ? "accepts photos" : null,
                  ].filter(Boolean);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      aria-pressed={active}
                      disabled={disabled}
                      className={cn(
                        "flex min-h-[58px] w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition disabled:opacity-45",
                        active
                          ? "bg-[var(--ground-tint)]"
                          : "hover:bg-[var(--ground-hi)]",
                      )}
                      onClick={() => onChange(model.id)}
                    >
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          active ? "bg-[var(--accent)]" : "bg-[var(--edge-strong)]",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="nm block truncate text-[13px]">{model.name}</span>
                        <span className="m mt-0.5 block truncate text-[10px] text-[var(--ink-5)]">
                          {model.id}
                        </span>
                      </span>
                      {metadata.length ? (
                        <span className="m shrink-0 text-right text-[9px] leading-4 text-[var(--ink-5)]">
                          {metadata.map((item) => <span className="block" key={item}>{item}</span>)}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <p className="bd px-4 py-6 text-center text-[12.5px] text-[var(--ink-5)]">
                  No loaded model matches “{query.trim()}”.
                </p>
              )}
            </div>
            <p className="m px-1 text-[10px] text-[var(--ink-6)]" role="status">
              {matchingModels.length > MODEL_RESULT_LIMIT
                ? `Showing ${MODEL_RESULT_LIMIT} of ${matchingModels.length} matches · type more to narrow`
                : `${matchingModels.length} matching model${matchingModels.length === 1 ? "" : "s"}`}
            </p>
          </>
        ) : null}

        <details
          open={models.length === 0 || (!selected && Boolean(value))}
          className="rounded-[16px] bg-[var(--ground)] px-4 py-3"
        >
          <summary className="m cursor-pointer text-[11px] text-[var(--ink-4)]">
            Enter a custom model ID
          </summary>
          <input
            id={id}
            aria-label={`Custom ${label.toLocaleLowerCase("en-US")} ID`}
            className={`${inputClass} mt-3`}
            autoComplete="off"
            maxLength={160}
            placeholder="provider/model or provider/model~alias"
            required
            spellCheck={false}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        </details>
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
  const [clearing, setClearing] = useState(false);
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
    async (input: { apiKey?: string }) => {
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
      discoveryInput(settings, draft?.provider ?? null, apiKey),
    [apiKey, draft?.provider, settings],
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
        <div className="row">
          <span className="bd min-w-0 flex-1">Local demo assistants</span>
          <span className="m text-[11px] font-semibold text-[var(--sage)]">in use</span>
        </div>
        <div className="row">
          <span className="bd min-w-0 flex-1 text-[var(--ink-4)]">
            Connect Supabase to choose OpenAI or OpenRouter
          </span>
          <span className="m text-[11px] text-[var(--ink-5)]">owner only</span>
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

  // A saved key is bound to the provider it was entered for, so switching
  // providers always requires a fresh key.
  function householdKeyStillValid() {
    return Boolean(
      settings &&
        settings.credentialConfigured &&
        settings.provider === draft?.provider,
    );
  }

  function credentialAction() {
    if (apiKey.trim()) return "replace" as const;
    return householdKeyStillValid() ? ("retain" as const) : null;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings || !draft || !settings.canEdit) return;
    const action = credentialAction();
    if (!action) {
      setError(
        `Enter a ${providerLabel(draft.provider)} API key to finish this configuration.`,
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
      if (
        caught instanceof ApiClientError &&
        (caught.code === "VERSION_CONFLICT" ||
          caught.code === "AI_SETTINGS_PROVIDER_CHANGED")
      ) {
        try {
          const latest = await getAiSettings();
          setSettings(latest);
          setDraft(
            latest.provider === draft.provider ? draft : toDraft(latest),
          );
          setError(
            latest.provider === draft.provider
              ? "Settings changed while this form was open. The latest version is loaded and your model choices are still here; save again."
              : "The saved provider changed while this form was open. The latest provider and model choices are now loaded.",
          );
        } catch {
          setError(caught.message);
        }
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : "AI provider settings could not be saved.",
        );
      }
    } finally {
      // The credential lives only in component memory for this one request.
      setApiKey("");
      setSaving(false);
    }
  }

  async function removeSavedKey() {
    if (!settings || !draft || !settings.canEdit) return;
    setClearing(true);
    setSaved(false);
    setError(null);
    try {
      const next = await updateAiSettings({
        ...draft,
        credentialAction: "clear",
        expectedVersion: settings.version,
      });
      setSettings(next);
      setDraft(toDraft(next));
      setSaved(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The saved API key could not be removed.",
      );
    } finally {
      setApiKey("");
      setClearing(false);
    }
  }

  const keyIsBoundToCurrentProvider = householdKeyStillValid();

  return (
    <div className="flex flex-col gap-3">
      <div className="row">
        <span className="nm min-w-0 flex-1 truncate">
          {settings
            ? `${providerLabel(settings.provider)} · ${settings.visionModelId}`
            : "AI provider"}
        </span>
        <span
          className={cn(
            "m flex-none text-[11px] font-semibold",
            settings?.credentialConfigured ? "text-[var(--sage)]" : "text-[var(--time)]",
          )}
        >
          {settings ? (settings.credentialConfigured ? "in use" : "needs key") : "loading"}
        </span>
      </div>
      <p className="bd px-1 text-[12.5px] text-[var(--ink-5)]">
        Applies to photo analysis, meal-intent parsing, and match explanations for everyone in this
        household.
      </p>

      {loading ? (
        <p className="m px-1 py-4 text-[11px] text-[var(--ink-4)]" role="status">
          loading provider settings…
        </p>
      ) : error && !draft ? (
        <div className="py-2">
          <StateNotice title="Provider settings unavailable" tone="error">
            {error}
          </StateNotice>
        </div>
      ) : settings && draft ? (
        <form className="flex flex-col gap-6 py-2" onSubmit={save}>
          {!settings.canEdit ? (
            <StateNotice title="Owner-managed setting" tone="neutral">
              Only the household owner can change the provider, models, or
              billing credential. Members can see the current processing route.
            </StateNotice>
          ) : null}

          <Field
            label="Provider"
            htmlFor="ai-provider"
            hint="Your own API key and model choices belong to the provider selected here."
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

          <Field
            label={
              keyIsBoundToCurrentProvider
                ? `Replace ${providerLabel(draft.provider)} API key`
                : `${providerLabel(draft.provider)} API key`
            }
            htmlFor="ai-api-key"
            hint={
              keyIsBoundToCurrentProvider
                ? "Leave blank to retain the encrypted household key. Model choices load from the saved key, which is never shown again."
                : "Foodtopia never holds a shared key; each household supplies its own. Compatible model choices load automatically after entry."
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
              required={!keyIsBoundToCurrentProvider}
            />
          </Field>

          {keyIsBoundToCurrentProvider && settings.canEdit ? (
            <Button
              type="button"
              size="small"
              variant="secondary"
              busy={clearing}
              disabled={saving}
              className="self-start"
              onClick={() => {
                void removeSavedKey();
              }}
            >
              Remove saved key
            </Button>
          ) : null}

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
                <div className="rounded-[20px] bg-[var(--ground)] p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="bd text-[12px] text-[var(--ink-5)]" role="status">
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

          <p className="bd px-1 text-[12.5px] text-[var(--ink-5)]">
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
