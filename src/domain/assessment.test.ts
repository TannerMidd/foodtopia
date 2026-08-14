import { describe, expect, it } from "vitest";
import type {
  HouseholdPreferences,
  InventoryLot,
  Recipe,
  RecipeIngredient,
} from "../contracts/domain";
import {
  DEFAULT_RECIPE_INTENT,
  assessRecipe,
  rankRecipeAssessments,
  suggestRecipes,
} from "./assessment";

const HOUSEHOLD_ID = "10000000-0000-4000-8000-000000000001";

function ingredient(
  id: string,
  foodConceptId: string,
  name: string,
  amount = 1,
  unit = "count",
): RecipeIngredient {
  return {
    id,
    foodConceptId,
    name,
    amount,
    unit,
    display: `${amount} ${unit} ${name}`,
    required: true,
    acceptedForms: ["unspecified", "fresh", "canned", "dried"],
  };
}

function recipe(
  id: string,
  ingredients: RecipeIngredient[],
  overrides: Partial<Recipe> = {},
): Recipe {
  return {
    id,
    slug: id,
    title: `Test ${id}`,
    description: "A deterministic recipe fixture for domain behavior.",
    servings: 2,
    totalMinutes: 20,
    mealTypes: ["dinner"],
    cuisines: ["American"],
    dietaryTags: ["vegetarian"],
    ingredients,
    steps: ["Prepare every listed ingredient carefully.", "Cook until finished."],
    rights: {
      owner: "Foodtopia",
      author: "Foodtopia Editorial",
      reviewer: null,
      reviewedAt: null,
      status: "draft",
    },
    ...overrides,
  };
}

