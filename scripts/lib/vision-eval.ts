import { z } from "zod";

export const visionManifestSchema = z.object({
  version: z.literal(1),
  batches: z.array(
    z.object({
      id: z.string().trim().min(1),
      imagePaths: z.array(z.string().trim().min(1)).min(1),
      expectedConceptIds: z.array(z.string().trim().min(1)).min(1),
      tags: z.array(z.string().trim().min(1)).default([]),
    }),
  ),
});

export const visionResultsSchema = z.object({
  version: z.literal(1),
  batches: z.array(
    z.object({
      id: z.string().trim().min(1),
      proposedConceptIds: z.array(z.string().trim().min(1)),
    }),
  ),
});

export type VisionManifest = z.infer<typeof visionManifestSchema>;
export type VisionResults = z.infer<typeof visionResultsSchema>;

export type VisionScore = Readonly<{
  batchCount: number;
  truePositives: number;
  proposalCount: number;
  expectedCount: number;
  precision: number;
  recall: number;
}>;

function indexUniqueBatches<T extends { id: string }>(
  batches: readonly T[],
  source: "manifest" | "results",
) {
  const indexed = new Map<string, T>();
  for (const batch of batches) {
    if (indexed.has(batch.id)) {
      throw new Error(`Duplicate ${source} batch ID: ${batch.id}`);
    }
    indexed.set(batch.id, batch);
  }
  return indexed;
}

function counts(values: readonly string[]) {
  const bag = new Map<string, number>();
  values.forEach((id) => bag.set(id, (bag.get(id) ?? 0) + 1));
  return bag;
}

export function scoreVisionEvaluation(
  manifest: VisionManifest,
  results: VisionResults,
): VisionScore {
  const expectedById = indexUniqueBatches(manifest.batches, "manifest");
  const proposedById = indexUniqueBatches(results.batches, "results");
  const missing = [...expectedById.keys()].filter((id) => !proposedById.has(id));
  const unexpected = [...proposedById.keys()].filter((id) => !expectedById.has(id));
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      missing.length > 0 ? `missing results: ${missing.join(", ")}` : null,
      unexpected.length > 0 ? `unlinked results: ${unexpected.join(", ")}` : null,
    ].filter(Boolean);
    throw new Error(`Benchmark/results batch mismatch (${details.join("; ")}).`);
  }

  let truePositives = 0;
  let proposalCount = 0;
  let expectedCount = 0;
  for (const [id, expectedBatch] of expectedById) {
    const resultBatch = proposedById.get(id);
    if (!resultBatch) throw new Error(`Missing results for batch: ${id}`);
    const truth = counts(expectedBatch.expectedConceptIds);
    const proposed = counts(resultBatch.proposedConceptIds);
    truePositives += [...proposed].reduce(
      (total, [conceptId, count]) =>
        total + Math.min(count, truth.get(conceptId) ?? 0),
      0,
    );
    proposalCount += resultBatch.proposedConceptIds.length;
    expectedCount += expectedBatch.expectedConceptIds.length;
  }

  return {
    batchCount: manifest.batches.length,
    truePositives,
    proposalCount,
    expectedCount,
    precision: proposalCount === 0 ? 0 : truePositives / proposalCount,
    recall: expectedCount === 0 ? 0 : truePositives / expectedCount,
  };
}
