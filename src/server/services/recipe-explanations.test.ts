import { describe, expect, it } from "vitest";

import type { RecipeAssessment } from "@/contracts/domain";

import { mergeRecipeExplanations } from "./recipe-explanations";

function assessment(
  id: string,
  explanation: string | null,
  tier: RecipeAssessment["tier"] = "ready",
): RecipeAssessment {
  return {
    recipe: {
      id,
      slug: id,
      title: "Test recipe",
      description: "A deterministic test recipe description.",
      servings: 2,
      totalMinutes: 20,
      mealTypes: ["dinner"],
      cuisines: ["American"],
      dietaryTags: [],
      ingredients: [],
      steps: ["Prepare the ingredients."],
      rights: {
        owner: "Foodtopia",
        author: "Foodtopia Editorial",
        reviewer: null,
        reviewedAt: null,
        status: "draft",
      },
    },
    tier,
    missingCount: tier === "almost_ready" ? 1 : 0,
    unknownQuantityCount: 0,
    usesSoonCount: 0,
    explanation,
    evidence: [],
  };
}

describe("recipe explanation fallback", () => {
  it("uses provider prose when available", () => {
    const result = mergeRecipeExplanations(
      [assessment("tomato-toast", "Deterministic fallback.")],
      new Map([["tomato-toast", "Tailored explanation."]]),
    );

    expect(result[0]?.explanation).toBe("Tailored explanation.");
  });

  it("keeps deterministic matches useful when provider prose is unavailable", () => {
    const result = mergeRecipeExplanations(
      [
        assessment("tomato-toast", "Deterministic fallback."),
        assessment("bean-bowl", null, "almost_ready"),
      ],
      new Map(),
    );

    expect(result.map((item) => item.explanation)).toEqual([
      "Deterministic fallback.",
      "1 required ingredient is missing or insufficient.",
    ]);
  });
});
