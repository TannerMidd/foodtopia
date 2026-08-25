import { describe, expect, it, vi } from "vitest";
import { flagVisibleRecipe, getAvailableRecipe, preflightRecipeProposal } from "./recipes";

const input = {
  householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
  userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
  recipeId: "recipe-081",
  reason: "inaccurate" as const,
};

const recipeRow = {
  id: "household-recipe",
  household_id: input.householdId,
  visibility: "household",
  slug: "household-recipe",
  title: "Household Recipe",
  description: "A reusable household recipe for repository tests.",
  servings: 2,
  total_minutes: 20,
  meal_types: ["dinner"],
  cuisines: ["Test"],
  dietary_tags: [],
  steps: ["Prepare the rice carefully.", "Cook the rice until tender."],
  rights_owner: "Household",
  rights_author: "Household member",
  rights_reviewer: null,
  rights_reviewed_at: null,
  rights_status: "draft",
  recipe_ingredients: [
    {
      id: "rice",
      position: 0,
      food_concept_id: "rice",
      name: "rice",
      amount: 1,
      unit: "cup",
      display: "1 cup rice",
      required: true,
      accepted_forms: ["dried"],
    },
    {
      id: "water",
      position: 1,
      food_concept_id: "water",
      name: "water",
      amount: 2,
      unit: "cup",
      display: "2 cups water",
      required: true,
      accepted_forms: ["unspecified"],
    },
  ],
};

describe("available recipe repository", () => {
  function clientReturning(data: unknown) {
    return {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
          }),
        }),
      })),
    };
  }

  it("allows an RLS-visible draft from the caller's household", async () => {
    const client = clientReturning(recipeRow);
    await expect(
      getAvailableRecipe(client as never, recipeRow.id, input.householdId),
    ).resolves.toMatchObject({ id: recipeRow.id, rights: { status: "draft" } });
  });

  it("rejects malformed scope and another household even if a mock bypasses RLS", async () => {
    const otherHousehold = { ...recipeRow, household_id: "other-household" };
    await expect(
      getAvailableRecipe(
        clientReturning(otherHousehold) as never,
        recipeRow.id,
        input.householdId,
      ),
    ).resolves.toBeNull();
  });

  it("allows seeded public catalog recipes", async () => {
    const seeded = {
      ...recipeRow,
      household_id: null,
      visibility: "published",
      rights_status: "seeded",
      rights_author: "Foodtopia Initial Catalog",
    };
    await expect(
      getAvailableRecipe(clientReturning(seeded) as never, seeded.id, input.householdId),
    ).resolves.toMatchObject({ id: seeded.id, rights: { status: "seeded" } });
  });
});

describe("recipe proposal idempotency preflight", () => {
  function adminReturning(row: unknown) {
    const expiry = {
      eq: vi.fn(),
      lte: vi.fn().mockResolvedValue({ error: null }),
    };
    expiry.eq.mockReturnValue(expiry);
    const lookup = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    lookup.eq.mockReturnValue(lookup);
    return {
      from: vi.fn(() => ({
        update: vi.fn(() => expiry),
        select: vi.fn(() => lookup),
      })),
    };
  }

  it("returns the existing pending proposal for an identical fingerprint", async () => {
    const fingerprint = "a".repeat(64);
    const admin = adminReturning({
      id: "12345678-1234-4234-8234-123456789abc",
      status: "proposed",
      recipe_payload: {
        id: "generated-12345678-1234-4234-8234-123456789abc",
        slug: "generated-rice",
        title: "Generated Rice",
        description: "A generated household rice recipe for testing.",
        servings: 2,
        totalMinutes: 20,
        mealTypes: ["dinner"],
        cuisines: [],
        dietaryTags: ["vegan", "vegetarian", "dairy-free", "gluten-free"],
        ingredients: recipeRow.recipe_ingredients.map((item) => ({
          id: item.id,
          foodConceptId: item.food_concept_id,
          name: item.name,
          amount: item.amount,
          unit: item.unit,
          display: item.display,
          required: item.required,
          acceptedForms: item.accepted_forms,
        })),
        steps: recipeRow.steps,
        rights: { owner: "Household", author: "AI-assisted household recipe", reviewer: null, reviewedAt: null, status: "draft" },
      },
      provider: "openai",
      model: "recipe-model",
      created_at: "2026-08-26T00:00:00.000Z",
      version: 0,
      request_fingerprint: fingerprint,
    });

    await expect(preflightRecipeProposal(admin as never, {
      householdId: input.householdId,
      userId: input.userId,
      idempotencyKey: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      requestFingerprint: fingerprint,
    })).resolves.toMatchObject({ kind: "pending", proposal: { status: "proposed" } });
  });

  it("rejects an idempotency key reused for different structured inputs", async () => {
    const admin = adminReturning({
      id: "12345678-1234-4234-8234-123456789abc",
      status: "denied",
      recipe_payload: null,
      provider: "openai",
      model: "recipe-model",
      created_at: "2026-08-26T00:00:00.000Z",
      version: 1,
      request_fingerprint: "a".repeat(64),
    });
    await expect(preflightRecipeProposal(admin as never, {
      householdId: input.householdId,
      userId: input.userId,
      idempotencyKey: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      requestFingerprint: "b".repeat(64),
    })).rejects.toMatchObject({ status: 409 });
  });
});

describe("recipe flags repository", () => {
  it("uses an idempotent conflict target after checking RLS-visible availability", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: input.recipeId }, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
      from: vi.fn((table: string) => table === "recipes" ? { select } : { upsert }),
    };

    await flagVisibleRecipe(client as never, input);

    expect(select).toHaveBeenCalledWith("id");
    expect(eq).toHaveBeenCalledWith("id", input.recipeId);
    expect(upsert).toHaveBeenCalledWith(
      {
        household_id: input.householdId,
        recipe_id: input.recipeId,
        reason: input.reason,
        flagged_by: input.userId,
      },
      {
        onConflict: "household_id,recipe_id,flagged_by",
        ignoreDuplicates: true,
      },
    );
  });

  it("returns not found when recipe RLS hides an unavailable recipe", async () => {
    const client = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      })),
    };

    await expect(flagVisibleRecipe(client as never, input)).rejects.toMatchObject({
      code: "P0002",
      status: 404,
    });
  });
});
