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

  it("leaves processing work inside the terminal window untouched", () => {
    const observedAt = Date.parse("2026-08-13T13:00:00.000Z");
    // 30 minutes stale: past the 15-minute scan cutoff, but well inside the
    // 60-minute terminal window, so the job is neither redispatched nor failed.
    const processing = {
      analysisId: "11111111-1111-4111-8111-111111111111",
      householdId: "22222222-2222-4222-8222-222222222222",
      createdBy: "33333333-3333-4333-8333-333333333333",
      status: "processing" as const,
      staleSince: "2026-08-13T12:30:00.001Z",
    };

    expect(planAnalysisRecovery([processing], observedAt)).toEqual({
      redispatch: [],
      fail: [],
    });
  });

  it("fails processing work only once the terminal window has elapsed", () => {
    const observedAt = Date.parse("2026-08-13T13:01:00.000Z");
    const terminalProcessing = {
      analysisId: "11111111-1111-4111-8111-111111111111",
      householdId: "22222222-2222-4222-8222-222222222222",
      createdBy: "33333333-3333-4333-8333-333333333333",
      status: "processing" as const,
      staleSince: "2026-08-13T12:00:00.000Z",
    };

    expect(planAnalysisRecovery([terminalProcessing], observedAt)).toEqual({
      redispatch: [],
      fail: [terminalProcessing],
    });
  });

  it("redispatches queued work until the terminal cutoff, then fails it", () => {
    const observedAt = Date.parse("2026-08-13T13:00:00.000Z");
    const recentQueued = {
      analysisId: "11111111-1111-4111-8111-111111111111",
      householdId: "22222222-2222-4222-8222-222222222222",
      createdBy: "33333333-3333-4333-8333-333333333333",
      status: "queued" as const,
      staleSince: "2026-08-13T12:30:00.001Z",
    };
    const terminalQueued = {
      ...recentQueued,
      analysisId: "44444444-4444-4444-8444-444444444444",
      staleSince: "2026-08-13T12:00:00.000Z",
    };

    expect(
      planAnalysisRecovery([recentQueued, terminalQueued], observedAt),
    ).toEqual({
      redispatch: [recentQueued],
      fail: [terminalQueued],
    });
  });

  it("never acts on processing jobs with an unparseable staleness timestamp", () => {
    const observedAt = Date.parse("2026-08-13T13:00:00.000Z");
    const malformedProcessing = {
      analysisId: "11111111-1111-4111-8111-111111111111",
      householdId: "22222222-2222-4222-8222-222222222222",
      createdBy: "33333333-3333-4333-8333-333333333333",
      status: "processing" as const,
      staleSince: "not-a-timestamp",
    };

    expect(planAnalysisRecovery([malformedProcessing], observedAt)).toEqual({
      redispatch: [],
      fail: [],
    });
  });
});
