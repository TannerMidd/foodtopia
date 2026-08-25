import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiFault } from "@/server/http";

type ResultLike<T> = { data: T; error: unknown };

const adminMocks = vi.hoisted(() => {
  const makeThenable = <T>(result: ResultLike<T>) => {
    const builder: Record<string, unknown> = {
      then: (
        resolve?: (value: ResultLike<T>) => unknown,
        reject?: (error: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject),
    };
    for (const method of ["select", "eq", "not", "lte", "like", "limit"]) {
      builder[method] = vi.fn(() => builder);
    }
    return builder;
  };

  const rpc = vi.fn();
  const list = vi.fn();
  const remove = vi.fn();

  const admin = {
    from: vi.fn((table: string) =>
      table === "households"
        ? makeThenable({ data: [{ id: HOUSEHOLD_ID }], error: null })
        : makeThenable({
            data: [{ object_path: `${HOUSEHOLD_ID}/tracked.webp` }],
            error: null,
          }),
    ),
    rpc,
    storage: {
      from: vi.fn(() => ({ list, remove })),
    },
  };
  return { admin, rpc, list, remove };
});

const HOUSEHOLD_ID = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => adminMocks.admin,
}));

import { ApiFault as ImportedApiFault } from "@/server/http";
import {
  deleteCurrentHousehold,
  finalizePendingHouseholdDeletions,
} from "./households";

const userRpc = vi.fn();
const userClientStub = {
  rpc: userRpc,
} as unknown as Parameters<typeof deleteCurrentHousehold>[0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteCurrentHousehold owner-required faults", () => {
  it("surfaces 42501 from request_household_deletion as an owner fault", async () => {
    userRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "owner required" },
    });

    const error = await deleteCurrentHousehold(
      userClientStub,
      HOUSEHOLD_ID,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ImportedApiFault);
    expect(error).toMatchObject({
      code: "HOUSEHOLD_DELETE_NOT_OWNER",
      status: 403,
    });
    expect(adminMocks.rpc).not.toHaveBeenCalled();
  });

  it("surfaces 42501 from the finalizer as an owner fault instead of a retryable failure", async () => {
    userRpc.mockResolvedValueOnce({
      data: {
        householdId: HOUSEHOLD_ID,
        bucketId: "raw-images",
        objectPaths: [],
        status: "deletion_pending",
        finalizeAfter: new Date(Date.now() - 1000).toISOString(),
        replayed: false,
      },
      error: null,
    });
    adminMocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "not requested by an owner" },
    });

    const error = await deleteCurrentHousehold(
      userClientStub,
      HOUSEHOLD_ID,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiFault);
    expect(error).toMatchObject({
      code: "HOUSEHOLD_DELETE_NOT_OWNER",
      status: 403,
    });
  });
});

describe("finalizePendingHouseholdDeletions orphaned-object purge", () => {
  it("removes tracked assets together with prefix-scoped orphans before finalizing", async () => {
    // Flat orphan plus an empty pseudo-folder: the folder must be descended
    // into (finding nothing) without breaking the sweep.
    adminMocks.list.mockImplementation((prefix?: string) => {
      if (prefix === HOUSEHOLD_ID) {
        return Promise.resolve({
          data: [
            { id: "orphan-1", name: "orphan-a.bin" },
            { id: null, name: "empty-folder/" },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    adminMocks.remove.mockResolvedValue({ error: null });
    adminMocks.rpc.mockResolvedValue({
      data: { deleted: true, replayed: false },
      error: null,
    });

    const { finalized } = await finalizePendingHouseholdDeletions();

    expect(finalized).toBe(1);
    expect(adminMocks.remove).toHaveBeenCalledWith([
      `${HOUSEHOLD_ID}/tracked.webp`,
      `${HOUSEHOLD_ID}/orphan-a.bin`,
    ]);
    expect(adminMocks.rpc).toHaveBeenCalledWith("finalize_household_deletion", {
      p_household_id: HOUSEHOLD_ID,
    });
  });

  it("recurses through nested pseudo-folders to reach deeply orphaned uploads", async () => {
    const userId = "33333333-3333-4333-8333-333333333333";
    const analysisId = "44444444-4444-4444-8444-444444444444";
    adminMocks.list.mockImplementation((prefix?: string) => {
      switch (prefix) {
        case HOUSEHOLD_ID:
          return Promise.resolve({
            data: [{ id: null, name: `${userId}/` }],
            error: null,
          });
        case `${HOUSEHOLD_ID}/${userId}`:
          return Promise.resolve({
            data: [{ id: null, name: `${analysisId}/` }],
            error: null,
          });
        case `${HOUSEHOLD_ID}/${userId}/${analysisId}`:
          return Promise.resolve({
            data: [{ id: "orphan-deep", name: "orphan.jpg" }],
            error: null,
          });
        default:
          return Promise.resolve({ data: [], error: null });
      }
    });
    adminMocks.remove.mockResolvedValue({ error: null });
    adminMocks.rpc.mockResolvedValue({
      data: { deleted: true, replayed: false },
      error: null,
    });

    const { finalized } = await finalizePendingHouseholdDeletions();

    expect(finalized).toBe(1);
    expect(adminMocks.remove).toHaveBeenCalledWith([
      `${HOUSEHOLD_ID}/tracked.webp`,
      `${HOUSEHOLD_ID}/${userId}/${analysisId}/orphan.jpg`,
    ]);
    expect(adminMocks.rpc).toHaveBeenCalledWith("finalize_household_deletion", {
      p_household_id: HOUSEHOLD_ID,
    });
  });

  it("skips finalization while Storage deletion fails, leaving the sweep retryable", async () => {
    adminMocks.list.mockResolvedValue({ data: [], error: null });
    adminMocks.remove.mockResolvedValue({
      error: { message: "storage unavailable" },
    });

    const { finalized } = await finalizePendingHouseholdDeletions();

    expect(finalized).toBe(0);
    expect(adminMocks.rpc).not.toHaveBeenCalled();
  });
});
