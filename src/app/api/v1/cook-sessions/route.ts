import {
  cookSessionCreateRequestSchema,
  cookSessionCreateResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import { createDemoCookSession } from "@/server/demo/store";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { createProductionCookSession } from "@/server/repositories/cooking";
import { asApiError } from "@/server/repositories/errors";
import { getPublishedRecipe } from "@/server/repositories/recipes";
import { recordProductEvent } from "@/server/repositories/telemetry";

export async function POST(request: Request) {
  const correlation = correlationId(request);
  try {
    const input = await parseJson(request, cookSessionCreateRequestSchema);
    if (input.recipeId !== input.assessment.recipe.id) {
      throw new ApiFault(
        "RECIPE_MISMATCH",
        "The recipe assessment does not match this cooking session.",
        422,
      );
    }
    if (isDemoMode) {
      return json(
        cookSessionCreateResponseSchema.parse(
          createDemoCookSession(input.recipeId),
        ),
        { status: 201 },
      );
    }
    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    const recipe = await getPublishedRecipe(client, input.recipeId);
    if (!recipe) {
      throw new ApiFault(
        "RECIPE_NOT_PUBLISHED",
        "This recipe is not available for cooking.",
        404,
      );
    }
    const created = cookSessionCreateResponseSchema.parse(
      await createProductionCookSession(client, session, recipe),
    );
    await recordProductEvent({
      householdId: session.householdId,
      userId: session.userId,
      eventName: "cook_started",
      properties: { itemCount: recipe.ingredients.length },
      idempotencyKey: `cook-started:${created.cookSessionId}`,
    });
    return json(created, { status: 201 });
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "COOK_SESSION_CREATE_FAILED",
        message: "Cooking mode could not be started.",
      }),
      correlation,
    );
  }
}
