import path from "node:path";
import { describe, expect, it } from "vitest";
import type { InventoryLot } from "../contracts/domain";
import { DEFAULT_STAPLE_CONCEPT_IDS } from "./concepts";
import { DEFAULT_RECIPE_INTENT, suggestRecipes } from "./assessment";
import {
  loadRecipeDirectory,
  validateRecipeDirectory,
} from "./recipe-loader";

const recipeDirectory = path.resolve(process.cwd(), "content", "recipes");

describe("recipe corpus validation", () => {
  it("maintains a broad public catalog with honest provenance", async () => {
    const recipes = await loadRecipeDirectory(recipeDirectory, "preview");
    const reviewed = recipes.filter((recipe) => recipe.rights.status === "reviewed");
    const seeded = recipes.filter((recipe) => recipe.rights.status === "seeded");

    expect(recipes.length).toBeGreaterThanOrEqual(160);
    expect(new Set(recipes.map((recipe) => recipe.id)).size).toBe(recipes.length);
    expect(reviewed).toHaveLength(80);
    expect(reviewed.every((recipe) => recipe.rights.reviewer !== null)).toBe(true);
    expect(seeded.length).toBeGreaterThanOrEqual(80);
    expect(
      seeded.every(
        (recipe) => recipe.rights.reviewer === null && recipe.rights.reviewedAt === null,
      ),
    ).toBe(true);
  });

  it("returns honest near-matches for frozen chicken thighs and dried rice", async () => {
    const recipes = await loadRecipeDirectory(recipeDirectory, "publication");
    const now = "2026-08-26T00:00:00.000Z";
    const common = {
      householdId: "10000000-0000-4000-8000-000000000001",
      category: "Test",
      quantityStatus: "unknown" as const,
      quantity: null,
      unit: null,
      dateLabelType: null,
      dateLabel: null,
      status: "active" as const,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    const lots: InventoryLot[] = [
      {
        ...common,
        id: "20000000-0000-4000-8000-000000000001",
        foodConceptId: "chicken-thigh",
        name: "chicken thighs",
        form: "frozen",
        location: "freezer",
      },
      {
        ...common,
        id: "20000000-0000-4000-8000-000000000002",
        foodConceptId: "rice",
        name: "rice",
        form: "dried",
        location: "pantry",
      },
    ];

    const suggestions = suggestRecipes(
      recipes,
      lots,
      {
        staples: [...DEFAULT_STAPLE_CONCEPT_IDS],
        dietaryTags: [],
        excludedConceptIds: [],
      },
      DEFAULT_RECIPE_INTENT,
      { now },
    );

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.find((item) => item.recipe.id === "recipe-081")?.missingCount).toBe(0);
    expect(suggestions.every((item) => item.missingCount <= 2)).toBe(true);
  });

  it("admits reviewed and initial-seed recipes at the publication boundary", async () => {
    const result = await validateRecipeDirectory(recipeDirectory, "publication");

    expect(result.recipes.length).toBeGreaterThanOrEqual(160);
    expect(result.issues).toHaveLength(0);
    await expect(loadRecipeDirectory(recipeDirectory, "publication")).resolves.toHaveLength(
      result.recipes.length,
    );
  });
});
