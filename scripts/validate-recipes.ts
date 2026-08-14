import path from "node:path";
import {
  validateRecipeDirectory,
  type RecipeValidationMode,
} from "../src/domain/recipe-loader";

const mode: RecipeValidationMode = process.argv.includes("--publication")
  ? "publication"
  : "preview";
const directory = path.resolve(process.cwd(), "content", "recipes");
const result = await validateRecipeDirectory(directory, mode);

if (result.issues.length > 0) {
  for (const issue of result.issues) {
    const location = [
      path.relative(process.cwd(), issue.file),
      issue.recipeId ? `recipe=${issue.recipeId}` : null,
      issue.path || null,
    ]
      .filter(Boolean)
      .join(":");
    console.error(`${location}: ${issue.message}`);
  }
  console.error(
    `Recipe ${mode} validation failed: ${result.issues.length} issue(s) across ${result.files.length} file(s).`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Recipe ${mode} validation passed: ${result.recipes.length} recipe(s) across ${result.files.length} file(s).`,
  );
}
