import type { RecipeAssessment } from "@/contracts/domain";

const PREFIX = "foodtopia:recipe:";
const COOK_PREFIX = "foodtopia:cook:";

export function saveRecipeAssessment(assessment: RecipeAssessment) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(`${PREFIX}${assessment.recipe.slug}`, JSON.stringify(assessment));
  } catch {
    // A full or disabled session store should not block recipe navigation.
  }
}

export function loadRecipeAssessment(slug: string): RecipeAssessment | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${slug}`);
    return raw ? (JSON.parse(raw) as RecipeAssessment) : null;
  } catch {
    return null;
  }
}

export function saveCookSession(slug: string, sessionId: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(`${COOK_PREFIX}${slug}`, sessionId);
  } catch {
    // A blocked session store is handled by creating a new local session in the cooking UI.
  }
}

export function loadCookSession(slug: string) {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(`${COOK_PREFIX}${slug}`);
  } catch {
    return null;
  }
}
