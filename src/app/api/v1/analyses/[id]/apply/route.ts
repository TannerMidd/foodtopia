import {
  analysisApplyRequestSchema,
  analysisResponseSchema,
} from "@/contracts/api";
import { analysisCandidateSchema } from "@/contracts/domain";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  applyDemoAnalysis,
  getDemoAnalysis,
} from "@/server/demo/store";
import {
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import {
  applyProductionAnalysis,
  getProductionAnalysis,
} from "@/server/repositories/analyses";
import { asApiError } from "@/server/repositories/errors";
import { recordProductEvent } from "@/server/repositories/telemetry";
import { getAnalysisReviewMetrics } from "@/server/services/analysis-review-metrics";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const correlation = correlationId(request);
  try {
    const input = await parseJson(request, analysisApplyRequestSchema);
    const { id } = await params;
    const candidates = input.candidates.map((candidate) =>
      analysisCandidateSchema.parse({ ...candidate, analysisId: id }),
    );
    if (!isDemoMode) {
      const session = await requireHouseholdSession();
      const client = await createServerSupabaseClient();
      const reviewCompletedAt = Date.now();
      const reviewSnapshot = await getProductionAnalysis(
        client,
        id,
        session.householdId,
      ).catch(() => null);
      const applied = analysisResponseSchema.parse(
        await applyProductionAnalysis(
          client,
          id,
          session.householdId,
          candidates,
        ),
      );
      await recordProductEvent({
        householdId: session.householdId,
        userId: session.userId,
        eventName: "analysis_applied",
        properties: getAnalysisReviewMetrics(
          reviewSnapshot,
          candidates,
          reviewCompletedAt,
        ),
        idempotencyKey: `analysis-applied:${id}`,
      });
      return json(applied);
    }
    applyDemoAnalysis(id, candidates);
    return json(analysisResponseSchema.parse(getDemoAnalysis(id)));
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "ANALYSIS_APPLY_FAILED",
        message: "The reviewed foods could not be added to inventory.",
      }),
      correlation,
    );
  }
}
