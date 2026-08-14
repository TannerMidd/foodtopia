import { describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/client/api";

import {
  classifyOfflineFailure,
  isPermanentOutboxFailure,
  runBoundInventorySync,
} from "./isolation";

describe("offline household isolation", () => {
  it("clears and binds a changed household before refresh without replaying", async () => {
    const calls: string[] = [];
    const replay = vi.fn(async () => {
      calls.push("replay");
      return { conflict: false, failed: false };
    });

    const result = await runBoundInventorySync({
      deriveServerHouseholdId: async () => {
        calls.push("derive");
        return "new-household";
      },
      readPersistedHouseholdId: async () => {
        calls.push("read");
        return "old-household";
      },
      resetAndBind: async (householdId) => {
        calls.push(`reset:${householdId}`);
      },
      replay,
      refresh: async (householdId, forceFull) => {
        calls.push(`refresh:${householdId}:${forceFull}`);
        return { householdId, refreshedAt: "2026-08-13T12:00:00.000Z" };
      },
    });

    expect(calls).toEqual([
      "derive",
      "read",
      "reset:new-household",
      "refresh:new-household:true",
    ]);
    expect(replay).not.toHaveBeenCalled();
    expect(result.householdChanged).toBe(true);
  });

  it("replays only after the persisted household matches the server", async () => {
    const calls: string[] = [];
    await runBoundInventorySync({
      deriveServerHouseholdId: async () => {
        calls.push("derive");
        return "same-household";
      },
      readPersistedHouseholdId: async () => {
        calls.push("read");
        return "same-household";
      },
      resetAndBind: async () => {
        calls.push("reset");
      },
      replay: async () => {
        calls.push("replay");
        return { conflict: false, failed: false };
      },
      refresh: async (householdId) => {
        calls.push("refresh");
        return { householdId, refreshedAt: "2026-08-13T12:00:00.000Z" };
      },
    });

    expect(calls).toEqual(["derive", "read", "replay", "refresh"]);
  });

  it("evicts on authenticated access loss but preserves true offline data", () => {
    const fault = (status: number, retryable = false) =>
      new ApiClientError({ message: "test", status, retryable });

    expect(classifyOfflineFailure(fault(401), true)).toBe("access_revoked");
    expect(classifyOfflineFailure(fault(403), true)).toBe("access_revoked");
    expect(classifyOfflineFailure(fault(0, true), true)).toBe(
      "network_offline",
    );
    expect(classifyOfflineFailure(new Error("network"), false)).toBe(
      "network_offline",
    );
    expect(classifyOfflineFailure(fault(500, true), true)).toBe("error");
  });

  it("keeps a 429 pending while treating non-retryable validation as permanent", () => {
    expect(
      isPermanentOutboxFailure(
        new ApiClientError({ message: "slow down", status: 429, retryable: true }),
      ),
    ).toBe(false);
    expect(
      isPermanentOutboxFailure(
        new ApiClientError({ message: "invalid", status: 422, retryable: false }),
      ),
    ).toBe(true);
  });
});
