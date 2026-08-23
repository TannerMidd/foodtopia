import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSameOrigin: vi.fn(),
  requireAdminSession: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  getUserById: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isDemoMode: false }));
vi.mock("@/server/origin", () => ({ assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/server/auth/admin-user", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));

const confirmedId = "00000000-0000-4000-8000-000000000010";
const otherConfirmedId = "00000000-0000-4000-8000-000000000011";
const unconfirmedId = "00000000-0000-4000-8000-000000000012";

function request(userIds: string[]) {
  return new NextRequest("https://foodtopia.example/api/v1/admin/beta-accounts/enable", {
    method: "POST",
    headers: { origin: "https://foodtopia.example", "content-type": "application/json" },
    body: JSON.stringify({ userIds }),
  });
}

describe("POST /api/v1/admin/beta-accounts/enable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminSession.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
    });
    mocks.getUserById.mockImplementation(async (userId: string) => ({
      data: {
        user: {
          id: userId,
          email_confirmed_at: userId === unconfirmedId ? null : "2026-08-20T10:05:00.000Z",
        },
      },
      error: null,
    }));
    mocks.select.mockResolvedValue({ data: [{ id: confirmedId }], error: null });
    mocks.update.mockReturnValue({
      in: () => ({
        neq: () => ({ select: mocks.select }),
      }),
    });
    mocks.createAdminSupabaseClient.mockReturnValue({
      auth: { admin: { getUserById: mocks.getUserById } },
      from: () => ({ update: mocks.update }),
    });
  });

  it("enables a batch only after every Auth user has confirmed their email", async () => {
    mocks.select.mockResolvedValue({
      data: [{ id: confirmedId }, { id: otherConfirmedId }],
      error: null,
    });
    const { POST } = await import("./route");
    const response = await POST(request([confirmedId, otherConfirmedId]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changedCount: 2 });
    expect(mocks.getUserById).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("rejects a mixed confirmed and unconfirmed batch without updating profiles", async () => {
    const { POST } = await import("./route");
    const response = await POST(request([confirmedId, unconfirmedId]));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      code: "BETA_ACCOUNT_EMAIL_UNCONFIRMED",
      message: "Every selected account must confirm its email before it can be enabled.",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps missing-user and provider failures generic and does not update profiles", async () => {
    mocks.getUserById.mockResolvedValue({
      data: { user: null },
      error: Object.assign(new Error(`missing ${confirmedId} private@example.test`), {
        code: "auth_user_not_found",
        status: 404,
      }),
    });
    const { POST } = await import("./route");
    const response = await POST(request([confirmedId]));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(404);
    expect(serialized).not.toContain(confirmedId);
    expect(serialized).not.toContain("private@example.test");
    expect(serialized).not.toContain("missing");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
