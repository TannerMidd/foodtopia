"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Download,
  LockKeyhole,
  LogOut,
  Plus,
  Share,
  ShieldAlert,
  WifiOff,
  X,
} from "lucide-react";

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
import {
  Badge,
  Button,
  Card,
  Field,
  inputClass,
  Page,
  PageHeader,
  StateNotice,
} from "./ui";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const preferenceOptions = [
  { label: "Vegetarian", value: "vegetarian" },
  { label: "Vegan", value: "vegan" },
  { label: "Dairy-free preference", value: "dairy-free" },
] as const;
const defaultStaples: string[] = [...DEFAULT_STAPLE_CONCEPT_IDS];

function normalizeStaple(value: string) {
  if (value.trim().toLowerCase() === "neutral cooking oil") {
    return "vegetable-oil";
  }
  return resolveFoodConcept(value)?.id ?? value;
}

function stapleLabel(id: string) {
  if (id === "vegetable-oil") return "neutral cooking oil";
  return getFoodConcept(id)?.name ?? id;
}

function writeLocalPreferences(preferences: string[], staples: string[]) {
  try {
    localStorage.setItem(
      "foodtopia:preferences",
      JSON.stringify({ preferences, staples }),
    );
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
    const parsed = JSON.parse(raw) as {
      preferences?: string[];
      staples?: string[];
    };
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
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function SettingsScreen() {
  const router = useRouter();
  const { apiMode, clear } = useOfflineInventory();
  const [preferences, setPreferences] = useState<string[]>([]);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [staples, setStaples] = useState<string[]>(defaultStaples);
  const [newStaple, setNewStaple] = useState("");
  const [stapleError, setStapleError] = useState<string | null>(null);
  const [preferenceSaveError, setPreferenceSaveError] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
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
    if (apiMode !== "connected") {
      return () => window.clearTimeout(timeout);
    }
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
    const conceptId = value === "neutral cooking oil"
      ? "vegetable-oil"
      : resolveFoodConcept(value)?.id;
    if (!conceptId) {
      setStapleError(
        "Choose a recognized food so recipe evidence can match it.",
      );
      return;
    }
    setStapleError(null);
    if (!staples.includes(conceptId)) {
      persist(preferences, [...staples, conceptId]);
    }
    setNewStaple("");
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
    <Page>
      <PageHeader
        eyebrow={householdName ?? "Household"}
        title="Settings"
        description="Preferences shape ranking but never override ingredient evidence or label checks."
      />

      <AiProviderSettings apiMode={apiMode} />

      <Card className="mt-4">
        <h2 className="text-lg font-extrabold">Food preferences</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Used to rank and filter suggestions. These are not allergy controls.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
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
                className={`flex min-h-12 items-center gap-3 rounded-2xl border px-3 text-left text-sm font-bold ${selected ? "border-[var(--leaf)] bg-[var(--sprout)]" : "border-[var(--line)] bg-white"}`}
                onClick={() => persist(next, staples)}
              >
                <span
                  className={`flex size-6 items-center justify-center rounded-lg border ${selected ? "border-[var(--leaf)] bg-[var(--leaf)] text-white" : "border-[var(--line)]"}`}
                >
                  {selected ? <span aria-hidden="true">✓</span> : null}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
        {preferenceSaveError ? (
          <div className="mt-3">
            <StateNotice title="Preferences not synced" tone="warning">
              This device kept the edit, but the shared household copy could not
              be updated. Reconnect and try again.
            </StateNotice>
          </div>
        ) : null}
        <div className="mt-4">
          <StateNotice title="No allergen-safety claims" tone="warning">
            <span className="inline-flex items-start gap-1">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Always verify packages, substitutions, preparation, and
              cross-contact. A preference match does not mean a dish is safe.
            </span>
          </StateNotice>
        </div>
      </Card>

      <Card className="mt-4">
        <h2 className="text-lg font-extrabold">Assumed staples</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Recipes may label these “assumed staple,” never “known present.”
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {staples.map((staple) => (
            <Badge key={staple} tone="green" className="gap-1.5 pl-3">
              {stapleLabel(staple)}
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded-full"
                onClick={() =>
                  persist(
                    preferences,
                    staples.filter((item) => item !== staple),
                  )
                }
                aria-label={`Remove ${stapleLabel(staple)}`}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
        </div>
        <form onSubmit={addStaple} className="mt-4 flex gap-2">
          <Field label="Add staple" htmlFor="new-staple">
            <input
              id="new-staple"
              className={inputClass}
              maxLength={80}
              value={newStaple}
              onChange={(event) => setNewStaple(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            size="icon"
            className="mt-[1.65rem]"
            aria-label="Add staple"
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </form>
        {stapleError ? (
          <p className="mt-2 text-xs font-semibold text-[var(--danger)]">
            {stapleError}
          </p>
        ) : null}
      </Card>

      <Card className="mt-4">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--sprout)] text-[var(--leaf)]">
            <Download className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-extrabold">Install Foodtopia</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Standalone display, a home-screen icon, and offline inventory
              access after the app has loaded.
            </p>
          </div>
        </div>
        {installed ? (
          <div className="mt-4">
            <StateNotice title="Installed on this device" tone="success">
              Launch Foodtopia from the home screen for the app-like layout.
            </StateNotice>
          </div>
        ) : installPrompt ? (
          <Button className="mt-4 w-full" onClick={() => void install()}>
            <Download className="size-4" aria-hidden="true" /> Install app
          </Button>
        ) : (
          <div className="mt-4 rounded-2xl bg-white/55 p-4 text-sm leading-6 text-[var(--muted)]">
            {isIOS ? (
              <>
                <span className="inline-flex items-center gap-1 font-bold text-[var(--ink)]">
                  <Share className="size-4" aria-hidden="true" /> On iPhone or
                  iPad:
                </span>{" "}
                open Safari, tap Share, then “Add to Home Screen.”
              </>
            ) : (
              <>Open your browser menu and choose “Install app” or “Add to Home screen” when available.</>
            )}
          </div>
        )}
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--muted)]">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Offline edits replay only when Foodtopia is open, focused, and
          reconnected. Photo analysis, uploads, recipes, and reconciliation need
          connectivity.
        </p>
      </Card>

      <Card className="mt-4">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <LockKeyhole className="size-5 text-[var(--leaf)]" aria-hidden="true" />
          Privacy on this device
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Inventory snapshots and ordered commands live in IndexedDB for the
          active household. Raw batch photos are not stored there. Signing out
          clears the offline database, Foodtopia local/session keys, and caches
          before redirecting.
        </p>
        <Link
          href="/privacy"
          className="mt-3 inline-flex min-h-11 items-center font-bold text-[var(--leaf)] underline decoration-2 underline-offset-4"
        >
          Read the beta privacy notice
        </Link>
        <Button
          variant="danger"
          className="mt-5 w-full"
          busy={signingOut}
          onClick={() => void logout()}
        >
          <LogOut className="size-4" aria-hidden="true" /> Sign out & clear this
          device
        </Button>
      </Card>
    </Page>
  );
}
