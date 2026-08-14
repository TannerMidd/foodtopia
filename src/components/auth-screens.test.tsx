import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  clearFoodtopiaCaches: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  requestAdminPasswordLogin: vi.fn(),
  requestMagicLink: vi.fn(),
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

import { SignInScreen } from "./auth-screens";

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
    const passwordInput = screen.getByLabelText("Password");
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
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in as admin" }));

    expect(await screen.findByText("Invalid username or password.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("private-admin@example.test");
  });
});
