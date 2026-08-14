import type { InventoryCommand, InventoryLot } from "@/contracts/domain";
import { ApiFault } from "@/server/http";

export type DemoCookChange = Readonly<{
  lotId: string;
  action: "no_change" | "used_some" | "used_up";
  quantity: number | null;
  unit: string | null;
  expectedVersion: number;
}>;

export function buildDemoCookCommand(
  change: DemoCookChange,
  lot: InventoryLot | undefined,
  commandId: string,
): InventoryCommand | null {
  if (!lot || lot.id !== change.lotId) {
    throw new ApiFault("LOT_NOT_FOUND", "That inventory item no longer exists.", 404);
  }
  if (lot.version !== change.expectedVersion) {
    throw new ApiFault(
      "STALE_VERSION",
      "This item changed in your household. Review the latest value before reapplying.",
      409,
      false,
      lot,
    );
  }
  if (change.action === "no_change") {
    if (change.quantity !== null || change.unit !== null) {
      throw new ApiFault(
        "INVALID_RECONCILIATION",
        "No-change entries cannot include a quantity or unit.",
        422,
      );
    }
    return null;
  }
  if (lot.status !== "active") {
    throw new ApiFault(
      "INVALID_RECONCILIATION",
      "Only active inventory can be marked as used.",
      422,
    );
  }
  if (change.action === "used_up") {
    if (change.quantity !== null || change.unit !== null) {
      throw new ApiFault(
        "INVALID_RECONCILIATION",
        "Used-up entries cannot include a quantity or unit.",
        422,
      );
    }
    return {
      commandId,
      type: "consume",
      expectedVersion: change.expectedVersion,
      payload: { lotId: change.lotId },
    };
  }

  if (
    change.quantity === null ||
    change.unit === null ||
    lot.quantity === null ||
    lot.unit === null ||
    lot.quantityStatus === "unknown"
  ) {
    throw new ApiFault(
      "INVALID_RECONCILIATION",
      "Used-some entries require matching numeric inventory quantities.",
      422,
    );
  }
  if (lot.unit.toLowerCase() !== change.unit.toLowerCase()) {
    throw new ApiFault(
      "INVALID_RECONCILIATION",
      "The used quantity unit must match the inventory unit.",
      422,
    );
  }
  const remaining = lot.quantity - change.quantity;
  if (remaining <= 0) {
    throw new ApiFault(
      "INVALID_RECONCILIATION",
      "Choose used up when the whole inventory lot was consumed.",
      422,
    );
  }
  return {
    commandId,
    type: "adjust",
    expectedVersion: change.expectedVersion,
    payload: {
      lotId: change.lotId,
      quantityStatus: lot.quantityStatus,
      quantity: remaining,
      unit: lot.unit,
    },
  };
}
