import {
  recipeAssessmentSchema,
  recipeIntentSchema,
  type HouseholdPreferences,
  type IngredientEvidenceStatus,
  type InventoryLot,
  type Recipe,
  type RecipeAssessment,
  type RecipeIngredient,
  type RecipeIntent,
  type RecipeTier,
} from "../contracts/domain";
import { FOOD_CONCEPT_BY_ID } from "./concepts";
import { normalizeFoodLabel, resolveFoodConcept } from "./normalization";
import { convertQuantity } from "./units";

const QUANTITY_EPSILON = 1e-9;
const USE_SOON_DAYS = 3;

export const DEFAULT_RECIPE_INTENT: RecipeIntent = recipeIntentSchema.parse({
  query: "",
  maxMinutes: null,
  servings: null,
  mealTypes: [],
  cuisines: [],
  dietaryTags: [],
  includeConceptIds: [],
  excludeConceptIds: [],
});

export type AssessmentOptions = Readonly<{
  now?: Date | string;
}>;

export type SuggestRecipeOptions = AssessmentOptions &
  Readonly<{
    includeIncompatible?: boolean;
  }>;

type Evidence = RecipeAssessment["evidence"][number];

function conceptIdForLot(lot: InventoryLot): string | undefined {
  // A name-only/custom lot is deliberately inventory-only. Matching it by its
  // display name would turn an unreviewed suggestion into recipe evidence.
  return lot.foodConceptId ?? undefined;
}

function acceptedForm(
  ingredient: RecipeIngredient,
  lot: InventoryLot,
): boolean {
  return (
    ingredient.acceptedForms.length === 0 ||
    ingredient.acceptedForms.includes("unspecified") ||
    ingredient.acceptedForms.includes(lot.form)
  );
}

function preferenceConceptIds(values: readonly string[]): Set<string> {
  return new Set(
    values.map((value) => {
      if (FOOD_CONCEPT_BY_ID.has(value)) {
        return value;
      }
      return resolveFoodConcept(value)?.id ?? value;
    }),
  );
}

function scaledRequiredAmount(
  ingredient: RecipeIngredient,
  recipe: Recipe,
  intent: RecipeIntent,
): number | null {
  if (ingredient.amount === null) {
    return null;
  }
  const requestedServings = intent.servings ?? recipe.servings;
  return ingredient.amount * (requestedServings / recipe.servings);
}

function formatAmount(amount: number, unit: string): string {
  const rounded = Number(amount.toFixed(2));
  return `${rounded} ${unit}`;
}

