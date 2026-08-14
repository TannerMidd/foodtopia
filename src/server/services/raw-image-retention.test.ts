import { describe, expect, it } from "vitest";

import {
  RAW_IMAGE_PURGE_CLAIM_LIMIT,
  RAW_IMAGE_PURGE_MAX_BATCHES,
  shouldContinuePurgeDrain,
} from "./raw-image-retention";

describe("raw-image purge drain policy", () => {
  it("continues after a full analysis batch even when analyses have multiple assets", () => {
    const claims = Array.from(
      { length: RAW_IMAGE_PURGE_CLAIM_LIMIT },
      (_, analysisIndex) => [0, 1, 2].map(() => ({ analysis_id: analysisIndex })),
    ).flat();

    expect(shouldContinuePurgeDrain(claims, 1)).toBe(true);
  });

  it("stops after a partial batch or the bounded batch limit", () => {
    expect(
      shouldContinuePurgeDrain([{ analysis_id: "only-analysis" }], 1),
    ).toBe(false);

    const fullBatch = Array.from(
      { length: RAW_IMAGE_PURGE_CLAIM_LIMIT },
      (_, index) => ({ analysis_id: index }),
    );
    expect(
      shouldContinuePurgeDrain(fullBatch, RAW_IMAGE_PURGE_MAX_BATCHES),
    ).toBe(false);
  });
});
