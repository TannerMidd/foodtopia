"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Check, LoaderCircle, Plus } from "lucide-react";
import type {
  Analysis,
  AnalysisCandidate,
  FoodForm,
  FoodLocation,
  QuantityStatus,
} from "@/contracts/domain";
import { resolveFoodIdentity } from "@/domain/normalization";
import { applyAnalysis, cancelAnalysis, getAnalysis } from "@/lib/client/api";
import { amountText, numberWord } from "./format";
import { useOfflineInventory } from "./offline-provider";
import {
  Button,
  Field,
  Page,
  Section,
  StateNotice,
  cn,
  inputClass,
  selectClass,
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

const destination: Record<FoodLocation, string> = {
  unknown: "place later",
  pantry: "into the pantry",
  fridge: "into the fridge",
  freezer: "into the freezer",
  other: "into other storage",
};

/* A lit square when kept, an empty one when dropped. Nothing else moves. */
function Tick({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-[18px] flex-none items-center justify-center rounded-[2px] transition",
        checked
          ? "bg-[var(--accent-solid)] text-[var(--accent-on)]"
          : "border border-[var(--edge-strong)] text-transparent hover:border-[var(--ink-5)]",
      )}
    >
      <Check className="size-3" aria-hidden="true" />
    </button>
  );
}

