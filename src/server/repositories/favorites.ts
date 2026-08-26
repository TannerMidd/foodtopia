import "server-only";

import { z } from "zod";

import {
  recipeFavoriteItemSchema,
  type RecipeFavoriteMutationResponse,
  type RecipeFavoritesResponse,
} from "@/contracts/api";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ApiFault } from "@/server/http";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

type VisibleRecipe = Readonly<{
  id: string;
  slug: string;
  title: string;
}>;

/**
 * Favorites are household-shared: any member may add or remove. Routes must
 * first resolve the recipe through the caller's RLS-scoped user client, then
 * pass that trusted identity here; this admin DAL never decides visibility.
 */

const favoriteRow = z.object({
  recipe_id: z.string(),
  recipes: z
    .object({
      slug: z.string(),
      title: z.string().min(1),
    })
    .nullable()
    .optional(),
  created_at: z.string(),
});

export async function listRecipeFavorites(
  admin: AdminClient,
  householdId: string,
): Promise<RecipeFavoritesResponse> {
  const { data, error } = await admin
    .from("household_recipe_favorites")
    .select(
      `
      recipe_id,
      created_at,
      recipes (
        slug,
        title
      )
    `,
    )
    .eq("household_id", householdId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const favorites = (data ?? []).flatMap((entry) => {
    const parsed = favoriteRow.safeParse(entry);
    if (!parsed.success) return [];
    return [
      recipeFavoriteItemSchema.parse({
        recipeId: parsed.data.recipe_id,
        slug: parsed.data.recipes?.slug ?? null,
        title: parsed.data.recipes?.title ?? "Saved recipe",
        createdAt: new Date(parsed.data.created_at).toISOString(),
      }),
    ];
  });
  return { favorites };
}

function favoriteItem(recipe: VisibleRecipe, createdAt: string) {
  return recipeFavoriteItemSchema.parse({
    recipeId: recipe.id,
    slug: recipe.slug,
    title: recipe.title,
    createdAt: new Date(createdAt).toISOString(),
  });
}

async function findFavoriteCreatedAt(
  admin: AdminClient,
  householdId: string,
  recipeId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("household_recipe_favorites")
    .select("created_at")
    .eq("household_id", householdId)
    .eq("recipe_id", recipeId)
    .maybeSingle();
  if (error) throw error;
  return data?.created_at ?? null;
}

export async function addRecipeFavorite(
  admin: AdminClient,
  input: {
    householdId: string;
    userId: string;
    recipe: VisibleRecipe;
  },
): Promise<RecipeFavoriteMutationResponse> {
  const existingCreatedAt = await findFavoriteCreatedAt(
    admin,
    input.householdId,
    input.recipe.id,
  );
  if (existingCreatedAt) {
    return {
      status: "added",
      favorite: favoriteItem(input.recipe, existingCreatedAt),
      replayed: true,
    };
  }

  const countResult = await admin
    .from("household_recipe_favorites")
    .select("recipe_id", { count: "exact", head: true })
    .eq("household_id", input.householdId);
  if (countResult.error) throw countResult.error;
  // ponytail: application cap can overshoot only at the 200-row concurrent
  // boundary; move this check into a locked RPC if beta traffic ever reaches it.
  if ((countResult.count ?? 0) >= 200) {
    throw new ApiFault(
      "RECIPE_FAVORITES_FULL",
      "Remove a saved recipe before adding another.",
      409,
    );
  }

  const inserted = await admin
    .from("household_recipe_favorites")
    .insert({
      household_id: input.householdId,
      recipe_id: input.recipe.id,
      created_by: input.userId,
    })
    .select("created_at")
    .single();
  if (inserted.error) {
    // A concurrent member adding the same favorite surfaces as a unique
    // violation from the composite primary key; resolve the winning row.
    if (inserted.error.code === "23505") {
      const createdAt = await findFavoriteCreatedAt(
        admin,
        input.householdId,
        input.recipe.id,
      );
      if (createdAt) {
        return {
          status: "added",
          favorite: favoriteItem(input.recipe, createdAt),
          replayed: true,
        };
      }
    }
    throw inserted.error;
  }
  return {
    status: "added",
    favorite: favoriteItem(input.recipe, inserted.data.created_at),
    replayed: false,
  };
}

export async function removeRecipeFavorite(
  admin: AdminClient,
  input: { householdId: string; recipeId: string },
): Promise<void> {
  const removed = await admin
    .from("household_recipe_favorites")
    .delete()
    .eq("household_id", input.householdId)
    .eq("recipe_id", input.recipeId)
    .select("recipe_id");
  if (removed.error) throw removed.error;
}
