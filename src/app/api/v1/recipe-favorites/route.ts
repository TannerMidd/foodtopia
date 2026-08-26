import {
  recipeFavoriteMutationRequestSchema,
  recipeFavoritesResponseSchema,
  recipeFavoriteMutationResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  addDemoRecipeFavorite,
  listDemoApprovedRecipes,
  listDemoRecipeFavorites,
} from "@/server/demo/store";
import { ApiFault, correlationId, errorResponse, json, parseJson } from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import {
  addRecipeFavorite,
  listRecipeFavorites,
} from "@/server/repositories/favorites";
import { getAvailableRecipe } from "@/server/repositories/recipes";
import { getPreviewRecipeCatalog } from "@/server/recipes/catalog";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    if (isDemoMode) {
      return json(
        recipeFavoritesResponseSchema.parse({
          favorites: listDemoRecipeFavorites(await getPreviewRecipeCatalog()),
        }),
      );
    }
    const session = await requireHouseholdSession();
    return json(
      await listRecipeFavorites(createAdminSupabaseClient(), session.householdId),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "RECIPE_FAVORITES_FAILED",
        message: "Saved recipes could not be loaded.",
      }),
      id,
    );
  }
}

export async function POST(request: Request) {
  const id = correlationId(request);
  try {
    const input = await parseJson(request, recipeFavoriteMutationRequestSchema);
    if (isDemoMode) {
      const recipesById = new Map(
        [
          ...(await getPreviewRecipeCatalog()),
          ...listDemoApprovedRecipes(),
        ].map((recipe) => [recipe.id, recipe]),
      );
      const recipe = recipesById.get(input.recipeId);
      if (!recipe) {
        throw new ApiFault(
          "RECIPE_NOT_AVAILABLE",
          "That recipe is not available in your household.",
          404,
        );
      }
      const result = addDemoRecipeFavorite(input.recipeId);
      return json(
        recipeFavoriteMutationResponseSchema.parse({
          status: "added",
          favorite: {
            recipeId: input.recipeId,
            slug: recipe.slug,
            title: recipe.title,
            createdAt: new Date().toISOString(),
          },
          replayed: result.replayed,
        }),
      );
    }
    const session = await requireHouseholdSession();
    // Visibility is decided by the caller's RLS-scoped client before the
    // server-only favorites DAL writes anything. Admin access must never turn
    // a guessed private recipe id into a cross-household title/slug leak.
    const recipe = await getAvailableRecipe(
      await createServerSupabaseClient(),
      input.recipeId,
      session.householdId,
    );
    if (!recipe) {
      throw new ApiFault(
        "RECIPE_NOT_AVAILABLE",
        "That recipe is not available in your household.",
        404,
      );
    }
    return json(
      await addRecipeFavorite(createAdminSupabaseClient(), {
        householdId: session.householdId,
        userId: session.userId,
        recipe: { id: recipe.id, slug: recipe.slug, title: recipe.title },
      }),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "RECIPE_FAVORITE_ADD_FAILED",
        message: "The recipe could not be saved to household favorites.",
      }),
      id,
    );
  }
}
