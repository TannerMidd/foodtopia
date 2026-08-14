import { analysisResponseSchema } from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import { getDemoAnalysis, setDemoAnalysis } from "@/server/demo/store";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
} from "@/server/http";
import {
  cancelProductionAnalysis,
  getProductionAnalysis,
} from "@/server/repositories/analyses";
import { asApiError } from "@/server/repositories/errors";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const correlation = correlationId(request);
  try {
    const { id } = await params;
    if (isDemoMode) {
      return json(analysisResponseSchema.parse(getDemoAnalysis(id)));
    }
    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    return json(
      analysisResponseSchema.parse(
        await getProductionAnalysis(client, id, session.householdId),
      ),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "ANALYSIS_READ_FAILED",
        message: "The scan could not be loaded.",
      }),
      correlation,
    );
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const correlation = correlationId(request);
  try {
    const { id } = await params;
    if (!isDemoMode) {
      const session = await requireHouseholdSession();
      const client = await createServerSupabaseClient();
      return json(
        analysisResponseSchema.parse(
          await cancelProductionAnalysis(client, id, session.householdId),
        ),
      );
    }
    const analysis = getDemoAnalysis(id);
    if (analysis.status === "applied") {
      throw new ApiFault(
        "ANALYSIS_ALREADY_APPLIED",
        "An applied scan cannot be cancelled.",
        409,
      );
    }
    return json(
      analysisResponseSchema.parse(
        setDemoAnalysis(id, { status: "cancelled", candidates: [] }),
      ),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "ANALYSIS_CANCEL_FAILED",
        message: "The scan could not be cancelled and purged.",
      }),
      correlation,
    );
  }
}
