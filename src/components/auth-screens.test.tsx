import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  clearFoodtopiaCaches: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  requestAdminPasswordLogin: vi.fn(),
  requestMagicLink: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  signUpWithPassword: vi.fn(),
}));
const offline = vi.hoisted(() => ({ clear: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("@/lib/client/auth", () => auth);
vi.mock("./offline-provider", () => ({
  useOfflineInventory: () => offline,
}));

import { SignInScreen, SignUpScreen } from "./auth-screens";

describe("administrator password sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requestAdminPasswordLogin.mockResolvedValue(undefined);
    offline.clear.mockResolvedValue(undefined);
    auth.clearFoodtopiaCaches.mockResolvedValue(undefined);
  });

  it("posts the supplied credentials to the server login helper, then clears offline tenant data", async () => {
    const user = userEvent.setup();
    render(
      <SignInScreen
        nextPath="/inventory?location=fridge"
        adminLoginEnabled
      />,
    );

    await user.type(screen.getByLabelText("Username"), "Admin");
    const passwordInput = screen.getAllByLabelText("Password")[0];
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(passwordInput).toHaveAttribute("autocomplete", "current-password");
    await user.type(passwordInput, "a-test-password");
    await user.click(screen.getByRole("button", { name: "Sign in as admin" }));

    await waitFor(() => {
      expect(auth.requestAdminPasswordLogin).toHaveBeenCalledWith(
        "Admin",
        "a-test-password",
      );
      expect(offline.clear).toHaveBeenCalledTimes(1);
      expect(auth.clearFoodtopiaCaches).toHaveBeenCalledTimes(1);
    });
    expect(offline.clear).toHaveBeenCalledBefore(auth.clearFoodtopiaCaches);
  });

  it("does not expose provider errors for an unsuccessful administrator sign-in", async () => {
    const user = userEvent.setup();
    auth.requestAdminPasswordLogin.mockRejectedValue(
      new Error("Invalid login credentials for private-admin@example.test"),
    );
    render(<SignInScreen adminLoginEnabled />);

    await user.type(screen.getByLabelText("Username"), "Admin");
    await user.type(screen.getAllByLabelText("Password")[0], "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in as admin" }));

    expect(await screen.findByText("Invalid username or password.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("private-admin@example.test");
  });

  it("does not relabel a successful login when mobile storage cleanup fails", async () => {
    const user = userEvent.setup();
    offline.clear.mockRejectedValue(new Error("IndexedDB unavailable"));
    auth.clearFoodtopiaCaches.mockRejectedValue(
      new Error("CacheStorage unavailable"),
    );
    render(<SignInScreen adminLoginEnabled />);

    await user.type(screen.getByLabelText("Username"), "Admin");
    await user.type(screen.getAllByLabelText("Password")[0], "a-test-password");
    await user.click(screen.getByRole("button", { name: "Sign in as admin" }));

    await waitFor(() => {
      expect(offline.clear).toHaveBeenCalledTimes(1);
      expect(auth.clearFoodtopiaCaches).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Invalid username or password.")).toBeNull();
  });
});

describe("member password authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.signInWithPassword.mockResolvedValue({ demo: false });
    auth.signUpWithPassword.mockResolvedValue({
      demo: false,
      signedIn: true,
    });
    offline.clear.mockResolvedValue(undefined);
    auth.clearFoodtopiaCaches.mockResolvedValue(undefined);
  });

  it("signs in with email and password, then clears offline tenant data", async () => {
    const user = userEvent.setup();
    render(<SignInScreen nextPath="/inventory" />);

    await user.type(screen.getByLabelText("Email"), "member@example.test");
    const passwordInput = screen.getByLabelText("Password");
    expect(passwordInput).toHaveAttribute("autocomplete", "current-password");
    await user.type(passwordInput, "member-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(auth.signInWithPassword).toHaveBeenCalledWith(
        "member@example.test",
        "member-password",
      );
      expect(offline.clear).toHaveBeenCalledTimes(1);
      expect(auth.clearFoodtopiaCaches).toHaveBeenCalledTimes(1);
    });
  });

  it("does not expose Supabase details when member sign-in fails", async () => {
    const user = userEvent.setup();
    auth.signInWithPassword.mockRejectedValue(
      new Error("Email not confirmed for private-member@example.test"),
    );
    render(<SignInScreen />);

    await user.type(screen.getByLabelText("Email"), "member@example.test");
    await user.type(screen.getByLabelText("Password"), "member-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Sign-in failed")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("private-member@example.test");
  });

  it("shows a successful email-confirmation notice above password sign-in", () => {
    render(<SignInScreen emailConfirmed />);

    expect(screen.getByText("Email confirmed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("creates an account with username, email, and password without requesting confirmation", async () => {
    const user = userEvent.setup();
    render(<SignUpScreen />);

    await user.type(screen.getByLabelText("Username"), "Kitchen Keeper");
    await user.type(screen.getByLabelText("Email"), "new@example.test");
    await user.type(screen.getByLabelText("Password"), "new-password");
    await user.type(screen.getByLabelText("Confirm password"), "new-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(auth.signUpWithPassword).toHaveBeenCalledWith(
        "Kitchen Keeper",
        "new@example.test",
        "new-password",
        "/",
      );
    });
    expect(screen.queryByText("Confirm your email address.")).not.toBeInTheDocument();
  });

  it("handles a no-session signup without revealing whether the email exists", async () => {
    const user = userEvent.setup();
    auth.signUpWithPassword.mockResolvedValue({
      demo: false,
      signedIn: false,
    });
    render(<SignUpScreen />);

    await user.type(screen.getByLabelText("Username"), "Kitchen Keeper");
    await user.type(screen.getByLabelText("Email"), "existing@example.test");
    await user.type(screen.getByLabelText("Password"), "new-password");
    await user.type(screen.getByLabelText("Confirm password"), "new-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Try signing in.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("already exists");
    expect(screen.queryByText("Confirm your email address.")).not.toBeInTheDocument();
  });

  it("rejects mismatched passwords before contacting Supabase", async () => {
    const user = userEvent.setup();
    render(<SignUpScreen />);

    await user.type(screen.getByLabelText("Username"), "Kitchen Keeper");
    await user.type(screen.getByLabelText("Email"), "new@example.test");
    await user.type(screen.getByLabelText("Password"), "new-password");
    await user.type(screen.getByLabelText("Confirm password"), "other-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(auth.signUpWithPassword).not.toHaveBeenCalled();
  });
});
