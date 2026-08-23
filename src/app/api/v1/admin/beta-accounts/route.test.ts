import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiFault } from "@/server/http";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  listUsers: vi.fn(),
  profilesSelect: vi.fn(),
  settingsSingle: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isDemoMode: false }));
vi.mock("@/server/auth/admin-user", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));

describe("GET /api/v1/admin/beta-accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminSession.mockResolvedValue({ userId: "00000000-0000-4000-8000-000000000001" });
    mocks.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: "00000000-0000-4000-8000-000000000010",
            email: "confirmed@example.test",
            created_at: "2026-08-20T10:00:00.000Z",
            email_confirmed_at: "2026-08-20T10:05:00.000Z",
            last_sign_in_at: "2026-08-20T10:05:00.000Z",
          },
          {
            id: "00000000-0000-4000-8000-000000000011",
            email: "unconfirmed@example.test",
            created_at: "2026-08-21T10:00:00.000Z",
            email_confirmed_at: null,
            last_sign_in_at: null,
          },
          {
            id: "00000000-0000-4000-8000-000000000012",
            email: "enabled@example.test",
            created_at: "2026-08-19T10:00:00.000Z",
            email_confirmed_at: "2026-08-19T10:01:00.000Z",
            last_sign_in_at: "2026-08-22T10:00:00.000Z",
          },
        ],
      },
      error: null,
    });
    mocks.profilesSelect.mockResolvedValue({
      data: [
        {
          id: "00000000-0000-4000-8000-000000000011",
          status: "pending",
          display_name: null,
          enabled_at: null,
        },
        {
          id: "00000000-0000-4000-8000-000000000012",
          status: "enabled",
          display_name: "Enabled Person",
          enabled_at: "2026-08-19T10:02:00.000Z",
        },
      ],
      error: null,
    });
    mocks.settingsSingle.mockResolvedValue({
      data: { signups_open: true },
      error: null,
    });
    mocks.createAdminSupabaseClient.mockReturnValue({
      auth: { admin: { listUsers: mocks.listUsers } },
      from: (table: string) => {
        if (table === "profiles") return { select: mocks.profilesSelect };
        if (table === "beta_signup_settings") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: mocks.settingsSingle }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });
  });

  it("projects confirmation state and keeps missing profiles visible as pending", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("https://foodtopia.example/api/v1/admin/beta-accounts"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.signupsOpen).toBe(true);
    expect(body.counts).toEqual({ pending: 2, enabled: 1, disabled: 0 });
    expect(body.accounts).toEqual([
      expect.objectContaining({
        userId: "00000000-0000-4000-8000-000000000010",
        status: "pending",
        emailConfirmedAt: "2026-08-20T10:05:00.000Z",
      }),
      expect.objectContaining({
        userId: "00000000-0000-4000-8000-000000000011",
        status: "pending",
        emailConfirmedAt: null,
      }),
      expect.objectContaining({
        userId: "00000000-0000-4000-8000-000000000012",
        status: "enabled",
        emailConfirmedAt: "2026-08-19T10:01:00.000Z",
      }),
    ]);
  });

  it("does not touch service-role data when administrator authorization fails", async () => {
    mocks.requireAdminSession.mockRejectedValue(
      new ApiFault("ADMIN_AUTHORIZATION_REQUIRED", "Administrator access is required.", 403),
    );
    const { GET } = await import("./route");
    const response = await GET(new Request("https://foodtopia.example/api/v1/admin/beta-accounts"));

    expect(response.status).toBe(403);
    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled();
  });
});
