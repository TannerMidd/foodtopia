import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthCallbackSupabaseClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAuthCallbackSupabaseClient: mocks.createAuthCallbackSupabaseClient,
}));

describe("GET /auth/callback", () => {
  let callbackResponse: NextResponse | undefined;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    mocks.createAuthCallbackSupabaseClient.mockImplementation(
      (_request: NextRequest, response: NextResponse) => {
        callbackResponse = response;
        return {
          auth: {
            exchangeCodeForSession: mocks.exchangeCodeForSession,
            verifyOtp: mocks.verifyOtp,
          },
        };
      },
    );
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("exchanges the code server-side, preserves a safe next path, and forwards auth cookies", async () => {
    mocks.exchangeCodeForSession.mockImplementation(async () => {
      callbackResponse?.cookies.set({
        name: "sb-foodtopia-auth-token",
        value: "session-value",
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      });
      return { error: null };
    });
    const { GET } = await import("./route");

    const response = await GET(
      new NextRequest(
        "https://foodtopia.example/auth/callback?code=one-time-code&next=%2Finventory%3Flocation%3Dfridge",
      ),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://foodtopia.example/auth/complete?next=%2Finventory%3Flocation%3Dfridge",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.cookies.get("sb-foodtopia-auth-token")).toMatchObject({
      name: "sb-foodtopia-auth-token",
      value: "session-value",
      httpOnly: true,
      path: "/",
    });
  });

  it("does not exchange a missing code and safely returns to sign-in", async () => {
    const { GET } = await import("./route");

    const response = await GET(
      new NextRequest("https://foodtopia.example/auth/callback?next=%2Frecipes"),
    );

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://foodtopia.example/sign-in?authError=invalid_link",
    );
  });

  it("rejects an invalid code without trusting an external next URL", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: new Error("code verifier mismatch"),
    });
    const { GET } = await import("./route");

    const response = await GET(
      new NextRequest(
        "https://foodtopia.example/auth/callback?code=bad-code&next=https%3A%2F%2Fattacker.example%2Fsteal",
      ),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("bad-code");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://foodtopia.example/sign-in?authError=invalid_link",
    );
  });

  it("treats a cross-browser password confirmation as confirmed without creating a session", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: {
        code: "pkce_code_verifier_not_found",
        status: 400,
        message: "Private verifier details must not be exposed",
      },
    });
    const { GET } = await import("./route");

    const response = await GET(
      new NextRequest(
        "https://foodtopia.example/auth/callback?code=confirmed-email-code&next=%2Finventory",
      ),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("confirmed-email-code");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://foodtopia.example/sign-in?emailConfirmed=1",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each(["email", "signup", "invite", "magiclink"] as const)(
    "verifies a %s token hash once, preserves cookies, and redirects through completion",
    async (linkType) => {
    mocks.verifyOtp.mockImplementation(async () => {
      callbackResponse?.cookies.set({
        name: "sb-foodtopia-auth-token",
        value: "magic-session-value",
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      });
      return { error: null };
    });
    const { GET } = await import("./route");

    const response = await GET(
      new NextRequest(
        `https://foodtopia.example/auth/callback?token_hash=server-verified-hash&type=${linkType}&next=%2Fonboarding%2Fabc`,
      ),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledTimes(1);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "server-verified-hash",
      type: linkType,
    });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://foodtopia.example/auth/complete?next=%2Fonboarding%2Fabc",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.cookies.get("sb-foodtopia-auth-token")).toMatchObject({
      name: "sb-foodtopia-auth-token",
      value: "magic-session-value",
      httpOnly: true,
      path: "/",
    });
    expect(consoleError).not.toHaveBeenCalled();
  },
  );

  it.each([
    "https://foodtopia.example/auth/callback?type=magiclink",
    "https://foodtopia.example/auth/callback?token_hash=admin-generated-hash",
    "https://foodtopia.example/auth/callback?token_hash=admin-generated-hash&type=recovery",
    "https://foodtopia.example/auth/callback?token_hash=admin-generated-hash&type=email_change",
    "https://foodtopia.example/auth/callback?code=one&code=two",
    "https://foodtopia.example/auth/callback?code=one&token_hash=admin-generated-hash&type=magiclink",
    "https://foodtopia.example/auth/callback?token_hash=one&token_hash=two&type=magiclink",
    "https://foodtopia.example/auth/callback?token_hash=admin-generated-hash&type=magiclink&type=recovery",
    `https://foodtopia.example/auth/callback?token_hash=${"x".repeat(4_097)}&type=magiclink`,
  ])("fails closed for malformed admin magic-link parameters: %s", async (url) => {
    const { GET } = await import("./route");

    const response = await GET(new NextRequest(url));

    expect(mocks.createAuthCallbackSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://foodtopia.example/sign-in?authError=invalid_link",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("logs only bounded provider metadata when an exchange fails", async () => {
    mocks.verifyOtp.mockResolvedValue({
      error: {
        code: "otp_expired",
        status: 403,
        message: "expired for private-user@example.test with server-verified-hash",
        session: { access_token: "private-session" },
      },
    });
    const { GET } = await import("./route");

    const response = await GET(
      new NextRequest(
        "https://foodtopia.example/auth/callback?token_hash=server-verified-hash&type=email",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://foodtopia.example/sign-in?authError=invalid_link",
    );
    expect(consoleError).toHaveBeenCalledWith("Auth callback failed", {
      mechanism: "token_hash",
      verificationType: "email",
      phase: "exchange",
      code: "otp_expired",
      status: 403,
    });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("server-verified-hash");
    expect(logged).not.toContain("private-user@example.test");
    expect(logged).not.toContain("private-session");
    expect(logged).not.toContain("expired for");
  });

  it("does not log attacker-controlled unsupported verification types", async () => {
    const attackerType = "recovery-private-user@example.test-server-verified-hash";
    const { GET } = await import("./route");

    await GET(
      new NextRequest(
        `https://foodtopia.example/auth/callback?token_hash=server-verified-hash&type=${encodeURIComponent(attackerType)}`,
      ),
    );

    expect(consoleError).toHaveBeenCalledWith("Auth callback failed", {
      mechanism: "invalid",
      verificationType: "unsupported",
      phase: "validation",
    });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain(attackerType);
    expect(logged).not.toContain("server-verified-hash");
    expect(logged).not.toContain("private-user@example.test");
  });
});
