import type { HouseholdPreferences, Recipe } from "@/contracts/domain";
import { householdPreferencesSchema } from "@/contracts/domain";
import { getOfflineDb } from "@/lib/offline/db";
import {
  getHouseholdPreferences,
  getRecipeBySlug,
  getRecipeCatalog,
} from "@/lib/client/api";

/**
 * Offline cache for the browsable catalog. Every synced recipe is stored in
 * full so browse rows and detail pages work without a connection; household
 * preferences ride along because readiness tiers depend on staples and
 * exclusions.
 */

const SYNCED_AT_KEY = "recipeCatalogSyncedAt";
const PREFERENCES_KEY = "householdPreferences";
const FAVORITES_KEY = "recipeFavoriteIds";

async function writeMeta(key: string, value: unknown) {
  await getOfflineDb().meta.put({ key, value: JSON.stringify(value) });
}

async function readMeta<T>(key: string): Promise<T | null> {
  try {
    const record = await getOfflineDb().meta.get(key);
    if (typeof record?.value !== "string") return null;
    return JSON.parse(record.value) as T;
  } catch {
    return null;
  }
}

export async function loadCatalogSyncedAt(): Promise<string | null> {
  return readMeta<string>(SYNCED_AT_KEY);
}

export async function loadCachedRecipes(): Promise<Recipe[]> {
  try {
    const rows = await getOfflineDb().catalogRecipes.toArray();
    return rows.sort((left, right) => left.title.localeCompare(right.title, "en-US"));
  } catch {
    return [];
  }
}

export async function loadCachedPreferences(): Promise<HouseholdPreferences | null> {
  const parsed = await readMeta<unknown>(PREFERENCES_KEY);
  if (!parsed) return null;
  const result = householdPreferencesSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export async function loadCachedFavoriteIds(): Promise<string[]> {
  const parsed = await readMeta<unknown>(FAVORITES_KEY);
  return Array.isArray(parsed)
    ? parsed.filter((value): value is string => typeof value === "string")
    : [];
}

export async function cacheFavoriteIds(recipeIds: readonly string[]) {
  try {
    await writeMeta(FAVORITES_KEY, [...new Set(recipeIds)]);
  } catch {
    // Favorites still update in memory when browser storage is unavailable.
  }
}

export async function loadCachedRecipe(slug: string): Promise<Recipe | null> {
  try {
    return (await getOfflineDb().catalogRecipes.get(slug)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Refreshes the recipe and preference caches in one pass. Failures never
 * throw: the previous snapshot remains fully usable offline.
 */
export async function syncRecipeCatalog(
  options: { online: boolean } = { online: true },
): Promise<boolean> {
  if (!options.online) return false;
  let refreshed = false;
  try {
    const catalog = await getRecipeCatalog();
    const db = getOfflineDb();
    // Replace wholesale inside one transaction so a half-written catalog can
    // never render; removed or expired recipes disappear together.
    await db.transaction("rw", db.catalogRecipes, db.meta, async () => {
      await db.catalogRecipes.clear();
      await Promise.all(catalog.recipes.map((recipe) => db.catalogRecipes.put(recipe)));
      await writeMeta(SYNCED_AT_KEY, catalog.syncedAt);
    });
    refreshed = true;
  } catch {
    // Keep browsing on the previous snapshot.
  }
  try {
    const preferences = await getHouseholdPreferences();
    await writeMeta(PREFERENCES_KEY, preferences);
  } catch {
    // Without cached preferences the default staple set applies to tiers.
  }
  return refreshed;
}

/** Fetch-and-cache a single recipe detail; returns null when unavailable. */
export async function fetchAndCacheRecipe(slug: string): Promise<Recipe | null> {
  try {
    const detail = await getRecipeBySlug(slug);
    await getOfflineDb()
      .catalogRecipes.put(detail.recipe)
      .catch(() => undefined);
    return detail.recipe;
  } catch {
    return null;
  }
}
