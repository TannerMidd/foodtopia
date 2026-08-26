"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import {
  assessRecipe,
  DEFAULT_RECIPE_INTENT,
  rankRecipeAssessments,
} from "@/domain/assessment";
import type {
  HouseholdPreferences,
  InventoryLot,
  Recipe,
  RecipeAssessment,
} from "@/contracts/domain";
import {
  addRecipeFavorite,
  getRecipeFavorites,
  ApiClientError,
  removeRecipeFavorite,
} from "@/lib/client/api";
import { saveRecipeAssessment } from "@/lib/client/recipe-cache";
import {
  cacheFavoriteIds,
  loadCachedFavoriteIds,
  loadCachedPreferences,
  loadCachedRecipes,
  loadCatalogSyncedAt,
  syncRecipeCatalog,
} from "@/lib/client/recipe-catalog";
import { useOfflineInventory } from "./offline-provider";
import { RecipeRow } from "./recipe-suggestions";
import { cn, StateNotice } from "./ui";

type BrowseFilter = "all" | "favorites" | "ready" | "almost";

const filters: { value: BrowseFilter; label: string }[] = [
  { value: "all", label: "everything" },
  { value: "ready", label: "ready now" },
  { value: "almost", label: "almost ready" },
  { value: "favorites", label: "favorites" },
];

const DEFAULT_PREFERENCES: HouseholdPreferences = {
  staples: [],
  dietaryTags: [],
  excludedConceptIds: [],
};

/**
 * Browsable catalog: every recipe the household can cook, ranked against the
 * live inventory snapshot. Works fully offline from the Dexie cache; the AI
 * prompt search above stays available for intent-driven requests.
 */
