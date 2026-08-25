import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type {
  FoodForm,
  HouseholdPreferences,
  InventoryLot,
  Recipe,
  RecipeIntent,
} from "@/contracts/domain";
import { FOOD_CONCEPT_BY_ID, FOOD_CONCEPTS } from "@/domain/concepts";
import { normalizeFoodLabel, resolveFoodConcept } from "@/domain/normalization";
import { convertQuantity, getUnitDefinition } from "@/domain/units";
import {
  generatedRecipeDraftSchema,
  type GeneratedRecipeDraft,
  type RecipeGenerationContext,
} from "@/server/ai/contracts";

const ANIMAL_PROTEIN_CONCEPT_IDS = new Set([
  "chicken-breast",
  "chicken-thigh",
  "ground-beef",
  "beef-steak",
  "pork-chop",
  "pork-tenderloin",
  "bacon",
  "sausage",
  "salmon",
  "tuna",
  "shrimp",
  "eggs",
]);
const MEAT_AND_FISH_CONCEPT_IDS = new Set([
  ...ANIMAL_PROTEIN_CONCEPT_IDS,
  "chicken-broth",
  "beef-broth",
]);
MEAT_AND_FISH_CONCEPT_IDS.delete("eggs");
const DAIRY_CONCEPT_IDS = new Set([
  "butter",
  "milk",
  "cheddar",
  "mozzarella",
  "parmesan",
  "yogurt",
  "cream-cheese",
  "sour-cream",
  "heavy-cream",
  "pesto",
]);
// Generic noodles may represent egg noodles, so generated recipes cannot
// positively certify them as vegan without a composition-specific concept.
const OTHER_NON_VEGAN_CONCEPT_IDS = new Set([
  "eggs",
  "honey",
  "mayonnaise",
  "noodles",
]);
const GLUTEN_CONCEPT_IDS = new Set([
  "pasta",
  "noodles",
  "bread",
  "tortillas",
  "flour",
  "couscous",
  "barley",
  "soy-sauce",
]);
const SUPPORTED_DIETARY_TAGS = new Set([
  "vegan",
  "vegetarian",
  "dairy-free",
  "gluten-free",
]);
const PRECOOKED_FORMS = new Set<FoodForm>(["canned", "cooked"]);
const unsafeInstructionPattern =
  /\b(?:bleach|cleaner|cleaning fluid|soap|detergent|rubbing alcohol|isopropyl|methanol)\b|\b(?:heat|boil|bake|microwave|cook)[^.]{0,50}\bsealed (?:container|jar)\b|\b(?:leave|hold|keep)[^.]{0,50}\broom temperature\b|\b(?:serve|eat|leave)[^.]{0,30}\b(?:raw|rare|uncooked)\b|\b(?:water[- ]bath can|pressure can|home can|ferment|preserve at room temperature)\b/i;
const cookingVerbPattern =
  /\b(?:cook|bake|roast|grill|sear|simmer|boil|fry|saute|sauté|scramble|poach)\b/i;
const donenessPattern =
  /\b(?:until fully done|until done|until opaque|until no longer pink|until set|to a safe internal temperature|fully cooked)\b/i;
