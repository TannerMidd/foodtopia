import type { Analysis, AnalysisCandidate } from "@/contracts/domain";

const MAX_TELEMETRY_DURATION_MS = 86_400_000;

type ReviewSnapshot = Pick<Analysis, "candidates" | "updatedAt">;
type ComparedCandidateFields = Pick<
  AnalysisCandidate,
  | "id"
  | "suggestedName"
  | "suggestedConceptId"
  | "quantityStatus"
  | "quantity"
  | "unit"
  | "form"
  | "location"
>;

export type AnalysisReviewMetrics = {
  acceptedCount: number;
  rejectedCount?: number;
  correctionCount?: number;
  durationMs?: number;
};

function candidateWasCorrected(
  original: ComparedCandidateFields,
  reviewed: ComparedCandidateFields,
): boolean {
  return (
    original.suggestedName !== reviewed.suggestedName ||
    original.suggestedConceptId !== reviewed.suggestedConceptId ||
    original.quantityStatus !== reviewed.quantityStatus ||
    original.quantity !== reviewed.quantity ||
    original.unit !== reviewed.unit ||
    original.form !== reviewed.form ||
    original.location !== reviewed.location
  );
}

/** Derives only aggregate review telemetry; food names and labels never leave. */
export function getAnalysisReviewMetrics(
  snapshot: ReviewSnapshot | null,
  acceptedCandidates: readonly ComparedCandidateFields[],
  completedAt = Date.now(),
): AnalysisReviewMetrics {
  const acceptedIds = new Set(
    acceptedCandidates.map((candidate) => candidate.id),
  );
  const result: AnalysisReviewMetrics = { acceptedCount: acceptedIds.size };
  if (!snapshot) return result;

  const proposedIds = new Set(
    snapshot.candidates.map((candidate) => candidate.id),
  );
  const proposedById = new Map(
    snapshot.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const reviewedById = new Map(
    acceptedCandidates.map((candidate) => [candidate.id, candidate]),
  );
  let acceptedProposalCount = 0;
  let editedProposalCount = 0;
  for (const [candidateId, candidate] of reviewedById) {
    const original = proposedById.get(candidateId);
    if (original) {
      acceptedProposalCount += 1;
      if (candidateWasCorrected(original, candidate)) editedProposalCount += 1;
    }
  }
  result.rejectedCount = Math.max(0, proposedIds.size - acceptedProposalCount);
  const manuallyAddedCount = Math.max(0, acceptedIds.size - acceptedProposalCount);
  result.correctionCount =
    editedProposalCount + result.rejectedCount + manuallyAddedCount;

  const reviewStartedAt = Date.parse(snapshot.updatedAt);
  const durationMs = completedAt - reviewStartedAt;
  if (
    Number.isFinite(durationMs) &&
    durationMs >= 0 &&
    durationMs <= MAX_TELEMETRY_DURATION_MS
  ) {
    result.durationMs = Math.trunc(durationMs);
  }
  return result;
}
