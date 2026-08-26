import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ordered Supabase-postgrest fake. Repository flows hit from() a known number
 * of times; each queued entry answers one from() call regardless of how the
 * query builder is chained afterwards. Terminal results resolve as promises.
 */
function chainable(result: { data: unknown; error: unknown }) {
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

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));

import {
  addShoppingListItems,
  listShoppingListItems,
  removeShoppingListItem,
  updateShoppingListItem,
} from "./shopping-list";

/** Queue one resolved result per successive from(table) call. */
function enqueueFrom(...results: { data: unknown; error: unknown }[]) {
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

const itemRow = {
  id: "9f3c1b2a-1111-4111-8111-111111111111",
  name: "Lemons",
  category: "Produce",
  food_concept_id: "lemon",
  quantity_text: null,
  done: false,
  added_by: "7f892312-7c71-4e9f-a595-f8300f6d3234",
  created_at: "2026-08-27T10:00:00.000Z",
};

const profileRow = { id: itemRow.added_by, display_name: "Sam" };
const householdId = "45ebd76e-773c-43c6-a66a-e941dac40d80";
const userId = "7f892312-7c71-4e9f-a595-f8300f6d3234";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shared shopping list repository", () => {
  it("lists items and resolves member display names", async () => {
    // Call 1: item rows. Call 2: profile display names.
    enqueueFrom({ data: [itemRow], error: null }, { data: [profileRow], error: null });

    const result = await listShoppingListItems(adminClient, householdId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "Lemons", addedByName: "Sam", done: false });
  });

  it("deduplicates additions against open entry names and reports replays", async () => {
    const insertedRow = { ...itemRow, name: "Basil" };
    // Calls: 1) existing rows, 2) insert returning new row, 3) refreshed list, 4) profiles.
    enqueueFrom(
      { data: [{ name: "lemons", done: false }], error: null },
      { data: insertedRow, error: null },
      { data: [itemRow, insertedRow], error: null },
      { data: [profileRow], error: null },
    );

    const result = await addShoppingListItems(adminClient, {
      householdId,
      userId,
      items: [
        { name: "Lemons", category: "Produce", foodConceptId: "lemon", quantityText: null },
        { name: "Basil", category: "Produce", foodConceptId: "basil", quantityText: null },
      ],
    });

    expect(result.added).toBe(1);
    expect(result.replayedNames).toEqual(["Lemons"]);
  });

  it("treats a concurrent duplicate as a replay without failing the batch", async () => {
    enqueueFrom(
      { data: [], error: null },
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: [itemRow], error: null },
      { data: [profileRow], error: null },
    );

    const result = await addShoppingListItems(adminClient, {
      householdId,
      userId,
      items: [
        { name: "Lemons", category: "Produce", foodConceptId: "lemon", quantityText: null },
      ],
    });

    expect(result).toMatchObject({ added: 0, replayedNames: ["Lemons"] });
  });

  it("refuses additions after the bounded list reaches 100 rows", async () => {
    enqueueFrom({
      data: Array.from({ length: 100 }, (_, index) => ({ name: `Item ${index}`, done: true })),
      error: null,
    });

    await expect(
      addShoppingListItems(adminClient, {
        householdId,
        userId,
        items: [
          { name: "Lemons", category: "Produce", foodConceptId: "lemon", quantityText: null },
        ],
      }),
    ).rejects.toMatchObject({ status: 409, code: "SHOPPING_LIST_FULL" });
  });

  it("marks an item done through the trusted DAL", async () => {
    const doneRow = { ...itemRow, done: true };
    enqueueFrom(
      { data: doneRow, error: null }, // update ... .select().maybeSingle()
      { data: [profileRow], error: null },
    );

    const updated = await updateShoppingListItem(adminClient, {
      householdId,
      itemId: itemRow.id,
      done: true,
    });

    expect(updated.done).toBe(true);
    expect(updated.addedByName).toBe("Sam");
  });

  it("rejects updates for rows outside the household", async () => {
    enqueueFrom({ data: null, error: null });

    await expect(
      updateShoppingListItem(adminClient, {
        householdId,
        itemId: itemRow.id,
        done: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("removing an unknown item fails closed with 404", async () => {
    enqueueFrom({ data: [], error: null });

    await expect(
      removeShoppingListItem(adminClient, { householdId, itemId: itemRow.id }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
