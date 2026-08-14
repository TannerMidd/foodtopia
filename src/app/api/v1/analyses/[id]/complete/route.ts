import {
  analysisCompleteRequestSchema,
  analysisResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";
import { requireHouseholdSession } from "@/server/auth/session";
import { getDemoAnalysis, setDemoAnalysis } from "@/server/demo/store";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import {
  getProductionAnalysis,
  markAnalysisComplete,
  verifyCompletedUploads,
} from "@/server/repositories/analyses";
import { asApiError } from "@/server/repositories/errors";
import { recordProductEvent } from "@/server/repositories/telemetry";
import { processAnalysis } from "@/server/services/analysis";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, { params }: Context) {
  const correlation = correlationId(request);
  try {
    const input = await parseJson(request, analysisCompleteRequestSchema);
    const { id } = await params;
    if (!isDemoMode) {
      const session = await requireHouseholdSession();
      const client = await createServerSupabaseClient();
      await verifyCompletedUploads(
        client,
        id,
        session.householdId,
        input.assetIds,
      );
      await markAnalysisComplete(client, id, input.assetIds);
      try {
        await inngest.send({
          id: `analysis-${id}`,
          name: "foodtopia/analysis.requested",
          data: { analysisId: id, householdId: session.householdId },
        });
      } catch {
        // The database commit is the durable acceptance boundary. A scheduled
        // recovery scan redispatches stale queued rows, so a transient event
        // send failure must not turn a committed completion into a false 502.
      }
      const completed = analysisResponseSchema.parse(
        await getProductionAnalysis(client, id, session.householdId),
      );
      await recordProductEvent({
        householdId: session.householdId,
        userId: session.userId,
        eventName: "analysis_completed",
        properties: { imageCount: input.assetIds.length },
        idempotencyKey: `analysis-completed:${id}`,
      });
      return json(completed, { status: 202 });
    }
    const analysis = getDemoAnalysis(id);
    if (
      input.assetIds.length !== analysis.assetIds.length ||
      input.assetIds.some((assetId) => !analysis.assetIds.includes(assetId))
    ) {
      throw new ApiFault(
        "UPLOAD_SET_MISMATCH",
        "The completed uploads do not match this scan.",
        422,
      );
    }
    if (analysis.status === "needs_review" || analysis.status === "applied") {
      return json(analysis);
    }
    setDemoAnalysis(id, { status: "queued" });
    const completed = await processAnalysis(id, analysis.householdId);
    return json(completed, { status: 202 });
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "ANALYSIS_COMPLETE_FAILED",
        message: "The uploaded scan could not be completed.",
      }),
      correlation,
    );
  }
}
