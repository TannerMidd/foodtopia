import { describe, expect, it } from "vitest";
import {
  inventoryCommandSchema,
  type InventoryCommand,
} from "../contracts/domain";
import { createInventoryState, reduceInventoryCommand } from "./inventory";

const COMMAND_ID = "30000000-0000-4000-8000-000000000001";
const LOT_ID = "40000000-0000-4000-8000-000000000001";
const HOUSEHOLD_ID = "50000000-0000-4000-8000-000000000001";

function addCommand(commandId = COMMAND_ID): InventoryCommand {
  return {
    commandId,
    type: "add",
    expectedVersion: null,
    payload: {
      id: LOT_ID,
      householdId: HOUSEHOLD_ID,
      foodConceptId: "rice",
      name: "Rice",
      category: "Grains",
      quantityStatus: "known",
      quantity: 2,
      unit: "cup",
      form: "dried",
      location: "pantry",
      dateLabelType: null,
      dateLabel: null,
      status: "active",
    },
  };
}

describe("inventory command reducer", () => {
  it("adds a version-zero lot and emits an immutable event", () => {
    const initial = createInventoryState();
    const result = reduceInventoryCommand(
      initial,
      addCommand(),
      "2026-08-13T12:00:00.000Z",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(initial.lots).toHaveLength(0);
    expect(result.state.lots[0].version).toBe(0);
    expect(result.event.type).toBe("lot_added");
    expect(result.replayed).toBe(false);
  });

  it("replays an identical command before checking current versions", () => {
    const first = reduceInventoryCommand(createInventoryState(), addCommand());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replay = reduceInventoryCommand(first.state, addCommand());
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.replayed).toBe(true);
    expect(replay.state).toBe(first.state);
    expect(replay.event).toEqual(first.event);
  });

  it("rejects reuse of a command ID with different content", () => {
    const first = reduceInventoryCommand(createInventoryState(), addCommand());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const changed = addCommand();
    if (changed.type !== "add") return;
    const reuse: InventoryCommand = {
      ...changed,
      payload: { ...changed.payload, quantity: 3 },
    };

    const result = reduceInventoryCommand(first.state, reuse);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("command_id_reused");
  });

  it("reports optimistic version conflicts without changing state", () => {
    const first = reduceInventoryCommand(createInventoryState(), addCommand());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const stale: InventoryCommand = {
      commandId: "30000000-0000-4000-8000-000000000002",
      type: "adjust",
      expectedVersion: 2,
      payload: { lotId: LOT_ID, quantity: 1 },
    };

    const result = reduceInventoryCommand(first.state, stale);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: "version_conflict",
      expectedVersion: 2,
      actualVersion: 0,
    });
    expect(result.state).toBe(first.state);
  });

  it("applies an offline-compatible identity correction", () => {
    const first = reduceInventoryCommand(createInventoryState(), addCommand());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const adjusted = reduceInventoryCommand(first.state, {
      commandId: "30000000-0000-4000-8000-000000000005",
      type: "adjust",
      expectedVersion: 0,
      payload: {
        lotId: LOT_ID,
        foodConceptId: "olive-oil",
        name: "EVOO",
        category: "Oils",
      },
    });

    expect(adjusted.ok).toBe(true);
    if (!adjusted.ok) return;
    expect(adjusted.event.lot).toMatchObject({
      foodConceptId: "olive-oil",
      name: "EVOO",
      category: "Oils",
      version: 1,
    });
  });

  it("supports explicit consume and restore transitions", () => {
    const first = reduceInventoryCommand(createInventoryState(), addCommand());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const consumed = reduceInventoryCommand(first.state, {
      commandId: "30000000-0000-4000-8000-000000000003",
      type: "consume",
      expectedVersion: 0,
      payload: { lotId: LOT_ID },
    });
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) return;
    expect(consumed.event.lot.status).toBe("consumed");
    expect(consumed.event.version).toBe(1);

    const restored = reduceInventoryCommand(consumed.state, {
      commandId: "30000000-0000-4000-8000-000000000004",
      type: "restore",
      expectedVersion: 1,
      payload: { lotId: LOT_ID },
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.event.lot.status).toBe("active");
    expect(restored.event.version).toBe(2);
  });

  it("rejects partial quantities on the used-up consume command", () => {
    expect(
      inventoryCommandSchema.safeParse({
        commandId: "30000000-0000-4000-8000-000000000009",
        type: "consume",
        expectedVersion: 0,
        payload: { lotId: LOT_ID, quantity: 1, unit: "cup" },
      }).success,
    ).toBe(false);
  });

  it("rejects incoherent quantity state instead of guessing", () => {
    const invalid = addCommand();
    if (invalid.type !== "add") return;
    const command: InventoryCommand = {
      ...invalid,
      payload: {
        ...invalid.payload,
        quantityStatus: "unknown",
        quantity: 2,
        unit: "cup",
      },
    };
    const result = reduceInventoryCommand(createInventoryState(), command);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_command");
  });
});
