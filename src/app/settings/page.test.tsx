import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isDemoMode: false }));
vi.mock("@/server/auth/admin-user", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));
vi.mock("@/components/settings-screen", () => ({
  SettingsScreen: ({ isAdmin }: { isAdmin: boolean }) => (
    <p>{isAdmin ? "admin settings" : "member settings"}</p>
  ),
}));

describe("SettingsPage administrator visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes administrator visibility after a verified server-side check", async () => {
    mocks.requireAdminSession.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
    });
    const { default: SettingsPage } = await import("./page");

    render(await SettingsPage());

    expect(screen.getByText("admin settings")).toBeInTheDocument();
  });

  it("keeps ordinary Settings available when the administrator check fails", async () => {
    mocks.requireAdminSession.mockRejectedValue(new Error("not the configured administrator"));
    const { default: SettingsPage } = await import("./page");

    render(await SettingsPage());

    expect(screen.getByText("member settings")).toBeInTheDocument();
  });
});
