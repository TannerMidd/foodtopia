import { beforeEach, describe, expect, it, vi } from "vitest";

/** One queued result per successive from() call; every query-builder method
 * returns the same thenable proxy. */
function chainable(result: { data: unknown; error: unknown; count?: number }) {
  const promise = Promise.resolve(result);
  const builder: Record<string, unknown> = {};
  const proxy = new Proxy(builder, {
    get(_target, property) {
      if (property === "then") return promise.then.bind(promise);
      if (property === "catch") return promise.catch.bind(promise);
      return () => proxy;
    },
  });
  return proxy;
}

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: vi.fn() }));

import { addRecipeFavorite, listRecipeFavorites } from "./favorites";

function enqueueFrom(...results: { data: unknown; error: unknown; count?: number }[]) {
  mocks.from.mockReset();
  let call = 0;
  mocks.from.mockImplementation(() => {
    const result = results[Math.min(call, results.length - 1)];
    call += 1;
    return chainable(result ?? { data: [], error: null });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminClient = { from: (...args: unknown[]) => mocks.from(...(args as [])) } as any;
const householdId = "45ebd76e-773c-43c6-a66a-e941dac40d80";
const userId = "7f892312-7c71-4e9f-a595-f8300f6d3234";
const recipe = {
  id: "lemon-chicken-skillet",
  slug: "lemon-chicken-skillet",
  title: "Lemon Chicken Skillet",
};
const createdAt = "2026-08-27T09:00:00.000Z";
const favoriteRow = {
  recipe_id: recipe.id,
  created_at: createdAt,
  recipes: { slug: recipe.slug, title: recipe.title },
};

beforeEach(() => vi.clearAllMocks());

describe("household recipe favorites repository", () => {
  it("lists favorites with catalog titles and slugs", async () => {
    enqueueFrom({ data: [favoriteRow], error: null });

    const result = await listRecipeFavorites(adminClient, householdId);

    expect(result.favorites[0]).toMatchObject({
      recipeId: recipe.id,
      slug: recipe.slug,
      title: recipe.title,
      createdAt,
    });
  });

  it("adds a route-validated recipe and returns the persisted timestamp", async () => {
    enqueueFrom(
      { data: null, error: null },
      { data: null, error: null, count: 0 },
      { data: { created_at: createdAt }, error: null },
    );

    const result = await addRecipeFavorite(adminClient, {
      householdId,
      userId,
      recipe,
    });

    expect(result).toMatchObject({
      status: "added",
      replayed: false,
      favorite: { recipeId: recipe.id, createdAt },
    });
  });

  it("treats a concurrent duplicate add as an idempotent replay", async () => {
    enqueueFrom(
      { data: null, error: null },
      { data: null, error: null, count: 1 },
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: { created_at: createdAt }, error: null },
    );

    const result = await addRecipeFavorite(adminClient, {
      householdId,
      userId,
      recipe,
    });

    expect(result).toMatchObject({ status: "added", replayed: true });
  });

  it("refuses additions after the bounded favorites list reaches 200 rows", async () => {
    enqueueFrom(
      { data: null, error: null },
      { data: null, error: null, count: 200 },
    );

    await expect(
      addRecipeFavorite(adminClient, { householdId, userId, recipe }),
    ).rejects.toMatchObject({ status: 409, code: "RECIPE_FAVORITES_FULL" });
  });

  it("returns the existing favorite unchanged on replay", async () => {
    enqueueFrom({ data: { created_at: createdAt }, error: null });

    const result = await addRecipeFavorite(adminClient, {
      householdId,
      userId,
      recipe,
    });

    expect(result).toMatchObject({
      replayed: true,
      favorite: { createdAt },
    });
  });
});
