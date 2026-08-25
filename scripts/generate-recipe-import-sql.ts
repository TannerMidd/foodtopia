import { writeFile } from "node:fs/promises";
import path from "node:path";
import { validateRecipeDirectory } from "../src/domain/recipe-loader";
import { generatePublicRecipeImportSql } from "./lib/recipe-import-sql";

function outputPathFromArgs(args: readonly string[]): string | null {
  const meaningfulArgs = args.filter((argument) => argument !== "--");
  if (meaningfulArgs.length === 0) {
    return null;
  }
  if (meaningfulArgs.length !== 2 || meaningfulArgs[0] !== "--output") {
    throw new Error("Usage: generate-recipe-import-sql [--output <path>]");
  }
  if (meaningfulArgs[1].trim().length === 0) {
    throw new Error("--output requires a file path.");
  }
  return meaningfulArgs[1];
}

function printValidationIssues(
  issues: Awaited<ReturnType<typeof validateRecipeDirectory>>["issues"],
): void {
  for (const issue of issues) {
    const location = [
      path.relative(process.cwd(), issue.file),
      issue.recipeId ? `recipe=${issue.recipeId}` : null,
      issue.path || null,
    ]
      .filter(Boolean)
      .join(":");
    console.error(`${location}: ${issue.message}`);
  }
}

async function main(): Promise<void> {
  const outputPath = outputPathFromArgs(process.argv.slice(2));
  const recipeDirectory = path.resolve(process.cwd(), "content", "recipes");
  const validation = await validateRecipeDirectory(
    recipeDirectory,
    "publication",
  );

  if (validation.issues.length > 0) {
    printValidationIssues(validation.issues);
    throw new Error(
      `Recipe import refused: publication validation found ${validation.issues.length} issue(s) across ${validation.files.length} file(s).`,
    );
  }

  const sql = generatePublicRecipeImportSql(validation.recipes);
  if (outputPath === null) {
    process.stdout.write(sql);
    return;
  }
  await writeFile(path.resolve(process.cwd(), outputPath), sql, "utf8");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Recipe import failed.");
  process.exitCode = 1;
});
