import {
  recipeSuggestionRequestSchema,
  recipeSuggestionResponseSchema,
} from "@/contracts/api";
import { recipeIntentSchema } from "@/contracts/domain";
import { suggestRecipes } from "@/domain/assessment";
import { createRecipeAssistant } from "@/server/ai";
import type { RecipeAssistant } from "@/server/ai/contracts";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import { listDemoInventory } from "@/server/demo/store";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { asApiError, providerApiFault } from "@/server/repositories/errors";
import { getInventorySync } from "@/server/repositories/inventory";
import { readDemoPreferences } from "@/server/repositories/preferences";
import { enforceRateLimit } from "@/server/repositories/rate-limit";
import { recordProductEvent } from "@/server/repositories/telemetry";
import {
  getHouseholdPreferences,
  listPublishedRecipes,
} from "@/server/repositories/recipes";
import { getPreviewRecipeCatalog } from "@/server/recipes/catalog";
import { mergeRecipeExplanations } from "@/server/services/recipe-explanations";
import {
  AiConfigurationError,
  resolveHouseholdAiRuntimeConfig,
} from "@/server/services/household-ai-settings";

const emptyIntent = {
  query: "",
  maxMinutes: null,
  servings: null,
  mealTypes: [],
  cuisines: [],
  dietaryTags: [],
  includeConceptIds: [],
  excludeConceptIds: [],
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  const id = correlationId(request);
  const startedAt = Date.now();
  try {
    const input = await parseJson(request, recipeSuggestionRequestSchema);
    const production = isDemoMode
      ? null
      : await (async () => {
          const session = await requireHouseholdSession();
          const client = await createServerSupabaseClient();
          await enforceRateLimit(client, "recipe_suggest", 60, 60 * 60);
          return { client, session };
        })();
    let assistant: RecipeAssistant;
    try {
      assistant = production
        ? createRecipeAssistant(
            await resolveHouseholdAiRuntimeConfig(
              production.session.householdId,
            ),
          )
        : createRecipeAssistant();
    } catch (error) {
      if (error instanceof AiConfigurationError) {
        throw new ApiFault(
          "AI_PROVIDER_NOT_CONFIGURED",
          "Ask the household owner to configure an AI provider before using a meal prompt.",
          409,
        );
      }
      throw error;
    }
    let parsed;
    try {
      parsed = input.prompt
        ? await assistant.parseIntent(input.prompt)
        : recipeIntentSchema.parse({ ...emptyIntent, ...input.intent });
    } catch {
      throw providerApiFault(
        "RECIPE_INTENT_FAILED",
        "The meal request could not be interpreted. Try structured filters or simpler wording.",
      );
    }
    let recipes;
    let inventory;
    let preferences;
    if (isDemoMode) {
      recipes = await getPreviewRecipeCatalog();
      inventory = listDemoInventory();
      preferences = readDemoPreferences();
    } else {
      if (!production) throw new Error("Production recipe context is unavailable.");
      const { client, session } = production;
      [recipes, inventory, preferences] = await Promise.all([
        listPublishedRecipes(client),
        getInventorySync(client, null).then((result) => result.lots),
        getHouseholdPreferences(client, session.householdId),
      ]);
    }
    const assessments = suggestRecipes(
      recipes,
      inventory,
      preferences,
      parsed,
    );
    let explanations = new Map<string, string>();
    try {
      explanations = await assistant.explain(parsed, assessments);
    } catch {
      // Explanations are optional presentation. Deterministic eligibility,
      // evidence, and ranking remain valid when the provider is unavailable.
    }
    const explained = mergeRecipeExplanations(assessments, explanations);
    if (production) {
      await recordProductEvent({
        householdId: production.session.householdId,
        userId: production.session.userId,
        eventName: "recipe_suggestions_returned",
        properties: {
          itemCount: explained.length,
          durationMs: Date.now() - startedAt,
        },
      });
    }
    return json(
      recipeSuggestionResponseSchema.parse({
        parsedIntent: parsed,
        assessments: explained,
        generatedAt: new Date().toISOString(),
        allergyNotice:
          "Dietary settings are preferences only. Foodtopia does not verify recipes for allergy safety.",
      }),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "RECIPE_SUGGESTIONS_FAILED",
        message: "Recipe suggestions could not be prepared.",
      }),
      id,
    );
  }
}
