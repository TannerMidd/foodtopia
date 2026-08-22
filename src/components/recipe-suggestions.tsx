"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { IngredientEvidenceStatus, RecipeAssessment, RecipeTier } from "@/contracts/domain";
import type { RecipeSuggestionResponse } from "@/contracts/api";
import { getRecipeSuggestions } from "@/lib/client/api";
import { saveRecipeAssessment } from "@/lib/client/recipe-cache";
import { useOfflineInventory } from "./offline-provider";
import { Button, Page, Section, StateNotice, cn } from "./ui";

const evidenceLabels: Record<IngredientEvidenceStatus, string> = {
  present_sufficient: "Have it",
  present_quantity_unknown: "Amount unknown",
  insufficient: "Need more",
  missing: "Missing",
  ambiguous: "Check this",
  assumed_staple: "Staple",
};

const tierCopy: Record<RecipeTier, { label: string; description: string }> = {
  ready: {
    label: "ready",
    description: "Everything required is known present, in a usable form and amount.",
  },
  likely_ready: {
    label: "likely ready",
    description: "The foods appear present, but one or more amounts are not tracked.",
  },
  almost_ready: {
    label: "almost ready",
    description: "A small number of required ingredients are missing or insufficient.",
  },
  incompatible: {
    label: "not a fit",
    description: "This recipe conflicts with the request or with known preferences.",
  },
};

const starters = [
  "dinner in 30",
  "use the vegetables",
  "a filling breakfast",
  "something to share",
];

/** The one line that says why this recipe is on the list. */
function reasonFor(assessment: RecipeAssessment) {
  const { tier, evidence, missingCount } = assessment;
  if (tier === "ready") return "Everything it needs is on the shelves.";
  if (tier === "likely_ready") {
    const untracked = evidence.find((item) => item.status === "present_quantity_unknown");
    return untracked
      ? `All present — the ${untracked.ingredientName.toLowerCase()} amount isn't tracked.`
      : "All present, though one amount isn't tracked.";
  }
  const short = evidence.filter((item) => item.status === "missing" || item.status === "insufficient");
  if (short.length === 1) return `Short one thing: ${short[0].ingredientName.toLowerCase()}.`;
  if (short.length > 1)
    return `Short ${short.length} things: ${short.map((item) => item.ingredientName.toLowerCase()).join(", ")}.`;
  return `${missingCount} ingredient${missingCount === 1 ? "" : "s"} to sort out.`;
}

