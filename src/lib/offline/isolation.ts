import { ApiClientError } from "@/lib/client/api";

export type ReplayResult = Readonly<{
  conflict: boolean;
  failed: boolean;
}>;

export type RefreshResult = Readonly<{
  householdId: string;
  refreshedAt: string;
  householdChanged?: boolean;
}>;

export type BoundSyncDependencies = Readonly<{
  deriveServerHouseholdId: () => Promise<string>;
  readPersistedHouseholdId: () => Promise<string | null>;
  resetAndBind: (householdId: string) => Promise<void>;
  replay: (householdId: string) => Promise<ReplayResult>;
  refresh: (
    householdId: string,
    forceFull: boolean,
  ) => Promise<RefreshResult>;
  onHouseholdReset?: (householdId: string) => void;
}>;

export type BoundSyncResult = RefreshResult &
  ReplayResult &
  Readonly<{ householdChanged: boolean }>;

/**
 * The authenticated server binding is always resolved before outbox replay.
 * A changed tenant is reset and refreshed without touching the old outbox.
 */
export async function runBoundInventorySync(
  dependencies: BoundSyncDependencies,
  forceFull = false,
): Promise<BoundSyncResult> {
  const serverHouseholdId = await dependencies.deriveServerHouseholdId();
  const persistedHouseholdId = await dependencies.readPersistedHouseholdId();
  const bindingChanged = persistedHouseholdId !== serverHouseholdId;

  if (bindingChanged) {
    await dependencies.resetAndBind(serverHouseholdId);
    dependencies.onHouseholdReset?.(serverHouseholdId);
  }

  const replay = bindingChanged
    ? { conflict: false, failed: false }
    : await dependencies.replay(serverHouseholdId);
  const refreshed = await dependencies.refresh(
    serverHouseholdId,
    forceFull || bindingChanged || replay.conflict || replay.failed,
  );
  return {
    ...replay,
    ...refreshed,
    householdChanged:
      bindingChanged ||
      refreshed.householdChanged === true ||
      refreshed.householdId !== serverHouseholdId,
  };
}

export type OfflineFailureDisposition =
  | "network_offline"
  | "access_revoked"
  | "error";

export function classifyOfflineFailure(
  error: unknown,
  browserOnline: boolean,
): OfflineFailureDisposition {
  if (
    !browserOnline ||
    (error instanceof ApiClientError && error.status === 0)
  ) {
    return "network_offline";
  }
  if (
    error instanceof ApiClientError &&
    (error.status === 401 || error.status === 403)
  ) {
    return "access_revoked";
  }
  return "error";
}

/** 429 is retryable and must remain pending in the ordered outbox. */
export function isPermanentOutboxFailure(error: unknown): boolean {
  return error instanceof ApiClientError &&
    error.status !== 429 &&
    !error.retryable;
}
