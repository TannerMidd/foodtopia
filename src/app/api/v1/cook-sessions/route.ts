import {
  cookSessionCreateRequestSchema,
  cookSessionCreateResponseSchema,
  cookSessionSubstitutionConflictSchema,
} from "@/contracts/api";
import type { RecipeAssessment } from "@/contracts/domain";
import {
  DEFAULT_RECIPE_INTENT,
  assessRecipe,
  confirmedSubstitutionsForAssessment,
  materializeEffectiveAssessment,
} from "@/domain/assessment";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  createDemoCookSession,
  listDemoApprovedRecipes,
  listDemoInventory,
} from "@/server/demo/store";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { createProductionCookSession } from "@/server/repositories/cooking";
import { asApiError } from "@/server/repositories/errors";
import { getInventorySync } from "@/server/repositories/inventory";
import { readDemoPreferences } from "@/server/repositories/preferences";
import {
  getAvailableRecipe,
  getHouseholdPreferences,
} from "@/server/repositories/recipes";
import { getPreviewRecipeCatalog } from "@/server/recipes/catalog";
import { recordProductEvent } from "@/server/repositories/telemetry";

export const runtime = "nodejs";

type Confirmation = Readonly<{
  ingredientId: string;
  matchedConceptId: string;
}>;

function normalizedConfirmations(values: readonly Confirmation[]) {
  return [...values].sort(
    (left, right) =>
      left.ingredientId.localeCompare(right.ingredientId, "en-US") ||
      left.matchedConceptId.localeCompare(right.matchedConceptId, "en-US"),
  );
}

function substitutionsMatch(
  assessment: RecipeAssessment,
  submitted: readonly Confirmation[],
) {
  const required = confirmedSubstitutionsForAssessment(assessment);
  return JSON.stringify(required) === JSON.stringify(normalizedConfirmations(submitted));
}

function substitutionConflict(correlation: string, latestAssessment: RecipeAssessment) {
  return json(
    cookSessionSubstitutionConflictSchema.parse({
      code: "RECIPE_SUBSTITUTIONS_CHANGED",
      message: "The available substitutions changed. Review and confirm them again before cooking.",
      retryable: false,
      correlationId: correlation,
      latestAssessment,
    }),
    { status: 409 },
  );
}

export async function POST(request: Request) {
  const correlation = correlationId(request);
  try {
    const input = await parseJson(request, cookSessionCreateRequestSchema);

    if (isDemoMode) {
      const recipe = [
        ...(await getPreviewRecipeCatalog()),
        ...listDemoApprovedRecipes(),
      ].find((candidate) => candidate.id === input.recipeId);
      if (!recipe) {
        throw new ApiFault(
          "RECIPE_UNAVAILABLE",
          "This recipe is not available for cooking.",
          404,
        );
      }
      const assessment = assessRecipe(
        recipe,
        listDemoInventory(),
        readDemoPreferences(),
        { ...DEFAULT_RECIPE_INTENT, servings: input.servings },
      );
      if (!substitutionsMatch(assessment, input.confirmedSubstitutions)) {
        return substitutionConflict(correlation, assessment);
      }
      if (assessment.tier === "incompatible") {
        throw new ApiFault(
          "RECIPE_INCOMPATIBLE",
          "This recipe conflicts with the current household preferences.",
          422,
        );
      }
      const effectiveAssessment = materializeEffectiveAssessment(
        assessment,
        input.servings,
      );
      return json(
        cookSessionCreateResponseSchema.parse({
          ...createDemoCookSession(input.recipeId),
          assessment: effectiveAssessment,
        }),
        { status: 201 },
      );
    }

    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    const [recipe, inventoryResult, preferences] = await Promise.all([
      getAvailableRecipe(client, input.recipeId, session.householdId),
      getInventorySync(client, null),
      getHouseholdPreferences(client, session.householdId),
    ]);
    if (!recipe) {
      throw new ApiFault(
        "RECIPE_UNAVAILABLE",
        "This recipe is not available for cooking.",
        404,
      );
    }

    const assessment = assessRecipe(
      recipe,
      inventoryResult.lots,
      preferences,
      { ...DEFAULT_RECIPE_INTENT, servings: input.servings },
    );
    if (!substitutionsMatch(assessment, input.confirmedSubstitutions)) {
      return substitutionConflict(correlation, assessment);
    }
    if (assessment.tier === "incompatible") {
      throw new ApiFault(
        "RECIPE_INCOMPATIBLE",
        "This recipe conflicts with the current household preferences.",
        422,
      );
    }
    const effectiveAssessment = materializeEffectiveAssessment(
      assessment,
      input.servings,
    );
    const created = cookSessionCreateResponseSchema.parse(
      await createProductionCookSession(session, effectiveAssessment),
    );
    await recordProductEvent({
      householdId: session.householdId,
      userId: session.userId,
      eventName: "cook_started",
      properties: { itemCount: effectiveAssessment.recipe.ingredients.length },
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
