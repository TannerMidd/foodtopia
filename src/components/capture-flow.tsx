"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Camera, ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
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
import { Button, Card, Page, Section, StateNotice } from "./ui";

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
  if (typeof window === "undefined" || process.env.NEXT_PUBLIC_SUPABASE_URL) return false;
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
  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url)), []);
  useEffect(() => {
    let cancelled = false;
    if (apiMode === "connected" && online) {
      void Promise.allSettled([getVisionConsent(), getAiSettings()]).then(
        ([consentResult, settingsResult]) => {
          if (cancelled) return;
          if (consentResult.status === "fulfilled") setConsented(consentResult.value.consented);
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
    return () => {
      cancelled = true;
    };
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
      if (files.length > remaining)
        setError(
          `Only the first ${remaining} photo${remaining === 1 ? " was" : "s were"} added. The batch limit is 3.`,
        );
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
        caught instanceof Error ? caught.message : "The saved upload could not be cancelled safely.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function analyze() {
    if (!consented || (apiMode === "connected" && (!aiSettings || !aiSettings.credentialConfigured))) {
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
      setError(
        caught instanceof Error ? caught.message : "Consent could not be recorded. No photo was uploaded.",
      );
    } finally {
      setSavingConsent(false);
    }
  }

  const ready = photos.length || pendingAnalysis ? true : false;

  return (
    <Page className="max-w-[42rem]">
      <header>
        <p className="ml">add food · first of two</p>
        <h1 className="hd mt-3 text-[clamp(1.5rem,6vw,1.65rem)]">Photograph the counter.</h1>
        <p className="bd mt-2.5 max-w-[30rem]">
          One clear overview is usually enough. Add an angle only when things overlap.
        </p>
      </header>

      {!online && (
        <div className="mt-6">
          <StateNotice title="Connect to analyze photos" tone="warning">
            The kitchen stays available offline, but private uploads and analysis need connectivity.
          </StateNotice>
        </div>
      )}
      {error && (
        <div className="mt-6">
          <StateNotice title="Check this batch" tone="error">
            {error}
          </StateNotice>
        </div>
      )}
      {pendingAnalysis && (
        <div className="mt-6">
          <StateNotice title="Private upload ready to resume" tone="warning">
            Foodtopia kept this batch reference in the current tab. Retrying resumes the same analysis
            without uploading a duplicate.
          </StateNotice>
          <button
            type="button"
            className="m mt-3 min-h-9 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)] disabled:opacity-40"
            disabled={!online || submitting}
            onClick={() => void startOver()}
          >
            start over and purge this upload
          </button>
        </div>
      )}

      {showConsent && (
        <Card className="mt-6" aria-live="polite">
          <p className="ml">first photo analysis</p>
          <h2 className="hd mt-3 text-[22px]">Review the cloud-processing notice</h2>
          <div className="bd mt-4 flex flex-col gap-3">
            {apiMode === "connected" ? (
              aiSettings ? (
                <>
                  <p>
                    The current route is{" "}
                    <span className="text-[var(--ink)]">
                      {aiSettings.provider === "openrouter" ? "OpenRouter" : "OpenAI"}
                    </span>{" "}
                    using vision model{" "}
                    <span className="m text-[12px] text-[var(--ink)]">{aiSettings.visionModelId}</span>. The
                    one to three prepared photos in this batch will be sent through that route so Foodtopia
                    can propose food items.
                  </p>
                  {!aiSettings.credentialConfigured ? (
                    <StateNotice title="Provider key required" tone="warning">
                      The household owner must finish this provider setup in Settings before any photo can
                      be uploaded.
                    </StateNotice>
                  ) : null}
                  {aiSettings.provider === "openai" ? (
                    <p>
                      OpenAI states API data is not used for training unless the organization opts in;
                      default abuse-monitoring logs may be retained for up to 30 days.
                    </p>
                  ) : (
                    <p>
                      OpenRouter routes the request to the selected model&apos;s underlying provider.
                      Foodtopia requests zero-data-retention routing and denies provider data collection,
                      but availability and downstream-provider handling can vary.
                    </p>
                  )}
                  <p>
                    The household owner may later select OpenAI directly or OpenRouter plus an underlying
                    provider. This consent covers those future household-selected routes; the current route
                    is always shown here. Suggestions can be wrong and must be reviewed before inventory
                    changes.
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
                This local demo analyzes filenames with a built-in assistant and does not send the prepared
                photo bytes to a cloud AI provider.
              </p>
            )}
            <p>
              Foodtopia requests raw-object deletion after apply or cancel and sweeps all remaining raw
              objects within 24 hours. Structured review candidates may remain.
            </p>
          </div>
          <Link
            href="/privacy"
            className="m mt-4 inline-flex min-h-10 items-center border-b border-[var(--accent-rule)] pb-0.5 text-[11px] text-[var(--ink)]"
          >
            read the full beta privacy notice
          </Link>
          <div className="mt-6 flex items-center justify-end gap-6">
            <button
              type="button"
              className="m text-[11px] text-[var(--ink-4)] hover:text-[var(--ink)]"
              onClick={() => setShowConsent(false)}
            >
              not now
            </button>
            <Button
              busy={savingConsent}
              disabled={apiMode === "connected" && (!aiSettings || !aiSettings.credentialConfigured)}
              onClick={() => void consentAndAnalyze()}
            >
              I agree &amp; analyze
            </Button>
          </div>
        </Card>
      )}

      {/* Photos sit as plain tiles, no frame — the food is the subject. */}
      <div className="mt-8 grid grid-cols-2 gap-3.5">
        {photos.map((photo, index) => (
          <figure key={photo.url} className="relative flex aspect-[4/3] items-end overflow-hidden rounded-[3px] bg-[var(--ground-tint)] p-2.5">
            {/* Prepared images are local blob URLs and cannot use the Next image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={`Batch photo ${index + 1}`} className="absolute inset-0 size-full object-cover" />
            <figcaption className="m relative flex w-full items-center justify-between bg-[#100f0e]/70 px-2 py-1 text-[10.5px] text-[var(--ink-2)] backdrop-blur-sm">
              photo {index + 1} · {formatFileSize(photo.file.size)}
              <button
                type="button"
                disabled={Boolean(pendingAnalysis)}
                onClick={() => removePhoto(index)}
                className="flex size-7 items-center justify-center text-[var(--ink-4)] hover:text-[var(--time)] disabled:opacity-40"
                aria-label={`Remove photo ${index + 1}`}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </figcaption>
          </figure>
        ))}

        {photos.length < 3 && !pendingAnalysis && (
          <button
            type="button"
            className="flex aspect-[4/3] flex-col items-center justify-center gap-2.5 rounded-[3px] border border-dashed border-[var(--edge-strong)] text-[var(--ink-6)] transition hover:border-[var(--ink-5)] hover:text-[var(--ink-3)] disabled:opacity-40"
            onClick={() => inputRef.current?.click()}
            disabled={preparing}
          >
            {preparing ? (
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            ) : photos.length === 0 ? (
              <Camera className="size-5" aria-hidden="true" />
            ) : (
              <ImagePlus className="size-5" aria-hidden="true" />
            )}
            <span className="m text-[10.5px]">
              {preparing ? "preparing…" : photos.length === 0 ? "take or choose a photo" : "add an angle"}
            </span>
          </button>
        )}
      </div>

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

      <div className="mt-9">
        <Section label="how it works" labelWidth="78px">
          <div className="row min-h-[46px] gap-3 px-1">
            <span className="bd flex-1">Photos are re-encoded here, on your device.</span>
            <span className="m text-[10.5px] text-[var(--ink-6)]">1600 px · 5 mb</span>
          </div>
          <div className="row min-h-[46px] gap-3 px-1">
            <span className="bd flex-1">Location data is stripped before anything is sent.</span>
            <span className="m text-[10.5px] text-[var(--ink-6)]">exif removed</span>
          </div>
          <div className="row min-h-[46px] gap-3 px-1">
            <span className="bd flex-1">Raw photos are deleted once you confirm.</span>
            <span className="m text-[10.5px] text-[var(--ink-6)]">≤ 24 h</span>
          </div>
        </Section>
      </div>

      {apiMode === "demo" && (
        <p className="bd mt-6 text-[12px] text-[var(--ink-6)]">
          This demo reads filenames with a local assistant; no photo bytes leave the device.
        </p>
      )}

      <div className="mt-7 flex items-center justify-between gap-5">
        <span className="m text-[10.5px] text-[var(--ink-6)]">
          {pendingAnalysis
            ? "upload saved · ready to resume"
            : photos.length
              ? `${photos.length} photo${photos.length === 1 ? "" : "s"} ready`
              : "no photos yet"}
        </span>
        <Button onClick={analyze} disabled={!ready || !online || preparing} busy={submitting}>
          {submitting ? "Preparing…" : pendingAnalysis ? "Retry this analysis" : "Look for food"}
          {!submitting && <ArrowRight className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />}
        </Button>
      </div>
    </Page>
  );
}