export function RecipeBrowse() {
  const router = useRouter();
  const { lots, online, hydrated } = useOfflineInventory();
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [preferences, setPreferences] = useState<HouseholdPreferences>(DEFAULT_PREFERENCES);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<BrowseFilter>("all");
  const [query, setQuery] = useState("");
  const [favoriteBusy, setFavoriteBusy] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(60);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Paint the one coherent local snapshot first, then replace it with a
      // fresh snapshot. A single sequence avoids stale cache reads winning a
      // race against the network refresh.
      const [cachedRecipes, cachedPreferences, cachedSyncedAt, cachedFavoriteIds] =
        await Promise.all([
          loadCachedRecipes(),
          loadCachedPreferences(),
          loadCatalogSyncedAt(),
          loadCachedFavoriteIds(),
        ]);
      if (cancelled) return;
      setRecipes(cachedRecipes);
      if (cachedPreferences) setPreferences(cachedPreferences);
      setSyncedAt(cachedSyncedAt);
      setFavorites(new Set(cachedFavoriteIds));
      if (!online) return;

      await syncRecipeCatalog({ online });
      const [freshRecipes, freshPreferences, freshSyncedAt, favoritesResult] =
        await Promise.all([
          loadCachedRecipes(),
          loadCachedPreferences(),
          loadCatalogSyncedAt(),
          getRecipeFavorites().catch(() => null),
        ]);
      if (cancelled) return;
      setRecipes(freshRecipes);
      if (freshPreferences) setPreferences(freshPreferences);
      setSyncedAt(freshSyncedAt);
      if (favoritesResult) {
        const ids = favoritesResult.favorites.map((favorite) => favorite.recipeId);
        setFavorites(new Set(ids));
        void cacheFavoriteIds(ids);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [online]);

  const activeLots: InventoryLot[] = useMemo(
    () => lots.filter((lot) => lot.status === "active"),
    [lots],
  );

  const assessments: RecipeAssessment[] = useMemo(() => {
    if (!recipes || recipes.length === 0) return [];
    return rankRecipeAssessments(
      recipes.map((recipe) =>
        assessRecipe(recipe, activeLots, preferences, DEFAULT_RECIPE_INTENT),
      ),
      DEFAULT_RECIPE_INTENT,
    ).filter((assessment) => assessment.tier !== "incompatible");
  }, [recipes, activeLots, preferences]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assessments.filter((assessment) => {
      if (filter === "favorites" && !favorites.has(assessment.recipe.id)) return false;
      if (filter === "ready" && assessment.tier !== "ready") return false;
      if (
        filter === "almost" &&
        assessment.tier !== "likely_ready" &&
        assessment.tier !== "almost_ready"
      ) {
        return false;
      }
      if (!needle) return true;
      const haystack = [
        assessment.recipe.title,
        assessment.recipe.description,
        ...assessment.recipe.mealTypes,
        ...assessment.recipe.cuisines,
        ...assessment.recipe.dietaryTags,
        ...assessment.recipe.ingredients.map((ingredient) => ingredient.name),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [assessments, favorites, filter, query]);

  function openRecipe(assessment: RecipeAssessment) {
    // The detail page re-reads the durable store; writing here keeps evidence
    // identical between the browse row and what opens next.
    void saveRecipeAssessment(assessment).then(() => {
      router.push(`/recipes/${assessment.recipe.slug}`);
    });
  }

  function updateFavorites(update: (current: Set<string>) => void) {
    setFavorites((current) => {
      const next = new Set(current);
      update(next);
      void cacheFavoriteIds([...next]);
      return next;
    });
  }

  async function toggleFavorite(assessment: RecipeAssessment) {
    const recipeId = assessment.recipe.id;
    const wasFavorite = favorites.has(recipeId);
    setFavoriteBusy(recipeId);
    setFavoriteError(null);
    // Optimistic: the star answers immediately, the request follows.
    updateFavorites((next) => {
      if (wasFavorite) next.delete(recipeId);
      else next.add(recipeId);
    });
    try {
      if (wasFavorite) {
        await removeRecipeFavorite(recipeId);
      } else {
        await addRecipeFavorite(recipeId);
      }
    } catch (caught) {
      updateFavorites((next) => {
        if (wasFavorite) next.add(recipeId);
        else next.delete(recipeId);
      });
      setFavoriteError(
        caught instanceof ApiClientError && caught.status === 0
          ? "Reconnect to change household favorites."
          : caught instanceof Error
            ? caught.message
            : "The favorite could not be saved.",
      );
    } finally {
      setFavoriteBusy(null);
    }
  }

  return (
    <section aria-label="Browse all recipes" className="mt-12 flex flex-col gap-5">
      <div className="flex items-baseline justify-between">
        <p className="ml !text-[var(--accent)]">the whole larder</p>
        <span className="font-[family-name:var(--font-familjen)] text-[16px] font-semibold text-[var(--ink-5)]">
          {hydrated && recipes ? String(visible.length).padStart(2, "0") : "··"}
        </span>
      </div>

      {/* Soft controls: one quiet search bar plus shelf-style filter chips. */}
      <div className="rounded-[24px] bg-[var(--ground-hi)] px-5 py-3.5">
        <label htmlFor="recipe-browse-query" className="sr-only">
          Filter the recipe library
        </label>
        <input
          id="recipe-browse-query"
          type="search"
          className="w-full bg-transparent text-[16px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--ink-5)] focus:outline-none disabled:cursor-wait disabled:opacity-60"
          placeholder="filter by name, cuisine, or food…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Recipe filters">
        {filters.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
            className={cn(
              "chip transition",
              filter === item.value
                ? "!bg-[var(--ink)] !text-[var(--page)]"
                : "hover:text-[var(--ink)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {recipes && recipes.length > 0 && syncedAt === null && online && (
        <p className="m text-[11px] text-[var(--ink-5)]">updating the library…</p>
      )}

      {!recipes && hydrated && (
        <StateNotice title="No library on this device yet" tone="neutral">
          Connect once to download the recipe catalog. After that it stays browsable offline.
        </StateNotice>
      )}

      {recipes && recipes.length === 0 && (
        <p className="bd rounded-[20px] bg-[var(--ground)] px-5 py-8 text-[var(--ink-4)]">
          The recipe catalog has not been downloaded yet. Connect to fetch it once; browsing then
          works offline.
        </p>
      )}

      {favoriteError && (
        <StateNotice title="Favorites need attention" tone="warning">
          {favoriteError}
        </StateNotice>
      )}

      <div className="flex flex-col gap-2.5">
        {visible.slice(0, visibleLimit).map((assessment) => (
          <div key={assessment.recipe.id} className="flex items-stretch gap-2.5">
            <RecipeRow assessment={assessment} lit={false} onOpen={() => openRecipe(assessment)} />
            <button
              type="button"
              aria-pressed={favorites.has(assessment.recipe.id)}
              aria-label={
                favorites.has(assessment.recipe.id)
                  ? `Remove ${assessment.recipe.title} from favorites`
                  : `Save ${assessment.recipe.title} to favorites`
              }
              disabled={!online || favoriteBusy === assessment.recipe.id}
              onClick={() => void toggleFavorite(assessment)}
              className={cn(
                "flex w-12 flex-none items-center justify-center rounded-[24px] transition",
                favorites.has(assessment.recipe.id)
                  ? "bg-[var(--ground-tint)] text-[var(--accent)]"
                  : "bg-transparent text-[var(--ink-6)] hover:text-[var(--ink-3)] disabled:opacity-35",
              )}
            >
              <Star
                className="size-[18px]"
                aria-hidden="true"
                fill={favorites.has(assessment.recipe.id) ? "currentColor" : "none"}
              />
            </button>
          </div>
        ))}
        {recipes && visible.length > visibleLimit && (
          <button
            type="button"
            className="m mt-1 min-h-10 self-start rounded-full bg-[var(--ground-hi)] px-4 text-[11px] text-[var(--ink-4)] transition hover:bg-[var(--ground-tint)] hover:text-[var(--ink)]"
            onClick={() => setVisibleLimit((current) => current + 60)}
          >
            show more recipes · {visible.length - visibleLimit} remaining
          </button>
        )}
      </div>
    </section>
  );
}