const negatedCookingPattern =
  /\b(?:do not|don't|never|without)\b[^,;:.]{0,40}\b(?:cook|bake|roast|grill|sear|simmer|boil|fry|saute|sauté|scramble|poach)\b/i;

export type ValidatedGeneratedRecipe = Readonly<{
  recipe: Recipe;
  contentHash: string;
}>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function slugify(value: string): string {
  const normalized = normalizeFoodLabel(value).replace(/\s+/g, "-");
  return normalized.slice(0, 72).replace(/-+$/g, "") || "household-recipe";
}

function uniqueIngredientId(conceptId: string, position: number): string {
  return `${conceptId}-${position + 1}`.slice(0, 120);
}

function normalizedIntersection(left: readonly string[], right: readonly string[]): boolean {
  const values = new Set(left.map(normalizeFoodLabel));
  return right.some((value) => values.has(normalizeFoodLabel(value)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function animalInstructionIsSafe(instruction: string, animalName: string): boolean {
  // A comma, semicolon, sentence boundary, or “then” starts a new cooking
  // clause. This prevents “cook rice until done, then add chicken” from being
  // treated as a chicken doneness instruction.
  return instruction
    .split(/[,;:.]|\b(?:and\s+)?then\b/i)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .some((clause) => {
      const canonicalName = escapeRegExp(animalName);
      const positiveCooking = new RegExp(
        `\\b(?:cook|bake|roast|grill|sear|simmer|boil|fry|saute|sauté|scramble|poach)\\b[^,;:.]{0,80}\\b${canonicalName}\\b[^,;:.]{0,100}\\b(?:until fully done|until done|until opaque|until no longer pink|until set|to a safe internal temperature|fully cooked)\\b`,
        "i",
      );
      return (
        positiveCooking.test(clause) &&
        cookingVerbPattern.test(clause) &&
        donenessPattern.test(clause) &&
        !negatedCookingPattern.test(clause)
      );
    });
}

function canonicalDisplay(name: string, amount: number | null, unit: string | null): string {
  return amount === null || unit === null ? `${name}, as needed` : `${Number(amount.toFixed(3))} ${unit} ${name}`;
}

function derivedDietaryTags(conceptIds: ReadonlySet<string>): string[] {
  const vegetarian = ![...conceptIds].some((id) => MEAT_AND_FISH_CONCEPT_IDS.has(id));
  const dairyFree = ![...conceptIds].some((id) => DAIRY_CONCEPT_IDS.has(id));
  const vegan =
    vegetarian &&
    dairyFree &&
    ![...conceptIds].some((id) => OTHER_NON_VEGAN_CONCEPT_IDS.has(id));
  const glutenFree = ![...conceptIds].some((id) => GLUTEN_CONCEPT_IDS.has(id));
  return [
    ...(vegan ? ["vegan"] : []),
    ...(vegetarian ? ["vegetarian"] : []),
    ...(dairyFree ? ["dairy-free"] : []),
    ...(glutenFree ? ["gluten-free"] : []),
  ];
}

export function buildRecipeGenerationContext(
  lots: readonly InventoryLot[],
  preferences: HouseholdPreferences,
  intent: RecipeIntent,
): RecipeGenerationContext {
  const foodsByConcept = new Map<
    string,
    {
      foodConceptId: string;
      name: string;
      forms: Set<FoodForm>;
      quantities: { quantity: number; unit: string; form: FoodForm }[];
      unknownQuantityForms: Set<FoodForm>;
    }
  >();

  for (const lot of lots) {
    if (lot.status !== "active" || !lot.foodConceptId) continue;
    const concept = FOOD_CONCEPT_BY_ID.get(lot.foodConceptId);
    if (!concept) continue;
    const food = foodsByConcept.get(concept.id) ?? {
      foodConceptId: concept.id,
      name: concept.name,
      forms: new Set<FoodForm>(),
      quantities: [],
      unknownQuantityForms: new Set<FoodForm>(),
    };
    food.forms.add(lot.form);
    if (lot.quantityStatus === "known" && lot.quantity !== null && lot.unit !== null) {
      const existingQuantity = food.quantities.find(
        (quantity) => quantity.unit === lot.unit && quantity.form === lot.form,
      );
      if (existingQuantity) existingQuantity.quantity += lot.quantity;
      else food.quantities.push({ quantity: lot.quantity, unit: lot.unit, form: lot.form });
    } else {
      food.unknownQuantityForms.add(lot.form);
    }
    foodsByConcept.set(concept.id, food);
  }

  const excluded = new Set([...preferences.excludedConceptIds, ...intent.excludeConceptIds]);
  const foods = [...foodsByConcept.values()]
    .filter((food) => !excluded.has(food.foodConceptId))
    .sort((left, right) => left.foodConceptId.localeCompare(right.foodConceptId, "en-US"))
    .map((food) => ({
      foodConceptId: food.foodConceptId,
      name: food.name,
      forms: [...food.forms].sort(),
      quantities: food.quantities
        .sort((left, right) => left.form.localeCompare(right.form, "en-US") || left.unit.localeCompare(right.unit, "en-US"))
        .slice(0, 8),
      unknownQuantityForms: [...food.unknownQuantityForms].sort(),
    }));

  const staples = [...new Set(preferences.staples)]
    .flatMap((value) => {
      const concept = FOOD_CONCEPT_BY_ID.get(value) ?? resolveFoodConcept(value);
      return concept && !excluded.has(concept.id)
        ? [{ foodConceptId: concept.id, name: concept.name }]
        : [];
    })
    .sort((left, right) => left.foodConceptId.localeCompare(right.foodConceptId, "en-US"));

  return {
    intent: { ...intent, query: "" },
    foods,
    staples,
    dietaryTags: [...new Set(preferences.dietaryTags)].sort(),
    excludedConceptIds: [...excluded].sort(),
  };
}

/** A prompt-free fingerprint for idempotent generation reservation/replay. */
export function recipeGenerationRequestFingerprint(context: RecipeGenerationContext): string {
  return createHash("sha256").update(stableJson(context)).digest("hex");
}

export function validateAndMaterializeGeneratedRecipe(
  value: unknown,
  context: RecipeGenerationContext,
  proposalId: string = randomUUID(),
): ValidatedGeneratedRecipe {
  const draft = generatedRecipeDraftSchema.parse(value);
  const foodsById = new Map(context.foods.map((food) => [food.foodConceptId, food]));
  const stapleIds = new Set(context.staples.map((staple) => staple.foodConceptId));
  const excluded = new Set(context.excludedConceptIds);
  const seenConcepts = new Set<string>();
  const requiredConcepts = new Set<string>();

  const ingredients = draft.ingredients.map((ingredient, position) => {
    const concept = FOOD_CONCEPT_BY_ID.get(ingredient.foodConceptId);
    const food = foodsById.get(ingredient.foodConceptId);
    const staple = stapleIds.has(ingredient.foodConceptId);
    if (!concept || (!food && !staple)) {
      throw new Error(`Generated ingredient ${ingredient.foodConceptId} is not available.`);
    }
    if (excluded.has(concept.id)) throw new Error(`Generated ingredient ${concept.id} is excluded.`);
    if (ingredient.name !== concept.name) {
      throw new Error(`Generated ingredient ${concept.id} must use its canonical name.`);
    }
    if (seenConcepts.has(concept.id)) throw new Error(`Generated recipe repeats ${concept.id}.`);
    seenConcepts.add(concept.id);
    if (ingredient.required) requiredConcepts.add(concept.id);
    if ((ingredient.amount === null) !== (ingredient.unit === null)) {
      throw new Error(`Generated ingredient ${concept.id} has an incomplete quantity.`);
    }
    if (ingredient.unit !== null && !getUnitDefinition(ingredient.unit)) {
      throw new Error(`Generated ingredient ${concept.id} uses an unsupported unit.`);
    }

    const accepted = new Set(ingredient.acceptedForms);
    const matchingKnownForms = food?.forms.filter((form) => accepted.has(form)) ?? [];
    const stapleAvailable = staple && !food && accepted.has("unspecified");
    if (matchingKnownForms.length === 0 && !stapleAvailable) {
      throw new Error(`Generated ingredient ${concept.id} does not accept an available form.`);
    }

    if (ingredient.amount !== null && ingredient.unit !== null) {
      if (!food) {
        // Editable staples have no verified quantity. They may be used “as
        // needed”, but the model cannot assert a numeric amount from no data.
        throw new Error(`Generated staple ${concept.id} must not claim a verified quantity.`);
      }
      let knownTotal = 0;
      let hasConvertible = false;
      let hasKnownMatchingForm = false;
      for (const quantity of food.quantities) {
        if (!accepted.has(quantity.form)) continue;
        hasKnownMatchingForm = true;
        const converted = convertQuantity(quantity.quantity, quantity.unit, ingredient.unit);
        if (converted !== null) {
          knownTotal += converted;
          hasConvertible = true;
        }
      }
      const hasUnknownMatchingForm = food.unknownQuantityForms.some((form) => accepted.has(form));
      if (hasKnownMatchingForm && !hasConvertible && !hasUnknownMatchingForm) {
        throw new Error(`Generated ingredient ${concept.id} uses an incompatible quantity unit.`);
      }
      if (hasConvertible && knownTotal + 1e-9 < ingredient.amount && !hasUnknownMatchingForm) {
        throw new Error(`Generated ingredient ${concept.id} exceeds the confirmed available quantity.`);
      }
    }

    return {
      ...ingredient,
      id: uniqueIngredientId(concept.id, position),
      display: canonicalDisplay(concept.name, ingredient.amount, ingredient.unit),
    };
  });

  if (requiredConcepts.size === 0) throw new Error("Generated recipe needs at least one required ingredient.");

  const referenced = new Set<string>();
  for (const step of draft.steps) {
    if (unsafeInstructionPattern.test(step.instruction)) {
      throw new Error("Generated instructions contain an unsupported unsafe technique.");
    }
    if (new Set(step.foodConceptIds).size !== step.foodConceptIds.length) {
      throw new Error("Generated step repeats an ingredient reference.");
    }
    for (const conceptId of step.foodConceptIds) {
      if (!seenConcepts.has(conceptId)) {
        throw new Error(`Generated instructions reference undeclared ${conceptId}.`);
      }
      referenced.add(conceptId);
    }
  }
  for (const conceptId of requiredConcepts) {
    if (!referenced.has(conceptId)) {
      throw new Error(`Generated instructions do not use required ${conceptId}.`);
    }
  }

  for (const ingredient of ingredients) {
    if (!ANIMAL_PROTEIN_CONCEPT_IDS.has(ingredient.foodConceptId) || !referenced.has(ingredient.foodConceptId)) continue;
    const food = foodsById.get(ingredient.foodConceptId);
    const accepted = new Set(ingredient.acceptedForms);
    const matchedForms = food?.forms.filter((form) => accepted.has(form)) ?? [];
    const needsCooking = matchedForms.length === 0 || matchedForms.some((form) => !PRECOOKED_FORMS.has(form));
    if (!needsCooking) continue;
    const safeStep = draft.steps.some(
      (step) =>
        step.foodConceptIds.includes(ingredient.foodConceptId) &&
        animalInstructionIsSafe(step.instruction, ingredient.name),
    );
    if (!safeStep) {
      throw new Error(`Generated instructions must explicitly cook ${ingredient.foodConceptId} fully.`);
    }
  }

  const intent = context.intent;
  if (intent.maxMinutes !== null && draft.totalMinutes > intent.maxMinutes) {
    throw new Error("Generated recipe exceeds the requested time limit.");
  }
  if (intent.servings !== null && draft.servings !== intent.servings) {
    throw new Error("Generated recipe does not match the requested servings.");
  }
  if (intent.mealTypes.length > 0 && !normalizedIntersection(draft.mealTypes, intent.mealTypes)) {
    throw new Error("Generated recipe does not match the requested meal type.");
  }
  if (intent.cuisines.length > 0 && !normalizedIntersection(draft.cuisines, intent.cuisines)) {
    throw new Error("Generated recipe does not match the requested cuisine.");
  }
  if (!intent.includeConceptIds.every((id) => requiredConcepts.has(id))) {
    throw new Error("Generated recipe omits a required requested food.");
  }

  const requestedDietaryTags = [...new Set([...context.dietaryTags, ...intent.dietaryTags].map(normalizeFoodLabel))];
  const unsupportedTag = requestedDietaryTags.find((tag) => !SUPPORTED_DIETARY_TAGS.has(tag));
  if (unsupportedTag) throw new Error(`Generated recipes cannot verify dietary tag ${unsupportedTag}.`);
  const dietaryTags = derivedDietaryTags(seenConcepts);
  if (!requestedDietaryTags.every((tag) => dietaryTags.includes(tag))) {
    throw new Error("Generated recipe ingredients conflict with a requested dietary tag.");
  }

  const suffix = proposalId.replace(/-/g, "").slice(0, 10);
  const recipe: Recipe = {
    id: `generated-${proposalId}`,
    slug: `${slugify(draft.title)}-${suffix}`,
    title: draft.title,
    description: draft.description,
    servings: draft.servings,
    totalMinutes: draft.totalMinutes,
    mealTypes: draft.mealTypes,
    cuisines: draft.cuisines,
    dietaryTags,
    ingredients,
    steps: draft.steps.map((step) => step.instruction),
    rights: {
      owner: "Household",
      author: "AI-assisted household recipe",
      reviewer: null,
      reviewedAt: null,
      status: "draft",
    },
  };

  return {
    recipe,
    contentHash: createHash("sha256").update(stableJson(recipe)).digest("hex"),
  };
}

export function demoGeneratedDraft(context: RecipeGenerationContext): GeneratedRecipeDraft {
  const selected = [...context.foods.slice(0, 3), ...context.staples]
    .filter((food, index, values) => values.findIndex((candidate) => candidate.foodConceptId === food.foodConceptId) === index)
    .slice(0, 5);
  if (selected.length < 2) throw new Error("Add at least two confirmed foods or staples before generating a recipe.");
  const ingredients = selected.map((food) => {
    const inventoryFood = context.foods.find((candidate) => candidate.foodConceptId === food.foodConceptId);
    const form = inventoryFood?.forms[0] ?? "unspecified";
    return {
      foodConceptId: food.foodConceptId,
      name: food.name,
      amount: null,
      unit: null,
      required: true,
      acceptedForms: [form] as FoodForm[],
    };
  });
  const names = ingredients.map((ingredient) => ingredient.name);
  const prepareRefs = ingredients.map((ingredient) => ingredient.foodConceptId);
  const animalIngredients = ingredients.filter((ingredient) => ANIMAL_PROTEIN_CONCEPT_IDS.has(ingredient.foodConceptId));
  const nonAnimals = ingredients.filter((ingredient) => !ANIMAL_PROTEIN_CONCEPT_IDS.has(ingredient.foodConceptId));
  return {
    title: `Flexible ${names.slice(0, 2).map((name) => name.replace(/\b\w/g, (letter) => letter.toUpperCase())).join(" and ")}`,
    description: "A simple AI-assisted demo recipe built only from confirmed kitchen foods.",
    servings: context.intent.servings ?? 2,
    totalMinutes: context.intent.maxMinutes ? Math.min(context.intent.maxMinutes, 30) : 30,
    mealTypes: context.intent.mealTypes.length ? context.intent.mealTypes.slice(0, 2) : ["dinner"],
    cuisines: context.intent.cuisines.slice(0, 2),
    dietaryTags: [],
    ingredients,
    steps: [
      { instruction: `Prepare ${names.join(", ")} in the listed forms.`, foodConceptIds: prepareRefs },
      animalIngredients.length > 0
        ? {
            instruction: `Cook ${animalIngredients.map((item) => item.name).join(" and ")} until fully done, then combine with ${nonAnimals.map((item) => item.name).join(", ") || "the remaining ingredients"}.`,
            foodConceptIds: prepareRefs,
          }
        : { instruction: `Cook ${names.join(", ")} until tender and evenly heated, then serve.`, foodConceptIds: prepareRefs },
    ],
  };
}

export function allowedGenerationConceptSummary(): string {
  return FOOD_CONCEPTS.map((concept) => `${concept.id}:${concept.name}`).join(", ");
}
