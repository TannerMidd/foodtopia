import { beforeEach, describe, expect, it } from "vitest";

import {
  applyDemoCommand,
  listDemoInventory,
  resetDemoStateForTests,
} from "@/server/demo/store";

import { buildDemoCookCommand } from "./demo-cook-reconciliation";

describe("demo cook reconciliation", () => {
  beforeEach(resetDemoStateForTests);

  it("adjusts the remaining quantity for used_some instead of consuming the lot", () => {
    const tomatoes = listDemoInventory().find((lot) => lot.name === "Tomatoes")!;
    const command = buildDemoCookCommand(
      {
        lotId: tomatoes.id,
        action: "used_some",
        quantity: 1,
        unit: "count",
        expectedVersion: tomatoes.version,
      },
      tomatoes,
      crypto.randomUUID(),
    );

    expect(command?.type).toBe("adjust");
    const result = applyDemoCommand(command!);
    expect(result.lot).toMatchObject({ status: "active", quantity: 3 });
  });

  it("uses consume only for used_up", () => {
    const tomatoes = listDemoInventory().find((lot) => lot.name === "Tomatoes")!;
    const command = buildDemoCookCommand(
      {
        lotId: tomatoes.id,
        action: "used_up",
        quantity: null,
        unit: null,
        expectedVersion: tomatoes.version,
      },
      tomatoes,
      crypto.randomUUID(),
    );

    expect(command?.type).toBe("consume");
    expect(applyDemoCommand(command!).lot.status).toBe("consumed");
  });
});
