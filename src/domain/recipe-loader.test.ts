import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadRecipeDirectory,
  RecipeValidationError,
  validateRecipeDirectory,
} from "./recipe-loader";

const recipeDirectory = path.resolve(process.cwd(), "content", "recipes");

describe("recipe corpus validation", () => {
  it("loads all draft recipes in editorial preview mode", async () => {
    const recipes = await loadRecipeDirectory(recipeDirectory, "preview");

    expect(recipes).toHaveLength(80);
    expect(new Set(recipes.map((recipe) => recipe.id)).size).toBe(80);
    expect(recipes.every((recipe) => recipe.rights.status === "draft")).toBe(true);
  });

  it("rejects every unreviewed draft at the publication boundary", async () => {
    const result = await validateRecipeDirectory(recipeDirectory, "publication");

    expect(result.recipes).toHaveLength(80);
    expect(result.issues).toHaveLength(80);
    expect(
      result.issues.every(
        (issue) =>
          issue.path === "rights.status" &&
          issue.message.includes("cannot be published"),
      ),
    ).toBe(true);
    await expect(
      loadRecipeDirectory(recipeDirectory, "publication"),
    ).rejects.toBeInstanceOf(RecipeValidationError);
  });
});
