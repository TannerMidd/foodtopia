import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => vi.fn());
const offline = vi.hoisted(() => ({
  syncEnabled: [] as boolean[],
  value: {
    online: true,
    syncState: "error" as const,
    syncError: "You do not have access to this household resource.",
    conflicts: [],
    outbox: [],
  },
}));

vi.mock("next/navigation", () => ({ usePathname: pathname }));
vi.mock("./offline-provider", () => ({
  OfflineProvider: ({ children, syncEnabled = true }: { children: ReactNode; syncEnabled?: boolean }) => {
    offline.syncEnabled.push(syncEnabled);
    return <>{children}</>;
  },
  useOfflineInventory: () => offline.value,
}));
vi.mock("./service-worker-registration", () => ({
  ServiceWorkerRegistration: () => null,
}));

import { AppShell } from "./app-shell";

describe("AppShell sync errors", () => {
  beforeEach(() => {
    pathname.mockReturnValue("/");
    offline.syncEnabled = [];
    offline.value = {
      online: true,
      syncState: "error",
      syncError: "You do not have access to this household resource.",
      conflicts: [],
      outbox: [],
    };
  });

  it.each([
    "/sign-in",
    "/sign-up",
    "/pending",
    "/auth/complete",
    "/onboarding/invite-token",
    "/admin/beta",
  ])(
    "does not show a household access banner on public route %s",
    (route) => {
      pathname.mockReturnValue(route);
      render(<AppShell>Public content</AppShell>);

      expect(screen.queryByText(/sync paused/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/do not have access to this household/i)).not.toBeInTheDocument();
      expect(offline.syncEnabled).toEqual([false]);
    },
  );

  it("keeps sync enabled on the offline fallback so it can still queue edits", () => {
    // The fallback renders without app chrome, but it is reached by a device
    // that is already signed in. Pausing sync there leaves it unable to notice
    // that the connection dropped, or to queue an edit until it returns.
    pathname.mockReturnValue("/~offline");
    render(<AppShell>Offline content</AppShell>);

    expect(offline.syncEnabled).toEqual([true]);
  });

  it("shows the access-revocation banner on an authenticated household route", () => {
    render(<AppShell>Household content</AppShell>);

    expect(screen.getByText(/sync paused · You do not have access/i)).toBeInTheDocument();
    expect(offline.syncEnabled).toEqual([true]);
  });
});
