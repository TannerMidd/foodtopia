import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryLot, Recipe, RecipeAssessment } from "@/contracts/domain";

const mocks = vi.hoisted(() => ({
  demoMode: false,
  requireSession: vi.fn(),
  createClient: vi.fn(),
  getAvailableRecipe: vi.fn(),
  getInventorySync: vi.fn(),
  getPreferences: vi.fn(),
  createCookSession: vi.fn(),
  recordEvent: vi.fn(),
  previewCatalog: vi.fn(),
  demoApprovedRecipes: vi.fn(),
  demoInventory: vi.fn(),
  demoCookSession: vi.fn(),
  demoPreferences: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  get isDemoMode() {
    return mocks.demoMode;
  },
}));
vi.mock("@/server/auth/session", () => ({ requireHouseholdSession: mocks.requireSession }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createClient }));
vi.mock("@/server/repositories/recipes", () => ({
  getAvailableRecipe: mocks.getAvailableRecipe,
  getHouseholdPreferences: mocks.getPreferences,
}));
vi.mock("@/server/repositories/inventory", () => ({ getInventorySync: mocks.getInventorySync }));
vi.mock("@/server/repositories/cooking", () => ({ createProductionCookSession: mocks.createCookSession }));
vi.mock("@/server/repositories/telemetry", () => ({ recordProductEvent: mocks.recordEvent }));
vi.mock("@/server/recipes/catalog", () => ({ getPreviewRecipeCatalog: mocks.previewCatalog }));
vi.mock("@/server/demo/store", () => ({
  createDemoCookSession: mocks.demoCookSession,
  listDemoApprovedRecipes: mocks.demoApprovedRecipes,
  listDemoInventory: mocks.demoInventory,
}));
vi.mock("@/server/repositories/preferences", () => ({ readDemoPreferences: mocks.demoPreferences }));

const session = {
  userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
  householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
  role: "member" as const,
};

const recipe: Recipe = {
  id: "recipe-042",
  slug: "chicken-rice-test",
  title: "Chicken Rice Test",
  description: "A test chicken breast recipe with rice for route validation.",
  servings: 4,
  totalMinutes: 30,
  mealTypes: ["dinner"],
  cuisines: ["Test"],
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
      acceptedForms: ["fresh", "frozen"],
    },
    {
      id: "rice",
      foodConceptId: "rice",
      name: "rice",
      amount: 1,
      unit: "cup",
      display: "1 cup rice",
      required: true,
      acceptedForms: ["dried"],
    },
  ],
  steps: [
    "Cook the chicken breast completely in a skillet.",
    "Cook the rice and serve it with the chicken breast.",
  ],
  rights: {
    owner: "Foodtopia",
    author: "Foodtopia Editorial",
    reviewer: "Reviewer",
    reviewedAt: "2026-08-23",
    status: "reviewed",
  },
};

