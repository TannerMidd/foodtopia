import { describe, expect, it } from "vitest";
import {
  findFoodConceptMentions,
  normalizeFoodLabel,
  resolveFoodConcept,
  resolveFoodIdentity,
} from "./normalization";

describe("food normalization", () => {
  it("normalizes accents, punctuation, and whitespace", () => {
    expect(normalizeFoodLabel("  Jalapeño’s -- PEPPERS  ")).toBe(
      "jalapenos peppers",
    );
  });

  it("resolves explicit aliases to stable global concepts", () => {
    expect(resolveFoodConcept("EVOO")?.id).toBe("olive-oil");
    expect(resolveFoodConcept("garbanzo beans")?.id).toBe("chickpeas");
    expect(resolveFoodConcept("Spaghetti")?.id).toBe("pasta");
  });

  it("does not guess from partial labels", () => {
    expect(resolveFoodConcept("chicken-ish product")).toBeUndefined();
  });

  it("derives identity only for exact known labels and clears unknown ones", () => {
    expect(resolveFoodIdentity("EVOO")).toEqual({
      foodConceptId: "olive-oil",
      category: "Oils",
    });
    expect(resolveFoodIdentity("renamed custom food")).toEqual({
      foodConceptId: null,
      category: "Other",
    });
  });

  it("prefers the most specific mention instead of overlapping aliases", () => {
    const ids = findFoodConceptMentions(
      "Fold the bell pepper into the black beans and add black pepper.",
    ).map((mention) => mention.concept.id);

    expect(ids).toEqual(["bell-pepper", "black-beans", "black-pepper"]);
  });
});
