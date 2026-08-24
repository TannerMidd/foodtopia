import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadRecipeDirectory,
  validateRecipeDirectory,
} from "./recipe-loader";

const recipeDirectory = path.resolve(process.cwd(), "content", "recipes");

describe("recipe corpus validation", () => {
  it("loads all reviewed recipes in editorial preview mode", async () => {
    const recipes = await loadRecipeDirectory(recipeDirectory, "preview");

    expect(recipes).toHaveLength(80);
    expect(new Set(recipes.map((recipe) => recipe.id)).size).toBe(80);
    expect(recipes.every((recipe) => recipe.rights.status === "reviewed")).toBe(true);
    expect(recipes.every((recipe) => recipe.rights.reviewer !== null)).toBe(true);
  });

  it("admits every reviewed recipe at the publication boundary", async () => {
    const result = await validateRecipeDirectory(recipeDirectory, "publication");

    expect(result.recipes).toHaveLength(80);
    expect(result.issues).toHaveLength(0);
    await expect(
      loadRecipeDirectory(recipeDirectory, "publication"),
    ).resolves.toHaveLength(80);
  });
});
