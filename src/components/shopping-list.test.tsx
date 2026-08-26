import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  online: true,
  getList: vi.fn(),
  addItems: vi.fn(),
  setDone: vi.fn(),
  removeItem: vi.fn(),
  metaGet: vi.fn<(key?: unknown) => Promise<unknown>>(async () => undefined),
  metaPut: vi.fn(async () => undefined),
}));

vi.mock("@/lib/client/api", () => ({
  getShoppingList: mocks.getList,
  addShoppingListItems: mocks.addItems,
  setShoppingListItemDone: mocks.setDone,
  deleteShoppingListItem: mocks.removeItem,
  ApiClientError: class ApiClientError extends Error {
    status = 0;
  },
}));
vi.mock("@/lib/offline/db", () => ({
  getOfflineDb: () => ({
    meta: {
      get: mocks.metaGet,
      put: mocks.metaPut,
    },
  }),
}));
vi.mock("./offline-provider", () => ({
  useOfflineInventory: () => ({ online: mocks.online }),
}));

import { ShoppingList } from "./shopping-list";

const item = {
  id: "9f3c1b2a-1111-4111-8111-111111111111",
  name: "Lemons",
  category: "Produce",
  foodConceptId: "lemon",
  quantityText: "2 count",
  done: false,
  addedByName: "Sam",
  createdAt: "2026-08-27T10:00:00.000Z",
};

describe("ShoppingList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getList.mockReset();
  });

  it("renders the synced shared list with member attribution", async () => {
    mocks.getList.mockResolvedValue({ items: [item] });
    render(<ShoppingList />);

    expect(await screen.findByText("Lemons")).toBeVisible();
    expect(screen.getByText(/added by sam/i)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /mark lemons as fetched/i })).toBeVisible();
  });

  it("adds a typed item and clears the input", async () => {
    const user = userEvent.setup();
    mocks.getList.mockResolvedValue({ items: [] });
    mocks.addItems.mockResolvedValue({
      items: [item],
      added: 1,
      replayedNames: [],
    });
    render(<ShoppingList />);

    await screen.findByPlaceholderText(/add something to fetch/i);
    await user.type(screen.getByLabelText(/add an item to the shopping list/i), "Lemons");
    await user.click(screen.getByRole("button", { name: /add to shopping list/i }));

    await screen.findByText("Lemons");
    expect(mocks.addItems).toHaveBeenCalledWith({
      items: [
        { name: "Lemons", category: "Produce", foodConceptId: "lemon", quantityText: null },
      ],
    });
  });

  it("shows the cached list offline and blocks mutations", async () => {
    mocks.online = false;
    mocks.metaGet.mockResolvedValue({
      key: "shoppingList",
      value: JSON.stringify([item]),
    });
    const user = userEvent.setup();
    render(<ShoppingList />);

    expect(await screen.findByText(/showing the last synced list/i)).toBeVisible();
    const toggle = screen.getByRole("checkbox", { name: /mark lemons as fetched/i });
    expect(toggle).toBeDisabled();
    // A disabled control cannot be clicked; guard against accidental mutations.
    await user.click(toggle).catch(() => undefined);
    expect(mocks.setDone).not.toHaveBeenCalled();

    mocks.online = true;
  });

  it("reverts an optimistic toggle when the server rejects it", async () => {
    const user = userEvent.setup();
    mocks.getList.mockResolvedValue({ items: [item] });
    mocks.setDone.mockRejectedValue(new Error("Someone else edited this item."));
    render(<ShoppingList />);

    await user.click(await screen.findByRole("checkbox", { name: /mark lemons as fetched/i }));

    // The optimistic flip is undone: the item returns to unchecked ("as fetched")
    // and the server-side explanation surfaces.
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /mark lemons as fetched/i })).toBeVisible();
    });
    expect(await screen.findByText(/someone else edited/i)).toBeVisible();
  });
});
