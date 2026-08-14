import "server-only";

import path from "node:path";

import type { Recipe } from "@/contracts/domain";
import { loadRecipeDirectory } from "@/domain/recipe-loader";

let previewCatalog: Promise<readonly Recipe[]> | null = null;

/**
 * Local/demo environments read the audited source format directly. Production
 * imports only publication-valid recipes into Postgres and reads them through
 * the tenant-safe repository instead.
 */
export function getPreviewRecipeCatalog() {
  previewCatalog ??= loadRecipeDirectory(
    path.join(process.cwd(), "content", "recipes"),
    "preview",
  );
  return previewCatalog;
}

