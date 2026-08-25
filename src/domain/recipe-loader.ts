import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadAll } from "js-yaml";
import { recipeSchema, type Recipe } from "../contracts/domain";
import { FOOD_CONCEPT_BY_ID } from "./concepts";
import {
  findFoodConceptMentions,
  normalizeFoodLabel,
  resolveFoodConcept,
} from "./normalization";
import { getUnitDefinition } from "./units";

export type RecipeValidationMode = "preview" | "publication";

export type RecipeValidationIssue = Readonly<{
  file: string;
  recipeId: string | null;
  path: string;
  message: string;
}>;

export type RecipeValidationResult = Readonly<{
  recipes: readonly Recipe[];
  issues: readonly RecipeValidationIssue[];
  files: readonly string[];
}>;

export class RecipeValidationError extends Error {
  readonly issues: readonly RecipeValidationIssue[];

  constructor(issues: readonly RecipeValidationIssue[]) {
    super(`Recipe validation failed with ${issues.length} issue(s).`);
    this.name = "RecipeValidationError";
    this.issues = issues;
  }
}

type RawRecipe = Readonly<{ value: unknown; file: string; index: number }>;

const TOP_LEVEL_KEYS = new Set([
  "id",
  "slug",
  "title",
  "description",
  "servings",
  "totalMinutes",
  "mealTypes",
  "cuisines",
  "dietaryTags",
  "ingredients",
  "steps",
  "rights",
]);
const INGREDIENT_KEYS = new Set([
  "id",
  "foodConceptId",
  "name",
  "amount",
  "unit",
  "display",
  "required",
  "acceptedForms",
]);
const RIGHTS_KEYS = new Set([
  "owner",
  "author",
  "reviewer",
  "reviewedAt",
  "status",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recipeIdOf(value: unknown): string | null {
  return isRecord(value) && typeof value.id === "string" ? value.id : null;
}

function issue(
  issues: RecipeValidationIssue[],
  raw: RawRecipe,
  message: string,
  issuePath = "",
): void {
  issues.push({
    file: raw.file,
    recipeId: recipeIdOf(raw.value),
    path: issuePath,
    message,
  });
}

function checkUnknownKeys(
  value: unknown,
  allowed: ReadonlySet<string>,
  raw: RawRecipe,
  issues: RecipeValidationIssue[],
  basePath: string,
): void {
  if (!isRecord(value)) {
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issue(
        issues,
        raw,
        `Unknown field "${key}" is not allowed in strict recipe content.`,
        basePath ? `${basePath}.${key}` : key,
      );
    }
  }
}

function validateRawRecipeShape(
  raw: RawRecipe,
  mode: RecipeValidationMode,
  issues: RecipeValidationIssue[],
): Recipe | null {
  checkUnknownKeys(raw.value, TOP_LEVEL_KEYS, raw, issues, "");
  if (isRecord(raw.value)) {
    checkUnknownKeys(raw.value.rights, RIGHTS_KEYS, raw, issues, "rights");
    if (Array.isArray(raw.value.ingredients)) {
      raw.value.ingredients.forEach((ingredient, ingredientIndex) =>
        checkUnknownKeys(
          ingredient,
          INGREDIENT_KEYS,
          raw,
          issues,
          `ingredients.${ingredientIndex}`,
        ),
      );
    }
  }

  const parsed = recipeSchema.safeParse(raw.value);
  if (!parsed.success) {
    for (const parseIssue of parsed.error.issues) {
      issue(
        issues,
        raw,
        parseIssue.message,
        parseIssue.path.map(String).join("."),
      );
    }
    return null;
  }

  const recipe = parsed.data;
  const ingredientIds = new Set<string>();
  const conceptIds = new Set<string>();

  for (const [ingredientIndex, ingredient] of recipe.ingredients.entries()) {
    const basePath = `ingredients.${ingredientIndex}`;
    if (ingredientIds.has(ingredient.id)) {
      issue(issues, raw, `Duplicate ingredient ID "${ingredient.id}".`, `${basePath}.id`);
    }
    ingredientIds.add(ingredient.id);

    if (!FOOD_CONCEPT_BY_ID.has(ingredient.foodConceptId)) {
      issue(
        issues,
        raw,
        `Unknown global food concept "${ingredient.foodConceptId}".`,
        `${basePath}.foodConceptId`,
      );
    }
    conceptIds.add(ingredient.foodConceptId);

    const nameConcept = resolveFoodConcept(ingredient.name);
    if (!nameConcept || nameConcept.id !== ingredient.foodConceptId) {
      issue(
        issues,
        raw,
        `Ingredient name "${ingredient.name}" does not resolve to ${ingredient.foodConceptId}.`,
        `${basePath}.name`,
      );
    }

    const amountIsNull = ingredient.amount === null;
    const unitIsNull = ingredient.unit === null;
    if (amountIsNull !== unitIsNull) {
      issue(
        issues,
        raw,
        "Ingredient amount and unit must either both be present or both be null.",
        basePath,
      );
    }
    if (ingredient.unit !== null && !getUnitDefinition(ingredient.unit)) {
      issue(
        issues,
        raw,
        `Unsupported recipe unit "${ingredient.unit}".`,
        `${basePath}.unit`,
      );
    }
    if (ingredient.acceptedForms.length === 0) {
      issue(
        issues,
        raw,
        "acceptedForms must explicitly state at least one usable form.",
        `${basePath}.acceptedForms`,
      );
    }
    if (new Set(ingredient.acceptedForms).size !== ingredient.acceptedForms.length) {
      issue(
        issues,
        raw,
        "acceptedForms must not contain duplicates.",
        `${basePath}.acceptedForms`,
      );
    }
  }

  if (!recipe.ingredients.some((ingredient) => ingredient.required)) {
    issue(issues, raw, "A recipe must have at least one required ingredient.", "ingredients");
  }

  const mentionedConceptIds = new Set(
    recipe.steps.flatMap((step) =>
      findFoodConceptMentions(step).map((mention) => mention.concept.id),
    ),
  );
  for (const mentionedConceptId of mentionedConceptIds) {
    if (!conceptIds.has(mentionedConceptId)) {
      issue(
        issues,
        raw,
        `Instructions introduce undeclared food concept "${mentionedConceptId}".`,
        "steps",
      );
    }
  }
  for (const ingredient of recipe.ingredients.filter((item) => item.required)) {
    if (!mentionedConceptIds.has(ingredient.foodConceptId)) {
      issue(
        issues,
        raw,
        `Required ingredient "${ingredient.foodConceptId}" is never named in the instructions.`,
        "steps",
      );
    }
  }

  if (recipe.rights.status === "reviewed") {
    if (recipe.rights.reviewer === null || recipe.rights.reviewedAt === null) {
      issue(
        issues,
        raw,
        "Reviewed recipes require both reviewer and reviewedAt.",
        "rights",
      );
    } else if (
      recipe.rights.reviewer !== recipe.rights.reviewer.trim() ||
      recipe.rights.reviewer.length > 160
    ) {
      issue(
        issues,
        raw,
        "Reviewed recipe reviewer must be trimmed and at most 160 characters.",
        "rights.reviewer",
      );
    }
  } else if (recipe.rights.reviewer !== null || recipe.rights.reviewedAt !== null) {
    issue(
      issues,
      raw,
      `${recipe.rights.status === "seeded" ? "Seeded" : "Draft"} recipes must not claim a reviewer or review date.`,
      "rights",
    );
  }
  if (mode === "publication" && recipe.rights.status === "draft") {
    issue(
      issues,
      raw,
      "Draft recipe is allowed in editorial preview but cannot be published.",
      "rights.status",
    );
  }

  return recipe;
}

function recordsFromDocument(
  document: unknown,
  file: string,
  startIndex: number,
): RawRecipe[] {
  const values = Array.isArray(document)
    ? document
    : isRecord(document) && Array.isArray(document.recipes)
      ? document.recipes
      : [document];
  return values.map((value, offset) => ({ value, file, index: startIndex + offset }));
}

async function yamlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return yamlFiles(entryPath);
      }
      return /\.ya?ml$/i.test(entry.name) ? [entryPath] : [];
    }),
  );
  return nested.flat().sort((left, right) => left.localeCompare(right, "en-US"));
}

