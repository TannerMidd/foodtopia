"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChefHat, Clock3, HelpCircle, ShoppingBasket, Users } from "lucide-react";
import type { IngredientEvidenceStatus, RecipeAssessment } from "@/contracts/domain";
import { createCookSession, recordRecipeOpened } from "@/lib/client/api";
import { loadRecipeAssessment, saveCookSession } from "@/lib/client/recipe-cache";
import { Badge, Button, EmptyState, Page, StateNotice } from "./ui";

const evidenceCopy: Record<IngredientEvidenceStatus, { label: string; tone: "green" | "neutral" | "yellow" | "orange" }> = {
  present_sufficient: { label: "Have enough", tone: "green" },
  present_quantity_unknown: { label: "Present · amount unknown", tone: "yellow" },
  insufficient: { label: "Need more", tone: "orange" },
  missing: { label: "Missing", tone: "orange" },
  ambiguous: { label: "Check item", tone: "yellow" },
  assumed_staple: { label: "Assumed staple", tone: "neutral" },
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

  if (assessment === undefined) return <Page><div className="skeleton h-9 w-48 rounded-2xl" /><div className="skeleton mt-5 h-72 rounded-[2rem]" /></Page>;
  if (!assessment) {
    return <Page><EmptyState icon={<HelpCircle className="size-6" aria-hidden="true" />} title="Open this recipe from suggestions" description="Recipe details are kept only for this browsing session. Search again to restore ingredient evidence." action={<Link href="/recipes" className="inline-flex min-h-12 items-center rounded-full bg-[var(--leaf)] px-5 font-bold text-white">Find recipes</Link>} /></Page>;
  }

  const { recipe, evidence, explanation } = assessment;
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
    <Page>
      <Link href="/recipes" className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[var(--leaf)]"><ArrowLeft className="size-4" aria-hidden="true" /> Back to suggestions</Link>
      <section className="relative overflow-hidden rounded-[2rem] bg-[var(--leaf)] p-6 text-white sm:p-8">
        <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-white/14"><ChefHat className="size-7" aria-hidden="true" /></span>
        <div className="flex flex-wrap gap-2">
          <Badge tone={assessment.tier === "ready" ? "green" : assessment.tier === "likely_ready" ? "yellow" : "orange"}>{assessment.tier === "ready" ? "Ready" : assessment.tier === "likely_ready" ? "Likely ready" : "Almost ready"}</Badge>
          {recipe.rights.status === "draft" && <Badge tone="orange">Editorial preview · not yet human reviewed</Badge>}
        </div>
        <h1 className="mt-4 max-w-xl text-[clamp(2rem,8vw,3.2rem)] font-extrabold leading-[1] tracking-[-0.055em]">{recipe.title}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-white/74">{recipe.description}</p>
        <div className="mt-5 flex flex-wrap gap-4 text-sm font-bold text-white/82"><span className="inline-flex items-center gap-1.5"><Clock3 className="size-4" aria-hidden="true" /> {recipe.totalMinutes} minutes</span><span className="inline-flex items-center gap-1.5"><Users className="size-4" aria-hidden="true" /> {recipe.servings} servings</span></div>
      </section>

      {explanation && <div className="mt-4"><StateNotice title="Why this fits">{explanation}</StateNotice></div>}

      <section className="mt-8">
        <h2 className="text-xl font-extrabold tracking-tight">Ingredient evidence</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">This is a household-inventory comparison, not a safety check.</p>
        <div className="mt-3 overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--card)]">
          {recipe.ingredients.map((ingredient, index) => {
            const item = evidence.find((entry) => entry.ingredientId === ingredient.id);
            const copy = item ? evidenceCopy[item.status] : evidenceCopy.missing;
            return (
              <div key={ingredient.id} className={`flex min-h-20 items-center gap-3 px-4 py-3 ${index ? "border-t border-[var(--line)]" : ""}`}>
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${copy.tone === "green" ? "bg-[var(--sprout)] text-[var(--leaf)]" : "bg-[#f7edc8] text-[#725b13]"}`}>{copy.tone === "green" ? <Check className="size-4" aria-hidden="true" /> : <ShoppingBasket className="size-4" aria-hidden="true" />}</span>
                <div className="min-w-0 flex-1"><p className="font-bold">{ingredient.display}</p><p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">{item?.detail ?? "No matching inventory evidence."}</p></div>
                <Badge tone={copy.tone}>{copy.label}</Badge>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-extrabold tracking-tight">Method</h2>
        <ol className="mt-3 space-y-3">{recipe.steps.map((step, index) => <li key={`${index}-${step}`} className="flex gap-4 rounded-2xl bg-white/48 p-4"><span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--ink)] text-sm font-black text-white">{index + 1}</span><p className="pt-1 text-sm leading-6">{step}</p></li>)}</ol>
      </section>

      <div className="mt-7"><StateNotice title="Allergy reminder" tone="warning">Dietary settings and recipe tags are preferences only. Check every package label, recipe ingredient, and cross-contact risk yourself.</StateNotice></div>
      {startError && <div className="mt-4"><StateNotice title="Couldn’t start cooking" tone="error">{startError}</StateNotice></div>}
      <Button className="mt-5 w-full" busy={starting} onClick={() => void startCooking()}><ChefHat className="size-4" aria-hidden="true" /> Start cooking</Button>
      <p className="mt-3 text-center text-xs text-[var(--muted)]">Recipe by {recipe.rights.author}{recipe.rights.status === "reviewed" && recipe.rights.reviewer ? ` · reviewed by ${recipe.rights.reviewer}` : recipe.rights.status === "draft" ? " · editorial preview" : ""}</p>
    </Page>
  );
}
