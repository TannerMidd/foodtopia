import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createResponseSupabaseClient: vi.fn(),
  signInWithPassword: vi.fn(),
  consumeAdminLoginRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createResponseSupabaseClient: mocks.createResponseSupabaseClient,
}));
vi.mock("@/server/auth/admin-login-rate-limit", () => ({
  consumeAdminLoginRateLimit: mocks.consumeAdminLoginRateLimit,
}));

describe("POST /api/v1/auth/admin-login", () => {
  let callbackResponse: NextResponse | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://foodtopia.example");
    vi.stubEnv("FOODTOPIA_ADMIN_LOGIN_ENABLED", "true");
    vi.stubEnv("FOODTOPIA_ADMIN_USERNAME", "Admin");
    vi.stubEnv("FOODTOPIA_ADMIN_EMAIL", "admin@example.test");
    mocks.consumeAdminLoginRateLimit.mockResolvedValue(null);
    mocks.createResponseSupabaseClient.mockImplementation(
      (_request: NextRequest, response: NextResponse) => {
        callbackResponse = response;
        return {
          auth: {
            signInWithPassword: mocks.signInWithPassword,
          },
        };
      },
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps only the configured admin username to its server-side email and forwards the session cookie", async () => {
    mocks.signInWithPassword.mockImplementation(async () => {
      callbackResponse?.cookies.set({
        name: "sb-foodtopia-auth-token",
        value: "session-value",
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      });
      return { error: null };
    });
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://foodtopia.example/api/v1/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({ username: "Admin", password: "not-a-real-password" }),
        headers: {
          "content-type": "application/json",
          origin: "https://foodtopia.example",
        },
      }),
    );

    expect(mocks.createResponseSupabaseClient).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "admin@example.test",
      password: "not-a-real-password",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.cookies.get("sb-foodtopia-auth-token")).toMatchObject({
      name: "sb-foodtopia-auth-token",
      value: "session-value",
      httpOnly: true,
      path: "/",
    });
  });

  it("does not reveal whether an unknown username is configured", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://foodtopia.example/api/v1/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({ username: "SomeoneElse", password: "not-a-real-password" }),
        headers: {
          "content-type": "application/json",
          origin: "https://foodtopia.example",
        },
      }),
    );

    const body = await response.json() as Record<string, unknown>;
    expect(mocks.createResponseSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(body)).not.toContain("SomeoneElse");
    expect(JSON.stringify(body)).not.toContain("admin@example.test");
    expect(body.message).toBe("Invalid username or password.");
    expect(body.retryable).toBe(false);
  });

  it("returns the same generic failure for a bad password", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: new Error("Invalid login credentials") });
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://foodtopia.example/api/v1/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({ username: "Admin", password: "wrong-password" }),
        headers: {
          "content-type": "application/json",
          origin: "https://foodtopia.example",
        },
      }),
    );

    const body = await response.json() as Record<string, unknown>;
    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
    expect(body.message).toBe("Invalid username or password.");
    expect(JSON.stringify(body)).not.toContain("Invalid login credentials");
    expect(JSON.stringify(body)).not.toContain("admin@example.test");
  });

  it("keeps a disabled administrator alias indistinguishable from bad credentials", async () => {
    vi.stubEnv("FOODTOPIA_ADMIN_LOGIN_ENABLED", "false");
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://foodtopia.example/api/v1/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({ username: "Admin", password: "password" }),
        headers: {
          "content-type": "application/json",
          origin: "https://foodtopia.example",
        },
      }),
    );

    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(401);
    expect(body.message).toBe("Invalid username or password.");
    expect(mocks.createResponseSupabaseClient).not.toHaveBeenCalled();
  });

  it("returns a bounded retryable response when Supabase throttles password attempts", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: { status: 429, message: "provider-specific throttle details" },
    });
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://foodtopia.example/api/v1/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({ username: "Admin", password: "password" }),
        headers: {
          "content-type": "application/json",
          origin: "https://foodtopia.example",
        },
      }),
    );

    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(429);
    expect(body.retryable).toBe(true);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(JSON.stringify(body)).not.toContain("provider-specific");
  });

  it("throttles before resolving either a configured or unknown username", async () => {
    mocks.consumeAdminLoginRateLimit.mockResolvedValue(321);
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://foodtopia.example/api/v1/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({ username: "SomeoneElse", password: "password" }),
        headers: {
          "content-type": "application/json",
          origin: "https://foodtopia.example",
        },
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("321");
    expect(mocks.createResponseSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("throttles before parsing username credentials and emits a bounded Retry-After header", async () => {
    mocks.consumeAdminLoginRateLimit.mockResolvedValue(0);
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://foodtopia.example/api/v1/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({ username: "", password: "" }),
        headers: {
          "content-type": "application/json",
          origin: "https://foodtopia.example",
        },
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(mocks.createResponseSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    { username: "", password: "password" },
    { username: "A".repeat(65), password: "password" },
    { username: "Admin", password: "short" },
    { username: "Admin", password: "p".repeat(257) },
  ])("rejects out-of-bounds credentials before attempting Supabase: %#", async (body) => {
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://foodtopia.example/api/v1/auth/admin-login", {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          origin: "https://foodtopia.example",
        },
      }),
    );

    expect(response.status).toBe(422);
    expect(mocks.createResponseSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin credential submission before reading credentials", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://foodtopia.example/api/v1/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({ username: "Admin", password: "password" }),
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.consumeAdminLoginRateLimit).not.toHaveBeenCalled();
    expect(mocks.createResponseSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("does not trust a request-derived host as the allowed origin", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://attacker.example/api/v1/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({ username: "Admin", password: "password" }),
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.consumeAdminLoginRateLimit).not.toHaveBeenCalled();
    expect(mocks.createResponseSupabaseClient).not.toHaveBeenCalled();
  });
});
