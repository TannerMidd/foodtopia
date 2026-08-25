import {
  recipeSuggestionRequestSchema,
  recipeSuggestionResponseSchema,
  type RecipeProposal,
} from "@/contracts/api";
import { recipeIntentSchema, type RecipeIntent } from "@/contracts/domain";
import { suggestRecipes } from "@/domain/assessment";
import { createRecipeAssistant } from "@/server/ai";
import type { RecipeAssistant } from "@/server/ai/contracts";
import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  listDemoApprovedRecipes,
  listDemoInventory,
  preflightDemoRecipeProposal,
  saveDemoRecipeProposal,
} from "@/server/demo/store";
import { ApiFault, correlationId, errorResponse, json, parseJson } from "@/server/http";
import { asApiError, providerApiFault } from "@/server/repositories/errors";
import { getInventorySync } from "@/server/repositories/inventory";
import { readDemoPreferences } from "@/server/repositories/preferences";
import { enforceRateLimit } from "@/server/repositories/rate-limit";
import { recordProductEvent } from "@/server/repositories/telemetry";
import {
  createRecipeProposal,
  getHouseholdPreferences,
  listSuggestibleRecipes,
  preflightRecipeProposal,
} from "@/server/repositories/recipes";
import { getPreviewRecipeCatalog } from "@/server/recipes/catalog";
import {
  buildRecipeGenerationContext,
  recipeGenerationRequestFingerprint,
  validateAndMaterializeGeneratedRecipe,
} from "@/server/services/generated-recipes";
import { mergeRecipeExplanations } from "@/server/services/recipe-explanations";
import { purgeExpiredRecipeProposals } from "@/server/services/recipe-proposal-retention";
import {
  AiConfigurationError,
  resolveHouseholdAiRuntimeConfig,
  type HouseholdAiRuntimeConfig,
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
const MAX_SUGGESTIONS = 24;
const GENERATION_LIMIT_PER_HOUR = 6;

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
          return { client, session, admin: createAdminSupabaseClient() };
        })();

    if (production) {
      try {
        await purgeExpiredRecipeProposals(production.admin);
      } catch {
        // The hourly retention job remains authoritative; cleanup must not
        // prevent a household from browsing the deterministic catalog.
      }
    }

    let runtimeConfig: HouseholdAiRuntimeConfig | null = null;
    let assistant: RecipeAssistant | null = null;
    async function loadAssistant(): Promise<{
      client: RecipeAssistant;
      config: HouseholdAiRuntimeConfig | null;
    }> {
      if (!assistant) {
        runtimeConfig = production
          ? await resolveHouseholdAiRuntimeConfig(production.session.householdId)
          : null;
        assistant = createRecipeAssistant(runtimeConfig ?? undefined);
      }
      return { client: assistant, config: runtimeConfig };
    }

    let parsed: RecipeIntent;
    if (input.prompt !== undefined) {
      try {
        parsed = await (await loadAssistant()).client.parseIntent(input.prompt);
      } catch (error) {
        if (error instanceof AiConfigurationError) {
          throw new ApiFault(
            "AI_PROVIDER_NOT_CONFIGURED",
            "Ask the household owner to configure an AI provider before using a meal prompt.",
            409,
          );
        }
        throw providerApiFault(
          "RECIPE_INTENT_FAILED",
          "The meal request could not be interpreted. Try structured filters or simpler wording.",
        );
      }
    } else {
      parsed = recipeIntentSchema.parse({ ...emptyIntent, ...input.intent });
    }

    let recipes;
    let inventory;
    let preferences;
    if (isDemoMode) {
      recipes = [...(await getPreviewRecipeCatalog()), ...listDemoApprovedRecipes()];
      inventory = listDemoInventory();
      preferences = readDemoPreferences();
    } else {
      if (!production) throw new Error("Production recipe context is unavailable.");
      const { client, session, admin } = production;
      [recipes, inventory, preferences] = await Promise.all([
        listSuggestibleRecipes(client, admin, session.householdId),
        getInventorySync(client, null).then((result) => result.lots),
        getHouseholdPreferences(client, session.householdId),
      ]);
    }

    const assessments = suggestRecipes(recipes, inventory, preferences, parsed).slice(
      0,
      MAX_SUGGESTIONS,
    );
    let explanations = new Map<string, string>();
    if (assessments.length > 0) {
      try {
        explanations = await (await loadAssistant()).client.explain(parsed, assessments);
      } catch {
        // Explanations are optional; structured searches work without AI configuration.
      }
    }
    const explained = mergeRecipeExplanations(assessments, explanations);

    let proposal: RecipeProposal | null = null;
    let fallbackNotice: string | null = null;
    if (explained.length === 0) {
      const generationContext = buildRecipeGenerationContext(inventory, preferences, parsed);
      const requestFingerprint = recipeGenerationRequestFingerprint(generationContext);
      const idempotencyKey = input.generationRequestId ?? crypto.randomUUID();
      let shouldGenerate = true;

      if (input.generationRequestId) {
        try {
          const replay = production
            ? await preflightRecipeProposal(production.admin, {
                householdId: production.session.householdId,
                userId: production.session.userId,
                idempotencyKey,
                requestFingerprint,
              })
            : preflightDemoRecipeProposal({
                idempotencyKey,
                requestFingerprint,
              });
          if (replay.kind === "pending") {
            proposal = replay.proposal;
            fallbackNotice = "Returning the existing AI draft for this recipe request.";
            shouldGenerate = false;
          } else if (replay.kind === "terminal") {
            fallbackNotice =
              replay.status === "approved"
                ? "This AI draft was already approved and is now in your household recipes."
                : replay.status === "denied"
                  ? "This AI draft was already denied and its content was discarded."
                  : "This AI draft expired and its content was discarded.";
            shouldGenerate = false;
          }
        } catch (error) {
          if (error && typeof error === "object" && "status" in error && error.status === 409) {
            throw new ApiFault(
              "RECIPE_GENERATION_REQUEST_CONFLICT",
              error instanceof Error ? error.message : "Generation request ID conflict.",
              409,
            );
          }
          throw error;
        }
      }

      if (shouldGenerate) {
        try {
          const loaded = await loadAssistant();
          const generator = loaded.client;
          if (production) {
            await enforceRateLimit(
              production.client,
              "recipe_generate",
              GENERATION_LIMIT_PER_HOUR,
              60 * 60,
            );
          }
          const draft = await generator.generate(generationContext);
          const proposalId = crypto.randomUUID();
          const { recipe, contentHash } = validateAndMaterializeGeneratedRecipe(
            draft,
            generationContext,
            proposalId,
          );
          const provider: "openai" | "openrouter" | "demo" =
            loaded.config?.provider ?? "demo";
          const model = loaded.config?.recipeModelId ?? null;
          const candidate = {
            id: proposalId,
            status: "proposed" as const,
            recipe,
            provider,
            model,
            createdAt: new Date().toISOString(),
            version: 0,
          };
          proposal = production
            ? await createRecipeProposal(production.admin, {
                proposalId,
                householdId: production.session.householdId,
                userId: production.session.userId,
                idempotencyKey,
                requestFingerprint,
                contentHash,
                recipe,
                provider,
                model,
              })
            : saveDemoRecipeProposal(candidate, {
                idempotencyKey,
                requestFingerprint,
              });
          fallbackNotice =
            "No catalog recipe fit closely enough, so Foodtopia prepared one AI draft for your review.";
        } catch (error) {
          fallbackNotice =
            error instanceof AiConfigurationError
              ? "No catalog recipe fit. Configure a household AI provider to prepare a private draft."
              : error instanceof ApiFault && error.status === 429
                ? "AI recipe generation has reached its hourly limit. Try again later."
                : "No catalog recipe fit, and an AI draft could not be prepared safely this time.";
        }
      }
    }

    if (production) {
      await recordProductEvent({
        householdId: production.session.householdId,
        userId: production.session.userId,
        eventName: "recipe_suggestions_returned",
        properties: { itemCount: explained.length, durationMs: Date.now() - startedAt },
      });
    }
    return json(
      recipeSuggestionResponseSchema.parse({
        parsedIntent: parsed,
        assessments: explained,
        proposal,
        fallbackNotice,
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
