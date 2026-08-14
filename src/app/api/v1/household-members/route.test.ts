import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  requireHouseholdSession: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isDemoMode: false }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/server/auth/session", () => ({
  requireHouseholdSession: mocks.requireHouseholdSession,
}));

const MEMBER_ID = "7f892312-7c71-4e9f-a595-f8300f6d3234";

describe("GET /api/v1/household-members", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.requireHouseholdSession.mockResolvedValue({
      userId: MEMBER_ID,
      householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
      role: "owner",
    });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("accepts PostgreSQL offset timestamps and returns canonical timestamps without email data", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        members: [
          {
            userId: MEMBER_ID,
            displayName: "Admin",
            role: "owner",
            joinedAt: "2026-08-14T17:00:00+00:00",
          },
        ],
      },
      error: null,
    });
    const { GET } = await import("./route");

    const response = await GET(
      new Request("https://foodtopia.example/api/v1/household-members"),
    );

    expect(mocks.requireHouseholdSession).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("list_household_members");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      members: [
        {
          userId: MEMBER_ID,
          displayName: "Admin",
          email: null,
          role: "owner",
          joinedAt: "2026-08-14T17:00:00.000Z",
        },
      ],
    });
  });

  it("fails closed when the RPC returns a malformed member payload", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        members: [
          {
            userId: MEMBER_ID,
            displayName: "Admin",
            role: "owner",
            joinedAt: "not-a-timestamp",
          },
        ],
      },
      error: null,
    });
    const { GET } = await import("./route");

    const response = await GET(
      new Request("https://foodtopia.example/api/v1/household-members", {
        headers: { "x-correlation-id": "household-members-malformed" },
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Some submitted fields are invalid.",
      retryable: false,
      correlationId: "household-members-malformed",
    });
  });
});
