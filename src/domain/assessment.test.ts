import { describe, expect, it } from "vitest";
import type {
  HouseholdPreferences,
  InventoryLot,
  Recipe,
  RecipeAssessment,
  RecipeIngredient,
} from "../contracts/domain";
import {
  DEFAULT_RECIPE_INTENT,
  assessRecipe,
  materializeEffectiveAssessment,
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

  it("uses curated chicken substitutions in both directions with provenance", () => {
    const breast = {
      ...ingredient("chicken", "chicken-breast", "chicken breast", 1, "lb"),
      acceptedForms: ["fresh", "frozen"] as RecipeIngredient["acceptedForms"],
    };
    const thigh = {
      ...ingredient("chicken", "chicken-thigh", "chicken thigh", 1, "lb"),
      acceptedForms: ["fresh", "frozen"] as RecipeIngredient["acceptedForms"],
    };
    const thighLot = lot(30, "chicken-thigh", "chicken thighs", "known", 1, "lb", {
      form: "frozen",
    });
    const breastLot = lot(31, "chicken-breast", "chicken breast", "known", 1, "lb", {
      form: "fresh",
    });

    const fromThighs = assessRecipe(recipe("breast-from-thighs", [breast, ingredient("salt", "salt", "salt")]), [thighLot, lot(32, "salt", "salt", "known", 1, "count")], noPreferences);
    const fromBreast = assessRecipe(recipe("thigh-from-breast", [thigh, ingredient("salt", "salt", "salt")]), [breastLot, lot(33, "salt", "salt", "known", 1, "count")], noPreferences);

    expect(fromThighs.tier).toBe("likely_ready");
    expect(fromThighs.substitutionCount).toBe(1);
    expect(fromThighs.evidence[0].substitution).toMatchObject({
      requestedConceptId: "chicken-breast",
      matchedConceptId: "chicken-thigh",
    });
    expect(fromBreast.evidence[0].substitution).toMatchObject({
      requestedConceptId: "chicken-thigh",
      matchedConceptId: "chicken-breast",
    });
  });

  it("prefers exact evidence but can replace an insufficient exact lot", () => {
    const chicken = {
      ...ingredient("chicken", "chicken-breast", "chicken breast", 1, "lb"),
      acceptedForms: ["fresh", "frozen"] as RecipeIngredient["acceptedForms"],
    };
    const target = recipe("exact-first", [chicken, ingredient("salt", "salt", "salt")]);
    const salt = lot(34, "salt", "salt", "known", 1, "count");
    const sufficientBreast = lot(35, "chicken-breast", "chicken breast", "known", 1, "lb", { form: "fresh" });
    const sufficientThigh = lot(36, "chicken-thigh", "chicken thigh", "known", 1, "lb", { form: "fresh" });

    expect(assessRecipe(target, [sufficientBreast, sufficientThigh, salt], noPreferences).evidence[0].substitution).toBeNull();
    const replaced = assessRecipe(target, [
      lot(37, "chicken-breast", "chicken breast", "known", 0.25, "lb", { form: "fresh" }),
      sufficientThigh,
      salt,
    ], noPreferences);
    expect(replaced.evidence[0].status).toBe("present_sufficient");
    expect(replaced.evidence[0].substitution?.matchedConceptId).toBe("chicken-thigh");
  });

  it("keeps substituted unknown quantities unproved and rejects form mismatches", () => {
    const chicken = {
      ...ingredient("chicken", "chicken-breast", "chicken breast", 1, "lb"),
      acceptedForms: ["fresh", "frozen"] as RecipeIngredient["acceptedForms"],
    };
    const target = recipe("substitution-uncertain", [chicken, ingredient("salt", "salt", "salt")]);
    const salt = lot(38, "salt", "salt", "known", 1, "count");
    const unknown = assessRecipe(target, [
      lot(39, "chicken-thigh", "chicken thigh", "unknown", null, null, { form: "frozen" }),
      salt,
    ], noPreferences);
    expect(unknown.evidence[0].status).toBe("present_quantity_unknown");
    expect(unknown.evidence[0].substitution?.matchedConceptId).toBe("chicken-thigh");

    const wrongForm = assessRecipe(target, [
      lot(40, "chicken-thigh", "chicken thigh", "known", 1, "lb", { form: "cooked" }),
      salt,
    ], noPreferences);
    expect(wrongForm.evidence[0].status).toBe("missing");
    expect(wrongForm.evidence[0].substitution).toBeNull();
  });

  it("applies exclusions to the selected substitute and ignores name-only lots", () => {
    const chicken = {
      ...ingredient("chicken", "chicken-breast", "chicken breast", 1, "lb"),
      acceptedForms: ["fresh", "frozen"] as RecipeIngredient["acceptedForms"],
    };
    const target = recipe("excluded-substitute", [chicken, ingredient("salt", "salt", "salt")]);
    const lots = [
      lot(41, "chicken-thigh", "chicken thigh", "known", 1, "lb", { form: "fresh" }),
      lot(42, "salt", "salt", "known", 1, "count"),
    ];
    expect(assessRecipe(target, lots, { ...noPreferences, excludedConceptIds: ["chicken-thigh"] }).tier).toBe("incompatible");
    const nameOnly = assessRecipe(target, [
      lot(43, null, "chicken thighs", "known", 1, "lb", { form: "fresh" }),
      lots[1],
    ], noPreferences);
    expect(nameOnly.evidence[0].status).toBe("missing");
    expect(nameOnly.evidence[0].substitution).toBeNull();
  });

  it("does not pool substitute concepts or chain beyond direct audited rules", () => {
    const beans = {
      ...ingredient("beans", "black-beans", "black beans", 16, "oz"),
      acceptedForms: ["canned", "cooked"] as RecipeIngredient["acceptedForms"],
    };
    const target = recipe("one-substitute", [beans, ingredient("salt", "salt", "salt")]);
    const assessment = assessRecipe(target, [
      lot(44, "kidney-beans", "kidney beans", "known", 8, "oz", { form: "canned" }),
      lot(45, "white-beans", "white beans", "known", 8, "oz", { form: "canned" }),
      lot(46, "chickpeas", "chickpeas", "known", 16, "oz", { form: "canned" }),
      lot(47, "salt", "salt", "known", 1, "count"),
    ], noPreferences);
    expect(assessment.evidence[0].status).toBe("missing");
    expect(assessment.evidence[0].substitution).toBeNull();
  });

  it("chooses an allowed sufficient substitute ahead of unknown or excluded rules", () => {
    const beans = {
      ...ingredient("beans", "black-beans", "black beans", 16, "oz"),
      acceptedForms: ["canned", "cooked"] as RecipeIngredient["acceptedForms"],
    };
    const target = recipe("best-bean-substitute", [beans, ingredient("salt", "salt", "salt")]);
    const assessment = assessRecipe(
      target,
      [
        lot(54, "kidney-beans", "kidney beans", "unknown", null, null, { form: "canned" }),
        lot(55, "white-beans", "white beans", "known", 16, "oz", { form: "canned" }),
        lot(56, "salt", "salt", "known", 1, "count"),
      ],
      { ...noPreferences, excludedConceptIds: ["kidney-beans"] },
    );

    expect(assessment.tier).toBe("likely_ready");
    expect(assessment.evidence[0].substitution?.matchedConceptId).toBe("white-beans");
    expect(assessment.explanation).not.toContain("excluded");
  });

  it("materializes substituted concepts and instructions for the cook snapshot", () => {
    const chicken = {
      ...ingredient("chicken", "chicken-breast", "chicken breast", 1, "lb"),
      display: "1 pound chicken breast, diced",
      acceptedForms: ["fresh", "frozen"] as RecipeIngredient["acceptedForms"],
    };
    const target = recipe("effective-snapshot", [chicken, ingredient("salt", "salt", "salt")], {
      steps: ["Brown the chicken breast.", "Cook the chicken breasts completely with salt."],
    });
    const assessed = assessRecipe(target, [
      lot(52, "chicken-thigh", "chicken thigh", "known", 1, "lb", { form: "fresh" }),
      lot(53, "salt", "salt", "known", 1, "count"),
    ], noPreferences);
    const defaultEffective = materializeEffectiveAssessment(assessed);
    const effective = materializeEffectiveAssessment(assessed, 4);

    expect(defaultEffective.recipe.ingredients[0].display).toBe(
      "1 pound chicken thigh, diced",
    );
    expect(effective.recipe.ingredients[0].display).toBe("2 lb chicken thigh, diced");
    expect(effective.recipe.servings).toBe(4);
    expect(effective.recipe.ingredients[0]).toMatchObject({
      foodConceptId: "chicken-thigh",
      name: "chicken thigh",
      amount: 2,
    });
    expect(effective.recipe.steps.join(" ")).toContain("chicken thigh");
    expect(effective.recipe.steps.slice(1).join(" ")).not.toContain("chicken breast");
    expect(effective.recipe.steps[0]).toContain("Timing may differ");
  });

  it("preserves preparation display copy and replaces reciprocal substitutions once", () => {
    const lemon = {
      ...ingredient("lemon", "lemon", "lemon", 1, "count"),
      display: "1 lemon, juiced",
      acceptedForms: ["fresh"] as RecipeIngredient["acceptedForms"],
    };
    const lime = {
      ...ingredient("lime", "lime", "lime", 1, "count"),
      display: "1 lime, cut into wedges",
      acceptedForms: ["fresh"] as RecipeIngredient["acceptedForms"],
    };
    const target = recipe("reciprocal-citrus", [lemon, lime], {
      steps: ["Juice the lemon and garnish with the lime.", "Serve the lemon and lime together."],
    });
    const assessed = assessRecipe(
      target,
      [
        lot(57, "lime", "lime", "known", 1, "count", { form: "fresh" }),
        lot(58, "lemon", "lemon", "known", 1, "count", { form: "fresh" }),
      ],
      noPreferences,
    );
    // Force the direct reciprocal rules because exact inventory normally wins.
    const reciprocal = {
      ...assessed,
      substitutionCount: 2,
      evidence: assessed.evidence.map((item) => ({
        ...item,
        substitution:
          item.ingredientId === "lemon"
            ? {
                requestedConceptId: "lemon",
                requestedName: "lemon",
                matchedConceptId: "lime",
                matchedName: "lime",
                guidance: "Use lime.",
              }
            : {
                requestedConceptId: "lime",
                requestedName: "lime",
                matchedConceptId: "lemon",
                matchedName: "lemon",
                guidance: "Use lemon.",
              },
      })),
    } satisfies RecipeAssessment;
    const effective = materializeEffectiveAssessment(reciprocal);

    expect(effective.recipe.ingredients[0].display).toBe("1 lime, juiced");
    expect(effective.recipe.ingredients[1].display).toBe("1 lemon, cut into wedges");
    expect(effective.recipe.steps.slice(2)).toEqual([
      "Juice the lime and garnish with the lemon.",
      "Serve the lime and lemon together.",
    ]);
    expect(effective.recipe.steps[0]).toMatch(/^Substitution note:/);
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

  it("ranks an exact likely match ahead of a substituted likely match", () => {
    const chicken = {
      ...ingredient("chicken", "chicken-breast", "chicken breast", 1, "lb"),
      acceptedForms: ["fresh", "frozen"] as RecipeIngredient["acceptedForms"],
    };
    const salt = ingredient("salt", "salt", "salt");
    const exactUnknown = assessRecipe(
      recipe("z-exact", [chicken, salt]),
      [
        lot(48, "chicken-breast", "chicken breast", "unknown", null, null, { form: "fresh" }),
        lot(49, "salt", "salt", "known", 1, "count"),
      ],
      noPreferences,
    );
    const substituted = assessRecipe(
      recipe("a-substituted", [chicken, salt]),
      [
        lot(50, "chicken-thigh", "chicken thigh", "known", 1, "lb", { form: "fresh" }),
        lot(51, "salt", "salt", "known", 1, "count"),
      ],
      noPreferences,
    );
    expect(rankRecipeAssessments([substituted, exactUnknown]).map((item) => item.recipe.id)).toEqual([
      "z-exact",
      "a-substituted",
    ]);
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
