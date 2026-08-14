"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Check,
  ImagePlus,
  LockKeyhole,
  RotateCcw,
  Sparkles,
  Trash2,
  WifiOff,
} from "lucide-react";
import type { AiSettingsResponse } from "@/contracts/api";
import {
  cancelAnalysis,
  completeAnalysis,
  createAnalysis,
  getAiSettings,
  getVisionConsent,
  grantVisionConsent,
  uploadAnalysisFiles,
} from "@/lib/client/api";
import { formatFileSize, prepareInventoryPhoto } from "@/lib/client/image";
import { useOfflineInventory } from "./offline-provider";
import { Button, Card, Page, PageHeader, StateNotice } from "./ui";

type PreparedPhoto = { file: File; url: string };
type PendingAnalysis = { analysisId: string; assetIds: string[] };

const PENDING_ANALYSIS_KEY = "foodtopia:capture:pending-analysis";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function savePendingAnalysis(value: PendingAnalysis | null) {
  try {
    if (value) sessionStorage.setItem(PENDING_ANALYSIS_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_ANALYSIS_KEY);
  } catch {
    // The in-memory retry remains available when session storage is blocked.
  }
}

function readPendingAnalysis(): PendingAnalysis | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_ANALYSIS_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object") return null;
    const candidate = value as { analysisId?: unknown; assetIds?: unknown };
    if (
      typeof candidate.analysisId !== "string" ||
      !UUID_PATTERN.test(candidate.analysisId) ||
      !Array.isArray(candidate.assetIds) ||
      candidate.assetIds.length < 1 ||
      candidate.assetIds.length > 3 ||
      !candidate.assetIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id))
    ) return null;
    return { analysisId: candidate.analysisId, assetIds: candidate.assetIds };
  } catch {
    return null;
  }
}

function hasLocalDemoVisionConsent() {
  if (
    typeof window === "undefined" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL
  ) return false;
  try {
    return Boolean(localStorage.getItem("foodtopia:vision-consent:vision-v2"));
  } catch {
    return false;
  }
}

