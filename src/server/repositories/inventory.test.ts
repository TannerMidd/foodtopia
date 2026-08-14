import { describe, expect, it } from "vitest";

import type { InventoryCommand } from "@/contracts/domain";
import { inventorySyncResponseSchema } from "@/contracts/api";
import { ApiFault } from "@/server/http";

import {
  assertInventoryCommandHousehold,
  decodeInventoryCursor,
  encodeInventoryCursor,
  getInventorySync,
} from "./inventory";

describe("inventory cursor", () => {
  it("round-trips an opaque ordered-event cursor", () => {
    const cursor = {
      createdAt: "2026-08-13T10:00:00.000Z",
      eventId: "11111111-1111-4111-8111-111111111111",
    };
    expect(decodeInventoryCursor(encodeInventoryCursor(cursor))).toEqual(cursor);
  });

  it("uses an empty string for the initial full-snapshot cursor", () => {
    expect(encodeInventoryCursor(null)).toBe("");
    expect(decodeInventoryCursor("")).toBeNull();
  });

  it("rejects forged or malformed cursors", () => {
    expect(() => decodeInventoryCursor("not-a-cursor")).toThrow(ApiFault);
  });

  it("normalizes Supabase event timestamps before the sync response is parsed", async () => {
    const client = {
      rpc: async () => ({
        data: {
          lots: [],
          events: [
            {
              id: "20000000-0000-4000-8000-000000000001",
              lotId: "20000000-0000-4000-8000-000000000002",
              type: "added",
              createdAt: "2026-08-14T21:40:24.132336+00:00",
            },
          ],
          cursor: {
            createdAt: "2026-08-14T21:40:24.132336+00:00",
            eventId: "20000000-0000-4000-8000-000000000001",
          },
        },
        error: null,
      }),
    };

    const result = await getInventorySync(client as never, null);
    const parsed = inventorySyncResponseSchema.parse({
      householdId: "20000000-0000-4000-8000-000000000003",
      ...result,
    });

    expect(parsed.events[0]?.createdAt).toBe("2026-08-14T21:40:24.132Z");
  });
});

describe("inventory command household boundary", () => {
  const addCommand: InventoryCommand = {
    commandId: "10000000-0000-4000-8000-000000000001",
    type: "add",
    expectedVersion: null,
    payload: {
      id: "10000000-0000-4000-8000-000000000002",
      householdId: "10000000-0000-4000-8000-000000000003",
      foodConceptId: null,
      name: "Test food",
      category: "other",
      quantityStatus: "unknown",
      quantity: null,
      unit: null,
      form: "unspecified",
      location: "unknown",
      dateLabelType: null,
      dateLabel: null,
      status: "active",
    },
  };

  it("accepts an add only when its optimistic DTO matches the authenticated household", () => {
    expect(() =>
      assertInventoryCommandHousehold(
        addCommand,
        addCommand.payload.householdId,
      ),
    ).not.toThrow();
  });

  it("rejects a stale add tenant before the RPC", () => {
    expect(() =>
      assertInventoryCommandHousehold(
        addCommand,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).toThrowError(ApiFault);
    try {
      assertInventoryCommandHousehold(
        addCommand,
        "20000000-0000-4000-8000-000000000001",
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: "HOUSEHOLD_CONTEXT_MISMATCH",
        status: 403,
      });
    }
  });
});
