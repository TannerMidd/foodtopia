import type { FoodForm } from "../contracts/domain";

export type IngredientSubstitutionRule = Readonly<{
  requestedConceptId: string;
  matchedConceptId: string;
  acceptedForms: readonly FoodForm[];
  guidance: string;
}>;

const defineRule = (
  requestedConceptId: string,
  matchedConceptId: string,
  acceptedForms: readonly FoodForm[],
  guidance: string,
): IngredientSubstitutionRule => ({
  requestedConceptId,
  matchedConceptId,
  acceptedForms,
  guidance,
});

/**
 * Audited, directed culinary alternatives. These are never food identity aliases:
 * assessment may use one direct rule only and cooking still requires confirmation.
 */
export const INGREDIENT_SUBSTITUTION_RULES = [
  defineRule(
    "chicken-breast",
    "chicken-thigh",
    ["fresh", "frozen"],
    "Use the same weight of chicken thighs; thaw before cooking when frozen and cook until fully done. Timing may differ.",
  ),
  defineRule(
    "chicken-thigh",
    "chicken-breast",
    ["fresh", "frozen"],
    "Use the same weight of chicken breast; thaw before cooking when frozen and cook until fully done. Timing may differ.",
  ),
  defineRule(
    "olive-oil",
    "vegetable-oil",
    ["opened", "unspecified"],
    "Use the same measured amount of neutral vegetable oil; the flavor will be milder.",
  ),
  defineRule(
    "vegetable-oil",
    "olive-oil",
    ["opened", "unspecified"],
    "Use the same measured amount of olive oil; its flavor may be more noticeable.",
  ),
  defineRule(
    "lemon",
    "lime",
    ["fresh", "opened"],
    "Use the same count or measured amount of lime; the citrus flavor will change slightly.",
  ),
  defineRule(
    "lime",
    "lemon",
    ["fresh", "opened"],
    "Use the same count or measured amount of lemon; the citrus flavor will change slightly.",
  ),
  ...["black-beans", "kidney-beans", "white-beans"].flatMap((requestedConceptId) =>
    ["black-beans", "kidney-beans", "white-beans"]
      .filter((matchedConceptId) => matchedConceptId !== requestedConceptId)
      .map((matchedConceptId) =>
        defineRule(
          requestedConceptId,
          matchedConceptId,
          ["canned", "cooked", "opened"],
          "Use the same measured amount of cooked or canned beans; drain them when the recipe calls for drained beans.",
        ),
      ),
  ),
] as const satisfies readonly IngredientSubstitutionRule[];

const rulesByRequestedConcept = new Map<string, readonly IngredientSubstitutionRule[]>(
  [...new Set(INGREDIENT_SUBSTITUTION_RULES.map((rule) => rule.requestedConceptId))].map(
    (requestedConceptId) => [
      requestedConceptId,
      INGREDIENT_SUBSTITUTION_RULES.filter(
        (rule) => rule.requestedConceptId === requestedConceptId,
      ),
    ],
  ),
);

export function substitutionRulesFor(
  requestedConceptId: string,
): readonly IngredientSubstitutionRule[] {
  return rulesByRequestedConcept.get(requestedConceptId) ?? [];
}
