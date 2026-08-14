import { describe, expect, it } from "vitest";

import { mapAnalysis, mapInventoryLot, mapRecipe } from "./mappers";

const householdId = "11111111-1111-4111-8111-111111111111";
const analysisId = "22222222-2222-4222-8222-222222222222";

describe("Supabase DTO mappers", () => {
  it("maps numeric and snake-case inventory fields into the public contract", () => {
    const lot = mapInventoryLot({
      id: "33333333-3333-4333-8333-333333333333",
      household_id: householdId,
      food_concept_id: "tomato",
      name: "Tomatoes",
      category: "Produce",
      quantity_status: "known",
      quantity: "4.000",
      unit: "count",
      form: "fresh",
      location: "fridge",
      date_label_type: null,
      date_label: null,
      status: "active",
      version: 2,
      created_at: "2026-08-13T10:00:00.000Z",
      updated_at: "2026-08-13T11:00:00.000Z",
    });

    expect(lot).toMatchObject({
      householdId,
      foodConceptId: "tomato",
      quantity: 4,
      version: 2,
    });
  });

  it("normalizes Supabase offset timestamps in inventory rows", () => {
    const lot = mapInventoryLot({
      id: "33333333-3333-4333-8333-333333333333",
      household_id: householdId,
      food_concept_id: null,
      name: "Seasoning",
      category: "Pantry",
      quantity_status: "unknown",
      quantity: null,
      unit: null,
      form: "dried",
      location: "pantry",
      date_label_type: null,
      date_label: null,
      status: "active",
      version: 0,
      created_at: "2026-08-14T21:40:24.132336+00:00",
      updated_at: "2026-08-14T21:40:24.132336+00:00",
    });

    expect(lot.createdAt).toBe("2026-08-14T21:40:24.132Z");
    expect(lot.updatedAt).toBe("2026-08-14T21:40:24.132Z");
  });

  it("maps proposed candidates as preselected review drafts", () => {
    const analysis = mapAnalysis(
      {
        id: analysisId,
        household_id: householdId,
        status: "needs_review",
        error_code: null,
        created_at: "2026-08-13T10:00:00.000Z",
        updated_at: "2026-08-13T10:01:00.000Z",
      },
      [
        {
          id: "44444444-4444-4444-8444-444444444444",
          analysis_id: analysisId,
          raw_label: "tomato",
          suggested_food_concept_id: "tomato",
          suggested_name: "Tomatoes",
          category: "Produce",
          quantity_status: "unknown",
          quantity: null,
          unit: null,
          form: "fresh",
          location: "fridge",
          image_indexes: [0],
          uncertainty_reason: null,
          review_status: "proposed",
          accepted: false,
        },
      ],
    );

    expect(analysis.candidates).toHaveLength(1);
    expect(analysis.candidates[0].accepted).toBe(true);
  });

  it("normalizes PostgreSQL timestamp offsets in analysis responses", () => {
    const analysis = mapAnalysis({
      id: analysisId,
      household_id: householdId,
      status: "queued",
      error_code: null,
      created_at: "2026-08-14T18:20:00+00:00",
      updated_at: "2026-08-14T18:21:00+00:00",
    });

    expect(analysis.createdAt).toBe("2026-08-14T18:20:00.000Z");
    expect(analysis.updatedAt).toBe("2026-08-14T18:21:00.000Z");
  });

  it("orders ingredients and maps reviewed recipe rights", () => {
    const recipe = mapRecipe({
      id: "quick-tomatoes",
      slug: "quick-tomatoes",
      title: "Quick Tomatoes",
      description: "A simple original tomato preparation.",
      servings: 2,
      total_minutes: 10,
      meal_types: ["dinner"],
      cuisines: ["american"],
      dietary_tags: ["vegetarian"],
      steps: ["Prepare all of the tomatoes.", "Cook until just tender."],
      rights_owner: "Foodtopia",
      rights_author: "Foodtopia",
      rights_reviewer: "Reviewer",
      rights_reviewed_at: "2026-08-13",
      rights_status: "reviewed",
      recipe_ingredients: [
        {
          id: "salt",
          position: 1,
          food_concept_id: "salt",
          name: "Salt",
          amount: null,
          unit: null,
          display: "Salt to taste",
          required: true,
          accepted_forms: ["unspecified"],
        },
        {
          id: "tomato",
          position: 0,
          food_concept_id: "tomato",
          name: "Tomatoes",
          amount: "2",
          unit: "count",
          display: "2 tomatoes",
          required: true,
          accepted_forms: ["fresh"],
        },
      ],
    });

    expect(recipe.ingredients.map((item) => item.id)).toEqual(["tomato", "salt"]);
    expect(recipe.rights.status).toBe("reviewed");
  });
});
