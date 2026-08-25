import "server-only";

import type { RecipeAssessment } from "@/contracts/domain";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { asObject } from "./mappers";

type UserClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export async function createProductionCookSession(
  session: { householdId: string; userId: string },
  assessment: RecipeAssessment,
) {
  const recipe = assessment.recipe;
  // Session/tenant authorization and assessment recomputation happen in the
  // route before this trusted write. Authenticated clients have no table INSERT
  // grant and cannot forge recipe_snapshot directly.
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("cook_sessions")
    .insert({
      household_id: session.householdId,
      recipe_id: recipe.id,
      recipe_snapshot: recipe,
      servings: recipe.servings,
      status: "active",
      started_by: session.userId,
    })
    .select("id, recipe_id, started_at")
    .single();
  if (error) throw error;
  return {
    cookSessionId: data.id,
    recipeId: data.recipe_id,
    createdAt: data.started_at,
    assessment,
  };
}

export async function reconcileProductionCookSession(
  client: UserClient,
  cookSessionId: string,
  changes: {
    ingredientId: string;
    lotId: string;
    action: "no_change" | "used_some" | "used_up";
    quantity: number | null;
    unit: string | null;
    expectedVersion: number;
  }[],
) {
  const { data, error } = await client.rpc("apply_cook_reconciliation", {
    p_cook_session_id: cookSessionId,
    p_changes: changes,
  });
  if (error) throw error;
  return asObject(data, "cook reconciliation");
}
