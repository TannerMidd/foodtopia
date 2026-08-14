import { describe, expect, it } from "vitest";

import type { Analysis, AnalysisCandidate } from "@/contracts/domain";

import { getAnalysisReviewMetrics } from "./analysis-review-metrics";

const candidate = (
  id: string,
  overrides: Partial<AnalysisCandidate> = {},
) =>
  ({
    id,
    suggestedName: "Tomatoes",
    suggestedConceptId: "tomato",
    quantityStatus: "known",
    quantity: 2,
    unit: "count",
    form: "fresh",
    location: "fridge",
    ...overrides,
  }) as AnalysisCandidate;

describe("analysis review telemetry", () => {
  it("counts accepted, rejected, and manual additions without exposing labels", () => {
    const snapshot = {
      updatedAt: "2026-08-13T12:00:00.000Z",
      candidates: [candidate("proposal-1"), candidate("proposal-2")],
    } satisfies Pick<Analysis, "updatedAt" | "candidates">;

    expect(
      getAnalysisReviewMetrics(
        snapshot,
        [candidate("proposal-1"), candidate("manual-1")],
        Date.parse("2026-08-13T12:00:05.000Z"),
      ),
    ).toEqual({
      acceptedCount: 2,
      rejectedCount: 1,
      correctionCount: 2,
      durationMs: 5_000,
    });
  });

  it("keeps accepted count when the optional review snapshot is unavailable", () => {
    expect(
      getAnalysisReviewMetrics(null, [candidate("accepted"), candidate("accepted")]),
    ).toEqual({ acceptedCount: 1 });
  });

  it("omits durations outside the privacy-safe telemetry range", () => {
    const snapshot = {
      updatedAt: "2026-08-11T12:00:00.000Z",
      candidates: [],
    } satisfies Pick<Analysis, "updatedAt" | "candidates">;

    expect(
      getAnalysisReviewMetrics(
        snapshot,
        [],
        Date.parse("2026-08-13T12:00:00.000Z"),
      ),
    ).toEqual({ acceptedCount: 0, rejectedCount: 0, correctionCount: 0 });
  });

  it("counts edited proposals without returning any edited values", () => {
    const snapshot = {
      updatedAt: "2026-08-13T12:00:00.000Z",
      candidates: [candidate("proposal-1"), candidate("proposal-2")],
    } satisfies Pick<Analysis, "updatedAt" | "candidates">;

    const metrics = getAnalysisReviewMetrics(
      snapshot,
      [
        candidate("proposal-1", { quantity: 3 }),
        candidate("proposal-2"),
      ],
      Date.parse("2026-08-13T12:00:05.000Z"),
    );

    expect(metrics.correctionCount).toBe(1);
    expect(Object.values(metrics)).not.toContain("Tomatoes");
  });
});
