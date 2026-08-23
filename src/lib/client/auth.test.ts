import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

describe("password authentication client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
    mocks.createBrowserClient.mockReturnValue({
      auth: {
        signInWithPassword: mocks.signInWithPassword,
        signUp: mocks.signUp,
      },
    });
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.signUp.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a password account with profile metadata and a safe confirmation callback", async () => {
    const { signUpWithPassword } = await import("./auth");

    await signUpWithPassword(
      "Kitchen Keeper",
      "new@example.test",
      "new-password",
      "/inventory?location=fridge",
    );

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "new@example.test",
      password: "new-password",
      options: {
        data: { display_name: "Kitchen Keeper" },
        emailRedirectTo:
          "http://localhost:3000/auth/callback?next=%2Finventory%3Flocation%3Dfridge",
      },
    });
  });

  it("signs in with the supplied email and password", async () => {
    const { signInWithPassword } = await import("./auth");

    await signInWithPassword("member@example.test", "member-password");

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "member@example.test",
      password: "member-password",
    });
  });

  it("forwards provider failures without logging credentials", async () => {
    const providerError = new Error("Invalid login credentials");
    mocks.signInWithPassword.mockResolvedValue({ error: providerError });
    const { signInWithPassword } = await import("./auth");

    await expect(
      signInWithPassword("member@example.test", "member-password"),
    ).rejects.toBe(providerError);
  });
});
