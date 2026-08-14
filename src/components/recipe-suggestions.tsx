"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChefHat,
  Clock3,
  HelpCircle,
  Search,
  ShoppingBasket,
  Sparkles,
  Users,
  WifiOff,
} from "lucide-react";
import type {
  IngredientEvidenceStatus,
  RecipeAssessment,
  RecipeTier,
} from "@/contracts/domain";
import type { RecipeSuggestionResponse } from "@/contracts/api";
import { getRecipeSuggestions } from "@/lib/client/api";
import { saveRecipeAssessment } from "@/lib/client/recipe-cache";
import { useOfflineInventory } from "./offline-provider";
import { Badge, Button, Card, EmptyState, Page, PageHeader, StateNotice } from "./ui";

const evidenceLabels: Record<IngredientEvidenceStatus, { label: string; tone: "green" | "neutral" | "yellow" | "orange" }> = {
  present_sufficient: { label: "Have it", tone: "green" },
  present_quantity_unknown: { label: "Amount unknown", tone: "yellow" },
  insufficient: { label: "Need more", tone: "orange" },
  missing: { label: "Missing", tone: "orange" },
  ambiguous: { label: "Check this", tone: "yellow" },
  assumed_staple: { label: "Staple", tone: "neutral" },
};

const tierCopy: Record<RecipeTier, { label: string; description: string; tone: "green" | "yellow" | "orange" | "neutral" }> = {
  ready: { label: "Ready", description: "All required ingredients are known present in a usable form and amount.", tone: "green" },
  likely_ready: { label: "Likely ready", description: "Required foods appear present, but one or more amounts are not tracked.", tone: "yellow" },
  almost_ready: { label: "Almost ready", description: "A small number of required ingredients are missing or insufficient.", tone: "orange" },
  incompatible: { label: "Not a fit", description: "This recipe conflicts with the request or known preferences.", tone: "neutral" },
};

