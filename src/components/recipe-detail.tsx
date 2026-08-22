"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChefHat } from "lucide-react";
import type { IngredientEvidenceStatus, RecipeAssessment } from "@/contracts/domain";
import { createCookSession, recordRecipeOpened } from "@/lib/client/api";
import { loadRecipeAssessment, saveCookSession } from "@/lib/client/recipe-cache";
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
  const [assessment, setAssessment] = useState<RecipeAssessment | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const loaded = loadRecipeAssessment(slug);
      setAssessment(loaded);
      if (loaded) void recordRecipeOpened();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [slug]);

  if (assessment === undefined) {
    return (
      <Page className="max-w-[44rem]">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton mt-6 h-9 w-80" />
        <div className="skeleton mt-8 h-48" />
      </Page>
    );
  }

  if (!assessment) {
    return (
      <Page className="max-w-[44rem]">
        <p className="ml">cook</p>
        <h1 className="hd mt-3 text-[26px]">Open this recipe from the suggestions.</h1>
        <p className="bd mt-2.5 max-w-md">
          Recipe details are kept only for this browsing session. Search again to restore the
          ingredient evidence.
        </p>
        <Link
          href="/recipes"
          className="glow mt-7 inline-flex min-h-11 items-center rounded-[3px] px-[18px] text-[15px] font-light"
        >
          Find something to cook
        </Link>
      </Page>
    );
  }

  const { recipe, evidence, explanation } = assessment;
  const preview = recipe.rights.status === "draft";

  async function startCooking() {
    setStarting(true);
    setStartError(null);
    try {
      const session = await createCookSession(assessment!);
      saveCookSession(slug, session.cookSessionId);
      router.push(`/recipes/${slug}/cook`);
    } catch (caught) {
      setStartError(caught instanceof Error ? caught.message : "The cooking session could not be started.");
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
          {preview ? " · editorial preview" : ""}
        </p>
        <h1 className="hd mt-3 text-[clamp(1.5rem,6vw,1.65rem)]">{recipe.description}</h1>
        <div className="mt-3.5 flex flex-wrap gap-x-6 gap-y-1.5">
          <span className="m text-[10.5px] text-[var(--ink-4)]">{recipe.totalMinutes} minutes</span>
          <span className="m text-[10.5px] text-[var(--ink-4)]">{recipe.servings} servings</span>
          {recipe.dietaryTags.map((tag) => (
            <span key={tag} className="m text-[10.5px] text-[var(--ink-4)]">
              {tag}
            </span>
          ))}
        </div>
      </header>

      {explanation && <p className="bd mt-6 max-w-[34rem]">{explanation}</p>}

      <div className="mt-10 flex flex-col gap-9">
        <Section label="you have" labelWidth="66px">
          {recipe.ingredients.map((ingredient) => {
            const item = evidence.find((entry) => entry.ingredientId === ingredient.id);
            const copy = item ? evidenceCopy[item.status] : evidenceCopy.missing;
            const short = item?.status === "missing" || item?.status === "insufficient";
            return (
              // The evidence sentence can be long, so it wraps under the
              // ingredient on narrow screens instead of crowding it.
              <div
                key={ingredient.id}
                className="row min-h-[42px] flex-col items-start gap-1 px-1 py-3 sm:flex-row sm:items-baseline sm:gap-5"
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
                    short ? "text-[var(--time)]" : copy.dim ? "text-[var(--ink-6)]" : "text-[var(--ink-4)]",
                  )}
                >
                  {item?.detail ?? copy.label}
                </span>
              </div>
            );
          })}
        </Section>

        <Section label="method" labelWidth="66px">
          <ol className="flex flex-col gap-3.5 pt-3.5">
            {recipe.steps.map((step, index) => (
              <li key={`${index}-${step}`} className="bd text-[var(--ink-2)]">
                {step}
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <p className="bd mt-8 text-[12px] text-[var(--ink-6)]">
        An inventory comparison, not a safety check. Dietary tags are preferences — check labels and
        cross-contact yourself.
      </p>

      {startError && (
        <div className="mt-6">
          <StateNotice title="Could not start cooking" tone="error">
            {startError}
          </StateNotice>
        </div>
      )}

      <div className="mt-7 flex flex-wrap items-center justify-between gap-5">
        <Button busy={starting} onClick={() => void startCooking()}>
          <ChefHat className="size-4 text-[var(--accent-ink)]" aria-hidden="true" /> Cook this
        </Button>
        <p className="m text-[10.5px] text-[var(--ink-6)]">
          recipe by {recipe.rights.author}
          {recipe.rights.status === "reviewed" && recipe.rights.reviewer
            ? ` · reviewed by ${recipe.rights.reviewer}`
            : preview
              ? " · editorial preview"
              : ""}
        </p>
      </div>
    </Page>
  );
}
