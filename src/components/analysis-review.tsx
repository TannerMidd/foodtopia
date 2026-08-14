"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDashed,
  ImageOff,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  Analysis,
  AnalysisCandidate,
  FoodForm,
  FoodLocation,
  QuantityStatus,
} from "@/contracts/domain";
import { resolveFoodIdentity } from "@/domain/normalization";
import { applyAnalysis, cancelAnalysis, getAnalysis } from "@/lib/client/api";
import { useOfflineInventory } from "./offline-provider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  inputClass,
  Page,
  PageHeader,
  selectClass,
  StateNotice,
} from "./ui";

const forms: Array<{ value: FoodForm; label: string }> = [
  { value: "unspecified", label: "Not specified" },
  { value: "fresh", label: "Fresh" },
  { value: "frozen", label: "Frozen" },
  { value: "canned", label: "Canned" },
  { value: "dried", label: "Dried" },
  { value: "cooked", label: "Cooked" },
  { value: "opened", label: "Opened" },
];

const locations: Array<{ value: FoodLocation; label: string }> = [
  { value: "unknown", label: "Choose later" },
  { value: "pantry", label: "Pantry" },
  { value: "fridge", label: "Fridge" },
  { value: "freezer", label: "Freezer" },
  { value: "other", label: "Other" },
];

