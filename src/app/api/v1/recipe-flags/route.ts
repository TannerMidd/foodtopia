import {
  recipeFlagRequestSchema,
  recipeFlagResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import { flagVisibleRecipe } from "@/server/repositories/recipes";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const id = correlationId(request);
  try {
    const input = await parseJson(request, recipeFlagRequestSchema);
    if (isDemoMode) {
      return json(recipeFlagResponseSchema.parse({ flagged: true, simulated: true }), {
        status: 201,
      });
    }

    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    await flagVisibleRecipe(client, {
      householdId: session.householdId,
      userId: session.userId,
      recipeId: input.recipeId,
      reason: input.reason,
    });

    return json(recipeFlagResponseSchema.parse({ flagged: true, simulated: false }), {
      status: 201,
    });
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "RECIPE_FLAG_FAILED",
        message: "The recipe could not be flagged.",
      }),
      id,
    );
  }
}
