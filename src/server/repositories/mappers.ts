import {
  analysisSchema,
  householdPreferencesSchema,
  inventoryLotSchema,
  recipeSchema,
  type Analysis,
  type HouseholdPreferences,
  type InventoryLot,
  type Recipe,
} from "@/contracts/domain";
import { ApiFault } from "@/server/http";

type Row = Record<string, unknown>;

function row(value: unknown, label: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiFault(
      "PERSISTENCE_RESPONSE_INVALID",
      `The ${label} response was malformed.`,
      502,
      true,
    );
  }
  return value as Row;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown): number {
  const parsed = numberOrNull(value);
  return parsed === null ? Number.NaN : Math.trunc(parsed);
}

function stringArray(value: unknown): string[] {
  return array(value).filter((item): item is string => typeof item === "string");
}

export function mapInventoryLot(value: unknown): InventoryLot {
  const item = row(value, "inventory lot");
  return inventoryLotSchema.parse({
    id: item.id,
    householdId: item.householdId ?? item.household_id,
    foodConceptId: item.foodConceptId ?? item.food_concept_id ?? null,
    name: item.name,
    category: item.category ?? "Other",
    quantityStatus: item.quantityStatus ?? item.quantity_status,
    quantity: numberOrNull(item.quantity),
    unit: item.unit ?? null,
    form: item.form,
    location: item.location,
    dateLabelType: item.dateLabelType ?? item.date_label_type ?? null,
    dateLabel: item.dateLabel ?? item.date_label ?? null,
    status: item.status,
    version: integer(item.version),
    createdAt: item.createdAt ?? item.created_at,
    updatedAt: item.updatedAt ?? item.updated_at,
  });
}

export function mapAnalysis(
  analysisValue: unknown,
  candidateValues: unknown[] = [],
): Analysis {
  const analysis = row(analysisValue, "analysis");
  const candidates = candidateValues.map((value) => {
    const candidate = row(value, "analysis candidate");
    return {
      id: candidate.id,
      analysisId: candidate.analysisId ?? candidate.analysis_id,
      rawLabel: candidate.rawLabel ?? candidate.raw_label,
      suggestedConceptId:
        candidate.suggestedConceptId ?? candidate.suggested_food_concept_id ?? null,
      suggestedName: candidate.suggestedName ?? candidate.suggested_name,
      category: candidate.category ?? "Other",
      quantityStatus: candidate.quantityStatus ?? candidate.quantity_status,
      quantity: numberOrNull(candidate.quantity),
      unit: candidate.unit ?? null,
      form: candidate.form,
      location: candidate.location,
      imageIndexes: candidate.imageIndexes ?? candidate.image_indexes,
      uncertaintyReason:
        candidate.uncertaintyReason ?? candidate.uncertainty_reason ?? null,
      accepted:
        candidate.review_status === "proposed" ||
        candidate.accepted === true ||
        candidate.review_status === "accepted",
    };
  });

  return analysisSchema.parse({
    id: analysis.id,
    householdId: analysis.householdId ?? analysis.household_id,
    status: analysis.status,
    candidates,
    errorCode: analysis.errorCode ?? analysis.error_code ?? null,
    createdAt: analysis.createdAt ?? analysis.created_at,
    updatedAt: analysis.updatedAt ?? analysis.updated_at,
  });
}

export function mapRecipe(value: unknown): Recipe {
  const recipe = row(value, "recipe");
  const ingredients = array(
    recipe.ingredients ?? recipe.recipe_ingredients,
  ).map((value) => {
    const ingredient = row(value, "recipe ingredient");
    return {
      id: ingredient.id,
      foodConceptId: ingredient.foodConceptId ?? ingredient.food_concept_id,
      name: ingredient.name,
      amount: numberOrNull(ingredient.amount),
      unit: ingredient.unit ?? null,
      display: ingredient.display,
      required: ingredient.required,
      acceptedForms: ingredient.acceptedForms ?? ingredient.accepted_forms,
      position: integer(ingredient.position),
    };
  });
  ingredients.sort((left, right) => left.position - right.position);

  return recipeSchema.parse({
    id: recipe.id,
    slug: recipe.slug,
    title: recipe.title,
    description: recipe.description,
    servings: integer(recipe.servings),
    totalMinutes: integer(recipe.totalMinutes ?? recipe.total_minutes),
    mealTypes: stringArray(recipe.mealTypes ?? recipe.meal_types),
    cuisines: stringArray(recipe.cuisines),
    dietaryTags: stringArray(recipe.dietaryTags ?? recipe.dietary_tags),
    ingredients: ingredients.map((ingredient) => ({
      id: ingredient.id,
      foodConceptId: ingredient.foodConceptId,
      name: ingredient.name,
      amount: ingredient.amount,
      unit: ingredient.unit,
      display: ingredient.display,
      required: ingredient.required,
      acceptedForms: ingredient.acceptedForms,
    })),
    steps: stringArray(recipe.steps),
    rights: {
      owner: recipe.rightsOwner ?? recipe.rights_owner,
      author: recipe.rightsAuthor ?? recipe.rights_author,
      reviewer: recipe.rightsReviewer ?? recipe.rights_reviewer ?? null,
      reviewedAt: recipe.rightsReviewedAt ?? recipe.rights_reviewed_at ?? null,
      status: recipe.rightsStatus ?? recipe.rights_status,
    },
  });
}

export function mapPreferences(value: unknown): HouseholdPreferences {
  const preferences = row(value, "household preferences");
  return householdPreferencesSchema.parse({
    staples: stringArray(preferences.staples),
    dietaryTags: stringArray(
      preferences.dietaryTags ?? preferences.dietary_tags,
    ),
    excludedConceptIds: stringArray(
      preferences.excludedConceptIds ?? preferences.excluded_food_concept_ids,
    ),
  });
}

export function asObject(value: unknown, label: string): Row {
  return row(value, label);
}
