import { describe, expect, it } from "vitest";

import {
  allocateIngredientAcrossLots,
  cookLotChoiceKey,
} from "./cook-allocation";

describe("cook allocation", () => {
  it("allocates across compatible lots in stable evidence order", () => {
    const allocations = allocateIngredientAcrossLots(
      { amount: 1.25, unit: "cup" },
      [
        {
          id: "first",
          quantityStatus: "known",
          quantity: 8,
          unit: "tbsp",
        },
        {
          id: "second",
          quantityStatus: "known",
          quantity: 1,
          unit: "cup",
        },
        {
          id: "third",
          quantityStatus: "known",
          quantity: 2,
          unit: "cup",
        },
      ],
    );

    expect(allocations).toEqual([
      {
        lotId: "first",
        canUseSome: true,
        suggestedAction: "used_up",
        suggestedQuantity: null,
        unit: "tbsp",
      },
      {
        lotId: "second",
        canUseSome: true,
        suggestedAction: "used_some",
        suggestedQuantity: 0.75,
        unit: "cup",
      },
      {
        lotId: "third",
        canUseSome: true,
        suggestedAction: "no_change",
        suggestedQuantity: null,
        unit: "cup",
      },
    ]);
  });

  it("does not allocate through unknown, estimated, or cross-family lots", () => {
    const allocations = allocateIngredientAcrossLots(
      { amount: 2, unit: "cup" },
      [
        {
          id: "unknown",
          quantityStatus: "unknown",
          quantity: null,
          unit: null,
        },
        {
          id: "estimated",
          quantityStatus: "estimated",
          quantity: 3,
          unit: "cup",
        },
        {
          id: "mass",
          quantityStatus: "known",
          quantity: 500,
          unit: "g",
        },
        {
          id: "compatible",
          quantityStatus: "known",
          quantity: 4,
          unit: "cup",
        },
      ],
    );

    expect(allocations.slice(0, 3).map((allocation) => ({
      canUseSome: allocation.canUseSome,
      suggestedAction: allocation.suggestedAction,
    }))).toEqual([
      { canUseSome: false, suggestedAction: "no_change" },
      { canUseSome: false, suggestedAction: "no_change" },
      { canUseSome: false, suggestedAction: "no_change" },
    ]);
    expect(allocations[3]).toMatchObject({
      lotId: "compatible",
      canUseSome: true,
      suggestedAction: "used_some",
      suggestedQuantity: 2,
    });
  });

  it("returns manual-only guidance without a numeric recipe requirement", () => {
    expect(
      allocateIngredientAcrossLots(
        { amount: null, unit: null },
        [
          {
            id: "known",
            quantityStatus: "known",
            quantity: 2,
            unit: "count",
          },
        ],
      ),
    ).toEqual([
      {
        lotId: "known",
        canUseSome: false,
        suggestedAction: "no_change",
        suggestedQuantity: null,
        unit: null,
      },
    ]);
  });

  it("keys choices by both ingredient and lot without delimiter collisions", () => {
    expect(cookLotChoiceKey("a:b", "c")).not.toBe(
      cookLotChoiceKey("a", "b:c"),
    );
  });
});