function lot(
  id: string,
  foodConceptId: string,
  name: string,
  quantity: number,
  unit: string,
  form: InventoryLot["form"],
): InventoryLot {
  return {
    id,
    householdId: session.householdId,
    foodConceptId,
    name,
    category: "Test",
    quantityStatus: "known",
    quantity,
    unit,
    form,
    location: "pantry",
    dateLabelType: null,
    dateLabel: null,
    status: "active",
    version: 0,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

const thigh = lot(
  "10000000-0000-4000-8000-000000000001",
  "chicken-thigh",
  "chicken thighs",
  1,
  "lb",
  "frozen",
);
const rice = lot(
  "10000000-0000-4000-8000-000000000002",
  "rice",
  "rice",
  1,
  "cup",
  "dried",
);

function request(body: unknown) {
  return new Request("https://foodtopia.example/api/v1/cook-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/cook-sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.demoMode = false;
    mocks.requireSession.mockResolvedValue(session);
    mocks.createClient.mockResolvedValue({ kind: "user-client" });
    mocks.getAvailableRecipe.mockResolvedValue(recipe);
    mocks.getInventorySync.mockResolvedValue({ lots: [thigh, rice] });
    mocks.getPreferences.mockResolvedValue({ staples: [], dietaryTags: [], excludedConceptIds: [] });
    mocks.recordEvent.mockResolvedValue(undefined);
    mocks.previewCatalog.mockResolvedValue([]);
    mocks.demoApprovedRecipes.mockReturnValue([]);
    mocks.demoInventory.mockReturnValue([thigh, rice]);
    mocks.demoPreferences.mockReturnValue({ staples: [], dietaryTags: [], excludedConceptIds: [] });
    mocks.demoCookSession.mockReturnValue({
      cookSessionId: "79a886b8-df1b-4f87-bb36-b3b5bd485fd9",
      recipeId: recipe.id,
      createdAt: "2026-08-26T12:00:00.000Z",
    });
    mocks.createCookSession.mockImplementation(
      async (_session: unknown, assessment: RecipeAssessment) => ({
        cookSessionId: "79a886b8-df1b-4f87-bb36-b3b5bd485fd9",
        recipeId: assessment.recipe.id,
        createdAt: "2026-08-26T12:00:00.000Z",
        assessment,
      }),
    );
  });

  it("recomputes and persists an authoritative effective substitution snapshot", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request({
        recipeId: recipe.id,
        servings: 4,
        confirmedSubstitutions: [
          { ingredientId: "chicken", matchedConceptId: "chicken-thigh" },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    const persisted = mocks.createCookSession.mock.calls[0][1] as RecipeAssessment;
    expect(persisted.recipe.ingredients[0]).toMatchObject({
      id: "chicken",
      foodConceptId: "chicken-thigh",
      name: "chicken thigh",
    });
    expect(persisted.recipe.steps[0]).toContain("Substitution note");
    expect(persisted.recipe.steps.slice(1).join(" ")).not.toContain("chicken breast");
    expect(body.assessment).toEqual(persisted);
    expect(mocks.getAvailableRecipe).toHaveBeenCalledWith(
      { kind: "user-client" },
      recipe.id,
      session.householdId,
    );
  });

  it("rejects an unconfirmed or different substitution", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request({ recipeId: recipe.id, servings: 4, confirmedSubstitutions: [] }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "RECIPE_SUBSTITUTIONS_CHANGED",
      latestAssessment: { recipe: { id: recipe.id } },
    });
    expect(mocks.createCookSession).not.toHaveBeenCalled();
  });

  it("rejects stale substitution confirmations when exact inventory becomes available", async () => {
    mocks.getInventorySync.mockResolvedValue({
      lots: [
        lot(
          "10000000-0000-4000-8000-000000000003",
          "chicken-breast",
          "chicken breast",
          1,
          "lb",
          "fresh",
        ),
        rice,
      ],
    });
    const { POST } = await import("./route");
    const response = await POST(
      request({
        recipeId: recipe.id,
        servings: 4,
        confirmedSubstitutions: [
          { ingredientId: "chicken", matchedConceptId: "chicken-thigh" },
        ],
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.createCookSession).not.toHaveBeenCalled();
  });

  it("can cook an approved generated recipe in demo mode", async () => {
    mocks.demoMode = true;
    mocks.demoApprovedRecipes.mockReturnValue([recipe]);
    const { POST } = await import("./route");
    const response = await POST(
      request({
        recipeId: recipe.id,
        servings: 4,
        confirmedSubstitutions: [
          { ingredientId: "chicken", matchedConceptId: "chicken-thigh" },
        ],
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.demoApprovedRecipes).toHaveBeenCalled();
    expect((await response.json()).assessment.recipe.id).toBe(recipe.id);
  });

  it("never accepts a client-supplied assessment payload", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request({
        recipeId: recipe.id,
        servings: 4,
        confirmedSubstitutions: [],
        assessment: { recipe: { id: "attacker-recipe" }, tier: "ready" },
      }),
    );

    expect(response.status).toBe(422);
    expect(mocks.getAvailableRecipe).not.toHaveBeenCalled();
    expect(mocks.createCookSession).not.toHaveBeenCalled();
  });
});
