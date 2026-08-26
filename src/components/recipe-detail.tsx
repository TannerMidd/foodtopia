"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChefHat, ShoppingBasket, Star } from "lucide-react";
import type { RecipeFlagReason } from "@/contracts/api";
import {
  ApiClientError,
  addRecipeFavorite,
  addShoppingListItems,
  createCookSession,
  flagRecipe,
  getRecipeFavorites,
  recordRecipeOpened,
  removeRecipeFavorite,
} from "@/lib/client/api";
import { assessRecipe, DEFAULT_RECIPE_INTENT } from "@/domain/assessment";
import { getFoodConcept } from "@/domain/concepts";
import type {
  HouseholdPreferences,
  IngredientEvidenceStatus,
  RecipeAssessment,
} from "@/contracts/domain";
import {
  loadCookSession,
  loadRecipeAssessment,
  saveCookSession,
  saveRecipeAssessment,
} from "@/lib/client/recipe-cache";
import {
  cacheFavoriteIds,
  fetchAndCacheRecipe,
  loadCachedFavoriteIds,
  loadCachedPreferences,
  loadCachedRecipe,
} from "@/lib/client/recipe-catalog";
import { useOfflineInventory } from "./offline-provider";
import { Button, Page, Section, StateNotice, cn } from "./ui";

const evidenceCopy: Record<IngredientEvidenceStatus, { label: string; dim: boolean }> = {
  present_sufficient: { label: "Have it", dim: false },
  present_quantity_unknown: { label: "Amount unknown", dim: false },
  insufficient: { label: "Need more", dim: false },
  missing: { label: "Missing", dim: false },
  ambiguous: { label: "Check this", dim: false },
  assumed_staple: { label: "assumed staple", dim: true },
};

