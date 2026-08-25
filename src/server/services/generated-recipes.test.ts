import { describe, expect, it } from "vitest";

import type { HouseholdPreferences, InventoryLot, RecipeIntent } from "@/contracts/domain";
import { generatedRecipeDraftSchema } from "@/server/ai/contracts";
import {
  buildRecipeGenerationContext,
  validateAndMaterializeGeneratedRecipe,
} from "./generated-recipes";

const intent: RecipeIntent = {
  query: "dinner with chicken and rice",
  maxMinutes: 40,
  servings: 2,
  mealTypes: ["dinner"],
  cuisines: [],
  dietaryTags: [],
  includeConceptIds: [],
  excludeConceptIds: [],
};
const preferences: HouseholdPreferences = {
  staples: ["water", "salt"],
  dietaryTags: [],
  excludedConceptIds: [],
};
const baseLot = {
  householdId: "10000000-0000-4000-8000-000000000001",
  category: "Test",
  quantityStatus: "known" as const,
  dateLabelType: null,
  dateLabel: null,
  status: "active" as const,
  version: 0,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};
const lots: InventoryLot[] = [
  {
    ...baseLot,
    id: "20000000-0000-4000-8000-000000000001",
    foodConceptId: "chicken-thigh",
    name: "Private raw inventory label",
    quantity: 2,
    unit: "lb",
    form: "frozen",
    location: "freezer",
  },
  {
    ...baseLot,
    id: "20000000-0000-4000-8000-000000000002",
    foodConceptId: "rice",
    name: "Secret family rice label",
    quantity: 2,
    unit: "cup",
    form: "dried",
    location: "pantry",
  },
];

const draft = {
  title: "Fully Cooked Chicken Rice",
  description: "A simple chicken thigh and rice dinner made from confirmed foods.",
  servings: 2,
  totalMinutes: 35,
  mealTypes: ["dinner"],
  cuisines: [],
  dietaryTags: [],
  ingredients: [
    {
      foodConceptId: "chicken-thigh",
      name: "chicken thigh",
      amount: 1,
      unit: "lb",
      required: true,
      acceptedForms: ["frozen"],
    },
    {
      foodConceptId: "rice",
      name: "rice",
      amount: 1,
      unit: "cup",
      required: true,
      acceptedForms: ["dried"],
    },
    {
      foodConceptId: "water",
      name: "water",
      amount: null,
      unit: null,
      required: true,
      acceptedForms: ["unspecified"],
    },
  ],
  steps: [
    {
      instruction: "Thaw the chicken thigh. Brown and cook the chicken thigh until fully done in a covered pan.",
      foodConceptIds: ["chicken-thigh"],
    },
    {
      instruction: "Add the rice and water, cover, and simmer until the rice is tender.",
      foodConceptIds: ["rice", "water"],
    },
  ],
} as const;

