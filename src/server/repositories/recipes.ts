import { recipeProposalSchema, type RecipeFlagReason, type RecipeProposal } from "@/contracts/api";
import { recipeSchema, type HouseholdPreferences, type Recipe } from "@/contracts/domain";
import { DEFAULT_STAPLE_CONCEPT_IDS } from "@/domain/concepts";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

import { mapPreferences, mapRecipe } from "./mappers";

type UserClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;
type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

const recipeProjection = `
  id,
  household_id,
  visibility,
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
    .in("rights_status", ["reviewed", "seeded"])
    .is("household_id", null)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRecipe);
}

export async function listSuggestibleRecipes(
  client: UserClient,
  admin: AdminClient,
  householdId: string,
): Promise<Recipe[]> {
  const publicRecipes = await listPublishedRecipes(client);
  const { data: proposalRows, error: proposalError } = await admin
    .from("recipe_proposals")
    .select("recipe_id")
    .eq("household_id", householdId)
    .eq("status", "approved")
    .not("recipe_id", "is", null);
  if (proposalError) throw proposalError;
  const recipeIds = (proposalRows ?? []).flatMap((row) =>
    row.recipe_id ? [row.recipe_id] : [],
  );
  if (recipeIds.length === 0) return publicRecipes;

  const { data, error } = await client
    .from("recipes")
    .select(recipeProjection)
    .in("id", recipeIds)
    .eq("visibility", "household")
    .eq("household_id", householdId)
    .order("id", { ascending: true });
  if (error) throw error;
  const privateRecipes = (data ?? []).map(mapRecipe);
  return [...publicRecipes, ...privateRecipes];
}

function mapRecipeProposal(value: {
  id: string;
  status: "proposed" | "approved" | "denied" | "expired";
  recipe_payload: unknown;
  provider: string | null;
  model: string | null;
  created_at: string;
  version: number;
}): RecipeProposal {
  if (value.status !== "proposed" || !value.recipe_payload) {
    throw new Error("Recipe proposal is not pending review.");
  }
  return recipeProposalSchema.parse({
    id: value.id,
    status: "proposed",
    recipe: recipeSchema.parse(value.recipe_payload),
    provider: value.provider,
    model: value.model,
    createdAt: new Date(value.created_at).toISOString(),
    version: value.version,
  });
}

export type RecipeProposalPreflight =
  | { kind: "none" }
  | { kind: "pending"; proposal: RecipeProposal }
  | { kind: "terminal"; status: "approved" | "denied" | "expired" };

export async function preflightRecipeProposal(
  admin: AdminClient,
  input: {
    householdId: string;
    userId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  },
): Promise<RecipeProposalPreflight> {
  const now = new Date().toISOString();
  const { error: expiryError } = await admin
    .from("recipe_proposals")
    .update({ status: "expired", recipe_payload: null, content_hash: null, decided_at: now })
    .eq("household_id", input.householdId)
    .eq("created_by", input.userId)
    .eq("status", "proposed")
    .lte("expires_at", now);
  if (expiryError) throw expiryError;

  const { data, error } = await admin
    .from("recipe_proposals")
    .select("id,status,recipe_payload,provider,model,created_at,version,request_fingerprint")
    .eq("household_id", input.householdId)
    .eq("created_by", input.userId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { kind: "none" };
  if (data.request_fingerprint !== input.requestFingerprint) {
    throw Object.assign(new Error("Generation request ID was already used for different recipe inputs."), {
      code: "23514",
      status: 409,
    });
  }
  if (data.status === "proposed" && data.recipe_payload) {
    return { kind: "pending", proposal: mapRecipeProposal(data) };
  }
  return {
    kind: "terminal",
    status: data.status === "approved" ? "approved" : data.status === "denied" ? "denied" : "expired",
  };
}

export async function createRecipeProposal(
  admin: AdminClient,
  input: {
    proposalId: string;
    householdId: string;
    userId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    contentHash: string;
    recipe: Recipe;
    provider: "openai" | "openrouter" | "demo";
    model: string | null;
  },
): Promise<RecipeProposal> {
  const row = {
    id: input.proposalId,
    household_id: input.householdId,
    status: "proposed" as const,
    recipe_payload: JSON.parse(JSON.stringify(input.recipe)) as Json,
    content_hash: input.contentHash,
    idempotency_key: input.idempotencyKey,
    request_fingerprint: input.requestFingerprint,
    provider: input.provider,
    model: input.model,
    created_by: input.userId,
  };
  const { data, error } = await admin
    .from("recipe_proposals")
    .insert(row)
    .select("id,status,recipe_payload,provider,model,created_at,version,request_fingerprint")
    .single();
  if (!error && data) return mapRecipeProposal(data);
  if (error?.code !== "23505") throw error;

  const { data: existing, error: existingError } = await admin
    .from("recipe_proposals")
    .select("id,status,recipe_payload,provider,model,created_at,version,request_fingerprint")
    .eq("household_id", input.householdId)
    .eq("created_by", input.userId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw error;
  if (existing.request_fingerprint !== input.requestFingerprint) {
    throw Object.assign(new Error("Generation request ID was already used for different recipe inputs."), {
      code: "23514",
      status: 409,
    });
  }
  return mapRecipeProposal(existing);
}

export async function getRecipeProposal(
  admin: AdminClient,
  proposalId: string,
  householdId: string,
): Promise<RecipeProposal | null> {
  const { data, error } = await admin
    .from("recipe_proposals")
    .select("id,status,recipe_payload,provider,model,created_at,version")
    .eq("id", proposalId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "proposed" || !data.recipe_payload) return null;
  return mapRecipeProposal(data);
}

export async function decideRecipeProposal(
  client: UserClient,
  input: {
    proposalId: string;
    decision: "approve" | "deny";
    expectedVersion: number;
  },
): Promise<{
  proposalId: string;
  status: "approved" | "denied" | "expired";
  recipeId: string | null;
  version: number;
  replayed: boolean;
}> {
  const { data, error } = await client.rpc("decide_recipe_proposal", {
    p_proposal_id: input.proposalId,
    p_decision: input.decision,
    p_expected_version: input.expectedVersion,
  });
  if (error) throw error;
  const row = data as Record<string, unknown>;
  return {
    proposalId: String(row.proposalId),
    status:
      row.status === "approved" ? "approved" : row.status === "expired" ? "expired" : "denied",
    recipeId: typeof row.recipeId === "string" ? row.recipeId : null,
    version: Number(row.version),
    replayed: row.replayed === true,
  };
}

export async function getAvailableRecipe(
  client: UserClient,
  recipeId: string,
  householdId: string,
): Promise<Recipe | null> {
  // RLS first limits this lookup to public catalog rows or the caller's own
  // household. Explicit scope/status checks keep malformed rows unavailable.
  const { data, error } = await client
    .from("recipes")
    .select(recipeProjection)
    .eq("id", recipeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const publicRecipe =
    data.visibility === "published" &&
    data.household_id === null &&
    (data.rights_status === "reviewed" || data.rights_status === "seeded");
  const householdRecipe =
    data.visibility === "household" &&
    data.household_id === householdId &&
    (data.rights_status === "draft" ||
      data.rights_status === "reviewed" ||
      data.rights_status === "seeded");
  return publicRecipe || householdRecipe ? mapRecipe(data) : null;
}

export async function flagVisibleRecipe(
  client: UserClient,
  input: {
    householdId: string;
    userId: string;
    recipeId: string;
    reason: RecipeFlagReason;
  },
): Promise<void> {
  // Recipe RLS is the availability boundary: it exposes public reviewed/seeded
  // rows and private recipes only to their own household.
  const { data: visibleRecipe, error: lookupError } = await client
    .from("recipes")
    .select("id")
    .eq("id", input.recipeId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!visibleRecipe) {
    throw Object.assign(new Error("Recipe is unavailable."), {
      code: "P0002",
      status: 404,
    });
  }

  const { error } = await client.from("recipe_flags").upsert(
    {
      household_id: input.householdId,
      recipe_id: input.recipeId,
      reason: input.reason,
      flagged_by: input.userId,
    },
    {
      onConflict: "household_id,recipe_id,flagged_by",
      ignoreDuplicates: true,
    },
  );
  if (error) throw error;
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
