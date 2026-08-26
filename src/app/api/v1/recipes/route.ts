import {
  recipeCatalogResponseSchema,
} from "@/contracts/api";
import type { Recipe } from "@/contracts/domain";
import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import { listDemoApprovedRecipes } from "@/server/demo/store";
import { correlationId, errorResponse, json } from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import { listSuggestibleRecipes } from "@/server/repositories/recipes";
import { getPreviewRecipeCatalog } from "@/server/recipes/catalog";

export const runtime = "nodejs";

/**
 * Browsable catalog of every recipe this household can cook or see: published
 * reviewed/seeded recipes plus its own approved private drafts, in full. The
 * client caches these for offline browsing and computes readiness tiers
 * against its local inventory snapshot.
 */
export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    let recipes: Recipe[];
    if (isDemoMode) {
      recipes = [...(await getPreviewRecipeCatalog()), ...listDemoApprovedRecipes()];
    } else {
      const session = await requireHouseholdSession();
      recipes = await listSuggestibleRecipes(
        await createServerSupabaseClient(),
        createAdminSupabaseClient(),
        session.householdId,
      );
    }
    return json(
      recipeCatalogResponseSchema.parse({
        recipes,
        syncedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "RECIPE_CATALOG_FAILED",
        message: "The recipe catalog could not be loaded.",
      }),
      id,
    );
  }
}
