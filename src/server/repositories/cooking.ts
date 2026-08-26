import "server-only";

import type { RecipeAssessment } from "@/contracts/domain";
import {
  cookHistoryResponseSchema,
  type CookHistoryResponse,
} from "@/contracts/api";
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

/**
 * Recently finished sessions, straight off the RLS-scoped user client. Only
 * reconciled rows are history; active or cancelled sessions never appear. The
 * snapshot title/slug let the UI render without joining the recipe catalog.
 */
export async function listCompletedCookSessions(
  client: UserClient,
  householdId: string,
): Promise<CookHistoryResponse> {
  const { data, error } = await client
    .from("cook_sessions")
    .select(
      `
      id,
      recipe_id,
      recipe_snapshot,
      servings,
      started_at,
      completed_at
    `,
    )
    .eq("household_id", householdId)
    .eq("status", "reconciled")
    .order("completed_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  return cookHistoryResponseSchema.parse({
    sessions: (data ?? []).map((entry) => {
      const row = entry as {
        id: string;
        recipe_id: string | null;
        recipe_snapshot: unknown;
        servings: number;
        started_at: string;
        completed_at: string | null;
      };
      const snapshot =
        row.recipe_snapshot && typeof row.recipe_snapshot === "object"
          ? (row.recipe_snapshot as { slug?: unknown; title?: unknown })
          : {};
      return {
        id: row.id,
        recipeId: row.recipe_id,
        slug:
          typeof snapshot.slug === "string"
            ? snapshot.slug
            : null,
        title:
          typeof snapshot.title === "string" && snapshot.title.length > 0
            ? snapshot.title
            : "A cooked meal",
        servings: row.servings,
        startedAt: new Date(row.started_at).toISOString(),
        completedAt: new Date(row.completed_at ?? row.started_at).toISOString(),
      };
    }),
  });
}
