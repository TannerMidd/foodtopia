import { recipeDetailResponseSchema } from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import { listDemoApprovedRecipes } from "@/server/demo/store";
import { ApiFault, correlationId, errorResponse, json } from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import { listSuggestibleRecipes } from "@/server/repositories/recipes";
import { getPreviewRecipeCatalog } from "@/server/recipes/catalog";

export const runtime = "nodejs";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const id = correlationId(request);
  try {
    const { slug } = await params;
    if (!SLUG_PATTERN.test(slug)) {
      throw new ApiFault("RECIPE_NOT_AVAILABLE", "That recipe does not exist.", 404);
    }

    let recipe = null;
    if (isDemoMode) {
      const catalog = [
        ...(await getPreviewRecipeCatalog()),
        ...listDemoApprovedRecipes(),
      ];
      recipe = catalog.find((entry) => entry.slug === slug) ?? null;
    } else {
      const session = await requireHouseholdSession();
      const recipes = await listSuggestibleRecipes(
        await createServerSupabaseClient(),
        createAdminSupabaseClient(),
        session.householdId,
      );
      recipe = recipes.find((entry) => entry.slug === slug) ?? null;
    }
    if (!recipe) {
      throw new ApiFault(
        "RECIPE_NOT_AVAILABLE",
        "That recipe is not available in your household.",
        404,
      );
    }
    return json(recipeDetailResponseSchema.parse({ recipe }));
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "RECIPE_DETAIL_FAILED",
        message: "The recipe could not be loaded.",
      }),
      id,
    );
  }
}