function assessIngredient(
  ingredient: RecipeIngredient,
  recipe: Recipe,
  lots: readonly InventoryLot[],
  staples: ReadonlySet<string>,
  intent: RecipeIntent,
): Evidence {
  if (staples.has(ingredient.foodConceptId)) {
    return {
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      status: "assumed_staple",
      lotIds: [],
      detail: "Counted as an editable household staple; its quantity was not verified.",
    };
  }

  const activeLots = lots.filter(
    (lot) => lot.status === "active" && conceptIdForLot(lot) === ingredient.foodConceptId,
  );
  const exactLots = activeLots.filter(
    (lot) => lot.foodConceptId === ingredient.foodConceptId && acceptedForm(ingredient, lot),
  );
  const unresolvedNameLots = activeLots.filter(
    (lot) => lot.foodConceptId === null,
  );
  const formMismatchLots = activeLots.filter(
    (lot) => lot.foodConceptId === ingredient.foodConceptId && !acceptedForm(ingredient, lot),
  );
  const requiredAmount = scaledRequiredAmount(ingredient, recipe, intent);

  if (exactLots.length === 0) {
    const ambiguousLots = [...unresolvedNameLots, ...formMismatchLots];
    if (ambiguousLots.length > 0) {
      const hasUnresolved = unresolvedNameLots.length > 0;
      return {
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        status: "ambiguous",
        lotIds: ambiguousLots.map((lot) => lot.id),
        detail: hasUnresolved
          ? "A name-only inventory item may match, but its food concept has not been confirmed."
          : "The food is present only in a form this recipe does not explicitly accept.",
      };
    }

    return {
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      status: "missing",
      lotIds: [],
      detail: ingredient.required
        ? "No active matching inventory lot was found."
        : "Optional ingredient is not in active inventory.",
    };
  }

  if (requiredAmount === null || ingredient.unit === null) {
    return {
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      status: "present_sufficient",
      lotIds: exactLots.map((lot) => lot.id),
      detail: "A confirmed matching inventory lot is present; the recipe has no numeric requirement.",
    };
  }

  let knownTotal = 0;
  let uncertain = false;

  for (const lot of exactLots) {
    if (
      lot.quantityStatus !== "known" ||
      lot.quantity === null ||
      lot.unit === null
    ) {
      uncertain = true;
      continue;
    }

    const converted = convertQuantity(lot.quantity, lot.unit, ingredient.unit);
    if (converted === null) {
      // Unknown and cross-family conversions must never be treated as zero.
      uncertain = true;
      continue;
    }
    knownTotal += converted;
  }

  if (knownTotal + QUANTITY_EPSILON >= requiredAmount) {
    return {
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      status: "present_sufficient",
      lotIds: exactLots.map((lot) => lot.id),
      detail: `${formatAmount(knownTotal, ingredient.unit)} confirmed for a ${formatAmount(requiredAmount, ingredient.unit)} requirement.`,
    };
  }

  if (uncertain) {
    return {
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      status: "present_quantity_unknown",
      lotIds: exactLots.map((lot) => lot.id),
      detail:
        knownTotal > 0
          ? `${formatAmount(knownTotal, ingredient.unit)} is confirmed, but another matching lot is estimated, unknown, or not safely convertible.`
          : "A confirmed matching item is present, but its usable quantity cannot be proved.",
    };
  }

  return {
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    status: "insufficient",
    lotIds: exactLots.map((lot) => lot.id),
    detail: `${formatAmount(knownTotal, ingredient.unit)} confirmed; ${formatAmount(requiredAmount, ingredient.unit)} required.`,
  };
}

function parseDate(value: Date | string | undefined): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value ?? Date.now());
  if (Number.isNaN(date.valueOf())) {
    throw new Error("Assessment 'now' must be a valid date.");
  }
  return date;
}

function startOfUtcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function isUseSoon(lot: InventoryLot, now: Date): boolean {
  if (!lot.dateLabel || !lot.dateLabelType || lot.dateLabelType === "unknown") {
    return false;
  }

  const today = startOfUtcDay(now);
  const labelDay = startOfUtcDay(new Date(`${lot.dateLabel}T00:00:00.000Z`));
  const days = (labelDay - today) / 86_400_000;
  return days >= 0 && days <= USE_SOON_DAYS;
}

function incompatibleReasons(
  recipe: Recipe,
  preferences: HouseholdPreferences,
  intent: RecipeIntent,
): string[] {
  const excluded = preferenceConceptIds([
    ...preferences.excludedConceptIds,
    ...intent.excludeConceptIds,
  ]);
  const excludedIngredients = recipe.ingredients.filter((ingredient) =>
    excluded.has(ingredient.foodConceptId),
  );
  const requiredDietTags = new Set(
    [...preferences.dietaryTags, ...intent.dietaryTags].map(normalizeFoodLabel),
  );
  const recipeDietTags = new Set(recipe.dietaryTags.map(normalizeFoodLabel));
  const missingDietTags = [...requiredDietTags].filter(
    (tag) => !recipeDietTags.has(tag),
  );
  const reasons: string[] = [];

  if (excludedIngredients.length > 0) {
    reasons.push(
      `Contains excluded ${excludedIngredients.map((item) => item.name).join(", ")}.`,
    );
  }
  if (missingDietTags.length > 0) {
    reasons.push(`Does not carry required dietary tag(s): ${missingDietTags.join(", ")}.`);
  }
  return reasons;
}

