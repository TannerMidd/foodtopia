import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demoMode: false,
  requireSession: vi.fn(),
  createClient: vi.fn(),
  createAdmin: vi.fn(),
  getAvailableRecipe: vi.fn(),
  addFavorite: vi.fn(),
  listFavorites: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  get isDemoMode() {
    return mocks.demoMode;
  },
}));
vi.mock("@/server/auth/session", () => ({ requireHouseholdSession: mocks.requireSession }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: mocks.createAdmin }));
vi.mock("@/server/repositories/recipes", () => ({ getAvailableRecipe: mocks.getAvailableRecipe }));
vi.mock("@/server/repositories/favorites", () => ({
  addRecipeFavorite: mocks.addFavorite,
  listRecipeFavorites: mocks.listFavorites,
}));
vi.mock("@/server/recipes/catalog", () => ({ getPreviewRecipeCatalog: vi.fn() }));
vi.mock("@/server/demo/store", () => ({
  addDemoRecipeFavorite: vi.fn(),
  listDemoApprovedRecipes: vi.fn(),
  listDemoRecipeFavorites: vi.fn(),
}));

import { POST } from "./route";

const session = {
  userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
  householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
  role: "member" as const,
};
const recipe = {
  id: "visible-recipe",
  slug: "visible-recipe",
  title: "Visible Recipe",
};

function request(recipeId: string) {
  return new Request("https://foodtopia.test/api/v1/recipe-favorites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipeId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demoMode = false;
  mocks.requireSession.mockResolvedValue(session);
  mocks.createClient.mockResolvedValue({ user: true });
  mocks.createAdmin.mockReturnValue({ admin: true });
});

describe("POST /api/v1/recipe-favorites", () => {
  it("checks recipe visibility through the caller's RLS-scoped client before writing", async () => {
    mocks.getAvailableRecipe.mockResolvedValue(recipe);
    mocks.addFavorite.mockResolvedValue({
      status: "added",
      favorite: {
        recipeId: recipe.id,
        slug: recipe.slug,
        title: recipe.title,
        createdAt: "2026-08-27T09:00:00.000Z",
      },
      replayed: false,
    });

    const response = await POST(request(recipe.id));

    expect(response.status).toBe(200);
    expect(mocks.getAvailableRecipe).toHaveBeenCalledWith(
      { user: true },
      recipe.id,
      session.householdId,
    );
    expect(mocks.addFavorite).toHaveBeenCalledWith(
      { admin: true },
      expect.objectContaining({
        householdId: session.householdId,
        userId: session.userId,
        recipe,
      }),
    );
  });

  it("does not let an admin client turn a guessed private recipe id into a cross-household leak", async () => {
    mocks.getAvailableRecipe.mockResolvedValue(null);

    const response = await POST(request("another-households-private-recipe"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("RECIPE_NOT_AVAILABLE");
    expect(mocks.addFavorite).not.toHaveBeenCalled();
  });
});
