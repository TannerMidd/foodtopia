"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";

import { DEFAULT_STAPLE_CONCEPT_IDS, getFoodConcept } from "@/domain/concepts";
import { resolveFoodConcept } from "@/domain/normalization";
import {
  getCurrentHousehold,
  getHouseholdPreferences,
  updateHouseholdPreferences,
} from "@/lib/client/api";
import { clearFoodtopiaCaches, signOut } from "@/lib/client/auth";
import { AiProviderSettings } from "./ai-provider-settings";
import { useOfflineInventory } from "./offline-provider";
import { Page, Section, StateNotice, cn } from "./ui";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const preferenceOptions = [
  { label: "vegetarian", value: "vegetarian" },
  { label: "vegan", value: "vegan" },
  { label: "dairy-free", value: "dairy-free" },
] as const;
const defaultStaples: string[] = [...DEFAULT_STAPLE_CONCEPT_IDS];

function normalizeStaple(value: string) {
  if (value.trim().toLowerCase() === "neutral cooking oil") return "vegetable-oil";
  return resolveFoodConcept(value)?.id ?? value;
}

function stapleLabel(id: string) {
  if (id === "vegetable-oil") return "neutral cooking oil";
  return (getFoodConcept(id)?.name ?? id).toLowerCase();
}

function writeLocalPreferences(preferences: string[], staples: string[]) {
  try {
    localStorage.setItem("foodtopia:preferences", JSON.stringify({ preferences, staples }));
  } catch {
    // A blocked preference store should not stop the settings UI.
  }
}

function readLocalPreferences() {
  if (typeof window === "undefined") {
    return { preferences: [] as string[], staples: defaultStaples };
  }
  try {
    const raw = localStorage.getItem("foodtopia:preferences");
    if (!raw) return { preferences: [] as string[], staples: defaultStaples };
    const parsed = JSON.parse(raw) as { preferences?: string[]; staples?: string[] };
    return {
      preferences: (parsed.preferences ?? []).map((value) =>
        value.toLowerCase().replace(" preference", ""),
      ),
      staples: (parsed.staples ?? defaultStaples).map(normalizeStaple),
    };
  } catch {
    return { preferences: [] as string[], staples: defaultStaples };
  }
}

function isInstalledDisplayMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function SettingsScreen() {
  const router = useRouter();
  const { apiMode, clear } = useOfflineInventory();
  const [preferences, setPreferences] = useState<string[]>([]);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [staples, setStaples] = useState<string[]>(defaultStaples);
  const [newStaple, setNewStaple] = useState("");
  const [addingStaple, setAddingStaple] = useState(false);
  const [stapleError, setStapleError] = useState<string | null>(null);
  const [preferenceSaveError, setPreferenceSaveError] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const signingOutRef = useRef(false);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const timeout = window.setTimeout(() => {
      setInstalled(isInstalledDisplayMode());
      setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent));
    }, 0);
    window.addEventListener("beforeinstallprompt", handler);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const local = readLocalPreferences();
      setPreferences(local.preferences);
      setStaples(local.staples);
    }, 0);
    if (apiMode !== "connected") return () => window.clearTimeout(timeout);
    let cancelled = false;
    void getHouseholdPreferences()
      .then((remote) => {
        if (cancelled || signingOutRef.current) return;
        setPreferences(remote.dietaryTags);
        setStaples(remote.staples);
        writeLocalPreferences(remote.dietaryTags, remote.staples);
        setPreferenceSaveError(false);
      })
      .catch(() => {
        if (!cancelled) setPreferenceSaveError(true);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [apiMode]);

  useEffect(() => {
    if (apiMode !== "connected") {
      const timeout = window.setTimeout(() => setHouseholdName("Maple Street"), 0);
      return () => window.clearTimeout(timeout);
    }
    let cancelled = false;
    void getCurrentHousehold()
      .then((household) => {
        if (!cancelled) setHouseholdName(household.name);
      })
      .catch(() => {
        // The settings remain usable with a generic household label.
      });
    return () => {
      cancelled = true;
    };
  }, [apiMode]);

  function persist(nextPreferences: string[], nextStaples: string[]) {
    setPreferences(nextPreferences);
    setStaples(nextStaples);
    writeLocalPreferences(nextPreferences, nextStaples);
    if (apiMode === "connected") {
      setPreferenceSaveError(false);
      void updateHouseholdPreferences({
        dietaryTags: nextPreferences,
        staples: nextStaples,
        excludedConceptIds: [],
      }).catch(() => setPreferenceSaveError(true));
    }
  }

  function addStaple(event: FormEvent) {
    event.preventDefault();
    const value = newStaple.trim().toLowerCase();
    if (!value) return;
    const conceptId = value === "neutral cooking oil" ? "vegetable-oil" : resolveFoodConcept(value)?.id;
    if (!conceptId) {
      setStapleError("Choose a recognized food so recipe evidence can match it.");
      return;
    }
    setStapleError(null);
    if (!staples.includes(conceptId)) persist(preferences, [...staples, conceptId]);
    setNewStaple("");
    setAddingStaple(false);
  }

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  }

  async function logout() {
    signingOutRef.current = true;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      await clear();
      await clearFoodtopiaCaches();
      router.replace("/sign-in");
      router.refresh();
    }
  }

  return (
    <Page className="max-w-[44rem]">
      <header>
        <p className="ml">settings{householdName ? ` · ${householdName.toLowerCase()}` : ""}</p>
        <h1 className="hd mt-3 text-[clamp(1.5rem,6vw,1.65rem)]">How Foodtopia behaves.</h1>
      </header>

      <div className="mt-9 flex flex-col gap-8">
        <Section label="assistant" labelWidth="78px">
          <AiProviderSettings apiMode={apiMode} />
        </Section>

        <Section label="preferences" labelWidth="78px">
          <div className="row min-h-[50px] flex-wrap gap-x-6 gap-y-2 px-1 py-2">
            {preferenceOptions.map((option) => {
              const selected = preferences.includes(option.value);
              const next = selected
                ? preferences.filter((item) => item !== option.value)
                : [...preferences, option.value];
              return (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  key={option.value}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-2.5 transition",
                    selected ? "text-[var(--ink)]" : "text-[var(--ink-6)] hover:text-[var(--ink-3)]",
                  )}
                  onClick={() => persist(next, staples)}
                >
                  <span className={selected ? "nm text-[14px]" : "m text-[10.5px]"}>{option.label}</span>
                  {selected && <span className="m text-[10.5px] text-[var(--accent)]">on</span>}
                </button>
              );
            })}
          </div>
          <div className="row min-h-0 px-1 py-3">
            <p className="bd text-[12px] text-[var(--time)]">
              Preferences only rank suggestions. They are not allergy controls — verify packages,
              preparation and cross-contact yourself.
            </p>
          </div>
          {preferenceSaveError && (
            <div className="px-1 py-3">
              <StateNotice title="Preferences not synced" tone="warning">
                This device kept the edit, but the shared household copy could not be updated.
                Reconnect and try again.
              </StateNotice>
            </div>
          )}
        </Section>

        <Section label="staples" labelWidth="78px">
          <div className="px-1 pt-3.5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
              {staples.map((staple) => (
                <span key={staple} className="m inline-flex items-center gap-1.5 text-[11px] text-[var(--ink-2)]">
                  {stapleLabel(staple)}
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center text-[var(--ink-6)] hover:text-[var(--time)]"
                    onClick={() => persist(preferences, staples.filter((item) => item !== staple))}
                    aria-label={`Remove ${stapleLabel(staple)}`}
                  >
                    <X className="size-2.5" aria-hidden="true" />
                  </button>
                </span>
              ))}
              {addingStaple ? (
                <form onSubmit={addStaple} className="inline-flex items-center gap-2.5">
                  <label htmlFor="new-staple" className="sr-only">
                    Add staple
                  </label>
                  <input
                    id="new-staple"
                    autoFocus
                    className="m w-40 border-b border-[var(--edge-strong)] bg-transparent pb-1 text-[11px] text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                    maxLength={80}
                    value={newStaple}
                    onChange={(event) => setNewStaple(event.target.value)}
                    onBlur={() => {
                      if (!newStaple.trim()) setAddingStaple(false);
                    }}
                  />
                  <button type="submit" className="m text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]">
                    add
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="m text-[11px] text-[var(--ink-6)] hover:text-[var(--ink-3)]"
                  onClick={() => setAddingStaple(true)}
                >
                  + add
                </button>
              )}
            </div>
            {stapleError && (
              <p className="bd mt-3 text-[12px] text-[var(--time)]" role="alert">
                {stapleError}
              </p>
            )}
            <p className="bd mt-3 pb-4 text-[12px] text-[var(--ink-6)]">
              Recipes call these “staple”, never “known present.”
            </p>
          </div>
        </Section>

        <Section label="this device" labelWidth="78px">
          <div className="row min-h-0 px-1 py-3.5">
            <p className="bd text-[12.5px]">
              Snapshots and queued edits live on this device for the active household. Raw photos never
              do. Signing out clears both, along with Foodtopia&rsquo;s local keys and caches.
            </p>
          </div>
          <div className="row min-h-[50px] px-1">
            <span className="bd flex-1 text-[var(--ink-3)]">Install Foodtopia</span>
            {installed ? (
              <span className="m text-[10.5px] text-[var(--ink-6)]">installed</span>
            ) : installPrompt ? (
              <button
                type="button"
                className="m border-b border-[var(--accent-rule)] pb-0.5 text-[10.5px] text-[var(--ink)]"
                onClick={() => void install()}
              >
                install
              </button>
            ) : (
              <span className="m text-[10.5px] text-[var(--ink-6)]">
                {isIOS ? "share → add to home screen" : "from the browser menu"}
              </span>
            )}
          </div>
          <div className="row min-h-[50px] px-1">
            <span className="bd flex-1 text-[var(--ink-3)]">The beta privacy notice</span>
            <Link href="/privacy" className="m text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]">
              read
            </Link>
          </div>
          <div className="row min-h-[50px] px-1">
            <span className="bd flex-1 text-[var(--ink-3)]">Sign out and clear this device</span>
            <button
              type="button"
              className="m text-[10.5px] text-[var(--ink-4)] hover:text-[var(--time)] disabled:opacity-40"
              disabled={signingOut}
              onClick={() => void logout()}
            >
              {signingOut ? "signing out…" : "sign out"}
            </button>
          </div>
        </Section>

        <p className="bd border-t border-[var(--hairline)] pt-4 text-[12px] text-[var(--ink-6)]">
          Offline edits replay only when Foodtopia is open, focused and reconnected. Photo analysis,
          uploads, recipes and the ingredient check all need connectivity.
        </p>
      </div>
    </Page>
  );
}