function CandidateEditor({
  candidate,
  index,
  onChange,
}: {
  candidate: AnalysisCandidate;
  index: number;
  onChange: (next: AnalysisCandidate) => void;
}) {
  function patch(update: Partial<AnalysisCandidate>) {
    onChange({ ...candidate, ...update });
  }

  return (
    <Card className={candidate.accepted ? "p-4 sm:p-5" : "bg-[#f1eee6] p-4 opacity-75 shadow-none sm:p-5"}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={candidate.accepted}
          aria-label={`${candidate.accepted ? "Reject" : "Accept"} ${candidate.suggestedName}`}
          className={`mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl border ${candidate.accepted ? "border-[var(--leaf)] bg-[var(--leaf)] text-white" : "border-[var(--line)] bg-white text-transparent"}`}
          onClick={() => patch({ accepted: !candidate.accepted })}
        >
          <Check className="size-5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Item {index + 1}</p>
              {candidate.uncertaintyReason && <Badge tone="yellow" className="mt-1">Needs a closer look</Badge>}
            </div>
            <Button type="button" variant="ghost" size="small" onClick={() => patch({ accepted: !candidate.accepted })}>
              {candidate.accepted ? <><Trash2 className="size-4" aria-hidden="true" /> Reject</> : <><Check className="size-4" aria-hidden="true" /> Accept</>}
            </Button>
          </div>

          {candidate.accepted ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Food name" htmlFor={`name-${candidate.id}`}>
                  <input
                    id={`name-${candidate.id}`}
                    className={inputClass}
                    value={candidate.suggestedName}
                    maxLength={120}
                    onChange={(event) => {
                      const suggestedName = event.target.value;
                      const identity = resolveFoodIdentity(suggestedName);
                      patch({
                        suggestedName,
                        suggestedConceptId: identity.foodConceptId,
                        category: identity.category,
                      });
                    }}
                  />
                </Field>
              </div>
              <Field label="Amount tracking" htmlFor={`quantity-state-${candidate.id}`}>
                <select
                  id={`quantity-state-${candidate.id}`}
                  className={selectClass}
                  value={candidate.quantityStatus}
                  onChange={(event) => {
                    const quantityStatus = event.target.value as QuantityStatus;
                    patch({ quantityStatus, quantity: quantityStatus === "unknown" ? null : candidate.quantity });
                  }}
                >
                  <option value="unknown">Don’t track amount</option>
                  <option value="estimated">Estimated amount</option>
                  <option value="known">Known amount</option>
                </select>
              </Field>
              {candidate.quantityStatus !== "unknown" && (
                <div className="grid grid-cols-[1fr_1fr] gap-2">
                  <Field label="Quantity" htmlFor={`quantity-${candidate.id}`}>
                    <input id={`quantity-${candidate.id}`} className={inputClass} type="number" inputMode="decimal" min="0.01" step="any" value={candidate.quantity ?? ""} onChange={(event) => patch({ quantity: event.target.value ? Number(event.target.value) : null })} />
                  </Field>
                  <Field label="Unit" htmlFor={`unit-${candidate.id}`}>
                    <input id={`unit-${candidate.id}`} className={inputClass} placeholder="items" maxLength={24} value={candidate.unit ?? ""} onChange={(event) => patch({ unit: event.target.value || null })} />
                  </Field>
                </div>
              )}
              <Field label="Form" htmlFor={`form-${candidate.id}`}>
                <select id={`form-${candidate.id}`} className={selectClass} value={candidate.form} onChange={(event) => patch({ form: event.target.value as FoodForm })}>
                  {forms.map((form) => <option key={form.value} value={form.value}>{form.label}</option>)}
                </select>
              </Field>
              <Field label="Put it in" htmlFor={`location-${candidate.id}`}>
                <select id={`location-${candidate.id}`} className={selectClass} value={candidate.location} onChange={(event) => patch({ location: event.target.value as FoodLocation })}>
                  {locations.map((location) => <option key={location.value} value={location.value}>{location.label}</option>)}
                </select>
              </Field>
              {candidate.uncertaintyReason && (
                <p className="sm:col-span-2 rounded-xl bg-[#fff7d9] px-3 py-2 text-xs leading-5 text-[#69551a]">AI note: {candidate.uncertaintyReason}</p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">“{candidate.suggestedName}” will not be added.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

export function AnalysisReview({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const { online, refresh } = useOfflineInventory();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [candidates, setCandidates] = useState<AnalysisCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getAnalysis(analysisId);
      setAnalysis(next);
      setError(null);
      if (next.status === "needs_review") setCandidates(next.candidates);
      return next.status;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The analysis could not be loaded.");
      return "load_error";
    }
  }, [analysisId]);

  useEffect(() => {
    let cancelled = false;
    let timeout: number | undefined;
    async function poll() {
      const status = await load();
      if (!cancelled && ["created", "uploaded", "queued", "processing", "load_error"].includes(status)) {
        timeout = window.setTimeout(poll, status === "load_error" ? 3_000 : 1_800);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [load]);

  function updateCandidate(index: number, candidate: AnalysisCandidate) {
    setCandidates((current) => current.map((item, itemIndex) => (itemIndex === index ? candidate : item)));
  }

  function addMissed() {
    setCandidates((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        analysisId,
        rawLabel: "Added during review",
        suggestedConceptId: null,
        suggestedName: "",
        category: "Other",
        quantityStatus: "unknown",
        quantity: null,
        unit: null,
        form: "unspecified",
        location: "unknown",
        imageIndexes: [0],
        uncertaintyReason: null,
        accepted: true,
      },
    ]);
  }

  async function confirm() {
    const accepted = candidates.filter((candidate) => candidate.accepted);
    if (!accepted.length) {
      setError("Accept at least one food item, or leave this batch without saving.");
      return;
    }
    if (accepted.some((candidate) => !candidate.suggestedName.trim())) {
      setError("Every accepted item needs a food name.");
      return;
    }
    if (accepted.some((candidate) => candidate.quantityStatus !== "unknown" && (!candidate.quantity || candidate.quantity <= 0))) {
      setError("Enter a positive quantity for every item whose amount is tracked.");
      return;
    }
    if (accepted.some((candidate) => candidate.quantityStatus !== "unknown" && !candidate.unit?.trim())) {
      setError("Enter a unit for every item whose amount is tracked.");
      return;
    }
    if (!online) {
      setError("Connect before confirming. Nothing has been added yet, and this review is still available.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await applyAnalysis(analysisId, accepted);
      await refresh(true).catch(() => undefined);
      router.replace("/inventory?batch=added");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The batch could not be confirmed.");
      setSaving(false);
    }
  }

  async function cancelBatch() {
    if (!online) {
      setError("Connect to cancel immediately. If you leave instead, the abandonment cleanup will remove the raw photos later.");
      return;
    }
    if (!window.confirm("Cancel this batch and delete its private raw photos now? No inventory items have been added.")) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelAnalysis(analysisId);
      router.replace("/capture");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The batch could not be cancelled.");
      setCancelling(false);
    }
  }

  const pending = !analysis || ["created", "uploaded", "queued", "processing"].includes(analysis.status);
  if (pending) {
    return (
      <Page className="flex min-h-[68dvh] items-center justify-center">
        <div className="max-w-sm text-center" role="status">
          <span className="mx-auto mb-6 flex size-20 items-center justify-center rounded-[1.75rem] bg-[var(--sprout)] text-[var(--leaf)]"><CircleDashed className="size-9 animate-spin" aria-hidden="true" /></span>
          <h1 className="text-2xl font-extrabold tracking-tight">Looking for food</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">This usually takes a moment. You’ll review every suggestion before the inventory changes.</p>
          <div className="mt-7 h-2 overflow-hidden rounded-full bg-[var(--paper-deep)]"><div className="h-full w-2/3 animate-pulse rounded-full bg-[var(--tomato)]" /></div>
          {error && <p className="mt-4 text-sm font-semibold text-[var(--tomato)]">{error}</p>}
          <Button className="mt-5" size="small" variant="ghost" busy={cancelling} onClick={() => void cancelBatch()}>Cancel batch</Button>
        </div>
      </Page>
    );
  }

  if (["failed", "cancelled", "expired"].includes(analysis.status)) {
    return (
      <Page>
        <PageHeader title="This batch needs another try" description="No inventory items were added." />
        <EmptyState
          icon={<ImageOff className="size-6" aria-hidden="true" />}
          title={analysis.status === "expired" ? "Review expired" : "Photos couldn’t be analyzed"}
          description={analysis.errorCode ? `Analysis stopped with code ${analysis.errorCode}. Raw photos are no longer available.` : "Raw photos are no longer available. Start a fresh batch when you’re ready."}
          action={(
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/capture" className="inline-flex min-h-12 items-center rounded-full bg-[var(--leaf)] px-5 font-bold text-white">Try another photo</Link>
              <Link href="/inventory#add-manually" className="inline-flex min-h-12 items-center rounded-full border border-[var(--line)] bg-white px-5 font-bold text-[var(--leaf)]">Add manually</Link>
            </div>
          )}
        />
      </Page>
    );
  }

  if (analysis.status === "applied") {
    return (
      <Page>
        <EmptyState icon={<CheckCircle2 className="size-6" aria-hidden="true" />} title="Batch already added" description="This review has been confirmed and its raw photos deleted." action={<Link href="/inventory" className="inline-flex min-h-12 items-center rounded-full bg-[var(--leaf)] px-5 font-bold text-white">View inventory</Link>} />
      </Page>
    );
  }

  const acceptedCount = candidates.filter((candidate) => candidate.accepted).length;
  return (
    <Page>
      <PageHeader eyebrow="Step 2 of 2" title="Review every item" description="Fix names and details, reject false detections, and add anything missed. Nothing reaches inventory until you confirm below." action={<Button size="small" variant="ghost" busy={cancelling} onClick={() => void cancelBatch()}>Cancel batch</Button>} />
      <StateNotice title={`${acceptedCount} item${acceptedCount === 1 ? "" : "s"} selected`} tone="success">
        AI suggestions can be wrong. You are the final reviewer.
      </StateNotice>
      {error && <div className="mt-3"><StateNotice title="Review needed" tone="error">{error}</StateNotice></div>}

      <div className="mt-4 space-y-3">
        {candidates.map((candidate, index) => (
          <CandidateEditor key={candidate.id} candidate={candidate} index={index} onChange={(next) => updateCandidate(index, next)} />
        ))}
      </div>

      <Button variant="secondary" className="mt-4 w-full border-dashed" onClick={addMissed}>
        <Plus className="size-4" aria-hidden="true" /> Add a missed food
      </Button>

      <div className="mt-6 rounded-2xl bg-[#edf4e7] p-4 text-xs leading-5 text-[#4d6357]">
        <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Confirming creates the selected inventory items and deletes the raw batch photos. This can’t be undone as one batch, though each item can still be adjusted or marked used up.</p>
      </div>
      <Button className="mt-4 w-full" busy={saving} disabled={!acceptedCount || !online} onClick={() => void confirm()}>
        <Sparkles className="size-4" aria-hidden="true" /> Confirm {acceptedCount} item{acceptedCount === 1 ? "" : "s"}
      </Button>
    </Page>
  );
}
