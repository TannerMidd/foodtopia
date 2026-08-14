import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));

describe("administrator login global rate limit", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.createAdminSupabaseClient.mockReturnValue({ rpc: mocks.rpc });
  });

  it("consumes the global 5-per-15-minute bucket before the 20-per-hour bucket", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { allowed: true, remaining: 4, retryAfterSeconds: 0 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { allowed: true, remaining: 19, retryAfterSeconds: 0 },
        error: null,
      });
    const { consumeAdminLoginRateLimit } = await import("./admin-login-rate-limit");

    await expect(consumeAdminLoginRateLimit()).resolves.toBeNull();
    expect(mocks.createAdminSupabaseClient).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "consume_pre_auth_rate_limit", {
      p_bucket: "admin_password_login",
      p_limit: 5,
      p_window_seconds: 900,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "consume_pre_auth_rate_limit", {
      p_bucket: "admin_password_login",
      p_limit: 20,
      p_window_seconds: 3_600,
    });
  });

  it("returns a bounded retry interval when the first global window blocks", async () => {
    mocks.rpc.mockResolvedValue({
      data: { allowed: false, remaining: 0, retryAfterSeconds: 0 },
      error: null,
    });
    const { consumeAdminLoginRateLimit } = await import("./admin-login-rate-limit");

    await expect(consumeAdminLoginRateLimit()).resolves.toBe(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns a bounded retry interval when the second global window blocks", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { allowed: true, remaining: 4, retryAfterSeconds: 0 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { allowed: false, remaining: 0, retryAfterSeconds: 23 },
        error: null,
      });
    const { consumeAdminLoginRateLimit } = await import("./admin-login-rate-limit");

    await expect(consumeAdminLoginRateLimit()).resolves.toBe(23);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("fails closed with a retryable 503 when a bucket cannot be checked", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    const { consumeAdminLoginRateLimit } = await import("./admin-login-rate-limit");

    await expect(consumeAdminLoginRateLimit()).rejects.toMatchObject({
      code: "RATE_LIMIT_CHECK_FAILED",
      status: 503,
      retryable: true,
    });
  });
});
