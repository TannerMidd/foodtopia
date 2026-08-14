import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => {
  class ApiClientError extends Error {
    readonly status: number;
    readonly retryable: boolean;

    constructor({ message, status, retryable = false }: {
      message: string;
      status: number;
      retryable?: boolean;
    }) {
      super(message);
      this.name = "ApiClientError";
      this.status = status;
      this.retryable = retryable;
    }
  }

  return {
    ApiClientError,
    getObservedApiMode: vi.fn(() => "connected" as const),
  };
});
const offlineDb = vi.hoisted(() => ({
  getPersistedActiveHouseholdId: vi.fn(),
  clearOfflineData: vi.fn(),
  getOfflineDb: vi.fn(() => ({
    lots: { where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn() })) })) },
    outbox: { where: vi.fn(() => ({ equals: vi.fn(() => ({ sortBy: vi.fn() })) })) },
    snapshots: { get: vi.fn() },
  })),
}));
const sync = vi.hoisted(() => ({
  synchronizeOfflineInventory: vi.fn(),
  enqueueInventoryCommand: vi.fn(),
  resolveOutboxConflict: vi.fn(),
}));

vi.mock("@/lib/client/api", () => api);
vi.mock("@/lib/offline/db", () => offlineDb);
vi.mock("@/lib/offline/sync", () => sync);
vi.mock("dexie", () => ({
  liveQuery: vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) })),
}));

import { OfflineProvider, useOfflineInventory } from "./offline-provider";

function SyncProbe() {
  const { activeHouseholdId, hydrated, syncError, syncState } = useOfflineInventory();
  return (
    <output>
      {JSON.stringify({ activeHouseholdId, hydrated, syncError, syncState })}
    </output>
  );
}

async function settleInitialEffects() {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("OfflineProvider route isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    offlineDb.getPersistedActiveHouseholdId.mockResolvedValue(null);
    sync.synchronizeOfflineInventory.mockResolvedValue({
      householdId: "household-a",
      refreshedAt: "2026-08-14T12:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not initialize inventory sync when a public/auth/onboarding route disables it", async () => {
    render(
      <OfflineProvider syncEnabled={false}>
        <SyncProbe />
      </OfflineProvider>,
    );

    await waitFor(() => expect(screen.getByText(/\"hydrated\":true/)).toBeInTheDocument());
    await settleInitialEffects();

    expect(sync.synchronizeOfflineInventory).not.toHaveBeenCalled();
    expect(screen.getByText(/\"syncError\":null/)).toBeInTheDocument();
  });

  it("ignores an access error from a sync that was already in flight when sync becomes disabled", async () => {
    const pending = deferred<{
      householdId: string;
      refreshedAt: string;
    }>();
    sync.synchronizeOfflineInventory.mockReturnValue(pending.promise);
    const { rerender } = render(
      <OfflineProvider syncEnabled>
        <SyncProbe />
      </OfflineProvider>,
    );

    await waitFor(() => expect(sync.synchronizeOfflineInventory).toHaveBeenCalledTimes(1));
    rerender(
      <OfflineProvider syncEnabled={false}>
        <SyncProbe />
      </OfflineProvider>,
    );

    await act(async () => {
      pending.reject(new api.ApiClientError({ message: "access revoked", status: 403 }));
      await Promise.resolve();
    });
    await settleInitialEffects();

    expect(offlineDb.clearOfflineData).not.toHaveBeenCalled();
    expect(screen.getByText(/\"syncError\":null/)).toBeInTheDocument();
    expect(screen.getByText(/\"syncState\":\"idle\"/)).toBeInTheDocument();
  });

  it.each([401, 403])("evicts a bound household when an authenticated household page receives %i", async (status) => {
    offlineDb.getPersistedActiveHouseholdId.mockResolvedValue("household-a");
    sync.synchronizeOfflineInventory.mockRejectedValue(
      new api.ApiClientError({ message: "access revoked", status }),
    );

    render(
      <OfflineProvider>
        <SyncProbe />
      </OfflineProvider>,
    );

    await waitFor(() => {
      expect(offlineDb.clearOfflineData).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/\"syncState\":\"error\"/)).toBeInTheDocument();
    });
    expect(sync.synchronizeOfflineInventory).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/\"activeHouseholdId\":\"\"/)).toBeInTheDocument();
  });
});
