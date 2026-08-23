import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  updateUser: vi.fn(),
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
        getUser: mocks.getUser,
        signInWithPassword: mocks.signInWithPassword,
        signUp: mocks.signUp,
        updateUser: mocks.updateUser,
      },
    });
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "legacy-user" } }, error: null });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.signUp.mockResolvedValue({
      data: { session: { access_token: "session" }, user: { identities: [{}] } },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a password account with profile metadata and a safe confirmation callback", async () => {
    const { signUpWithPassword } = await import("./auth");

    const result = await signUpWithPassword(
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
    expect(result).toEqual({ demo: false, signedIn: true });
  });

  it("does not expose details from Supabase's privacy-safe repeated-signup response", async () => {
    mocks.signUp.mockResolvedValue({
      data: { session: null, user: { identities: [] } },
      error: null,
    });
    const { signUpWithPassword } = await import("./auth");

    const result = await signUpWithPassword(
      "Kitchen Keeper",
      "existing@example.test",
      "new-password",
    );

    expect(result).toEqual({ demo: false, signedIn: false });
  });

  it("signs in with the supplied email and password", async () => {
    const { signInWithPassword } = await import("./auth");

    await signInWithPassword("member@example.test", "member-password");

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "member@example.test",
      password: "member-password",
    });
  });

  it("sets a password only for the authenticated migration session", async () => {
    const { setCurrentUserPassword } = await import("./auth");

    await setCurrentUserPassword("replacement-password");

    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "replacement-password" });
  });

  it("refuses to set a password without an authenticated migration session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { setCurrentUserPassword } = await import("./auth");

    await expect(setCurrentUserPassword("replacement-password")).rejects.toThrow(
      "Authentication required.",
    );
    expect(mocks.updateUser).not.toHaveBeenCalled();
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
