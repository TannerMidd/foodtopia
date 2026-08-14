import type { InventoryLot, RecipeIngredient } from "@/contracts/domain";
import { convertQuantity } from "./units";

export type CookAllocationAction = "no_change" | "used_some" | "used_up";

export type CookLotAllocation = Readonly<{
  lotId: string;
  canUseSome: boolean;
  suggestedAction: CookAllocationAction;
  suggestedQuantity: number | null;
  unit: string | null;
}>;

type AllocationIngredient = Pick<RecipeIngredient, "amount" | "unit">;
type AllocationLot = Pick<
  InventoryLot,
  "id" | "quantityStatus" | "quantity" | "unit"
>;

const QUANTITY_EPSILON = 1e-9;

function toInventoryPrecision(value: number): number {
  return Number(value.toFixed(3));
}

/** A collision-free key for the per-ingredient, per-lot review choice. */
export function cookLotChoiceKey(ingredientId: string, lotId: string): string {
  return JSON.stringify([ingredientId, lotId]);
}

/**
 * Greedily allocates the recipe requirement over known, same-family lots in
 * evidence order. Results are suggestions only; the cooking UI still requires
 * explicit reconciliation confirmation.
 */
export function allocateIngredientAcrossLots(
  ingredient: AllocationIngredient,
  lots: readonly AllocationLot[],
): CookLotAllocation[] {
  let remaining =
    ingredient.amount !== null &&
    ingredient.amount > 0 &&
    ingredient.unit
      ? ingredient.amount
      : null;

  return lots.map((lot) => {
    const lotQuantity = lot.quantity;
    const lotUnit = lot.unit;
    const ingredientUnit = ingredient.unit;
    if (
      remaining === null ||
      lot.quantityStatus !== "known" ||
      lotQuantity === null ||
      lotQuantity <= 0 ||
      lotUnit === null ||
      ingredientUnit === null
    ) {
      return {
        lotId: lot.id,
        canUseSome: false,
        suggestedAction: "no_change",
        suggestedQuantity: null,
        unit: null,
      };
    }

    const availableInIngredientUnit = convertQuantity(
      lotQuantity,
      lotUnit,
      ingredientUnit,
    );
    if (availableInIngredientUnit === null || availableInIngredientUnit <= 0) {
      return {
        lotId: lot.id,
        canUseSome: false,
        suggestedAction: "no_change",
        suggestedQuantity: null,
        unit: null,
      };
    }
    if (remaining <= QUANTITY_EPSILON) {
      return {
        lotId: lot.id,
        canUseSome: true,
        suggestedAction: "no_change",
        suggestedQuantity: null,
        unit: lotUnit,
      };
    }

    const allocatedInIngredientUnit = Math.min(
      remaining,
      availableInIngredientUnit,
    );
    remaining = Math.max(0, remaining - allocatedInIngredientUnit);

    if (
      allocatedInIngredientUnit + QUANTITY_EPSILON >=
      availableInIngredientUnit
    ) {
      return {
        lotId: lot.id,
        canUseSome: true,
        suggestedAction: "used_up",
        suggestedQuantity: null,
        unit: lotUnit,
      };
    }

    const quantityInLotUnit = convertQuantity(
      allocatedInIngredientUnit,
      ingredientUnit,
      lotUnit,
    );
    const suggestedQuantity =
      quantityInLotUnit === null ? 0 : toInventoryPrecision(quantityInLotUnit);

    // The database stores three decimal places. If rounding would consume the
    // represented lot, guide the user to used_up instead of emitting an invalid
    // used_some amount with no positive remainder.
    if (
      suggestedQuantity <= 0 ||
      suggestedQuantity + QUANTITY_EPSILON >= lotQuantity
    ) {
      return {
        lotId: lot.id,
        canUseSome: true,
        suggestedAction:
          suggestedQuantity + QUANTITY_EPSILON >= lotQuantity
            ? "used_up"
            : "no_change",
        suggestedQuantity: null,
        unit: lotUnit,
      };
    }

    return {
      lotId: lot.id,
      canUseSome: true,
      suggestedAction: "used_some",
      suggestedQuantity,
      unit: lotUnit,
    };
  });
}
