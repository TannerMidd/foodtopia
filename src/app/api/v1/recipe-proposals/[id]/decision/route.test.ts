import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demoMode: false,
  demoDecide: vi.fn(),
  decide: vi.fn(),
  recipe: vi.fn(),
  inventory: vi.fn(),
  preferences: vi.fn(),
  requireSession: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ get isDemoMode() { return mocks.demoMode; } }));
vi.mock("@/server/auth/session", () => ({ requireHouseholdSession: mocks.requireSession }));
vi.mock("@/server/demo/store", () => ({
  decideDemoRecipeProposal: mocks.demoDecide,
  listDemoInventory: vi.fn(() => []),
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn().mockResolvedValue({ kind: "user" }) }));
vi.mock("@/server/repositories/recipes", () => ({
  decideRecipeProposal: mocks.decide,
  getAvailableRecipe: mocks.recipe,
  getHouseholdPreferences: mocks.preferences,
}));
vi.mock("@/server/repositories/inventory", () => ({ getInventorySync: mocks.inventory }));

const householdId = "45ebd76e-773c-43c6-a66a-e941dac40d80";
const recipe = {
  id: "generated-12345678-1234-4234-8234-123456789abc",
  slug: "generated-dinner-12345678",
  title: "Generated Dinner",
  description: "A generated recipe from confirmed household foods.",
  servings: 2,
  totalMinutes: 25,
  mealTypes: ["dinner"],
  cuisines: [],
  dietaryTags: [],
  ingredients: [
    { id: "rice-1", foodConceptId: "rice", name: "rice", amount: 1, unit: "cup", display: "1 cup rice", required: true, acceptedForms: ["dried"] },
    { id: "water-2", foodConceptId: "water", name: "water", amount: 2, unit: "cup", display: "2 cups water", required: true, acceptedForms: ["unspecified"] },
  ],
  steps: ["Combine the rice and water.", "Cook the rice and water until tender."],
  rights: { owner: "Household", author: "AI-assisted household recipe", reviewer: null, reviewedAt: null, status: "draft" },
};

function request(decision: "approve" | "deny", expectedVersion = 0) {
  return new Request("https://foodtopia.example/api/v1/recipe-proposals/id/decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, expectedVersion }),
  });
}
const context = { params: Promise.resolve({ id: "12345678-1234-4234-8234-123456789abc" }) };

describe("recipe proposal decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.demoMode = false;
    mocks.requireSession.mockResolvedValue({
      householdId,
      userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
      role: "member",
    });
    mocks.inventory.mockResolvedValue({ lots: [] });
    mocks.preferences.mockResolvedValue({ staples: ["rice", "water"], dietaryTags: [], excludedConceptIds: [] });
    mocks.recipe.mockResolvedValue(recipe);
  });

  it("approves through the atomic RPC seam and returns a server assessment", async () => {
    mocks.decide.mockResolvedValue({
      proposalId: "12345678-1234-4234-8234-123456789abc",
      status: "approved",
      recipeId: recipe.id,
      version: 1,
      replayed: false,
    });
    const { POST } = await import("./route");
    const response = await POST(request("approve"), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.decide).toHaveBeenCalledWith(
      { kind: "user" },
      { proposalId: "12345678-1234-4234-8234-123456789abc", decision: "approve", expectedVersion: 0 },
    );
    expect(mocks.recipe).toHaveBeenCalledWith({ kind: "user" }, recipe.id, householdId);
    expect(body).toMatchObject({ status: "approved", assessment: { recipe: { id: recipe.id } } });
  });

  it("denies without returning or loading recipe content", async () => {
    mocks.decide.mockResolvedValue({
      proposalId: "12345678-1234-4234-8234-123456789abc",
      status: "denied",
      recipeId: null,
      version: 1,
      replayed: false,
    });
    const { POST } = await import("./route");
    const response = await POST(request("deny"), context);
    const body = await response.json();

    expect(body).toEqual({
      proposalId: "12345678-1234-4234-8234-123456789abc",
      status: "denied",
      recipeId: null,
      version: 1,
      replayed: false,
    });
    expect(mocks.recipe).not.toHaveBeenCalled();
  });

  it("returns an expired demo decision without requiring recipe content", async () => {
    mocks.demoMode = true;
    mocks.demoDecide.mockReturnValue({
      proposalId: "12345678-1234-4234-8234-123456789abc",
      status: "expired",
      recipeId: null,
      version: 1,
      replayed: false,
      recipe: null,
    });
    const { POST } = await import("./route");
    const response = await POST(request("approve"), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      proposalId: "12345678-1234-4234-8234-123456789abc",
      status: "expired",
      recipeId: null,
      version: 1,
      replayed: false,
    });
    expect(mocks.recipe).not.toHaveBeenCalled();
  });

  it("requires an enabled authenticated household session", async () => {
    mocks.requireSession.mockRejectedValue(
      Object.assign(new Error("Account disabled"), { code: "account_not_enabled", status: 403 }),
    );
    const { POST } = await import("./route");
    const response = await POST(request("approve"), context);
    expect(response.status).toBe(403);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("does not expose another household proposal", async () => {
    mocks.decide.mockRejectedValue(
      Object.assign(new Error("proposal missing"), { code: "P0002", status: 404 }),
    );
    const { POST } = await import("./route");
    const response = await POST(request("approve"), context);
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("proposal missing");
  });
});
