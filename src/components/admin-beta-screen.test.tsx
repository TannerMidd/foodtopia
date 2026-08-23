import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BetaAccount, BetaAccountsResponse } from "@/contracts/api";

const api = vi.hoisted(() => ({
  listBetaAccounts: vi.fn(),
  enableBetaAccounts: vi.fn(),
  disableBetaAccounts: vi.fn(),
  setSignupWindow: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("@/lib/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/api")>();
  return { ...actual, ...api };
});

import { AdminBetaScreen } from "./admin-beta-screen";

function userId(index: number) {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function account(index: number, overrides: Partial<BetaAccount> = {}): BetaAccount {
  return {
    userId: userId(index),
    email: `person-${index}@example.test`,
    displayName: null,
    status: "pending",
    createdAt: "2026-08-20T10:00:00.000Z",
    emailConfirmedAt: "2026-08-20T10:05:00.000Z",
    lastSignInAt: null,
    enabledAt: null,
    ...overrides,
  };
}

function roster(accounts: BetaAccount[]): BetaAccountsResponse {
  return {
    signupsOpen: true,
    counts: {
      pending: accounts.filter((item) => item.status === "pending").length,
      enabled: accounts.filter((item) => item.status === "enabled").length,
      disabled: accounts.filter((item) => item.status === "disabled").length,
    },
    accounts,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("AdminBetaScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.enableBetaAccounts.mockResolvedValue({ changedCount: 1 });
    api.disableBetaAccounts.mockResolvedValue({ changedCount: 1 });
    api.setSignupWindow.mockResolvedValue({ signupsOpen: true });
  });

  it("separates unconfirmed accounts and refreshes when the window regains focus", async () => {
    api.listBetaAccounts.mockResolvedValue(
      roster([account(1), account(2, { emailConfirmedAt: null })]),
    );
    render(<AdminBetaScreen />);

    expect(await screen.findByLabelText("Enable person-1@example.test")).toBeEnabled();
    expect(screen.queryByLabelText("Enable person-2@example.test")).not.toBeInTheDocument();
    expect(screen.getByText("awaiting email confirmation")).toBeInTheDocument();
    expect(screen.getByText("not approvable yet")).toBeInTheDocument();

    fireEvent.focus(window);
    await waitFor(() => expect(api.listBetaAccounts).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/updates automatically/i)).toBeInTheDocument();
  });

  it("does not overlap background refresh with an enable mutation", async () => {
    const enableResult = deferred<{ changedCount: number }>();
    api.listBetaAccounts.mockResolvedValue(roster([account(1)]));
    api.enableBetaAccounts.mockReturnValue(enableResult.promise);
    const user = userEvent.setup();
    render(<AdminBetaScreen />);

    await user.click(await screen.findByLabelText("Enable person-1@example.test"));
    await user.click(screen.getByRole("button", { name: "Enable selected (1)" }));
    expect(api.enableBetaAccounts).toHaveBeenCalledWith([userId(1)]);

    fireEvent.focus(window);
    expect(api.listBetaAccounts).toHaveBeenCalledTimes(1);

    await act(async () => enableResult.resolve({ changedCount: 1 }));
    await waitFor(() => expect(api.listBetaAccounts).toHaveBeenCalledTimes(2));
  });

  it("selects at most 50 confirmed pending accounts and leaves later accounts for another batch", async () => {
    const accounts = Array.from({ length: 51 }, (_, index) => account(index + 1));
    api.listBetaAccounts.mockResolvedValue(roster(accounts));
    const user = userEvent.setup();
    render(<AdminBetaScreen />);

    const selectBatch = await screen.findByRole("checkbox", { name: "select first 50" });
    await user.click(selectBatch);

    expect(screen.getByRole("button", { name: "Enable selected (50)" })).toBeEnabled();
    expect(screen.getByLabelText("Enable person-51@example.test")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Enable selected (50)" }));
    expect(api.enableBetaAccounts).toHaveBeenCalledTimes(1);
    expect(api.enableBetaAccounts.mock.calls[0]?.[0]).toHaveLength(50);
  });

  it("prunes a selected account when a refresh makes it ineligible", async () => {
    api.listBetaAccounts
      .mockResolvedValueOnce(roster([account(1)]))
      .mockResolvedValueOnce(roster([account(1, { emailConfirmedAt: null })]));
    const user = userEvent.setup();
    render(<AdminBetaScreen />);

    await user.click(await screen.findByLabelText("Enable person-1@example.test"));
    expect(screen.getByRole("button", { name: "Enable selected (1)" })).toBeEnabled();
    fireEvent.focus(window);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Enable selected (1)" })).not.toBeInTheDocument();
    });
    expect(api.enableBetaAccounts).not.toHaveBeenCalled();
  });
});