function RecipeRow({
  assessment,
  lit,
  onOpen,
}: {
  assessment: RecipeAssessment;
  lit: boolean;
  onOpen: () => void;
}) {
  const { recipe, tier, evidence } = assessment;
  const notes = evidence.filter((item) => item.status !== "present_sufficient").slice(0, 3);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${recipe.title}`}
      className={cn(
        "block w-full border-b border-[var(--hairline)] py-4 pr-1 text-left transition last:border-b-0 hover:bg-[var(--ground-hi)]",
        lit ? "pl-4 shadow-[inset_3px_0_0_-1px_var(--accent-solid)]" : "pl-4",
      )}
    >
      <div className="flex items-baseline justify-between gap-3.5">
        <span className={cn("nm text-[16px]", tier === "almost_ready" && "text-[var(--ink-3)]")}>
          {recipe.title}
        </span>
        <span
          className={cn(
            "m flex-none text-[10.5px]",
            tier === "almost_ready" ? "text-[var(--ink-6)]" : "text-[var(--ink-4)]",
          )}
        >
          {recipe.totalMinutes} min · {recipe.servings}
        </span>
      </div>
      <p className={cn("bd mt-1.5 text-[12.5px]", tier === "almost_ready" && "text-[var(--ink-6)]")}>
        {reasonFor(assessment)}
      </p>
      {notes.length > 0 && (
        <p className="m mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[10.5px] text-[var(--ink-6)]">
          {notes.map((item) => (
            <span key={item.ingredientId}>
              {item.ingredientName} · {evidenceLabels[item.status]}
            </span>
          ))}
        </p>
      )}
    </button>
  );
}

export function RecipeSuggestions() {
  const router = useRouter();
  const { online, lots, hydrated } = useOfflineInventory();
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState<RecipeSuggestionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchRecipes(value = prompt) {
    const nextPrompt = value.trim();
    if (!nextPrompt) {
      setError("Tell Foodtopia what sounds good tonight.");
      return;
    }
    if (!online) {
      setError("Recipe retrieval needs a connection. The kitchen remains available offline.");
      return;
    }
    setPrompt(nextPrompt);
    setLoading(true);
    setError(null);
    try {
      setResponse(await getRecipeSuggestions(nextPrompt));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recipes could not be retrieved.");
    } finally {
      setLoading(false);
    }
  }

  function openRecipe(assessment: RecipeAssessment) {
    saveRecipeAssessment(assessment);
    router.push(`/recipes/${assessment.recipe.slug}`);
  }

  const tiers: RecipeTier[] = ["ready", "likely_ready", "almost_ready"];
  const groups = response
    ? tiers
        .map((tier) => ({
          tier,
          assessments: response.assessments.filter((item) => item.tier === tier),
        }))
        .filter((group) => group.assessments.length > 0)
    : [];

  const intent = response?.parsedIntent;
  const understood = intent
    ? [
        intent.maxMinutes ? `${intent.maxMinutes} min max` : null,
        intent.servings ? `${intent.servings} servings` : null,
        ...intent.mealTypes,
        ...intent.cuisines,
        ...intent.dietaryTags.map((tag) => `${tag} preference`),
      ].filter((value): value is string => Boolean(value))
    : [];

  return (
    <Page className="max-w-[46rem]">
      <header>
        <p className="ml">cook</p>
        <h1 className="hd mt-3 text-[clamp(1.6rem,6vw,1.75rem)]">What sounds good?</h1>
      </header>

      {/* The request line: one lit rule, the count in mono. */}
      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("prompt");
          void searchRecipes(typeof value === "string" ? value : "");
        }}
      >
        <label htmlFor="recipe-prompt" className="sr-only">
          What sounds good?
        </label>
        <div className="flex items-start gap-3 border-b border-[var(--accent-line)] pb-3">
          <Search className="mt-1.5 size-4 flex-none text-[var(--accent)]" aria-hidden="true" />
          <textarea
            name="prompt"
            id="recipe-prompt"
            rows={2}
            maxLength={500}
            disabled={!hydrated}
            className="bd w-full resize-none bg-transparent text-[var(--ink)] focus:outline-none disabled:cursor-wait disabled:opacity-60"
            placeholder="something cozy, vegetarian, under 30 minutes"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <span className="m mt-1.5 flex-none text-[10.5px] text-[var(--ink-6)]">{prompt.length}/500</span>
        </div>
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {starters.map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                onClick={() => void searchRecipes(suggestion)}
                disabled={!online || !hydrated}
                className="m min-h-8 text-[10.5px] text-[var(--ink-4)] hover:text-[var(--ink)] disabled:cursor-wait disabled:opacity-45"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <Button type="submit" size="small" disabled={!online || !hydrated} busy={loading}>
            Find recipes
          </Button>
        </div>
      </form>

      {!online && (
        <div className="mt-6">
          <StateNotice title="Recipes need connectivity" tone="warning">
            Previously opened screens stay available, but retrieving and interpreting a new request
            happens online.
          </StateNotice>
        </div>
      )}
      {error && (
        <div className="mt-6">
          <StateNotice title="No recipes found" tone="error">
            {error}
          </StateNotice>
        </div>
      )}

      {!response && !loading && !error && (
        <p className="bd mt-9 max-w-[30rem] text-[var(--ink-4)]">
          {lots.some((lot) => lot.status === "active")
            ? "Include time, cuisine, meal, servings, or the foods you want to use. Every result explains what is present, uncertain, or missing."
            : "Recipes can still be browsed, but inventory evidence stays limited until the kitchen has items."}
        </p>
      )}

      {loading && (
        <div className="mt-9 space-y-3" aria-label="Finding recipes">
          <div className="skeleton h-20" />
          <div className="skeleton h-20" />
        </div>
      )}

      {response && !loading && (
        <div className="mt-10 flex flex-col gap-9">
          <Section label="understood" labelWidth="74px">
            <p className="m flex flex-wrap gap-x-5 gap-y-1.5 py-3.5 text-[10.5px] text-[var(--ink-4)]">
              {understood.length ? (
                understood.map((item) => <span key={item}>{item}</span>)
              ) : (
                <span>no extra filters inferred</span>
              )}
            </p>
          </Section>

          {groups.map((group) => (
            <Section
              key={group.tier}
              label={tierCopy[group.tier].label}
              meta={String(group.assessments.length)}
              labelWidth="74px"
            >
              {group.assessments.map((assessment, index) => (
                <RecipeRow
                  key={assessment.recipe.id}
                  assessment={assessment}
                  lit={group.tier === "ready" && index === 0}
                  onOpen={() => openRecipe(assessment)}
                />
              ))}
            </Section>
          ))}

          {!groups.length && (
            <p className="bd border-t border-[var(--hairline)] py-8 text-[var(--ink-4)]">
              No feasible recipes this time. Try a broader request, or update the kitchen — Foodtopia
              will not invent a recipe to fill the gap.
            </p>
          )}

          <p className="bd border-t border-[var(--hairline)] pt-4 text-[12px] text-[var(--time)]">
            {response.allergyNotice} Preferences only rank suggestions. They are not allergy controls —
            check every package label, ingredient and cross-contact risk yourself.
          </p>
        </div>
      )}
    </Page>
  );
}
