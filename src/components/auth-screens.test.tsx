import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  clearFoodtopiaCaches: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  requestMagicLink: vi.fn(),
  setCurrentUserPassword: vi.fn(),
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

import { SetPasswordScreen, SignInScreen, SignUpScreen } from "./auth-screens";

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

describe("legacy account password migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.setCurrentUserPassword.mockResolvedValue({ demo: false });
  });

  it("sets the authenticated account password", async () => {
    const user = userEvent.setup();
    render(<SetPasswordScreen />);

    await user.type(screen.getByLabelText("Password"), "replacement-password");
    await user.type(screen.getByLabelText("Confirm password"), "replacement-password");
    await user.click(screen.getByRole("button", { name: "Save password" }));

    await waitFor(() => {
      expect(auth.setCurrentUserPassword).toHaveBeenCalledWith("replacement-password");
    });
  });

  it("rejects mismatched migration passwords before contacting Supabase", async () => {
    const user = userEvent.setup();
    render(<SetPasswordScreen />);

    await user.type(screen.getByLabelText("Password"), "replacement-password");
    await user.type(screen.getByLabelText("Confirm password"), "different-password");
    await user.click(screen.getByRole("button", { name: "Save password" }));

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(auth.setCurrentUserPassword).not.toHaveBeenCalled();
  });
});
