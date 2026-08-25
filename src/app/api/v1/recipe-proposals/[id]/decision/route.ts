import {
  recipeProposalDecisionRequestSchema,
  recipeProposalDecisionResponseSchema,
} from "@/contracts/api";
import { DEFAULT_RECIPE_INTENT, assessRecipe } from "@/domain/assessment";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  decideDemoRecipeProposal,
  listDemoInventory,
} from "@/server/demo/store";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { getInventorySync } from "@/server/repositories/inventory";
import { readDemoPreferences } from "@/server/repositories/preferences";
import {
  decideRecipeProposal,
  getAvailableRecipe,
  getHouseholdPreferences,
} from "@/server/repositories/recipes";
import { asApiError } from "@/server/repositories/errors";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function POST(request: Request, { params }: Context) {
  const correlation = correlationId(request);
  try {
    const input = await parseJson(request, recipeProposalDecisionRequestSchema);
    const { id } = await params;

    if (isDemoMode) {
      const decided = decideDemoRecipeProposal(
        id,
        input.decision,
        input.expectedVersion,
      );
      if (decided.status !== "approved") {
        return json(
          recipeProposalDecisionResponseSchema.parse({
            proposalId: decided.proposalId,
            status: decided.status,
            recipeId: decided.recipeId,
            version: decided.version,
            replayed: decided.replayed,
          }),
        );
      }
      if (!decided.recipe) throw new Error("Approved demo recipe is unavailable.");
      const assessment = assessRecipe(
        decided.recipe,
        listDemoInventory(),
        readDemoPreferences(),
        DEFAULT_RECIPE_INTENT,
      );
      return json(
        recipeProposalDecisionResponseSchema.parse({ ...decided, assessment }),
      );
    }

    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    const decided = await decideRecipeProposal(client, {
      proposalId: id,
      decision: input.decision,
      expectedVersion: input.expectedVersion,
    });
    if (decided.status !== "approved") {
      return json(recipeProposalDecisionResponseSchema.parse(decided));
    }
    if (!decided.recipeId) {
      throw new ApiFault(
        "RECIPE_PROPOSAL_INVALID",
        "The approved recipe could not be loaded.",
        500,
      );
    }
    const [recipe, inventory, preferences] = await Promise.all([
      getAvailableRecipe(client, decided.recipeId, session.householdId),
      getInventorySync(client, null).then((result) => result.lots),
      getHouseholdPreferences(client, session.householdId),
    ]);
    if (!recipe) {
      throw new ApiFault(
        "RECIPE_PROPOSAL_INVALID",
        "The approved recipe could not be loaded.",
        500,
      );
    }
    const assessment = assessRecipe(
      recipe,
      inventory,
      preferences,
      DEFAULT_RECIPE_INTENT,
    );
    return json(
      recipeProposalDecisionResponseSchema.parse({ ...decided, assessment }),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "RECIPE_PROPOSAL_DECISION_FAILED",
        message: "The recipe proposal decision could not be saved.",
      }),
      correlation,
    );
  }
}
