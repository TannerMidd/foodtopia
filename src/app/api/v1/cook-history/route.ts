import { cookHistoryResponseSchema } from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  listDemoApprovedRecipes,
  listDemoCompletedCookSessions,
} from "@/server/demo/store";
import { correlationId, errorResponse, json } from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import { listCompletedCookSessions } from "@/server/repositories/cooking";
import { getPreviewRecipeCatalog } from "@/server/recipes/catalog";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    if (isDemoMode) {
      // Demo history titles resolve against the preview catalog plus any
      // approved AI drafts, mirroring the production snapshot join.
      const recipesById = new Map(
        [
          ...(await getPreviewRecipeCatalog()),
          ...listDemoApprovedRecipes(),
        ].map((recipe) => [recipe.id, recipe]),
      );
      return json(
        cookHistoryResponseSchema.parse({
          sessions: listDemoCompletedCookSessions().flatMap((session) => {
            const recipe = recipesById.get(session.recipeId);
            if (!recipe) return [];
            return [
              {
                id: session.id,
                recipeId: session.recipeId,
                slug: recipe.slug,
                title: recipe.title,
                servings: recipe.servings,
                startedAt: session.startedAt,
                completedAt: session.completedAt,
              },
            ];
          }),
        }),
      );
    }
    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    return json(await listCompletedCookSessions(client, session.householdId));
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "COOK_HISTORY_FAILED",
        message: "The cooking history could not be loaded.",
      }),
      id,
    );
  }
}
