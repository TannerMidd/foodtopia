import { describe, expect, it } from "vitest";

import {
  cookHistoryResponseSchema,
  recipeCatalogResponseSchema,
  recipeFavoritesResponseSchema,
  shoppingListAddRequestSchema,
  shoppingListAddResponseSchema,
  shoppingListItemSchema,
} from "./api";

const recipe = {
  id: "lemon-chicken-skillet",
  slug: "lemon-chicken-skillet",
  title: "Lemon Chicken Skillet",
  description: "A one-pan lemon chicken dinner finished with herbs.",
  servings: 4,
  totalMinutes: 30,
  mealTypes: ["dinner"],
  cuisines: ["European-inspired"],
  dietaryTags: [],
  ingredients: [
    {
      id: "chicken",
      foodConceptId: "chicken-breast",
      name: "chicken breast",
      amount: 1,
      unit: "lb",
      display: "1 pound chicken breast",
      required: true,
      acceptedForms: ["fresh" as const],
    },
    {
      id: "lemon",
      foodConceptId: "lemon",
      name: "lemon",
      amount: 1,
      unit: "count",
      display: "1 lemon",
      required: true,
      acceptedForms: ["fresh" as const],
    },
  ],
  steps: ["Sear the chicken until golden.", "Finish with lemon and herbs."],
  rights: {
    owner: "Foodtopia",
    author: "Foodtopia Editorial",
    reviewer: null,
    reviewedAt: null,
    status: "seeded" as const,
  },
};

describe("recipeCatalogResponseSchema", () => {
  it("accepts a full cached catalog with a sync timestamp", () => {
    expect(
      recipeCatalogResponseSchema.safeParse({
        recipes: [recipe],
        syncedAt: "2026-08-27T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects summaries missing the method steps", () => {
    expect(
      recipeCatalogResponseSchema.safeParse({
        recipes: [{ ...recipe, steps: [] }],
        syncedAt: "2026-08-27T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("cookHistoryResponseSchema", () => {
  it("accepts reconciled sessions", () => {
    expect(
      cookHistoryResponseSchema.safeParse({
        sessions: [
          {
            id: "79a886b8-df1b-4f87-bb36-b3b5bd485fd9",
            recipeId: recipe.id,
            slug: recipe.slug,
            title: recipe.title,
            servings: 4,
            startedAt: "2026-08-26T18:00:00.000Z",
            completedAt: "2026-08-26T18:40:00.000Z",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("allows a deleted recipe reference (null ids) but keeps the title snapshot", () => {
    const parsed = cookHistoryResponseSchema.safeParse({
      sessions: [
        {
          id: "79a886b8-df1b-4f87-bb36-b3b5bd485fd9",
          recipeId: null,
          slug: null,
          title: "A cooked meal",
          servings: 2,
          startedAt: "2026-08-26T18:00:00Z",
          completedAt: "2026-08-26T18:40:00Z",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("recipeFavoritesResponseSchema", () => {
  it("requires an ISO timestamp per favorite", () => {
    expect(
      recipeFavoritesResponseSchema.safeParse({
        favorites: [
          { recipeId: recipe.id, slug: recipe.slug, title: recipe.title, createdAt: "not-a-date" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("shopping list schemas", () => {
  it("parses items with nullable quantity and concept links", () => {
    expect(
      shoppingListItemSchema.safeParse({
        id: "9f3c1b2a-1111-4111-8111-111111111111",
        name: "Lemons",
        category: "Produce",
        foodConceptId: "lemon",
        quantityText: "2 count",
        done: false,
        addedByName: "Sam",
        createdAt: "2026-08-27T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an empty non-null quantity label before it reaches Postgres", () => {
    expect(
      shoppingListAddRequestSchema.safeParse({
        items: [
          { name: "Lemons", category: "Produce", foodConceptId: "lemon", quantityText: " " },
        ],
      }).success,
    ).toBe(false);
  });

  it("caps batch additions at 16 items", () => {
    const items = Array.from({ length: 17 }, (_, index) => ({
      name: `Item ${index}`,
      category: "Other",
      foodConceptId: null,
      quantityText: null,
    }));
    expect(shoppingListAddRequestSchema.safeParse({ items }).success).toBe(false);
  });

  it("reports replayed names so offline replays stay honest", () => {
    expect(
      shoppingListAddResponseSchema.safeParse({
        items: [],
        added: 0,
        replayedNames: ["Lemons"],
      }).success,
    ).toBe(true);
  });
});
