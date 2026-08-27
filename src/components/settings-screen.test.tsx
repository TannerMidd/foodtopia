import { render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const offline = vi.hoisted(() => ({
  apiMode: "demo" as const,
  clear: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/client/api", () => ({
  getCurrentHousehold: vi.fn(),
  getHouseholdPreferences: vi.fn(),
  updateHouseholdPreferences: vi.fn(),
}));
vi.mock("@/lib/client/auth", () => ({
  clearFoodtopiaCaches: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("./ai-provider-settings", () => ({
  AiProviderSettings: () => <div>AI settings</div>,
}));
vi.mock("./offline-provider", () => ({
  useOfflineInventory: () => offline,
}));
vi.mock("./ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ui")>();
  return {
    ...actual,
    Page: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  };
});

import { SettingsScreen } from "./settings-screen";

describe("SettingsScreen beta admissions entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the approvals link only to a server-verified administrator", () => {
    const { rerender } = render(<SettingsScreen isAdmin={false} />);
    expect(screen.queryByRole("link", { name: "review signups" })).not.toBeInTheDocument();

    rerender(<SettingsScreen isAdmin />);
    expect(screen.getByRole("link", { name: "review signups" })).toHaveAttribute(
      "href",
      "/admin/beta",
    );
  });

  it("spaces the device actions as one ledger", () => {
    render(<SettingsScreen isAdmin />);

    const ledger = screen.getByText("Install Foodtopia").closest(".ledger");
    expect(ledger).toHaveClass("mt-4");
    expect(ledger).toContainElement(screen.getByRole("link", { name: "The beta privacy notice" }));
    expect(ledger).toContainElement(screen.getByText("Beta admissions"));
    expect(ledger).toContainElement(screen.getByText("Sign out and clear this device"));
  });
});
