import {
  recipeSchema,
  type Recipe,
  type RecipeIngredient,
} from "../../src/contracts/domain";
import { FOOD_CONCEPT_BY_ID } from "../../src/domain/concepts";

export class RecipeImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipeImportError";
  }
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlArray(values: readonly string[], type: string): string {
  if (values.length === 0) {
    return `array[]::${type}[]`;
  }
  return `array[${values.map(sqlText).join(", ")}]::${type}[]`;
}

function sqlNumeric(value: number | null): string {
  if (value === null) {
    // The desired-row CTE needs an explicit type when every recipe amount is null.
    return "null::numeric";
  }
  const thousandths = Math.round(value * 1_000);
  if (
    Math.abs(value * 1_000 - thousandths) > 1e-8 ||
    value > 999_999_999.999
  ) {
    throw new RecipeImportError(
      `Ingredient amount ${value} does not fit numeric(12, 3).`,
    );
  }
  return String(Number(value.toFixed(3)));
}

function valueRows(rows: readonly string[]): string {
  return rows.map((row) => `  (${row})`).join(",\n");
}

function validateIngredient(
  recipe: Recipe,
  ingredient: RecipeIngredient,
  seenIngredientIds: Set<string>,
): void {
  if (seenIngredientIds.has(ingredient.id)) {
    throw new RecipeImportError(
      `Recipe ${recipe.id} repeats ingredient ID ${ingredient.id}.`,
    );
  }
  seenIngredientIds.add(ingredient.id);

  if (ingredient.id.length > 120) {
    throw new RecipeImportError(
      `Recipe ${recipe.id} ingredient ID ${ingredient.id} exceeds 120 characters.`,
    );
  }
  if (!FOOD_CONCEPT_BY_ID.has(ingredient.foodConceptId)) {
    throw new RecipeImportError(
      `Recipe ${recipe.id} references unknown food concept ${ingredient.foodConceptId}.`,
    );
  }
  if (ingredient.name.length > 160 || ingredient.display.length > 240) {
    throw new RecipeImportError(
      `Recipe ${recipe.id} ingredient ${ingredient.id} exceeds a database text limit.`,
    );
  }
  if (ingredient.unit !== null && ingredient.unit.length > 40) {
    throw new RecipeImportError(
      `Recipe ${recipe.id} ingredient ${ingredient.id} unit exceeds 40 characters.`,
    );
  }
  if ((ingredient.amount === null) !== (ingredient.unit === null)) {
    throw new RecipeImportError(
      `Recipe ${recipe.id} ingredient ${ingredient.id} must provide amount and unit together.`,
    );
  }
  if (ingredient.acceptedForms.length === 0) {
    throw new RecipeImportError(
      `Recipe ${recipe.id} ingredient ${ingredient.id} needs at least one accepted form.`,
    );
  }
  sqlNumeric(ingredient.amount);
}

