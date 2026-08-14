import type { RecipeAssessment } from "@/contracts/domain";

function localExplanation(assessment: RecipeAssessment): string {
  const deterministic = assessment.explanation?.trim();
  if (deterministic) return deterministic;

  switch (assessment.tier) {
    case "ready":
      return "All required ingredients are confirmed or listed as household staples.";
    case "likely_ready":
      return "All required foods appear present, but at least one quantity or identity needs confirmation.";
    case "almost_ready":
      return `${assessment.missingCount} required ingredient${assessment.missingCount === 1 ? " is" : "s are"} missing or insufficient.`;
    case "incompatible":
      return "This recipe does not fit the current household preferences.";
  }
}

/** Provider prose is optional; deterministic assessments remain usable alone. */
export function mergeRecipeExplanations(
  assessments: readonly RecipeAssessment[],
  providerExplanations: ReadonlyMap<string, string>,
): RecipeAssessment[] {
  return assessments.map((assessment) => ({
    ...assessment,
    explanation:
      providerExplanations.get(assessment.recipe.id)?.trim() ||
      localExplanation(assessment),
  }));
}
