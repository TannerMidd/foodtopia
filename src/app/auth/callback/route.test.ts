import { NextRequest, type NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

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

  it("verifies an admin-generated magic-link token once, preserves cookies, and redirects through completion", async () => {
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
        "https://foodtopia.example/auth/callback?token_hash=admin-generated-hash&type=magiclink&next=%2Fonboarding%2Fabc",
      ),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledTimes(1);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "admin-generated-hash",
      type: "magiclink",
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
  });

  it.each([
    "https://foodtopia.example/auth/callback?type=magiclink",
    "https://foodtopia.example/auth/callback?token_hash=admin-generated-hash",
    "https://foodtopia.example/auth/callback?token_hash=admin-generated-hash&type=recovery",
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
});
