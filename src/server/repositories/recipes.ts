import type { HouseholdPreferences, Recipe } from "@/contracts/domain";
import { DEFAULT_STAPLE_CONCEPT_IDS } from "@/domain/concepts";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { mapPreferences, mapRecipe } from "./mappers";

type UserClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

const recipeProjection = `
  id,
  slug,
  title,
  description,
  servings,
  total_minutes,
  meal_types,
  cuisines,
  dietary_tags,
  steps,
  rights_owner,
  rights_author,
  rights_reviewer,
  rights_reviewed_at,
  rights_status,
  recipe_ingredients (
    id,
    position,
    food_concept_id,
    name,
    amount,
    unit,
    display,
    required,
    accepted_forms
  )
`;

export async function listPublishedRecipes(
  client: UserClient,
): Promise<Recipe[]> {
  const { data, error } = await client
    .from("recipes")
    .select(recipeProjection)
    .eq("visibility", "published")
    .eq("rights_status", "reviewed")
    .is("household_id", null)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRecipe);
}

export async function getPublishedRecipe(
  client: UserClient,
  recipeId: string,
): Promise<Recipe | null> {
  const { data, error } = await client
    .from("recipes")
    .select(recipeProjection)
    .eq("id", recipeId)
    .eq("visibility", "published")
    .eq("rights_status", "reviewed")
    .is("household_id", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRecipe(data) : null;
}

export async function getHouseholdPreferences(
  client: UserClient,
  householdId: string,
): Promise<HouseholdPreferences> {
  const { data, error } = await client
    .from("household_preferences")
    .select("staples, dietary_tags, excluded_food_concept_ids")
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? mapPreferences(data)
    : {
        staples: [...DEFAULT_STAPLE_CONCEPT_IDS],
        dietaryTags: [],
        excludedConceptIds: [],
      };
}
