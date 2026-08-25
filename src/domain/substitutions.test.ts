import { describe, expect, it } from "vitest";
import { FOOD_CONCEPT_BY_ID } from "./concepts";
import { INGREDIENT_SUBSTITUTION_RULES, substitutionRulesFor } from "./substitutions";

describe("curated ingredient substitutions", () => {
  it("contains unique directed rules between known, distinct concepts", () => {
    const keys = INGREDIENT_SUBSTITUTION_RULES.map(
      (rule) => `${rule.requestedConceptId}->${rule.matchedConceptId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    for (const rule of INGREDIENT_SUBSTITUTION_RULES) {
      expect(FOOD_CONCEPT_BY_ID.has(rule.requestedConceptId)).toBe(true);
      expect(FOOD_CONCEPT_BY_ID.has(rule.matchedConceptId)).toBe(true);
      expect(rule.requestedConceptId).not.toBe(rule.matchedConceptId);
      expect(rule.acceptedForms.length).toBeGreaterThan(0);
      expect(rule.guidance.length).toBeGreaterThan(10);
    }
  });

  it("returns only direct rules for the requested concept", () => {
    expect(substitutionRulesFor("chicken-breast").map((rule) => rule.matchedConceptId)).toEqual([
      "chicken-thigh",
    ]);
    expect(substitutionRulesFor("rice")).toEqual([]);
  });
});
