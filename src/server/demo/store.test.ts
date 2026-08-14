import { beforeEach, describe, expect, it } from "vitest";

import type { InventoryCommand } from "@/contracts/domain";

import {
  applyDemoCommand,
  listDemoInventory,
  resetDemoStateForTests,
} from "./store";

describe("demo persistence contract", () => {
  beforeEach(resetDemoStateForTests);

  it("replays the same command without a second event or version change", () => {
    const tomato = listDemoInventory().find((lot) => lot.name === "Tomatoes")!;
    const command: InventoryCommand = {
      commandId: crypto.randomUUID(),
      type: "adjust",
      expectedVersion: tomato.version,
      payload: { lotId: tomato.id, location: "pantry" },
    };

    const first = applyDemoCommand(command);
    const replay = applyDemoCommand(command);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.lot).toEqual(first.lot);
  });

  it("rejects a stale version before changing inventory", () => {
    const tomato = listDemoInventory().find((lot) => lot.name === "Tomatoes")!;
    applyDemoCommand({
      commandId: crypto.randomUUID(),
      type: "adjust",
      expectedVersion: tomato.version,
      payload: { lotId: tomato.id, location: "pantry" },
    });

    expect(() =>
      applyDemoCommand({
        commandId: crypto.randomUUID(),
        type: "discard",
        expectedVersion: tomato.version,
        payload: { lotId: tomato.id },
      }),
    ).toThrow(/changed in your household/i);
  });
});