describe("generated recipe validation", () => {
  it("minimizes inventory context to canonical concepts and coarse known quantities", () => {
    const context = buildRecipeGenerationContext(lots, preferences, intent);
    const serialized = JSON.stringify(context);

    expect(context.foods).toEqual([
      {
        foodConceptId: "chicken-thigh",
        name: "chicken thigh",
        forms: ["frozen"],
        quantities: [{ quantity: 2, unit: "lb", form: "frozen" }],
        unknownQuantityForms: [],
      },
      {
        foodConceptId: "rice",
        name: "rice",
        forms: ["dried"],
        quantities: [{ quantity: 2, unit: "cup", form: "dried" }],
        unknownQuantityForms: [],
      },
    ]);
    expect(context.intent.query).toBe("");
    expect(serialized).not.toContain("dinner with chicken and rice");
    expect(serialized).not.toContain("Private raw inventory label");
    expect(serialized).not.toContain(lots[0].id);
    expect(serialized).not.toContain("freezer");
  });

  it("derives IDs, scope-safe rights, and a deterministic content hash", () => {
    const context = buildRecipeGenerationContext(lots, preferences, intent);
    const result = validateAndMaterializeGeneratedRecipe(
      draft,
      context,
      "12345678-1234-4234-8234-123456789abc",
    );

    expect(result.recipe).toMatchObject({
      id: "generated-12345678-1234-4234-8234-123456789abc",
      rights: {
        owner: "Household",
        author: "AI-assisted household recipe",
        reviewer: null,
        reviewedAt: null,
        status: "draft",
      },
    });
    expect(result.recipe.ingredients.map((item) => item.id)).toEqual([
      "chicken-thigh-1",
      "rice-2",
      "water-3",
    ]);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects model-controlled scope fields and unavailable concepts", () => {
    expect(() => generatedRecipeDraftSchema.parse({ ...draft, householdId: "attacker" })).toThrow();
    const context = buildRecipeGenerationContext(lots, preferences, intent);
    const invented = {
      ...draft,
      ingredients: [
        ...draft.ingredients,
        {
          foodConceptId: "salmon",
          name: "salmon",
          amount: 1,
          unit: "lb",
          required: true,
          acceptedForms: ["fresh"],
        },
      ],
      steps: [
        ...draft.steps,
        { instruction: "Cook the salmon until fully done.", foodConceptIds: ["salmon"] },
      ],
    };
    expect(() => validateAndMaterializeGeneratedRecipe(invented, context)).toThrow(
      /not available/,
    );
  });

  it("rejects raw animal instructions and unsupported preservation", () => {
    const context = buildRecipeGenerationContext(lots, preferences, intent);
    expect(() =>
      validateAndMaterializeGeneratedRecipe(
        {
          ...draft,
          steps: [
            { instruction: "Mix the chicken thigh with rice and water.", foodConceptIds: ["chicken-thigh", "rice", "water"] },
            { instruction: "Serve the chicken thigh raw.", foodConceptIds: ["chicken-thigh"] },
          ],
        },
        context,
      ),
    ).toThrow(/unsafe|fully/i);
    for (const instruction of [
      "Home can the chicken thigh with rice and water.",
      "Mix bleach with the chicken thigh and rice.",
      "Boil the rice in a sealed container.",
      "Leave the chicken thigh at room temperature overnight.",
    ]) {
      expect(() =>
        validateAndMaterializeGeneratedRecipe(
          {
            ...draft,
            steps: [
              { instruction, foodConceptIds: ["chicken-thigh", "rice", "water"] },
              { instruction: "Cook the chicken thigh until fully done.", foodConceptIds: ["chicken-thigh"] },
            ],
          },
          context,
        ),
      ).toThrow(/unsafe/i);
    }
  });

  it("uses structured step references without ambiguous alias guessing", () => {
    const context = buildRecipeGenerationContext(lots, preferences, intent);
    const result = validateAndMaterializeGeneratedRecipe(
      {
        ...draft,
        steps: [
          { instruction: "Toast the rice gently while the pan warms.", foodConceptIds: ["rice"] },
          { instruction: "Cook the chicken thigh with water until fully done.", foodConceptIds: ["chicken-thigh", "water"] },
        ],
      },
      context,
    );
    expect(result.recipe.steps[0]).toContain("Toast the rice");
    expect(() =>
      validateAndMaterializeGeneratedRecipe(
        {
          ...draft,
          steps: [
            ...draft.steps,
            { instruction: "Add salmon at the end.", foodConceptIds: ["salmon"] },
          ],
        },
        context,
      ),
    ).toThrow(/undeclared salmon/i);
  });

  it("derives canonical displays and rejects proven quantity misuse", () => {
    const context = buildRecipeGenerationContext(lots, preferences, intent);
    const valid = validateAndMaterializeGeneratedRecipe(draft, context);
    expect(valid.recipe.ingredients[0].display).toBe("1 lb chicken thigh");
    expect(() =>
      validateAndMaterializeGeneratedRecipe(
        {
          ...draft,
          ingredients: draft.ingredients.map((item) =>
            item.foodConceptId === "chicken-thigh" ? { ...item, amount: 100 } : item,
          ),
        },
        context,
      ),
    ).toThrow(/exceeds the confirmed/i);
    expect(() =>
      validateAndMaterializeGeneratedRecipe(
        {
          ...draft,
          ingredients: draft.ingredients.map((item) =>
            item.foodConceptId === "chicken-thigh" ? { ...item, amount: 1, unit: "cup" } : item,
          ),
        },
        context,
      ),
    ).toThrow(/incompatible quantity/i);
  });

  it("rejects doneness language that is not tied to the named animal", () => {
    const context = buildRecipeGenerationContext(lots, preferences, intent);
    for (const instruction of [
      "Cook the rice until done, then add the chicken thigh.",
      "Cook the rice until done with the chicken thigh nearby.",
      "Do not cook the chicken thigh until done.",
    ]) {
      expect(() =>
        validateAndMaterializeGeneratedRecipe(
          {
            ...draft,
            steps: [
              { instruction, foodConceptIds: ["rice", "chicken-thigh"] },
              { instruction: "Simmer the rice with water until tender.", foodConceptIds: ["rice", "water"] },
            ],
          },
          context,
        ),
      ).toThrow(/cook chicken-thigh fully/i);
    }
  });

  it("requires doneness guidance for each raw animal concept", () => {
    const salmonLot: InventoryLot = {
      ...lots[0],
      id: "20000000-0000-4000-8000-000000000003",
      foodConceptId: "salmon",
      name: "salmon",
      quantity: 1,
      form: "fresh",
    };
    const context = buildRecipeGenerationContext([...lots, salmonLot], preferences, intent);
    expect(() =>
      validateAndMaterializeGeneratedRecipe(
        {
          ...draft,
          ingredients: [
            ...draft.ingredients,
            { foodConceptId: "salmon", name: "salmon", amount: 1, unit: "lb", required: false, acceptedForms: ["fresh"] },
          ],
          steps: [
            ...draft.steps,
            { instruction: "Fold in the salmon and serve.", foodConceptIds: ["salmon"] },
          ],
        },
        context,
      ),
    ).toThrow(/cook salmon fully/i);
  });

  it("validates optional quantities and rejects numeric unverified staples", () => {
    const context = buildRecipeGenerationContext(lots, preferences, intent);
    expect(() =>
      validateAndMaterializeGeneratedRecipe(
        {
          ...draft,
          ingredients: draft.ingredients.map((item) =>
            item.foodConceptId === "chicken-thigh"
              ? { ...item, amount: 3, required: false }
              : item,
          ),
        },
        context,
      ),
    ).toThrow(/exceeds the confirmed/i);
    expect(() =>
      validateAndMaterializeGeneratedRecipe(
        {
          ...draft,
          ingredients: draft.ingredients.map((item) =>
            item.foodConceptId === "water"
              ? { ...item, amount: 2, unit: "cup" }
              : item,
          ),
        },
        context,
      ),
    ).toThrow(/staple water must not claim/i);
  });

  it("does not certify composition-ambiguous noodles as vegan", () => {
    const noodleLot: InventoryLot = {
      ...lots[1],
      id: "20000000-0000-4000-8000-000000000004",
      foodConceptId: "noodles",
      name: "egg noodles",
      form: "dried",
    };
    const veganContext = buildRecipeGenerationContext(
      [noodleLot],
      { ...preferences, staples: ["water"] },
      { ...intent, dietaryTags: ["vegan"], includeConceptIds: ["noodles"] },
    );
    expect(() =>
      validateAndMaterializeGeneratedRecipe(
        {
          ...draft,
          title: "Simple Noodles",
          description: "A simple noodle meal from the confirmed pantry food.",
          dietaryTags: ["vegan"],
          ingredients: [
            { foodConceptId: "noodles", name: "noodles", amount: 1, unit: "cup", required: true, acceptedForms: ["dried"] },
            { foodConceptId: "water", name: "water", amount: null, unit: null, required: true, acceptedForms: ["unspecified"] },
          ],
          steps: [
            { instruction: "Boil the noodles in water until tender.", foodConceptIds: ["noodles", "water"] },
            { instruction: "Drain the noodles and serve them hot.", foodConceptIds: ["noodles"] },
          ],
        },
        veganContext,
      ),
    ).toThrow(/dietary tag/i);
  });

  it("derives dietary tags and enforces hard structured intent", () => {
    const veganIntent = { ...intent, dietaryTags: ["vegan"] };
    const veganContext = buildRecipeGenerationContext(lots, preferences, veganIntent);
    expect(() => validateAndMaterializeGeneratedRecipe(draft, veganContext)).toThrow(/dietary tag/i);

    const constrained = buildRecipeGenerationContext(lots, preferences, {
      ...intent,
      maxMinutes: 20,
      servings: 4,
      includeConceptIds: ["rice"],
    });
    expect(() => validateAndMaterializeGeneratedRecipe(draft, constrained)).toThrow(/time limit|servings/i);
  });

  it("does not treat unspecified as a wildcard for known inventory forms", () => {
    const context = buildRecipeGenerationContext(lots, { ...preferences, staples: [...preferences.staples, "rice"] }, intent);
    expect(() =>
      validateAndMaterializeGeneratedRecipe(
        {
          ...draft,
          ingredients: draft.ingredients.map((item) =>
            item.foodConceptId === "rice" ? { ...item, acceptedForms: ["unspecified"] } : item,
          ),
        },
        context,
      ),
    ).toThrow(/does not accept an available form/i);
  });
});
