"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChefHat } from "lucide-react";
import type { RecipeFlagReason } from "@/contracts/api";
import type { IngredientEvidenceStatus, RecipeAssessment } from "@/contracts/domain";
import {
  ApiClientError,
  createCookSession,
  flagRecipe,
  recordRecipeOpened,
} from "@/lib/client/api";
import {
  loadRecipeAssessment,
  saveCookSession,
  saveRecipeAssessment,
} from "@/lib/client/recipe-cache";
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
  const { online } = useOfflineInventory();
  const [assessment, setAssessment] = useState<RecipeAssessment | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [confirmedSubstitutionSignature, setConfirmedSubstitutionSignature] = useState("");
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagReason, setFlagReason] = useState<RecipeFlagReason>("inaccurate");
  const [flagging, setFlagging] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [flagSimulated, setFlagSimulated] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const flagReasonRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const loaded = loadRecipeAssessment(slug);
      setAssessment(loaded);
      if (loaded) void recordRecipeOpened();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [slug]);

  useEffect(() => {
    if (showFlagForm) flagReasonRef.current?.focus();
  }, [showFlagForm]);

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
        <h1 className="hd mt-3 text-[clamp(1.9rem,7vw,2.1rem)]">Open this recipe from the suggestions.</h1>
        <p className="bd mt-3 max-w-md">
          Recipe details are kept only for this browsing session. Search again to restore the
          ingredient evidence.
        </p>
        <Link
          href="/recipes"
          className="glow mt-7 inline-flex min-h-12 items-center rounded-full px-6 text-[15px]"
        >
          Find something to cook
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
      saveRecipeAssessment(session.assessment);
      saveCookSession(slug, session.cookSessionId);
      router.push(`/recipes/${slug}/cook`);
    } catch (caught) {
      if (
        caught instanceof ApiClientError &&
        caught.code === "RECIPE_SUBSTITUTIONS_CHANGED" &&
        caught.latestAssessment
      ) {
        setAssessment(caught.latestAssessment);
        saveRecipeAssessment(caught.latestAssessment);
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
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="chip !py-[7px] !text-[12px]">{recipe.totalMinutes} minutes</span>
          <span className="chip !py-[7px] !text-[12px]">{recipe.servings} servings</span>
          {recipe.dietaryTags.map((tag) => (
            <span key={tag} className="chip !py-[7px] !text-[12px]">
              {tag}
            </span>
          ))}
        </div>
      </header>

      {explanation && <p className="bd mt-6 max-w-[34rem]">{explanation}</p>}

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
    </Page>
  );
}