function validateReviewedRecipes(values: readonly Recipe[]): Recipe[] {
  if (values.length === 0) {
    throw new RecipeImportError("No reviewed recipes were supplied for import.");
  }

  const recipes = values.map((value, index) => {
    const parsed = recipeSchema.safeParse(value);
    if (!parsed.success) {
      throw new RecipeImportError(
        `Recipe at index ${index} is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    return parsed.data;
  });
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();

  for (const recipe of recipes) {
    if (
      recipe.rights.status !== "reviewed" ||
      recipe.rights.reviewer === null ||
      recipe.rights.reviewer.trim().length === 0 ||
      recipe.rights.reviewedAt === null
    ) {
      throw new RecipeImportError(
        `Recipe ${recipe.id} is not genuinely publication-ready: reviewed status, a nonblank reviewer, and reviewedAt are required.`,
      );
    }
    if (recipe.rights.reviewer !== recipe.rights.reviewer.trim()) {
      throw new RecipeImportError(
        `Recipe ${recipe.id} reviewer metadata must not have surrounding whitespace.`,
      );
    }
    if (recipe.id.length > 120) {
      throw new RecipeImportError(`Recipe ${recipe.id} exceeds 120 characters.`);
    }
    if (recipe.servings > 24 || recipe.totalMinutes > 480) {
      throw new RecipeImportError(
        `Recipe ${recipe.id} exceeds the database servings or duration limit.`,
      );
    }
    if (
      recipe.rights.owner.length > 160 ||
      recipe.rights.author.length > 160
    ) {
      throw new RecipeImportError(
        `Recipe ${recipe.id} rights metadata exceeds 160 characters.`,
      );
    }
    if (
      recipe.rights.owner.trim().length === 0 ||
      recipe.rights.author.trim().length === 0 ||
      recipe.rights.owner !== recipe.rights.owner.trim() ||
      recipe.rights.author !== recipe.rights.author.trim()
    ) {
      throw new RecipeImportError(
        `Recipe ${recipe.id} owner and author metadata must be nonblank and trimmed.`,
      );
    }
    if (seenIds.has(recipe.id)) {
      throw new RecipeImportError(`Duplicate recipe ID ${recipe.id}.`);
    }
    if (seenSlugs.has(recipe.slug)) {
      throw new RecipeImportError(`Duplicate published recipe slug ${recipe.slug}.`);
    }
    seenIds.add(recipe.id);
    seenSlugs.add(recipe.slug);

    const ingredientIds = new Set<string>();
    for (const ingredient of recipe.ingredients) {
      validateIngredient(recipe, ingredient, ingredientIds);
    }
  }

  return recipes.sort((left, right) => left.id.localeCompare(right.id, "en-US"));
}

function recipeRow(recipe: Recipe): string {
  return [
    sqlText(recipe.id),
    "null::uuid",
    "'published'::public.recipe_visibility",
    sqlText(recipe.slug),
    sqlText(recipe.title),
    sqlText(recipe.description),
    String(recipe.servings),
    String(recipe.totalMinutes),
    sqlArray(recipe.mealTypes, "text"),
    sqlArray(recipe.cuisines, "text"),
    sqlArray(recipe.dietaryTags, "text"),
    sqlArray(recipe.steps, "text"),
    sqlText(recipe.rights.owner),
    sqlText(recipe.rights.author),
    sqlText(recipe.rights.reviewer!),
    `${sqlText(recipe.rights.reviewedAt!)}::date`,
    "'reviewed'::public.recipe_review_status",
    "null",
  ].join(", ");
}

function ingredientRow(
  recipe: Recipe,
  ingredient: RecipeIngredient,
  position: number,
): string {
  return [
    sqlText(recipe.id),
    sqlText(ingredient.id),
    "null::uuid",
    String(position),
    sqlText(ingredient.foodConceptId),
    sqlText(ingredient.name),
    sqlNumeric(ingredient.amount),
    ingredient.unit === null ? "null" : sqlText(ingredient.unit),
    sqlText(ingredient.display),
    String(ingredient.required),
    sqlArray(ingredient.acceptedForms, "public.food_form"),
  ].join(", ");
}

export function generateReviewedRecipeImportSql(
  values: readonly Recipe[],
): string {
  const recipes = validateReviewedRecipes(values);
  const ingredientRows = recipes.flatMap((recipe) =>
    recipe.ingredients.map((ingredient, position) =>
      ingredientRow(recipe, ingredient, position),
    ),
  );
  const recipeIds = recipes.map((recipe) => sqlText(recipe.id)).join(", ");

  return [
    "-- Generated by scripts/generate-recipe-import-sql.ts. Do not edit by hand.",
    "-- The CLI emits this only after every source recipe passes publication validation.",
    "begin;",
    "",
    "insert into public.recipes",
    "  (id, household_id, visibility, slug, title, description, servings, total_minutes,",
    "   meal_types, cuisines, dietary_tags, steps, rights_owner, rights_author,",
    "   rights_reviewer, rights_reviewed_at, rights_status, created_by)",
    "values",
    valueRows(recipes.map(recipeRow)),
    "on conflict (id) do update",
    "set household_id = excluded.household_id,",
    "    visibility = excluded.visibility,",
    "    slug = excluded.slug,",
    "    title = excluded.title,",
    "    description = excluded.description,",
    "    servings = excluded.servings,",
    "    total_minutes = excluded.total_minutes,",
    "    meal_types = excluded.meal_types,",
    "    cuisines = excluded.cuisines,",
    "    dietary_tags = excluded.dietary_tags,",
    "    steps = excluded.steps,",
    "    rights_owner = excluded.rights_owner,",
    "    rights_author = excluded.rights_author,",
    "    rights_reviewer = excluded.rights_reviewer,",
    "    rights_reviewed_at = excluded.rights_reviewed_at,",
    "    rights_status = excluded.rights_status,",
    "    created_by = excluded.created_by",
    "where (recipes.household_id, recipes.visibility, recipes.slug, recipes.title,",
    "       recipes.description, recipes.servings, recipes.total_minutes, recipes.meal_types,",
    "       recipes.cuisines, recipes.dietary_tags, recipes.steps, recipes.rights_owner,",
    "       recipes.rights_author, recipes.rights_reviewer, recipes.rights_reviewed_at,",
    "       recipes.rights_status, recipes.created_by)",
    "  is distinct from",
    "      (excluded.household_id, excluded.visibility, excluded.slug, excluded.title,",
    "       excluded.description, excluded.servings, excluded.total_minutes, excluded.meal_types,",
    "       excluded.cuisines, excluded.dietary_tags, excluded.steps, excluded.rights_owner,",
    "       excluded.rights_author, excluded.rights_reviewer, excluded.rights_reviewed_at,",
    "       excluded.rights_status, excluded.created_by);",
    "",
    "-- Delete stale and changed rows first so ingredient position swaps cannot",
    "-- collide with the immediate unique (recipe_id, position) constraint.",
    "with desired",
    "  (recipe_id, id, household_id, position, food_concept_id, name, amount, unit,",
    "   display, required, accepted_forms) as (",
    "  values",
    valueRows(ingredientRows),
    ")",
    "delete from public.recipe_ingredients as existing",
    `where existing.recipe_id in (${recipeIds})`,
    "  and not exists (",
    "    select 1",
    "    from desired",
    "    where desired.recipe_id = existing.recipe_id",
    "      and desired.id = existing.id",
    "      and (existing.household_id, existing.position, existing.food_concept_id,",
    "           existing.name, existing.amount, existing.unit, existing.display,",
    "           existing.required, existing.accepted_forms)",
    "        is not distinct from",
    "          (desired.household_id, desired.position, desired.food_concept_id,",
    "           desired.name, desired.amount, desired.unit, desired.display,",
    "           desired.required, desired.accepted_forms)",
    "  );",
    "",
    "insert into public.recipe_ingredients",
    "  (recipe_id, id, household_id, position, food_concept_id, name, amount, unit,",
    "   display, required, accepted_forms)",
    "values",
    valueRows(ingredientRows),
    "on conflict (recipe_id, id) do update",
    "set household_id = excluded.household_id,",
    "    position = excluded.position,",
    "    food_concept_id = excluded.food_concept_id,",
    "    name = excluded.name,",
    "    amount = excluded.amount,",
    "    unit = excluded.unit,",
    "    display = excluded.display,",
    "    required = excluded.required,",
    "    accepted_forms = excluded.accepted_forms",
    "where (recipe_ingredients.household_id, recipe_ingredients.position,",
    "       recipe_ingredients.food_concept_id, recipe_ingredients.name,",
    "       recipe_ingredients.amount, recipe_ingredients.unit,",
    "       recipe_ingredients.display, recipe_ingredients.required,",
    "       recipe_ingredients.accepted_forms)",
    "  is distinct from",
    "      (excluded.household_id, excluded.position, excluded.food_concept_id,",
    "       excluded.name, excluded.amount, excluded.unit, excluded.display,",
    "       excluded.required, excluded.accepted_forms);",
    "",
    "commit;",
    "",
  ].join("\n");
}