export async function validateRecipeDirectory(
  directory: string,
  mode: RecipeValidationMode,
): Promise<RecipeValidationResult> {
  const files = await yamlFiles(directory);
  const issues: RecipeValidationIssue[] = [];
  const rawRecipes: RawRecipe[] = [];

  if (files.length === 0) {
    issues.push({
      file: directory,
      recipeId: null,
      path: "",
      message: "No YAML recipe files were found.",
    });
  }

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const documents: unknown[] = [];
    try {
      loadAll(source, (document) => documents.push(document));
    } catch (error) {
      issues.push({
        file,
        recipeId: null,
        path: "",
        message: error instanceof Error ? error.message : "Invalid YAML.",
      });
      continue;
    }
    for (const document of documents.filter((value) => value !== undefined)) {
      rawRecipes.push(...recordsFromDocument(document, file, rawRecipes.length));
    }
  }

  const validatedRecipes = rawRecipes.flatMap((raw) => {
    const recipe = validateRawRecipeShape(raw, mode, issues);
    return recipe === null ? [] : [{ raw, recipe }];
  });
  const recipes = validatedRecipes.map(({ recipe }) => recipe);
  const seenIds = new Map<string, string>();
  const seenSlugs = new Map<string, string>();
  const seenInstructions = new Map<string, string>();

  for (const { raw, recipe } of validatedRecipes) {
    const priorIdFile = seenIds.get(recipe.id);
    if (priorIdFile) {
      issue(issues, raw, `Duplicate recipe ID also found in ${priorIdFile}.`, "id");
    } else {
      seenIds.set(recipe.id, raw.file);
    }
    const priorSlugFile = seenSlugs.get(recipe.slug);
    if (priorSlugFile) {
      issue(issues, raw, `Duplicate recipe slug also found in ${priorSlugFile}.`, "slug");
    } else {
      seenSlugs.set(recipe.slug, raw.file);
    }
    const instructionFingerprint = normalizeFoodLabel(recipe.steps.join(" "));
    const priorInstructionRecipe = seenInstructions.get(instructionFingerprint);
    if (priorInstructionRecipe) {
      issue(
        issues,
        raw,
        `Instructions duplicate recipe "${priorInstructionRecipe}".`,
        "steps",
      );
    } else {
      seenInstructions.set(instructionFingerprint, recipe.id);
    }
  }

  return { recipes, issues, files };
}

export async function loadRecipeDirectory(
  directory: string,
  mode: RecipeValidationMode = "preview",
): Promise<readonly Recipe[]> {
  const result = await validateRecipeDirectory(directory, mode);
  if (result.issues.length > 0) {
    throw new RecipeValidationError(result.issues);
  }
  return result.recipes;
}
