import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  online: true,
  lots: [] as { id: string; status: string }[],
  push: vi.fn(),
  saveAssessment: vi.fn(async () => undefined),
  syncCatalog: vi.fn(async () => true),
  loadCachedRecipes: vi.fn(),
  loadCachedPreferences: vi.fn(async () => null),
  loadCachedFavoriteIds: vi.fn(async () => [] as string[]),
  cacheFavoriteIds: vi.fn(async () => undefined),
  loadCatalogSyncedAt: vi.fn(async () => "2026-08-27T12:00:00.000Z"),
  getFavorites: vi.fn(async () => ({ favorites: [] as never[] })),
  addFavorite: vi.fn(async () => ({ status: "added", replayed: false })),
  removeFavorite: vi.fn(async () => ({ status: "removed", replayed: false })),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/client/api", () => ({
  getRecipeCatalog: vi.fn(),
  getHouseholdPreferences: vi.fn(),
  getRecipeFavorites: mocks.getFavorites,
  addRecipeFavorite: mocks.addFavorite,
  removeRecipeFavorite: mocks.removeFavorite,
  ApiClientError: class ApiClientError extends Error {
    status = 0;
  },
}));
vi.mock("@/lib/client/recipe-cache", () => ({
  saveRecipeAssessment: mocks.saveAssessment,
}));
vi.mock("@/lib/client/recipe-catalog", () => ({
  syncRecipeCatalog: mocks.syncCatalog,
  loadCachedRecipes: mocks.loadCachedRecipes,
  loadCachedPreferences: mocks.loadCachedPreferences,
  loadCachedFavoriteIds: mocks.loadCachedFavoriteIds,
  cacheFavoriteIds: mocks.cacheFavoriteIds,
  loadCatalogSyncedAt: mocks.loadCatalogSyncedAt,
}));
vi.mock("./offline-provider", () => ({
  useOfflineInventory: () => ({ online: mocks.online, lots: mocks.lots, hydrated: true }),
}));

import { RecipeBrowse } from "./recipe-browse";
import type { Recipe } from "@/contracts/domain";

function recipe(slug: string, title: string): Recipe {
  return {
    id: slug,
    slug,
    title,
    description: `A ${title.toLowerCase()} recipe used for browse testing.`,
    servings: 4,
    totalMinutes: 25,
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
        id: "water",
        foodConceptId: "water",
        name: "water",
        amount: 2,
        unit: "cup",
        display: "2 cups water",
        required: true,
        acceptedForms: ["unspecified"],
      },
    ],
    steps: ["Boil the water.", "Cook the rice through."],
    rights: { owner: "Foodtopia", author: "Foodtopia Editorial", reviewer: null, reviewedAt: null, status: "seeded" },
  };
}

describe("RecipeBrowse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.online = true;
    mocks.lots = [];
    mocks.loadCachedFavoriteIds.mockResolvedValue([]);
    mocks.getFavorites.mockResolvedValue({ favorites: [] });
    mocks.loadCachedRecipes.mockResolvedValue([
      recipe("lemon-rice", "Lemon Rice"),
      recipe("plain-rice", "Plain Rice"),
    ]);
  });

  it("renders cached recipes with readiness evidence and opens the detail screen", async () => {
    const user = userEvent.setup();
    render(<RecipeBrowse />);

    const row = await screen.findByRole("button", { name: /open plain rice/i });
    await user.click(row);

    await waitFor(() => {
      expect(mocks.saveAssessment).toHaveBeenCalledWith(
        expect.objectContaining({ recipe: expect.objectContaining({ slug: "plain-rice" }) }),
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/recipes/plain-rice");
  });

  it("narrows the library as you type", async () => {
    const user = userEvent.setup();
    render(<RecipeBrowse />);

    await screen.findByRole("button", { name: /open lemon rice/i });
    const input = screen.getByLabelText(/filter the recipe library/i);
    await user.type(input, "lemon");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /open plain rice/i })).toBeNull();
    });
    expect(screen.getByRole("button", { name: /open lemon rice/i })).toBeVisible();
  });

  it("syncs the catalog when connected and reports favorites", async () => {
    mocks.getFavorites.mockResolvedValue({
      favorites: [
        { recipeId: "plain-rice", slug: "plain-rice", title: "Plain Rice", createdAt: "2026-08-27T09:00:00Z" } as never,
      ],
    });
    render(<RecipeBrowse />);

    await screen.findByRole("button", { name: /remove plain rice from favorites/i });
    expect(mocks.syncCatalog).toHaveBeenCalled();
  });

  it("keeps browsing and favorite filters available offline", async () => {
    mocks.online = false;
    mocks.loadCachedFavoriteIds.mockResolvedValue(["plain-rice"]);
    const user = userEvent.setup();
    render(<RecipeBrowse />);

    await screen.findByRole("button", { name: /open lemon rice/i });
    await user.click(screen.getByRole("button", { name: "favorites" }));

    expect(screen.getByRole("button", { name: /open plain rice/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /open lemon rice/i })).toBeNull();
    expect(mocks.syncCatalog).not.toHaveBeenCalled();

    mocks.online = true;
  });
});