function lot(
  sequence: number,
  foodConceptId: string | null,
  name: string,
  quantityStatus: InventoryLot["quantityStatus"],
  quantity: number | null,
  unit: string | null,
  overrides: Partial<InventoryLot> = {},
): InventoryLot {
  return {
    id: `20000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    householdId: HOUSEHOLD_ID,
    foodConceptId,
    name,
    category: "Test",
    quantityStatus,
    quantity,
    unit,
    form: "unspecified",
    location: "pantry",
    dateLabelType: null,
    dateLabel: null,
    status: "active",
    version: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const noPreferences: HouseholdPreferences = {
  staples: [],
  dietaryTags: [],
  excludedConceptIds: [],
};

describe("recipe assessment", () => {
  it("proves Ready only from sufficient known quantities", () => {
    const target = recipe("known-ready", [
      ingredient("rice", "rice", "rice", 1, "cup"),
      ingredient("beans", "black-beans", "black beans", 8, "oz"),
    ]);
    const assessment = assessRecipe(
      target,
      [
        lot(1, "rice", "rice", "known", 16, "tbsp"),
        lot(2, "black-beans", "black beans", "known", 0.5, "lb"),
      ],
      noPreferences,
      DEFAULT_RECIPE_INTENT,
      { now: "2026-08-13T00:00:00.000Z" },
    );

    expect(assessment.tier).toBe("ready");
    expect(assessment.missingCount).toBe(0);
    expect(assessment.evidence.map((item) => item.status)).toEqual([
      "present_sufficient",
      "present_sufficient",
    ]);
  });

  it.each(["unknown", "estimated"] as const)(
    "keeps %s quantities in Likely ready",
    (quantityStatus) => {
      const target = recipe("quantity-uncertain", [
        ingredient("rice", "rice", "rice", 1, "cup"),
        ingredient("beans", "black-beans", "black beans", 8, "oz"),
      ]);
      const uncertainLot =
        quantityStatus === "unknown"
          ? lot(3, "rice", "rice", quantityStatus, null, null)
          : lot(3, "rice", "rice", quantityStatus, 2, "cup");
      const assessment = assessRecipe(
        target,
        [
          uncertainLot,
          lot(4, "black-beans", "black beans", "known", 8, "oz"),
        ],
        noPreferences,
      );

      expect(assessment.tier).toBe("likely_ready");
      expect(assessment.unknownQuantityCount).toBe(1);
      expect(assessment.evidence[0].status).toBe(
        "present_quantity_unknown",
      );
    },
  );

  it("does not use a cross-family quantity as proof", () => {
    const target = recipe("cross-family", [
      ingredient("rice", "rice", "rice", 1, "cup"),
      ingredient("beans", "black-beans", "black beans", 8, "oz"),
    ]);
    const assessment = assessRecipe(
      target,
      [
        lot(5, "rice", "rice", "known", 200, "g"),
        lot(6, "black-beans", "black beans", "known", 8, "oz"),
      ],
      noPreferences,
    );

    expect(assessment.tier).toBe("likely_ready");
    expect(assessment.evidence[0].status).toBe(
      "present_quantity_unknown",
    );
  });

  it("does not match a custom/name-only lot to a global recipe concept", () => {
    const target = recipe("ambiguous-name", [
      ingredient("rice", "rice", "rice", 1, "cup"),
      ingredient("salt", "salt", "salt", 1, "tsp"),
    ]);
    const assessment = assessRecipe(
      target,
      [
        lot(12, null, "rice", "known", 1, "cup"),
        lot(13, "salt", "salt", "known", 1, "tsp"),
      ],
      noPreferences,
    );

    expect(assessment.tier).toBe("almost_ready");
    expect(assessment.missingCount).toBe(1);
    expect(assessment.evidence[0].status).toBe("missing");
  });

  it("counts missing and insufficient required ingredients as Almost ready", () => {
    const target = recipe("almost", [
      ingredient("rice", "rice", "rice", 1, "cup"),
      ingredient("beans", "black-beans", "black beans", 8, "oz"),
    ]);
    const assessment = assessRecipe(
      target,
      [lot(7, "rice", "rice", "known", 0.5, "cup")],
      noPreferences,
    );

    expect(assessment.tier).toBe("almost_ready");
    expect(assessment.missingCount).toBe(2);
    expect(assessment.evidence.map((item) => item.status)).toEqual([
      "insufficient",
      "missing",
    ]);
  });

  it("uses only the household's editable staple list", () => {
    const target = recipe("staples", [
      ingredient("salt", "salt", "salt", 1, "tsp"),
      ingredient("eggs", "eggs", "eggs", 2, "count"),
    ]);
    const eggs = lot(8, "eggs", "eggs", "known", 2, "count");

    expect(assessRecipe(target, [eggs], noPreferences).tier).toBe(
      "almost_ready",
    );
    const withSaltStaple = assessRecipe(target, [eggs], {
      ...noPreferences,
      staples: ["salt"],
    });
    expect(withSaltStaple.tier).toBe("ready");
    expect(withSaltStaple.evidence[0].status).toBe("assumed_staple");
  });

  it("makes hard exclusions and unmet dietary tags incompatible", () => {
    const target = recipe("incompatible", [
      ingredient("eggs", "eggs", "eggs", 2, "count"),
      ingredient("salt", "salt", "salt", 1, "tsp"),
    ]);
    const assessment = assessRecipe(target, [], {
      staples: [],
      dietaryTags: ["vegan"],
      excludedConceptIds: ["eggs"],
    });

    expect(assessment.tier).toBe("incompatible");
    expect(assessment.explanation).toContain("excluded eggs");
    expect(assessment.explanation).toContain("vegan");
  });

  it("omits returned matches with more than two required gaps", () => {
    const target = recipe("too-many-gaps", [
      ingredient("rice", "rice", "rice"),
      ingredient("beans", "black-beans", "black beans"),
      ingredient("onion", "onion", "onion"),
    ]);

    expect(
      suggestRecipes([target], [], noPreferences, DEFAULT_RECIPE_INTENT),
    ).toEqual([]);
  });

  it("ranks deterministically by tier, gaps, urgency, unknowns, prompt fit, time, and ID", () => {
    const ingredients = [
      ingredient("rice", "rice", "rice", 1, "cup"),
      ingredient("salt", "salt", "salt", 1, "tsp"),
    ];
    const knownRice = lot(9, "rice", "rice", "known", 2, "cup", {
      dateLabelType: "best_before",
      dateLabel: "2026-08-14",
    });
    const knownSalt = lot(11, "salt", "salt", "known", 2, "tsp");
    const readyDraft = assessRecipe(
      recipe("ready-draft", ingredients, { totalMinutes: 10 }),
      [knownRice, knownSalt],
      noPreferences,
      DEFAULT_RECIPE_INTENT,
      { now: "2026-08-13T00:00:00.000Z" },
    );
    const readyReviewed = assessRecipe(
      recipe("ready-reviewed", ingredients, {
        totalMinutes: 30,
        rights: {
          owner: "Foodtopia",
          author: "Foodtopia Editorial",
          reviewer: "Test Reviewer",
          reviewedAt: "2026-08-13",
          status: "reviewed",
        },
      }),
      [knownRice, knownSalt],
      noPreferences,
      DEFAULT_RECIPE_INTENT,
      { now: "2026-08-13T00:00:00.000Z" },
    );
    const likely = assessRecipe(
      recipe("likely", ingredients),
      [
        lot(10, "rice", "rice", "unknown", null, null),
        knownSalt,
      ],
      noPreferences,
    );

    expect(
      rankRecipeAssessments([likely, readyDraft, readyReviewed]).map(
        (item) => item.recipe.id,
      ),
    ).toEqual(["ready-draft", "ready-reviewed", "likely"]);
  });

  it("uses the parsed prompt as a deterministic soft ranking signal", () => {
    const mild = recipe("a-mild", [
      ingredient("cucumber", "cucumber", "cucumber"),
      ingredient("salt", "salt", "salt", 1, "tsp"),
    ]);
    const spicy = recipe("z-spicy", [
      ingredient("beans", "black-beans", "black beans"),
      ingredient("chili", "chili-powder", "chili powder", 1, "tsp"),
    ]);
    const inventory = [
      lot(20, "cucumber", "cucumber", "known", 1, "count"),
      lot(21, "salt", "salt", "known", 1, "tsp"),
      lot(22, "black-beans", "black beans", "known", 1, "count"),
      lot(23, "chili-powder", "chili powder", "known", 1, "tsp"),
    ];
    const intent = {
      ...DEFAULT_RECIPE_INTENT,
      query: "spicy vegetarian dinner",
      mealTypes: ["dinner"],
      dietaryTags: ["vegetarian"],
    };

    expect(
      suggestRecipes([mild, spicy], inventory, noPreferences, intent).map(
        (item) => item.recipe.id,
      ),
    ).toEqual(["z-spicy", "a-mild"]);
  });
});