export function CaptureFlow() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<PreparedPhoto[]>([]);
  const { apiMode, online } = useOfflineInventory();
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [pendingAnalysis, setPendingAnalysis] = useState<PendingAnalysis | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consented, setConsented] = useState(hasLocalDemoVisionConsent);
  const [showConsent, setShowConsent] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiSettingsResponse | null>(null);
  const [aiSettingsError, setAiSettingsError] = useState(false);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => {
    const timeout = window.setTimeout(() => setPendingAnalysis(readPendingAnalysis()), 0);
    return () => window.clearTimeout(timeout);
  }, []);
  useEffect(
    () => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url)),
    [],
  );
  useEffect(() => {
    let cancelled = false;
    if (apiMode === "connected" && online) {
      void Promise.allSettled([getVisionConsent(), getAiSettings()]).then(
        ([consentResult, settingsResult]) => {
          if (cancelled) return;
          if (consentResult.status === "fulfilled") {
            setConsented(consentResult.value.consented);
          }
          if (settingsResult.status === "fulfilled") {
            setAiSettings(settingsResult.value);
            setAiSettingsError(false);
          } else {
            setAiSettings(null);
            setAiSettingsError(true);
          }
        },
      );
    }
    return () => { cancelled = true; };
  }, [apiMode, online]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const remaining = 3 - photos.length;
    if (remaining <= 0) {
      setError("A batch can include up to 3 photos. Remove one before adding another.");
      return;
    }
    setPreparing(true);
    setError(null);
    try {
      const selected = Array.from(files).slice(0, remaining);
      const converted: PreparedPhoto[] = [];
      for (let index = 0; index < selected.length; index += 1) {
        const file = await prepareInventoryPhoto(selected[index], photos.length + index);
        converted.push({ file, url: URL.createObjectURL(file) });
      }
      setPhotos((current) => [...current, ...converted]);
      if (files.length > remaining) setError(`Only the first ${remaining} photo${remaining === 1 ? " was" : "s were"} added. The batch limit is 3.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The photo could not be prepared.");
    } finally {
      setPreparing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      URL.revokeObjectURL(current[index].url);
      return current.filter((_, photoIndex) => photoIndex !== index);
    });
  }

  async function startAnalysis() {
    if (!online) {
      setError("Photo analysis needs a connection. Keep these photos here and try again when online.");
      return;
    }
    if (!photos.length && !pendingAnalysis) return;
    setSubmitting(true);
    setError(null);
    let resumable = pendingAnalysis;
    try {
      if (!resumable) {
        const files = photos.map((photo) => photo.file);
        const created = await createAnalysis(files);
        const assetIds = await uploadAnalysisFiles(created, files);
        resumable = { analysisId: created.analysisId, assetIds };
        setPendingAnalysis(resumable);
        savePendingAnalysis(resumable);
      }
      await completeAnalysis(resumable.analysisId, resumable.assetIds);
      savePendingAnalysis(null);
      setPendingAnalysis(null);
      router.push(`/analysis/${resumable.analysisId}`);
    } catch (caught) {
      setError(
        resumable
          ? "The private upload is saved, but analysis has not resumed yet. Retry this exact batch or start over."
          : caught instanceof Error
            ? caught.message
            : "Foodtopia could not start the analysis.",
      );
      setSubmitting(false);
    }
  }

  async function startOver() {
    if (!pendingAnalysis) return;
    setSubmitting(true);
    setError(null);
    try {
      await cancelAnalysis(pendingAnalysis.analysisId);
      savePendingAnalysis(null);
      setPendingAnalysis(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The saved upload could not be cancelled safely.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function analyze() {
    if (
      !consented ||
      (apiMode === "connected" &&
        (!aiSettings || !aiSettings.credentialConfigured))
    ) {
      setShowConsent(true);
      if (apiMode === "connected" && online && !aiSettings) {
        setAiSettingsError(false);
        void getAiSettings()
          .then((value) => setAiSettings(value))
          .catch(() => setAiSettingsError(true));
      }
      return;
    }
    void startAnalysis();
  }

  async function consentAndAnalyze() {
    setSavingConsent(true);
    setError(null);
    try {
      if (apiMode === "connected") await grantVisionConsent();
      const recordedAt = new Date().toISOString();
      try {
        localStorage.setItem("foodtopia:vision-consent:vision-v2", recordedAt);
      } catch {
        // Connected consent is already recorded server-side.
      }
      setConsented(true);
      setShowConsent(false);
      await startAnalysis();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Consent could not be recorded. No photo was uploaded.");
    } finally {
      setSavingConsent(false);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Step 1 of 2"
        title="Photograph a batch"
        description="Spread items out with labels facing up. One clear overview is usually enough; add angles only when items overlap."
      />

      {!online && (
        <StateNotice title="Connect to analyze photos" tone="warning">
          <span className="inline-flex items-center gap-1"><WifiOff className="size-4" aria-hidden="true" /> Inventory stays available offline, but private uploads and AI analysis need connectivity.</span>
        </StateNotice>
      )}
      {error && <div className="mt-3"><StateNotice title="Check this batch" tone="error">{error}</StateNotice></div>}
      {pendingAnalysis && (
        <div className="mt-3">
          <StateNotice title="Private upload ready to resume" tone="warning">
            Foodtopia retained this batch reference in the current tab. Retrying
            resumes the same analysis without uploading a duplicate.
          </StateNotice>
          <Button className="mt-2" size="small" variant="ghost" disabled={!online || submitting} onClick={() => void startOver()}>
            Start over and purge this upload
          </Button>
        </div>
      )}
      {showConsent && (
        <Card className="mt-4 border-[var(--leaf)]" aria-live="polite">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--tomato)]">First photo analysis</p>
          <h2 className="mt-2 text-xl font-extrabold">Review the cloud-processing notice</h2>
          <div className="mt-3 space-y-2 text-sm leading-6 text-[var(--muted)]">
            {apiMode === "connected" ? (
              aiSettings ? (
                <>
                  <p>
                    The current route is <strong>{aiSettings.provider === "openrouter" ? "OpenRouter" : "OpenAI"}</strong>{" "}
                    using vision model <strong>{aiSettings.visionModelId}</strong>.
                    The one to three prepared photos in this batch will be sent
                    through that route so Foodtopia can propose food items.
                  </p>
                  {!aiSettings.credentialConfigured ? (
                    <StateNotice title="Provider key required" tone="warning">
                      The household owner must finish this provider setup in
                      Settings before any photo can be uploaded.
                    </StateNotice>
                  ) : null}
                  {aiSettings.provider === "openai" ? (
                    <p>
                      OpenAI states API data is not used for training unless the
                      organization opts in; default abuse-monitoring logs may be
                      retained for up to 30 days.
                    </p>
                  ) : (
                    <p>
                      OpenRouter routes the request to the selected model&apos;s
                      underlying provider. Foodtopia requests zero-data-retention
                      routing and denies provider data collection, but availability
                      and downstream-provider handling can vary.
                    </p>
                  )}
                  <p>
                    The household owner may later select OpenAI directly or
                    OpenRouter plus an underlying provider. This consent covers
                    those future household-selected routes; the current route is
                    always shown here. Suggestions can be wrong and must be
                    reviewed before inventory changes.
                  </p>
                </>
              ) : (
                <StateNotice title="Current AI route unavailable" tone="warning">
                  {aiSettingsError
                    ? "Reconnect or retry before agreeing. No photo will be uploaded until the current provider can be shown."
                    : "Loading the household provider and model…"}
                </StateNotice>
              )
            ) : (
              <p>
                This local demo analyzes filenames with a built-in assistant and
                does not send the prepared photo bytes to a cloud AI provider.
              </p>
            )}
            <p>Foodtopia requests raw-object deletion after apply or cancel and sweeps all remaining raw objects within 24 hours. Structured review candidates may remain.</p>
          </div>
          <Link href="/privacy" className="mt-3 inline-flex min-h-10 items-center font-bold text-[var(--leaf)] underline underline-offset-4">Read the full beta privacy notice</Link>
          <div className="mt-4 flex gap-2"><Button variant="ghost" className="flex-1" onClick={() => setShowConsent(false)}>Not now</Button><Button className="flex-1" busy={savingConsent} disabled={apiMode === "connected" && (!aiSettings || !aiSettings.credentialConfigured)} onClick={() => void consentAndAnalyze()}>I agree & analyze</Button></div>
        </Card>
      )}

      <Card className="mt-4 overflow-hidden p-0">
        {photos.length === 0 ? (
          <button
            type="button"
            className="flex min-h-72 w-full flex-col items-center justify-center px-7 py-10 text-center transition hover:bg-[#fbf8f0]"
            onClick={() => inputRef.current?.click()}
            disabled={preparing || Boolean(pendingAnalysis)}
          >
            <span className="mb-5 flex size-20 items-center justify-center rounded-[1.75rem] bg-[var(--sprout)] text-[var(--leaf)]">
              {preparing ? <RotateCcw className="size-8 animate-spin" aria-hidden="true" /> : pendingAnalysis ? <LockKeyhole className="size-8" aria-hidden="true" /> : <Camera className="size-8" aria-hidden="true" />}
            </span>
            <span className="text-xl font-extrabold">{pendingAnalysis ? "Uploaded batch saved" : "Take or choose a photo"}</span>
            <span className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">{pendingAnalysis ? "The raw bytes are not stored in this page. Retry below to resume the same server analysis." : "Food only, good light, minimal overlap. Photos are re-encoded on this device before upload."}</span>
          </button>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((photo, index) => (
                <figure key={photo.url} className="group relative aspect-[4/3] overflow-hidden rounded-2xl bg-[var(--paper-deep)]">
                  {/* Prepared images are local blob URLs and cannot use the Next image optimizer. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt={`Batch photo ${index + 1}`} className="size-full object-cover" />
                  <figcaption className="absolute inset-x-2 bottom-2 flex items-center justify-between rounded-xl bg-black/60 px-2 py-1.5 text-xs text-white backdrop-blur-sm">
                    <span>Photo {index + 1} · {formatFileSize(photo.file.size)}</span>
                    <button type="button" disabled={Boolean(pendingAnalysis)} onClick={() => removePhoto(index)} className="flex size-9 items-center justify-center rounded-full bg-white/16 disabled:opacity-45" aria-label={`Remove photo ${index + 1}`}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </figcaption>
                </figure>
              ))}
              {photos.length < 3 && !pendingAnalysis && (
                <button type="button" className="flex aspect-[4/3] min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-white/40 text-sm font-bold text-[var(--leaf)]" onClick={() => inputRef.current?.click()} disabled={preparing}>
                  <ImagePlus className="mb-2 size-6" aria-hidden="true" /> Add angle
                </button>
              )}
            </div>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          disabled={Boolean(pendingAnalysis)}
          className="sr-only"
          aria-label="Choose up to three grocery photos"
          onChange={(event) => void onFiles(event.target.files)}
        />
      </Card>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {[
          { Icon: Sparkles, text: "Bright, even light" },
          { Icon: Check, text: "Keep food visible" },
          { Icon: LockKeyhole, text: "Raw photo purge within 24h" },
        ].map(({ Icon, text }) => (
          <div key={text} className="flex min-h-12 items-center gap-2 rounded-2xl bg-white/48 px-3 text-xs font-semibold text-[var(--muted)]">
            <Icon className="size-4 shrink-0 text-[var(--leaf)]" aria-hidden="true" /> {text}
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-[var(--line)] bg-white/40 p-4 text-xs leading-5 text-[var(--muted)]">
        Each image becomes a JPEG with a longest edge of at most 1600 px and a size under 5 MB. Re-encoding removes embedded EXIF metadata. Raw photos stay private, are used only for this review, and are deleted after you confirm; abandoned batches expire automatically.
      </div>

      <Button className="mt-5 w-full" onClick={analyze} disabled={(!photos.length && !pendingAnalysis) || !online || preparing} busy={submitting}>
        <Sparkles className="size-4" aria-hidden="true" /> {submitting ? "Preparing private analysis…" : pendingAnalysis ? "Retry this analysis" : `Review ${photos.length || ""} photo${photos.length === 1 ? "" : "s"}`}
      </Button>
    </Page>
  );
}