function RecipeCard({ assessment, onOpen }: { assessment: RecipeAssessment; onOpen: () => void }) {
  const { recipe, tier, evidence, missingCount } = assessment;
  return (
    <Card className="overflow-hidden p-0">
      <button type="button" className="w-full p-5 text-left" onClick={onOpen} aria-label={`Open ${recipe.title}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Badge tone={tierCopy[tier].tone}>{tierCopy[tier].label}</Badge>
            <h3 className="mt-3 text-xl font-extrabold tracking-[-0.03em]">{recipe.title}</h3>
          </div>
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--sprout)] text-[var(--leaf)]"><ArrowRight className="size-4" aria-hidden="true" /></span>
        </div>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--muted)]">{recipe.description}</p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold text-[var(--muted)]">
          <span className="inline-flex items-center gap-1"><Clock3 className="size-4" aria-hidden="true" /> {recipe.totalMinutes} min</span>
          <span className="inline-flex items-center gap-1"><Users className="size-4" aria-hidden="true" /> {recipe.servings} servings</span>
          {missingCount > 0 && <span className="inline-flex items-center gap-1 text-[#98442f]"><ShoppingBasket className="size-4" aria-hidden="true" /> {missingCount} missing</span>}
        </div>
      </button>
      <div className="border-t border-[var(--line)] bg-[#fbf8f0] px-5 py-3">
        <div className="flex flex-wrap gap-1.5">
          {evidence.filter((item) => item.status !== "present_sufficient").slice(0, 4).map((item) => (
            <span key={item.ingredientId} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
              {item.ingredientName} · {evidenceLabels[item.status].label}
            </span>
          ))}
          {evidence.every((item) => item.status === "present_sufficient") && <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--leaf)]"><Check className="size-4" aria-hidden="true" /> Required ingredients accounted for</span>}
        </div>
      </div>
    </Card>
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
      setError("Recipe retrieval needs a connection. Your inventory remains available offline.");
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

  const groups: Array<{ tier: RecipeTier; title: string; assessments: RecipeAssessment[] }> = response
    ? [
        { tier: "ready", title: "Ready", assessments: response.assessments.filter((item) => item.tier === "ready") },
        { tier: "likely_ready", title: "Likely ready", assessments: response.assessments.filter((item) => item.tier === "likely_ready") },
        { tier: "almost_ready", title: "Almost ready", assessments: response.assessments.filter((item) => item.tier === "almost_ready") },
      ]
    : [];

  return (
    <Page>
      <PageHeader eyebrow="From your kitchen" title="What should we cook?" description="Ask in plain English. Foodtopia searches original editorial preview recipes and explains every ingredient match." />

      <Card className="border-0 bg-[var(--leaf)] p-4 text-white sm:p-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("prompt");
            void searchRecipes(typeof value === "string" ? value : "");
          }}
        >
          <label htmlFor="recipe-prompt" className="mb-2 block text-sm font-bold">What sounds good?</label>
          <textarea name="prompt" id="recipe-prompt" rows={3} maxLength={500} disabled={!hydrated} className="w-full resize-none rounded-2xl border border-white/16 bg-white/10 px-4 py-3 text-base text-white placeholder:text-white/55 focus:bg-white/14 focus:outline-none disabled:cursor-wait disabled:opacity-60" placeholder="Something cozy, vegetarian, and under 30 minutes" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-white/65">{prompt.length}/500</span>
            <Button type="submit" className="bg-[var(--tomato)] hover:bg-[#ed785f]" disabled={!online || !hydrated} busy={loading}><Search className="size-4" aria-hidden="true" /> Find recipes</Button>
          </div>
        </form>
      </Card>

      {!online && <div className="mt-3"><StateNotice title="Recipes need connectivity" tone="warning"><span className="inline-flex items-center gap-1"><WifiOff className="size-4" aria-hidden="true" /> Previously opened screens remain available, but retrieving and interpreting a new request happens online.</span></StateNotice></div>}
      {error && <div className="mt-3"><StateNotice title="Couldn’t find recipes" tone="error">{error}</StateNotice></div>}

      {!response && !loading && (
        <section className="mt-7">
          <h2 className="mb-3 text-sm font-extrabold">Try a starting point</h2>
          <div className="flex flex-wrap gap-2">
            {["Dinner in 30 minutes", "Use the vegetables first", "A filling breakfast", "Something the whole household can share"].map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => void searchRecipes(suggestion)} disabled={!online || !hydrated} className="min-h-11 rounded-full border border-[var(--line)] bg-white/65 px-4 text-sm font-semibold text-[var(--leaf)] disabled:cursor-wait disabled:opacity-45">{suggestion}</button>
            ))}
          </div>
          <div className="mt-7">
            <EmptyState icon={<ChefHat className="size-6" aria-hidden="true" />} title={lots.some((lot) => lot.status === "active") ? "Your inventory is ready to search" : "Add food for better matches"} description={lots.some((lot) => lot.status === "active") ? "Include time, cuisine, meal, servings, or foods you want to use." : "Recipe results can still be browsed, but inventory evidence will be limited until the kitchen has items."} />
          </div>
        </section>
      )}

      {loading && <div className="mt-6 space-y-3" aria-label="Finding recipes"><div className="skeleton h-44 rounded-3xl" /><div className="skeleton h-44 rounded-3xl" /></div>}

      {response && !loading && (
        <div className="mt-7">
          <div className="mb-6 rounded-2xl border border-[var(--line)] bg-white/45 p-4">
            <p className="flex items-center gap-2 text-sm font-extrabold"><Sparkles className="size-4 text-[var(--tomato)]" aria-hidden="true" /> Understood request</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
              {response.parsedIntent.maxMinutes && <Badge>{response.parsedIntent.maxMinutes} min max</Badge>}
              {response.parsedIntent.servings && <Badge>{response.parsedIntent.servings} servings</Badge>}
              {response.parsedIntent.mealTypes.map((item) => <Badge key={item}>{item}</Badge>)}
              {response.parsedIntent.cuisines.map((item) => <Badge key={item}>{item}</Badge>)}
              {response.parsedIntent.dietaryTags.map((item) => <Badge key={item}>{item} preference</Badge>)}
              {!response.parsedIntent.maxMinutes && !response.parsedIntent.servings && !response.parsedIntent.mealTypes.length && !response.parsedIntent.cuisines.length && !response.parsedIntent.dietaryTags.length && <span>No extra filters inferred.</span>}
            </div>
          </div>

          {groups.map((group) => group.assessments.length ? (
            <section key={group.tier} className="mb-8">
              <div className="mb-3">
                <h2 className="text-xl font-extrabold tracking-tight">{group.title}</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{tierCopy[group.tier].description}</p>
              </div>
              <div className="space-y-3">{group.assessments.map((assessment) => <RecipeCard key={assessment.recipe.id} assessment={assessment} onOpen={() => openRecipe(assessment)} />)}</div>
            </section>
          ) : null)}

          {!groups.some((group) => group.assessments.length) && <EmptyState icon={<HelpCircle className="size-6" aria-hidden="true" />} title="No feasible recipes this time" description="Try a broader request or update the inventory. Foodtopia won’t invent a recipe to fill the gap." />}

          <StateNotice title="Preferences, not allergy protection" tone="warning">
            {response.allergyNotice} Always check ingredient labels and prevent cross-contact yourself. Foodtopia does not make allergen-safety claims.
          </StateNotice>
        </div>
      )}
    </Page>
  );
}
