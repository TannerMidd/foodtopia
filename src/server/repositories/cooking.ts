import type { Recipe } from "@/contracts/domain";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { asObject } from "./mappers";

type UserClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export async function createProductionCookSession(
  client: UserClient,
  session: { householdId: string; userId: string },
  recipe: Recipe,
) {
  const { data, error } = await client
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