function tierForEvidence(
  evidence: readonly Evidence[],
  recipe: Recipe,
  incompatible: boolean,
): RecipeTier {
  if (incompatible) {
    return "incompatible";
  }

  const requiredIngredientIds = new Set(
    recipe.ingredients.filter((ingredient) => ingredient.required).map((ingredient) => ingredient.id),
  );
  const requiredEvidence = evidence.filter((item) =>
    requiredIngredientIds.has(item.ingredientId),
  );
  const missing = requiredEvidence.filter(
    (item) => item.status === "missing" || item.status === "insufficient",
  );

  if (missing.length > 0) {
    return "almost_ready";
  }
  if (
    requiredEvidence.some(
      (item) =>
        item.status === "present_quantity_unknown" || item.status === "ambiguous",
    )
  ) {
    return "likely_ready";
  }
  return "ready";
}

export function assessRecipe(
  recipe: Recipe,
  lots: readonly InventoryLot[],
  preferences: HouseholdPreferences,
  intent: RecipeIntent = DEFAULT_RECIPE_INTENT,
  options: AssessmentOptions = {},
): RecipeAssessment {
  const parsedIntent = recipeIntentSchema.parse(intent);
  const staples = preferenceConceptIds(preferences.staples);
  const evidence = recipe.ingredients.map((ingredient) =>
    assessIngredient(ingredient, recipe, lots, staples, parsedIntent),
  );
  const requiredById = new Map(
    recipe.ingredients.map((ingredient) => [ingredient.id, ingredient.required]),
  );
  const missingCount = evidence.filter(
    (item) =>
      requiredById.get(item.ingredientId) &&
      (item.status === "missing" || item.status === "insufficient"),
  ).length;
  const unknownQuantityCount = evidence.filter(
    (item) =>
      requiredById.get(item.ingredientId) &&
      item.status === "present_quantity_unknown",
  ).length;
  const now = parseDate(options.now);
  const lotsById = new Map(lots.map((lot) => [lot.id, lot]));
  const usesSoonCount = evidence.filter((item) =>
    item.lotIds.some((lotId) => {
      const lot = lotsById.get(lotId);
      return lot ? isUseSoon(lot, now) : false;
    }),
  ).length;
  const reasons = incompatibleReasons(recipe, preferences, parsedIntent);
  const tier = tierForEvidence(evidence, recipe, reasons.length > 0);
  const explanation =
    reasons.length > 0
      ? reasons.join(" ")
      : tier === "ready"
        ? "All required ingredients are confirmed or explicitly assumed as editable staples."
        : tier === "likely_ready"
          ? "All required foods appear to be present, but at least one quantity or identity needs confirmation."
          : `${missingCount} required ingredient${missingCount === 1 ? "" : "s"} missing or insufficient.`;

  return recipeAssessmentSchema.parse({
    recipe,
    tier,
    missingCount,
    unknownQuantityCount,
    usesSoonCount,
    explanation,
    evidence,
  });
}

const TIER_ORDER: Readonly<Record<RecipeTier, number>> = {
  ready: 0,
  likely_ready: 1,
  almost_ready: 2,
  incompatible: 3,
};

const QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "for", "in", "me", "minutes", "minute", "mins",
  "of", "please", "recipe", "recipes", "something", "the", "to", "under",
  "within", "with",
]);

function promptFitScore(recipe: Recipe, intent: RecipeIntent): number {
  const queryTokens = normalizeFoodLabel(intent.query)
    .split(" ")
    .filter((token) => token.length > 2 && !QUERY_STOP_WORDS.has(token) && !/^\d+$/.test(token));
  if (queryTokens.length === 0) return 0;

  const metadataTokens = new Set(
    normalizeFoodLabel([
      recipe.title,
      recipe.description,
      ...recipe.mealTypes,
      ...recipe.cuisines,
      ...recipe.dietaryTags,
      ...recipe.ingredients.flatMap((ingredient) => [
        ingredient.name,
        ingredient.foodConceptId,
      ]),
    ].join(" ")).split(" "),
  );
  let score = queryTokens.reduce(
    (total, token) => total + (metadataTokens.has(token) ? 2 : 0),
    0,
  );

  const concepts = new Set(recipe.ingredients.map((item) => item.foodConceptId));
  if (queryTokens.includes("spicy") && concepts.has("chili-powder")) score += 5;
  if (
    queryTokens.some((token) => token === "quick" || token === "fast") &&
    recipe.totalMinutes <= 30
  ) score += 3;
  if (
    queryTokens.some((token) => token === "comfort" || token === "comforting" || token === "cozy") &&
    /soup|stew|pasta|bake|skillet/.test(normalizeFoodLabel(`${recipe.title} ${recipe.description}`))
  ) score += 3;
  return score;
}

