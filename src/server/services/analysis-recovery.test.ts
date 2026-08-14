import { describe, expect, it } from "vitest";

import {
  buildAnalysisRecoveryEvents,
  planAnalysisRecovery,
} from "./analysis-recovery";

describe("stale analysis recovery events", () => {
  it("uses tenant-scoped payloads and stable IDs within a recovery window", () => {
    const jobs = [
      {
        analysisId: "11111111-1111-4111-8111-111111111111",
        householdId: "22222222-2222-4222-8222-222222222222",
        createdBy: "33333333-3333-4333-8333-333333333333",
        status: "queued" as const,
        staleSince: "2026-08-13T12:00:00.000Z",
      },
    ];
    const first = buildAnalysisRecoveryEvents(
      jobs,
      Date.parse("2026-08-13T12:05:01.000Z"),
    );
    const replay = buildAnalysisRecoveryEvents(
      jobs,
      Date.parse("2026-08-13T12:09:59.000Z"),
    );

    expect(replay).toEqual(first);
    expect(first[0]).toMatchObject({
      name: "foodtopia/analysis.requested",
      data: {
        analysisId: jobs[0]?.analysisId,
        householdId: jobs[0]?.householdId,
      },
    });
  });

  it("uses a new id in a later window for queued delivery recovery", () => {
    const jobs = [
      {
        analysisId: "11111111-1111-4111-8111-111111111111",
        householdId: "22222222-2222-4222-8222-222222222222",
        createdBy: "33333333-3333-4333-8333-333333333333",
        status: "queued" as const,
        staleSince: "2026-08-13T12:00:00.000Z",
      },
    ];

    expect(
      buildAnalysisRecoveryEvents(jobs, Date.parse("2026-08-13T12:05:00Z"))[0]
        ?.id,
    ).not.toBe(
      buildAnalysisRecoveryEvents(jobs, Date.parse("2026-08-13T12:10:00Z"))[0]
        ?.id,
    );
  });

  it("fails stale processing immediately and queued work at the terminal cutoff", () => {
    const observedAt = Date.parse("2026-08-13T13:00:00.000Z");
    const processing = {
      analysisId: "11111111-1111-4111-8111-111111111111",
      householdId: "22222222-2222-4222-8222-222222222222",
      createdBy: "33333333-3333-4333-8333-333333333333",
      status: "processing" as const,
      staleSince: "2026-08-13T12:30:00.001Z",
    };
    const recentQueued = {
      ...processing,
      status: "queued" as const,
    };
    const terminalQueued = {
      ...recentQueued,
      analysisId: "44444444-4444-4444-8444-444444444444",
      staleSince: "2026-08-13T12:00:00.000Z",
    };

    expect(
      planAnalysisRecovery(
        [processing, recentQueued, terminalQueued],
        observedAt,
      ),
    ).toEqual({
      redispatch: [recentQueued],
      fail: [processing, terminalQueued],
    });
  });
});
