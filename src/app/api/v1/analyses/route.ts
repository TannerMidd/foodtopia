import {
  analysisCreateRequestSchema,
  analysisCreateResponseSchema,
  unfinishedAnalysesResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  createDemoAnalysis,
  DEMO_HOUSEHOLD_ID,
  listDemoUnfinishedAnalyses,
} from "@/server/demo/store";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import {
  createProductionAnalysis,
  listUnfinishedProductionAnalyses,
} from "@/server/repositories/analyses";
import { asApiError } from "@/server/repositories/errors";
import { recordProductEvent } from "@/server/repositories/telemetry";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    if (isDemoMode) {
      return json(
        unfinishedAnalysesResponseSchema.parse({
          analyses: listDemoUnfinishedAnalyses(),
        }),
      );
    }
    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    return json(
      unfinishedAnalysesResponseSchema.parse({
        analyses: await listUnfinishedProductionAnalyses(
          client,
          session.householdId,
        ),
      }),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "ANALYSIS_LIST_FAILED",
        message: "Unfinished photo reviews could not be loaded.",
      }),
      id,
    );
  }
}

export async function POST(request: Request) {
  const id = correlationId(request);
  try {
    const input = await parseJson(request, analysisCreateRequestSchema);
    if (input.imageCount !== input.files.length) {
      throw new ApiFault(
        "IMAGE_COUNT_MISMATCH",
        "Image count must match the supplied file descriptors.",
        422,
      );
    }
    if (isDemoMode) {
      const analysis = createDemoAnalysis(input.files);
      return json(
        analysisCreateResponseSchema.parse({
          analysisId: analysis.id,
          uploadMode: "demo",
          uploads: analysis.assetIds.map((assetId, index) => ({
            assetId,
            objectPath: `${DEMO_HOUSEHOLD_ID}/${analysis.id}/${index}.jpg`,
            token: null,
            signedUrl: null,
          })),
        }),
        { status: 201 },
      );
    }

    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    const created = analysisCreateResponseSchema.parse(
      await createProductionAnalysis(client, session, input.files),
    );
    await recordProductEvent({
      householdId: session.householdId,
      userId: session.userId,
      eventName: "analysis_created",
      properties: { imageCount: input.files.length },
      idempotencyKey: `analysis-created:${created.analysisId}`,
    });
    return json(
      created,
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "ANALYSIS_CREATE_FAILED",
        message: "The private photo upload could not be prepared.",
      }),
      id,
    );
  }
}
