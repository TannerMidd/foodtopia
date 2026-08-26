import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demoMode: false,
  requireSession: vi.fn(),
  createClient: vi.fn(),
  createAdmin: vi.fn(),
  listSuggestible: vi.fn(),
  previewCatalog: vi.fn(),
  demoApprovedRecipes: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  get isDemoMode() {
    return mocks.demoMode;
  },
}));
vi.mock("@/server/auth/session", () => ({ requireHouseholdSession: mocks.requireSession }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: mocks.createAdmin }));
vi.mock("@/server/repositories/recipes", () => ({
  listSuggestibleRecipes: mocks.listSuggestible,
}));
vi.mock("@/server/recipes/catalog", () => ({ getPreviewRecipeCatalog: mocks.previewCatalog }));
vi.mock("@/server/demo/store", () => ({
  listDemoApprovedRecipes: mocks.demoApprovedRecipes,
}));

import { GET } from "./route";

const session = {
  userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
  householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
  role: "member" as const,
};

const fullRecipe = {
  id: "lemon-rice",
  slug: "lemon-rice",
  title: "Lemon Rice",
  description: "A bright lemon rice side dish for testing the catalog.",
  servings: 4,
  totalMinutes: 20,
  mealTypes: ["dinner"],
  cuisines: ["Test"],
  dietaryTags: [],
  ingredients: [
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
    {
      id: "lemon",
      foodConceptId: "lemon",
      name: "lemon",
      amount: 1,
      unit: "count",
      display: "1 lemon",
      required: true,
      acceptedForms: ["fresh"],
    },
  ],
  steps: ["Cook the rice.", "Fold through lemon zest."],
  rights: { owner: "Foodtopia", author: "Foodtopia Editorial", reviewer: null, reviewedAt: null, status: "seeded" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demoMode = false;
});

describe("GET /api/v1/recipes", () => {
  it("returns the household-visible catalog in production", async () => {
    mocks.requireSession.mockResolvedValue(session);
    mocks.createClient.mockResolvedValue({});
    mocks.createAdmin.mockReturnValue({});
    mocks.listSuggestible.mockResolvedValue([fullRecipe]);

    const response = await GET(new Request("https://foodtopia.test/api/v1/recipes"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recipes).toHaveLength(1);
    expect(body.recipes[0].slug).toBe("lemon-rice");
    expect(typeof body.syncedAt).toBe("string");
  });

  it("serves the preview catalog plus approved drafts in demo mode", async () => {
    mocks.demoMode = true;
    mocks.previewCatalog.mockResolvedValue([fullRecipe]);
    mocks.demoApprovedRecipes.mockReturnValue([]);

    const response = await GET(new Request("https://foodtopia.test/api/v1/recipes"));
    const body = await response.json();

    expect(response.headers.get("x-foodtopia-mode")).toBe("demo");
    expect(body.recipes.map((entry: { slug: string }) => entry.slug)).toEqual(["lemon-rice"]);
  });
});
