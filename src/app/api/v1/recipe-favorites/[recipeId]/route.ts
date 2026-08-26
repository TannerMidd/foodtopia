import { recipeFavoriteMutationResponseSchema } from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireHouseholdSession } from "@/server/auth/session";
import { removeDemoRecipeFavorite } from "@/server/demo/store";
import { correlationId, errorResponse, json } from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import { removeRecipeFavorite } from "@/server/repositories/favorites";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ recipeId: string }> },
) {
  const id = correlationId(request);
  try {
    const { recipeId } = await params;
    if (!recipeId || recipeId.length > 120) {
      return json(
        recipeFavoriteMutationResponseSchema.parse({
          status: "removed",
          replayed: false,
        }),
      );
    }
    if (isDemoMode) {
      removeDemoRecipeFavorite(recipeId);
      return json(
        recipeFavoriteMutationResponseSchema.parse({
          status: "removed",
          replayed: false,
        }),
      );
    }
    const session = await requireHouseholdSession();
    await removeRecipeFavorite(createAdminSupabaseClient(), {
      householdId: session.householdId,
      recipeId,
    });
    return json(
      recipeFavoriteMutationResponseSchema.parse({
        status: "removed",
        replayed: false,
      }),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "RECIPE_FAVORITE_REMOVE_FAILED",
        message: "The recipe could not be removed from household favorites.",
      }),
      id,
    );
  }
}