export function RecipeDetail({ slug }: { slug: string }) {
  const router = useRouter();
  const { online, lots } = useOfflineInventory();
  const [assessment, setAssessment] = useState<RecipeAssessment | null | undefined>(undefined);
  const [favorite, setFavorite] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [listNotice, setListNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [confirmedSubstitutionSignature, setConfirmedSubstitutionSignature] = useState("");
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagReason, setFlagReason] = useState<RecipeFlagReason>("inaccurate");
  const [flagging, setFlagging] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [flagSimulated, setFlagSimulated] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  // Latest inventory/connection for the one-shot load below without making it
  // re-run (a reload must never clobber evidence the member is mid-review of).
  const latestLots = useRef(lots);
  const latestOnline = useRef(online);
  const recordedSlug = useRef<string | null>(null);

  useEffect(() => {
    latestLots.current = lots;
    latestOnline.current = online;
  }, [lots, online]);
  const flagReasonRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      // Resolution order: the durable cooking context (evidence frozen from
      // suggestions or a previous visit), then the cached catalog with a fresh
      // assessment against this device's inventory, then one online fetch.
      void (async () => {
        const [stored, activeSessionId] = await Promise.all([
          loadRecipeAssessment(slug),
          loadCookSession(slug),
        ]);
        // An active server cooking session freezes its ingredient comparison.
        // A browse-only assessment has no session id and must be recomputed
        // against today's inventory instead of becoming stale forever.
        if (!cancelled && stored && activeSessionId) {
          setAssessment(stored);
          return;
        }
        let recipe = stored?.recipe ?? (await loadCachedRecipe(slug));
        if (!recipe && !cancelled) {
          recipe = latestOnline.current ? await fetchAndCacheRecipe(slug) : null;
        }
        if (cancelled) return;
        if (!recipe) {
          setAssessment(null);
          return;
        }
        const preferences: HouseholdPreferences =
          (await loadCachedPreferences()) ?? {
            staples: [],
            dietaryTags: [],
            excludedConceptIds: [],
          };
        setAssessment(
          assessRecipe(
            recipe,
            latestLots.current.filter((lot) => lot.status === "active"),
            preferences,
            DEFAULT_RECIPE_INTENT,
          ),
        );
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [slug]);

  useEffect(() => {
    if (!assessment || recordedSlug.current === slug) return;
    recordedSlug.current = slug;
    void recordRecipeOpened();
  }, [assessment, slug]);

  useEffect(() => {
    const recipeId = assessment?.recipe.id;
    if (!recipeId) return;
    let cancelled = false;
    async function loadFavorite() {
      const cachedIds = await loadCachedFavoriteIds();
      if (!cancelled) setFavorite(cachedIds.includes(recipeId!));
      if (!online) return;
      try {
        const result = await getRecipeFavorites();
        const ids = result.favorites.map((entry) => entry.recipeId);
        if (!cancelled) setFavorite(ids.includes(recipeId!));
        void cacheFavoriteIds(ids);
      } catch {
        // The cached state remains available offline or during a transient fault.
      }
    }
    void loadFavorite();
    return () => {
      cancelled = true;
    };
  }, [online, assessment?.recipe.id]);

  useEffect(() => {
    if (showFlagForm) flagReasonRef.current?.focus();
  }, [showFlagForm]);

  /* Required ingredients the kitchen cannot cover — one tap fills the shared list. */
  const missingIngredients = useMemo(() => {
    if (!assessment) return [];
    return assessment.recipe.ingredients.filter((ingredient) => {
      if (!ingredient.required) return false;
      const item = assessment.evidence.find((entry) => entry.ingredientId === ingredient.id);
      return item?.status === "missing" || item?.status === "insufficient";
    });
  }, [assessment]);

  const substitutionSignature = assessment
    ? assessment.evidence
        .flatMap((item) =>
          item.substitution
            ? [`${item.ingredientId}:${item.substitution.matchedConceptId}`]
            : [],
        )
        .sort()
        .join("|")
    : "";
  const substitutionsConfirmed =
    substitutionSignature.length === 0 ||
    confirmedSubstitutionSignature === substitutionSignature;

  if (assessment === undefined) {
    return (
      <Page className="max-w-[44rem]">
        <div className="skeleton h-4 w-40 rounded-full" />
        <div className="skeleton mt-6 h-9 w-80 rounded-[16px]" />
        <div className="skeleton mt-8 h-48 rounded-[24px]" />
      </Page>
    );
  }

  if (!assessment) {
    return (
      <Page className="max-w-[44rem]">
        <p className="ml !text-[var(--accent)]">cook</p>
        <h1 className="hd mt-3 text-[clamp(1.9rem,7vw,2.1rem)]">This recipe isn&rsquo;t on this device yet.</h1>
        <p className="bd mt-3 max-w-md">
          Browse or search the library while connected and it downloads for good — then every
          visited recipe stays readable offline.
        </p>
        <Link
          href="/recipes"
          className="glow mt-7 inline-flex min-h-12 items-center rounded-full px-6 text-[15px]"
        >
          Open the library
        </Link>
      </Page>
    );
  }

  const { recipe, evidence, explanation } = assessment;
  const preview = recipe.rights.status === "draft";
  const initialSeed = recipe.rights.status === "seeded";
  const substitutions = evidence.flatMap((item) =>
    item.substitution ? [{ ingredientId: item.ingredientId, ...item.substitution }] : [],
  );

  async function toggleFavorite() {
    if (!assessment || favoriteBusy) return;
    const wasFavorite = favorite;
    setFavoriteBusy(true);
    setFavoriteError(null);
    setFavorite(!wasFavorite);
    const cachedIds = new Set(await loadCachedFavoriteIds());
    if (wasFavorite) cachedIds.delete(recipe.id);
    else cachedIds.add(recipe.id);
    void cacheFavoriteIds([...cachedIds]);
    try {
      if (wasFavorite) await removeRecipeFavorite(recipe.id);
      else await addRecipeFavorite(recipe.id);
    } catch (caught) {
      setFavorite(wasFavorite);
      if (wasFavorite) cachedIds.add(recipe.id);
      else cachedIds.delete(recipe.id);
      void cacheFavoriteIds([...cachedIds]);
      setFavoriteError(
        caught instanceof ApiClientError && caught.status === 0
          ? "Reconnect to change household favorites."
          : caught instanceof Error
            ? caught.message
            : "The favorite could not be saved.",
      );
    } finally {
      setFavoriteBusy(false);
    }
  }

  async function addMissingToShoppingList() {
    if (!online || missingIngredients.length === 0 || listBusy) return;
    setListBusy(true);
    setListError(null);
    setListNotice(null);
    try {
      const result = await addShoppingListItems({
        items: missingIngredients.map((ingredient) => ({
          name: ingredient.name,
          category: getFoodConcept(ingredient.foodConceptId)?.category ?? "Other",
          foodConceptId: ingredient.foodConceptId,
          quantityText: ingredient.amount !== null && ingredient.unit
            ? `${ingredient.amount} ${ingredient.unit}`
            : null,
        })),
      });
      setListNotice(
        result.added === 0
          ? "Everything on this list is already on the shared shopping list."
          : `Added ${result.added} item${result.added === 1 ? "" : "s"} to the household shopping list.`,
      );
    } catch (caught) {
      setListError(
        caught instanceof Error ? caught.message : "The shopping list could not be updated.",
      );
    } finally {
      setListBusy(false);
    }
  }

  async function submitFlag() {
    setFlagging(true);
    setFlagError(null);
    try {
      const result = await flagRecipe(recipe.id, flagReason);
      setFlagged(true);
      setFlagSimulated(result.simulated);
      setShowFlagForm(false);
    } catch (caught) {
      setFlagError(caught instanceof Error ? caught.message : "The recipe could not be flagged.");
    } finally {
      setFlagging(false);
    }
  }

  async function startCooking() {
    if (!online) {
      setStartError("Reconnect before starting a shared cooking session.");
      return;
    }
    if (substitutions.length > 0 && !substitutionsConfirmed) {
      setStartError("Confirm the listed substitutions before cooking.");
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const session = await createCookSession(assessment!);
      // Persist in order: saveCookSession updates the assessment row. Awaiting
      // both removes the race where the cook screen opens before Dexie settles.
      await saveRecipeAssessment(session.assessment);
      await saveCookSession(slug, session.cookSessionId);
      router.push(`/recipes/${slug}/cook`);
    } catch (caught) {
      if (
        caught instanceof ApiClientError &&
        caught.code === "RECIPE_SUBSTITUTIONS_CHANGED" &&
        caught.latestAssessment
      ) {
        setAssessment(caught.latestAssessment);
        await saveRecipeAssessment(caught.latestAssessment);
        setConfirmedSubstitutionSignature("");
        setStartError("The kitchen changed. Review the updated ingredient comparison and confirm any substitutions again.");
      } else {
        setStartError(caught instanceof Error ? caught.message : "The cooking session could not be started.");
      }
      setStarting(false);
    }
  }

  return (
    <Page className="max-w-[44rem]">
      <Link href="/recipes" className="m inline-flex min-h-9 items-center text-[10.5px] text-[var(--ink-5)] hover:text-[var(--ink)]">
        back to suggestions
      </Link>

      <header className="mt-5">
        <p className="ml">
          {recipe.title.toLowerCase()}
          {preview ? " · editorial preview" : initialSeed ? " · initial recipe" : ""}
        </p>
        <h1 className="hd mt-3 text-[clamp(1.9rem,7vw,2.2rem)]">{recipe.description}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="chip !py-[7px] !text-[12px]">{recipe.totalMinutes} minutes</span>
          <span className="chip !py-[7px] !text-[12px]">{recipe.servings} servings</span>
          {recipe.dietaryTags.map((tag) => (
            <span key={tag} className="chip !py-[7px] !text-[12px]">
              {tag}
            </span>
          ))}
          <button
            type="button"
            aria-pressed={favorite}
            aria-label={
              favorite
                ? "Remove this recipe from household favorites"
                : "Save this recipe to household favorites"
            }
            disabled={!online || favoriteBusy}
            onClick={() => void toggleFavorite()}
            className={cn(
              "chip inline-flex min-h-9 items-center gap-1.5 !px-3 !text-[12px] transition",
              favorite ? "!bg-[var(--ground-tint)] !text-[var(--accent)]" : "hover:!text-[var(--ink)]",
            )}
          >
            <Star
              className="size-3.5"
              aria-hidden="true"
              fill={favorite ? "currentColor" : "none"}
            />
            {favorite ? "saved" : "save"}
          </button>
        </div>
      </header>

      {explanation && <p className="bd mt-6 max-w-[34rem]">{explanation}</p>}

      {favoriteError && (
        <p role="alert" className="bd mt-4 text-[12px] text-[var(--accent)]">{favoriteError}</p>
      )}

      <div className="mt-10 flex flex-col gap-9">
        <Section label="you have" labelWidth="66px">
          <div className="flex flex-col gap-2">
            {recipe.ingredients.map((ingredient) => {
              const item = evidence.find((entry) => entry.ingredientId === ingredient.id);
              const copy = item ? evidenceCopy[item.status] : evidenceCopy.missing;
              const short = item?.status === "missing" || item?.status === "insufficient";
              return (
                // The evidence sentence can be long, so it wraps under the
                // ingredient on narrow screens instead of crowding it.
                <div
                  key={ingredient.id}
                  className="row min-h-0 flex-col items-start gap-1 py-3.5 sm:flex-row sm:items-baseline sm:gap-5"
                >
                  <span
                    className={cn(
                      "bd min-w-0 sm:flex-1",
                      copy.dim ? "text-[var(--ink-4)]" : short ? "text-[var(--ink-3)]" : "text-[var(--ink-2)]",
                    )}
                  >
                    {ingredient.display}
                  </span>
                  <span
                    className={cn(
                      "m text-[10.5px] leading-relaxed sm:max-w-[55%] sm:text-right",
                      short ? "text-[var(--accent)]" : copy.dim ? "text-[var(--ink-6)]" : "text-[var(--ink-4)]",
                    )}
                  >
                    {item?.substitution
                      ? `Use ${item.substitution.matchedName} instead of ${item.substitution.requestedName}. ${item.substitution.guidance}`
                      : item?.detail ?? copy.label}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>

        <Section label="method" labelWidth="66px">
          <ol className="flex flex-col gap-3">
            {recipe.steps.map((step, index) => (
              <li key={`${index}-${step}`} className="flex items-start gap-3.5">
                <span className="disc mt-0.5 !size-8 flex-none">
                  <span className="disc-num !text-[13px]">{index + 1}</span>
                </span>
                <span className="bd pt-1 text-[var(--ink-2)]">{step}</span>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <p className="bd mt-8 text-[12px] text-[var(--ink-6)]">
        An inventory comparison, not a safety check. Dietary tags are preferences — check labels and
        cross-contact yourself.
      </p>

      <section className="mt-7 rounded-[20px] bg-[var(--ground)] p-5" aria-labelledby="recipe-feedback-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="recipe-feedback-title" className="m text-[11px] text-[var(--ink-4)]">
              recipe feedback
            </h2>
            {flagged ? (
              <p role="status" aria-live="polite" className="bd mt-1 text-[12px] text-[var(--ink-5)]">
                {flagSimulated
                  ? "Demo mode simulated this flag; no moderation record was saved."
                  : "Thanks — this recipe has been flagged for review."}
              </p>
            ) : (
              <p className="bd mt-1 text-[12px] text-[var(--ink-5)]">
                Something inaccurate, unsafe, or unclear? Let us know.
              </p>
            )}
          </div>
          {!flagged && !showFlagForm && (
            <Button
              type="button"
              variant="ghost"
              size="small"
              onClick={() => {
                setFlagError(null);
                setShowFlagForm(true);
              }}
            >
              Flag a problem
            </Button>
          )}
        </div>
        {showFlagForm && !flagged && (
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void submitFlag();
            }}
          >
            <label className="bd flex flex-1 flex-col gap-2 text-[12px] text-[var(--ink-4)]">
              What is wrong?
              <select
                ref={flagReasonRef}
                value={flagReason}
                onChange={(event) => setFlagReason(event.target.value as RecipeFlagReason)}
                className="min-h-12 rounded-[16px] bg-[var(--ground-hi)] px-4 text-[14px] text-[var(--ink)]"
              >
                <option value="inaccurate">Ingredients or quantities seem inaccurate</option>
                <option value="unsafe">Method may be unsafe</option>
                <option value="poor_instructions">Instructions are unclear</option>
                <option value="rights_concern">Attribution or rights concern</option>
                <option value="other">Other problem</option>
              </select>
            </label>
            <div className="flex gap-2">
              <Button type="submit" size="small" variant="secondary" busy={flagging}>Submit flag</Button>
              <Button
                type="button"
                size="small"
                variant="ghost"
                onClick={() => {
                  setFlagError(null);
                  setShowFlagForm(false);
                }}
                disabled={flagging}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
        {flagError && <p role="alert" className="bd mt-3 text-[12px] text-[var(--accent)]">{flagError}</p>}
      </section>

      {substitutions.length > 0 && (
        <section
          className="mt-7 rounded-[20px] bg-[var(--ground-hi)] p-5"
          aria-labelledby="substitution-confirmation-title"
        >
          <h2 id="substitution-confirmation-title" className="m text-[11px] text-[var(--accent)]">
            confirm ingredient changes
          </h2>
          <ul className="bd mt-3 list-disc space-y-2 pl-5 text-[13px] text-[var(--ink-3)]">
            {substitutions.map((substitution) => (
              <li key={substitution.ingredientId}>
                Use <strong>{substitution.matchedName}</strong> instead of {substitution.requestedName}. {substitution.guidance}
              </li>
            ))}
          </ul>
          <label className="bd mt-4 flex min-h-11 cursor-pointer items-start gap-3 text-[13px] text-[var(--ink-2)]">
            <input
              type="checkbox"
              className="mt-1 size-5 accent-[var(--accent)]"
              checked={substitutionsConfirmed}
              onChange={(event) => {
                setConfirmedSubstitutionSignature(
                  event.target.checked ? substitutionSignature : "",
                );
                setStartError(null);
              }}
            />
            <span>I reviewed these substitutions and want to cook with them.</span>
          </label>
        </section>
      )}

      {startError && (
        <div className="mt-6">
          <StateNotice title="Could not start cooking" tone="error">
            {startError}
          </StateNotice>
        </div>
      )}

      {listNotice && (
        <p role="status" className="bd mt-6 rounded-[20px] bg-[var(--ground)] px-5 py-4 text-[var(--sage)]">
          {listNotice}
        </p>
      )}
      {listError && (
        <div className="mt-6">
          <StateNotice title="Shopping list needs attention" tone="error">
            {listError}
          </StateNotice>
        </div>
      )}

      <div className="mt-7 flex flex-wrap items-center justify-between gap-5">
        <Button
          busy={starting}
          disabled={!online || (substitutions.length > 0 && !substitutionsConfirmed)}
          onClick={() => void startCooking()}
        >
          <ChefHat className="size-4" aria-hidden="true" /> Cook this
        </Button>
        {!online && (
          <p className="bd text-[12px] text-[var(--accent)]">
            Reconnect to start cooking and keep the shared kitchen consistent.
          </p>
        )}
        <p className="m text-[10.5px] text-[var(--ink-6)]">
          recipe by {recipe.rights.author}
          {recipe.rights.status === "reviewed" && recipe.rights.reviewer
            ? ` · reviewed by ${recipe.rights.reviewer}`
            : preview
              ? " · editorial preview"
              : initialSeed
                ? " · initial catalog seed"
                : ""}
        </p>
      </div>

      {missingIngredients.length > 0 && (
        <section
          className="mt-6 rounded-[20px] bg-[var(--ground)] p-5"
          aria-labelledby="missing-ingredients-title"
        >
          <h2 id="missing-ingredients-title" className="m text-[11px] text-[var(--ink-4)]">
            shopping list
          </h2>
          <p className="bd mt-2 max-w-[30rem] text-[13px] text-[var(--ink-3)]">
            {missingIngredients.length} required ingredient{missingIngredients.length === 1 ? " is" : "s are"} missing or short:{" "}
            {missingIngredients.map((ingredient) => ingredient.name.toLowerCase()).join(", ")}.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="small"
            busy={listBusy}
            disabled={!online}
            className="mt-4"
            onClick={() => void addMissingToShoppingList()}
          >
            <ShoppingBasket className="size-4" aria-hidden="true" /> Add them to the shopping list
          </Button>
        </section>
      )}
    </Page>
  );
}