export function compareRecipeAssessments(
  left: RecipeAssessment,
  right: RecipeAssessment,
  intent: RecipeIntent = DEFAULT_RECIPE_INTENT,
): number {
  return (
    TIER_ORDER[left.tier] - TIER_ORDER[right.tier] ||
    left.missingCount - right.missingCount ||
    right.usesSoonCount - left.usesSoonCount ||
    left.unknownQuantityCount - right.unknownQuantityCount ||
    promptFitScore(right.recipe, intent) - promptFitScore(left.recipe, intent) ||
    left.recipe.totalMinutes - right.recipe.totalMinutes ||
    left.recipe.id.localeCompare(right.recipe.id, "en-US")
  );
}

export function rankRecipeAssessments(
  assessments: readonly RecipeAssessment[],
  intent: RecipeIntent = DEFAULT_RECIPE_INTENT,
): RecipeAssessment[] {
  const parsedIntent = recipeIntentSchema.parse(intent);
  return [...assessments].sort((left, right) =>
    compareRecipeAssessments(left, right, parsedIntent),
  );
}

function hasIntersection(left: readonly string[], right: readonly string[]): boolean {
  const normalized = new Set(left.map(normalizeFoodLabel));
  return right.some((value) => normalized.has(normalizeFoodLabel(value)));
}

export function recipeMatchesIntent(
  recipe: Recipe,
  intent: RecipeIntent = DEFAULT_RECIPE_INTENT,
): boolean {
  const parsedIntent = recipeIntentSchema.parse(intent);
  if (parsedIntent.maxMinutes !== null && recipe.totalMinutes > parsedIntent.maxMinutes) {
    return false;
  }
  if (parsedIntent.mealTypes.length > 0 && !hasIntersection(recipe.mealTypes, parsedIntent.mealTypes)) {
    return false;
  }
  if (parsedIntent.cuisines.length > 0 && !hasIntersection(recipe.cuisines, parsedIntent.cuisines)) {
    return false;
  }
  const recipeConceptIds = new Set(recipe.ingredients.map((item) => item.foodConceptId));
  if (!parsedIntent.includeConceptIds.every((id) => recipeConceptIds.has(id))) {
    return false;
  }

  // The raw query is deliberately not a hard gate. Natural-language syntax
  // such as "under 30 minutes" is represented by structured intent fields;
  // treating every remaining word as mandatory would hide feasible recipes.
  // Query-text relevance can be added later as a soft tie-breaker.
  return true;
}

export function suggestRecipes(
  recipes: readonly Recipe[],
  lots: readonly InventoryLot[],
  preferences: HouseholdPreferences,
  intent: RecipeIntent = DEFAULT_RECIPE_INTENT,
  options: SuggestRecipeOptions = {},
): RecipeAssessment[] {
  const assessments = recipes
    .filter((recipe) => recipeMatchesIntent(recipe, intent))
    .map((recipe) => assessRecipe(recipe, lots, preferences, intent, options))
    // The v1 result surface promises no more than two required gaps.
    .filter((assessment) => assessment.missingCount <= 2)
    .filter(
      (assessment) =>
        options.includeIncompatible || assessment.tier !== "incompatible",
    );

  return rankRecipeAssessments(assessments, intent);
}

export function evidenceStatusIsKnownAvailable(
  status: IngredientEvidenceStatus,
): boolean {
  return status === "present_sufficient" || status === "assumed_staple";
}