function KeptCandidate({
  candidate,
  expanded,
  onToggleExpand,
  onChange,
}: {
  candidate: AnalysisCandidate;
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (next: AnalysisCandidate) => void;
}) {
  function patch(update: Partial<AnalysisCandidate>) {
    onChange({ ...candidate, ...update });
  }

  const hasNotes = Boolean(candidate.uncertaintyReason) || candidate.form !== "unspecified";
  const name = candidate.suggestedName.trim();

  return (
    <div className="border-b border-[var(--hairline)] px-1 py-3.5 last:border-b-0">
      <div className="flex items-center gap-3.5">
        <Tick
          checked
          label={`Drop ${name || "this suggestion"}`}
          onClick={() => patch({ accepted: false })}
        />
        <button
          type="button"
          className="nm min-w-0 flex-1 truncate text-left hover:text-[var(--accent-ink)]"
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          {name || <span className="text-[var(--ink-5)] italic">Name this item</span>}
        </button>
        <span
          className={cn(
            "m flex-none text-[11px]",
            candidate.quantityStatus === "unknown" ? "text-[var(--ink-6)]" : "text-[var(--ink-2)]",
          )}
        >
          {amountText(candidate)}
        </span>
      </div>

      {!expanded && hasNotes && (
        <div className="ml-8 mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
          {candidate.form !== "unspecified" && (
            <span className="m text-[10.5px] text-[var(--ink-6)]">{candidate.form}</span>
          )}
          <span className="m text-[10.5px] text-[var(--ink-6)]">{destination[candidate.location]}</span>
          {candidate.uncertaintyReason && (
            <span className="m text-[10.5px] text-[var(--time)]">{candidate.uncertaintyReason}</span>
          )}
        </div>
      )}

      {expanded && (
        <div className="ml-8 mt-5 grid gap-6 sm:grid-cols-2">
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
                patch({
                  quantityStatus,
                  quantity: quantityStatus === "unknown" ? null : candidate.quantity,
                });
              }}
            >
              <option value="unknown">Don&rsquo;t track amount</option>
              <option value="estimated">Estimated amount</option>
              <option value="known">Known amount</option>
            </select>
          </Field>
          {candidate.quantityStatus !== "unknown" && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Quantity" htmlFor={`quantity-${candidate.id}`}>
                <input
                  id={`quantity-${candidate.id}`}
                  className={inputClass}
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="any"
                  value={candidate.quantity ?? ""}
                  onChange={(event) => patch({ quantity: event.target.value ? Number(event.target.value) : null })}
                />
              </Field>
              <Field label="Unit" htmlFor={`unit-${candidate.id}`}>
                <input
                  id={`unit-${candidate.id}`}
                  className={inputClass}
                  placeholder="items"
                  maxLength={24}
                  value={candidate.unit ?? ""}
                  onChange={(event) => patch({ unit: event.target.value || null })}
                />
              </Field>
            </div>
          )}
          <Field label="Form" htmlFor={`form-${candidate.id}`}>
            <select
              id={`form-${candidate.id}`}
              className={selectClass}
              value={candidate.form}
              onChange={(event) => patch({ form: event.target.value as FoodForm })}
            >
              {forms.map((form) => (
                <option key={form.value} value={form.value}>
                  {form.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Put it in" htmlFor={`location-${candidate.id}`}>
            <select
              id={`location-${candidate.id}`}
              className={selectClass}
              value={candidate.location}
              onChange={(event) => patch({ location: event.target.value as FoodLocation })}
            >
              {locations.map((location) => (
                <option key={location.value} value={location.value}>
                  {location.label}
                </option>
              ))}
            </select>
          </Field>
          {candidate.uncertaintyReason && (
            <p className="bd text-[12px] text-[var(--time)] sm:col-span-2">
              {candidate.uncertaintyReason}
            </p>
          )}
          <button
            type="button"
            className="m justify-self-start text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)] sm:col-span-2"
            onClick={onToggleExpand}
          >
            done editing
          </button>
        </div>
      )}
    </div>
  );
}

export function AnalysisReview({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const { online, refresh } = useOfflineInventory();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [candidates, setCandidates] = useState<AnalysisCandidate[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
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

  function updateCandidate(id: string, candidate: AnalysisCandidate) {
    setCandidates((current) => current.map((item) => (item.id === id ? candidate : item)));
  }

  function toggleExpand(id: string) {
    setExpanded((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function addMissed() {
    const id = crypto.randomUUID();
    setCandidates((current) => [
      ...current,
      {
        id,
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
    setExpanded((current) => [...current, id]);
  }

  async function confirm() {
    const accepted = candidates.filter((candidate) => candidate.accepted);
    if (!accepted.length) {
      setError("Keep at least one food item, or leave this batch without saving.");
      return;
    }
    if (accepted.some((candidate) => !candidate.suggestedName.trim())) {
      setError("Every kept item needs a food name.");
      return;
    }
    if (
      accepted.some(
        (candidate) => candidate.quantityStatus !== "unknown" && (!candidate.quantity || candidate.quantity <= 0),
      )
    ) {
      setError("Enter a positive quantity for every item whose amount is tracked.");
      return;
    }
    if (accepted.some((candidate) => candidate.quantityStatus !== "unknown" && !candidate.unit?.trim())) {
      setError("Enter a unit for every item whose amount is tracked.");
      return;
    }
    if (!online) {
      setError("Connect before saving. Nothing has been added yet, and this review is still available.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await applyAnalysis(analysisId, accepted);
      await refresh(true).catch(() => undefined);
      router.replace("/inventory?batch=added");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The batch could not be saved.");
      setSaving(false);
    }
  }

  async function cancelBatch() {
    if (!online) {
      setError(
        "Connect to cancel immediately. If you leave instead, the abandonment cleanup removes the raw photos later.",
      );
      return;
    }
    if (!window.confirm("Cancel this batch and delete its private raw photos now? No inventory items have been added."))
      return;
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
      <Page className="flex min-h-[64dvh] max-w-[42rem] items-center">
        <div className="max-w-sm" role="status">
          <p className="ml">add food · working</p>
          <h1 className="hd mt-3 flex items-center gap-3 text-[26px]">
            <LoaderCircle className="size-5 animate-spin text-[var(--accent)]" aria-hidden="true" />
            Looking for food
          </h1>
          <p className="bd mt-2.5">
            This usually takes a moment. You will see every suggestion before the kitchen changes.
          </p>
          <div className="mt-7 h-px bg-[var(--hairline)]">
            <div className="h-px w-1/2 animate-pulse bg-[var(--accent-rule)] shadow-[0_0_8px_1px_var(--accent-halo)]" />
          </div>
          {error && (
            <p className="bd mt-4 text-[var(--time)]" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="m mt-6 min-h-9 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)] disabled:opacity-40"
            disabled={cancelling}
            onClick={() => void cancelBatch()}
          >
            cancel batch
          </button>
        </div>
      </Page>
    );
  }

  if (["failed", "cancelled", "expired"].includes(analysis.status)) {
    return (
      <Page className="max-w-[42rem]">
        <p className="ml">add food · stopped</p>
        <h1 className="hd mt-3 text-[26px]">
          {analysis.status === "expired" ? "This review expired." : "These photos could not be read."}
        </h1>
        <p className="bd mt-2.5 max-w-md">
          {analysis.errorCode
            ? `Analysis stopped with code ${analysis.errorCode}. Raw photos are no longer available, and nothing was added.`
            : "Raw photos are no longer available, and nothing was added. Start a fresh batch when you are ready."}
        </p>
        <div className="mt-7 flex items-center gap-6">
          <Link
            href="/capture"
            className="glow inline-flex min-h-11 items-center rounded-[3px] px-[18px] text-[15px] font-light"
          >
            Try another photo
          </Link>
          <Link href="/inventory#add-manually" className="m text-[11px] text-[var(--ink-4)] hover:text-[var(--ink)]">
            add one by hand
          </Link>
        </div>
      </Page>
    );
  }

  if (analysis.status === "applied") {
    return (
      <Page className="max-w-[42rem]">
        <p className="ml">add food · done</p>
        <h1 className="hd mt-3 text-[26px]">This batch is already in the kitchen.</h1>
        <p className="bd mt-2.5 max-w-md">
          The review was confirmed and its raw photos deleted. Every item stays editable.
        </p>
        <Link
          href="/inventory"
          className="glow mt-7 inline-flex min-h-11 items-center rounded-[3px] px-[18px] text-[15px] font-light"
        >
          Open the kitchen
        </Link>
      </Page>
    );
  }

  const kept = candidates.filter((candidate) => candidate.accepted);
  const dropped = candidates.filter((candidate) => !candidate.accepted);

  return (
    <Page className="max-w-[44rem]">
      <header className="flex items-start justify-between gap-6">
        <div>
          <p className="ml">add food · second of two</p>
          <h1 className="hd mt-3 text-[clamp(1.5rem,6vw,1.65rem)]">Keep what&rsquo;s right.</h1>
          <p className="bd mt-2.5 max-w-[30rem]">
            {candidates.length} suggestion{candidates.length === 1 ? "" : "s"}. Drop anything wrong, fix
            anything close. Nothing is saved until you say so.
          </p>
        </div>
        <button
          type="button"
          className="m flex-none text-[10.5px] text-[var(--ink-5)] hover:text-[var(--ink)] disabled:opacity-40"
          disabled={cancelling}
          onClick={() => void cancelBatch()}
        >
          cancel batch
        </button>
      </header>

      {error && (
        <div className="mt-6">
          <StateNotice title="Check this review" tone="error">
            {error}
          </StateNotice>
        </div>
      )}

      <div className="mt-9 flex flex-col gap-8">
        <Section label="keeping" meta={String(kept.length)} labelWidth="78px">
          {kept.length ? (
            kept.map((candidate) => (
              <KeptCandidate
                key={candidate.id}
                candidate={candidate}
                expanded={expanded.includes(candidate.id)}
                onToggleExpand={() => toggleExpand(candidate.id)}
                onChange={(next) => updateCandidate(candidate.id, next)}
              />
            ))
          ) : (
            <p className="bd py-4 text-[var(--ink-4)]">Nothing kept yet. Tick anything below to keep it.</p>
          )}
          <button
            type="button"
            className="row row-link min-h-[48px] w-full gap-3.5 px-1 text-left"
            onClick={addMissed}
          >
            <Plus className="size-4 flex-none text-[var(--ink-6)]" aria-hidden="true" />
            <span className="bd flex-1 italic text-[var(--ink-4)]">Something the photo missed…</span>
          </button>
        </Section>

        {dropped.length > 0 && (
          <Section label="dropped" meta={String(dropped.length)} labelWidth="78px">
            {dropped.map((candidate) => (
              <div key={candidate.id} className="row gap-3.5 px-1">
                <Tick
                  checked={false}
                  label={`Keep ${candidate.suggestedName || "this suggestion"}`}
                  onClick={() => updateCandidate(candidate.id, { ...candidate, accepted: true })}
                />
                <span className="nm min-w-0 flex-1 truncate text-[var(--ink-6)]">
                  {candidate.suggestedName || "Unnamed suggestion"}
                </span>
                <button
                  type="button"
                  className="m flex-none border-b border-[var(--edge-strong)] pb-0.5 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)]"
                  onClick={() => updateCandidate(candidate.id, { ...candidate, accepted: true })}
                >
                  keep it after all
                </button>
              </div>
            ))}
          </Section>
        )}
      </div>

      <div className="mt-9 flex flex-col gap-5 border-t border-[var(--hairline)] pt-4.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="bd max-w-[19rem] text-[12px] text-[var(--ink-6)]">
          Saving adds {numberWord(kept.length)} item{kept.length === 1 ? "" : "s"} and deletes the photos.
          Every item stays editable afterwards.
        </p>
        <Button busy={saving} disabled={!kept.length || !online} onClick={() => void confirm()}>
          Save {numberWord(kept.length)} item{kept.length === 1 ? "" : "s"}
        </Button>
      </div>
    </Page>
  );
}
