import type { HouseholdPreferences } from "@/contracts/domain";
import { DEFAULT_STAPLE_CONCEPT_IDS } from "@/domain/concepts";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { mapPreferences } from "./mappers";

type UserClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

let demoPreferences: HouseholdPreferences = {
  staples: [...DEFAULT_STAPLE_CONCEPT_IDS],
  dietaryTags: [],
  excludedConceptIds: [],
};

export function readDemoPreferences(): HouseholdPreferences {
  return structuredClone(demoPreferences);
}

export function writeDemoPreferences(value: HouseholdPreferences) {
  demoPreferences = structuredClone(value);
  return readDemoPreferences();
}

export async function readPreferences(
  client: UserClient,
  householdId: string,
) {
  const { data, error } = await client
    .from("household_preferences")
    .select("staples, dietary_tags, excluded_food_concept_ids, version")
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) throw error;
  const preferences = data
    ? mapPreferences(data)
    : {
        staples: [...DEFAULT_STAPLE_CONCEPT_IDS],
        dietaryTags: [],
        excludedConceptIds: [],
      };
  return { ...preferences, version: data?.version ?? 0 };
}

export async function writePreferences(
  client: UserClient,
  session: { householdId: string; userId: string },
  preferences: HouseholdPreferences,
) {
  const { data, error } = await client
    .from("household_preferences")
    .upsert(
      {
        household_id: session.householdId,
        staples: preferences.staples,
        dietary_tags: preferences.dietaryTags,
        excluded_food_concept_ids: preferences.excludedConceptIds,
        updated_by: session.userId,
      },
      { onConflict: "household_id" },
    )
    .select("staples, dietary_tags, excluded_food_concept_ids, version")
    .single();
  if (error) throw error;
  return { ...mapPreferences(data), version: data.version };
}
