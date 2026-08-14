import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { recordProductEvent } from "@/server/repositories/telemetry";

export const ANALYSIS_RECOVERY_CRON = "*/5 * * * *";
export const ANALYSIS_RECOVERY_LIMIT_PER_STATE = 100;
export const QUEUED_ANALYSIS_STALE_MS = 2 * 60 * 1000;
export const PROCESSING_ANALYSIS_STALE_MS = 15 * 60 * 1000;
export const TERMINAL_ANALYSIS_STALE_MS = 60 * 60 * 1000;

export type StaleAnalysisJob = Readonly<{
  analysisId: string;
  householdId: string;
  createdBy: string;
  status: "queued" | "processing";
  staleSince: string;
}>;

export type AnalysisRecoveryScan = Readonly<{
  observedAt: number;
  jobs: StaleAnalysisJob[];
}>;

export type AnalysisRecoveryPlan = Readonly<{
  redispatch: StaleAnalysisJob[];
  fail: StaleAnalysisJob[];
}>;

export function planAnalysisRecovery(
  jobs: readonly StaleAnalysisJob[],
  observedAt: number,
): AnalysisRecoveryPlan {
  const redispatch: StaleAnalysisJob[] = [];
  const fail: StaleAnalysisJob[] = [];
  for (const job of jobs) {
    const staleSince = Date.parse(job.staleSince);
    if (
      job.status === "processing" ||
      Number.isFinite(staleSince) &&
        observedAt - staleSince >= TERMINAL_ANALYSIS_STALE_MS
    ) {
      fail.push(job);
    } else {
      redispatch.push(job);
    }
  }
  return { redispatch, fail };
}

export function buildAnalysisRecoveryEvents(
  jobs: readonly StaleAnalysisJob[],
  observedAt: number,
) {
  const recoveryWindow = Math.floor(observedAt / (5 * 60 * 1000));
  return jobs.map((job) => ({
    id: `analysis-recovery-${job.analysisId}-${job.status}-${recoveryWindow}`,
    name: "foodtopia/analysis.requested" as const,
    data: {
      analysisId: job.analysisId,
      householdId: job.householdId,
    },
  }));
}

/**
 * Find bounded stale work. Reprocessing is safe because worker state changes
 * are service-RPC guarded and inventory is never changed before review/apply.
 */
export async function listStaleAnalysisJobs(
  observedAt = Date.now(),
): Promise<AnalysisRecoveryScan> {
  if (isDemoMode) return { observedAt, jobs: [] };
  const admin = createAdminSupabaseClient();
  const queuedCutoff = new Date(
    observedAt - QUEUED_ANALYSIS_STALE_MS,
  ).toISOString();
  const processingCutoff = new Date(
    observedAt - PROCESSING_ANALYSIS_STALE_MS,
  ).toISOString();
  const [queuedResult, processingResult] = await Promise.all([
    admin
      .from("analyses")
      .select("id, household_id, created_by, status, updated_at, started_at")
      .eq("status", "queued")
      .lt("updated_at", queuedCutoff)
      .order("updated_at", { ascending: true })
      .limit(ANALYSIS_RECOVERY_LIMIT_PER_STATE),
    admin
      .from("analyses")
      .select("id, household_id, created_by, status, updated_at, started_at")
      .eq("status", "processing")
      .lt("started_at", processingCutoff)
      .order("started_at", { ascending: true })
      .limit(ANALYSIS_RECOVERY_LIMIT_PER_STATE),
  ]);
  if (queuedResult.error) throw queuedResult.error;
  if (processingResult.error) throw processingResult.error;

  const jobs = [...(queuedResult.data ?? []), ...(processingResult.data ?? [])]
    .filter(
      (row): row is typeof row & { status: "queued" | "processing" } =>
        row.status === "queued" || row.status === "processing",
    )
    .map((row) => ({
      analysisId: row.id,
      householdId: row.household_id,
      createdBy: row.created_by,
      status: row.status,
      staleSince: row.started_at ?? row.updated_at,
    }))
    .sort(
      (left, right) =>
        left.staleSince.localeCompare(right.staleSince) ||
        left.analysisId.localeCompare(right.analysisId),
    );
  return { observedAt, jobs };
}

/**
 * Guarded service transitions make a concurrent worker completion harmless.
 * Processing work is never redispatched: the original invocation already owns
 * the provider retry budget, so recovery fails a stale lease once and lets the
 * user explicitly retry as a new batch.
 */
export async function failTerminallyStaleAnalyses(
  jobs: readonly StaleAnalysisJob[],
  observedAt: number,
) {
  if (isDemoMode || jobs.length === 0) return { failed: 0 };
  const admin = createAdminSupabaseClient();
  let failed = 0;
  let firstUnexpectedError: unknown;

  for (const job of jobs) {
    try {
      if (job.status === "queued") {
        const { error: startError } = await admin.rpc(
          "store_analysis_candidates",
          {
            p_analysis_id: job.analysisId,
            p_from_status: "queued",
            p_to_status: "processing",
            p_candidates: [],
            p_provider: null,
            p_model: null,
            p_prompt_version: "food-batch-v1",
            p_error_code: null,
            p_error_detail: null,
          },
        );
        if (startError) throw startError;
      }
      const { error: failError } = await admin.rpc(
        "store_analysis_candidates",
        {
          p_analysis_id: job.analysisId,
          p_from_status: "processing",
          p_to_status: "failed",
          p_candidates: [],
          p_provider: null,
          p_model: null,
          p_prompt_version: "food-batch-v1",
          p_error_code: "VISION_PROCESSING_TIMEOUT",
          p_error_detail:
            "Vision processing did not complete within the recovery window.",
        },
      );
      if (failError) throw failError;
      failed += 1;
      await recordProductEvent({
        householdId: job.householdId,
        userId: job.createdBy,
        eventName: "analysis_failed",
        source: "worker",
        properties: {
          durationMs: Math.min(
            86_400_000,
            Math.max(0, observedAt - Date.parse(job.staleSince)),
          ),
        },
        idempotencyKey: `analysis-failed:${job.analysisId}`,
      });
    } catch (error) {
      // A guarded status conflict normally means the live worker won the race.
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== "40001" && code !== "23505") {
        firstUnexpectedError ??= error;
      }
    }
  }

  if (firstUnexpectedError) throw firstUnexpectedError;
  return { failed };
}
