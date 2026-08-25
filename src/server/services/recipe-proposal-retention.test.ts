import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: mocks.from }),
}));

import {
  RECIPE_PROPOSAL_PURGE_CRON,
  purgeExpiredRecipeProposals,
} from "./recipe-proposal-retention";

describe("recipe proposal retention", () => {
  it("expires overdue pending payloads without selecting their content", async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: "one" }, { id: "two" }], error: null });
    const lte = vi.fn(() => ({ select }));
    const eq = vi.fn(() => ({ lte }));
    const update = vi.fn(() => ({ eq }));
    mocks.from.mockReturnValue({ update });

    await expect(
      purgeExpiredRecipeProposals(
        { from: mocks.from } as never,
        new Date("2026-08-27T12:00:00.000Z"),
      ),
    ).resolves.toEqual({ expiredCount: 2 });

    expect(RECIPE_PROPOSAL_PURGE_CRON).toBe("17 * * * *");
    expect(update).toHaveBeenCalledWith({
      status: "expired",
      recipe_payload: null,
      content_hash: null,
      decided_at: "2026-08-27T12:00:00.000Z",
      version: 1,
    });
    expect(eq).toHaveBeenCalledWith("status", "proposed");
    expect(lte).toHaveBeenCalledWith("expires_at", "2026-08-27T12:00:00.000Z");
    expect(select).toHaveBeenCalledWith("id");
  });

  it("fails closed when the service update fails", async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: new Error("database unavailable") });
    const lte = vi.fn(() => ({ select }));
    const eq = vi.fn(() => ({ lte }));
    mocks.from.mockReturnValue({ update: vi.fn(() => ({ eq })) });

    await expect(
      purgeExpiredRecipeProposals(
        { from: mocks.from } as never,
        new Date("2026-08-27T12:00:00.000Z"),
      ),
    ).rejects.toThrow("database unavailable");
  });
});
