import { describe, expect, it } from "vitest";
import {
  scoreVisionEvaluation,
  type VisionManifest,
  type VisionResults,
} from "./lib/vision-eval";

const manifest: VisionManifest = {
  version: 1,
  batches: [
    {
      id: "batch-1",
      imagePaths: ["private/batch-1.jpg"],
      expectedConceptIds: ["tomato", "eggs"],
      tags: ["good-light"],
    },
    {
      id: "batch-2",
      imagePaths: ["private/batch-2.jpg"],
      expectedConceptIds: ["milk"],
      tags: ["packaged"],
    },
  ],
};

const results: VisionResults = {
  version: 1,
  batches: [
    { id: "batch-1", proposedConceptIds: ["tomato", "pepper"] },
    { id: "batch-2", proposedConceptIds: ["milk"] },
  ],
};

describe("scoreVisionEvaluation", () => {
  it("scores linked batches using multiset intersections", () => {
    expect(scoreVisionEvaluation(manifest, results)).toEqual({
      batchCount: 2,
      truePositives: 2,
      proposalCount: 3,
      expectedCount: 3,
      precision: 2 / 3,
      recall: 2 / 3,
    });
  });

  it("rejects duplicate manifest batch IDs", () => {
    expect(() =>
      scoreVisionEvaluation(
        { ...manifest, batches: [...manifest.batches, manifest.batches[0]] },
        results,
      ),
    ).toThrow("Duplicate manifest batch ID: batch-1");
  });

  it("rejects duplicate result batch IDs", () => {
    expect(() =>
      scoreVisionEvaluation(manifest, {
        ...results,
        batches: [...results.batches, results.batches[0]],
      }),
    ).toThrow("Duplicate results batch ID: batch-1");
  });

  it("rejects missing and unlinked result batches", () => {
    expect(() =>
      scoreVisionEvaluation(manifest, {
        version: 1,
        batches: [{ id: "different", proposedConceptIds: ["milk"] }],
      }),
    ).toThrow(
      "Benchmark/results batch mismatch (missing results: batch-1, batch-2; unlinked results: different).",
    );
  });
});
