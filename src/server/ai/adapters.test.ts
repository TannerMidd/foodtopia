import { describe, expect, it } from "vitest";

import { visionBatchResultSchema } from "./contracts";
import { DemoVisionAnalyzer, HeuristicRecipeAssistant } from "./local-adapters";

describe("vision response validation", () => {
  const baseProposal = {
    rawLabel: "tomato",
    suggestedName: "Tomato",
    category: "Produce",
    quantityStatus: "unknown" as const,
    quantity: null,
    unit: null,
    form: "fresh" as const,
    location: "fridge" as const,
    imageIndexes: [0],
    uncertaintyReason: null,
  };

  it("accepts a conservative unknown-quantity proposal", () => {
    expect(
      visionBatchResultSchema.parse({
        proposals: [baseProposal],
        batchNotes: null,
      }).proposals,
    ).toHaveLength(1);
  });

  it("rejects a numeric quantity labeled unknown", () => {
    expect(() =>
      visionBatchResultSchema.parse({
        proposals: [{ ...baseProposal, quantity: 3 }],
        batchNotes: null,
      }),
    ).toThrow(/Unknown quantities/);
  });

  it("rejects fields outside the strict model contract", () => {
    expect(() =>
      visionBatchResultSchema.parse({
        proposals: [{ ...baseProposal, freshness: "safe" }],
        batchNotes: null,
      }),
    ).toThrow();
  });

  it("places demo suggestions in likely storage", async () => {
    const result = await new DemoVisionAnalyzer().analyze({
      analysisId: "analysis-1",
      images: [{ index: 0 }],
      fileNames: ["rice-milk.jpg"],
    });

    expect(result.proposals.map(({ suggestedName, location }) => [suggestedName, location])).toEqual([
      ["Milk", "fridge"],
      ["Rice", "pantry"],
    ]);
  });
});

describe("local recipe intent parser", () => {
  it("builds one deterministic demo draft only from supplied concepts", async () => {
    const draft = await new HeuristicRecipeAssistant().generate({
      intent: {
        query: "dinner",
        maxMinutes: 30,
        servings: 2,
        mealTypes: ["dinner"],
        cuisines: [],
        dietaryTags: [],
        includeConceptIds: [],
        excludeConceptIds: [],
      },
      foods: [
        { foodConceptId: "rice", name: "rice", forms: ["dried"], quantities: [], unknownQuantityForms: ["dried"] },
        { foodConceptId: "tomato", name: "tomato", forms: ["fresh"], quantities: [], unknownQuantityForms: ["fresh"] },
      ],
      staples: [],
      dietaryTags: [],
      excludedConceptIds: [],
    });
    expect(draft.ingredients.map((item) => item.foodConceptId)).toEqual(["rice", "tomato"]);
    expect(draft).not.toHaveProperty("id");
    expect(draft).not.toHaveProperty("rights");
  });

  it("extracts bounded, deterministic filters without inventing food", async () => {
    const intent = await new HeuristicRecipeAssistant().parseIntent(
      "spicy vegetarian Mexican dinner under 30 minutes for 4",
    );

    expect(intent.maxMinutes).toBe(30);
    expect(intent.servings).toBe(4);
    expect(intent.cuisines).toEqual(["mexican"]);
    expect(intent.mealTypes).toEqual(["dinner"]);
    expect(intent.dietaryTags).toEqual(["vegetarian"]);
    expect(intent.includeConceptIds).toEqual([]);
  });
});

