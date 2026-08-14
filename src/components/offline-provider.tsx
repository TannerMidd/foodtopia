"use client";

import { liveQuery } from "dexie";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { InventoryCommand, InventoryLot } from "@/contracts/domain";
import { getObservedApiMode } from "@/lib/client/api";
import {
  clearOfflineData,
  getPersistedActiveHouseholdId,
  getOfflineDb,
  type OutboxRecord,
} from "@/lib/offline/db";
import { classifyOfflineFailure } from "@/lib/offline/isolation";
import {
  enqueueInventoryCommand,
  resolveOutboxConflict,
  synchronizeOfflineInventory,
} from "@/lib/offline/sync";

type SyncState = "idle" | "syncing" | "offline" | "error";

type OfflineContextValue = {
  activeHouseholdId: string;
  lots: InventoryLot[];
  outbox: OutboxRecord[];
  conflicts: OutboxRecord[];
  online: boolean;
  hydrated: boolean;
  syncState: SyncState;
  lastSyncedAt: string | null;
  syncError: string | null;
  apiMode: "connected" | "demo";
  queueCommand: (command: InventoryCommand) => Promise<void>;
  refresh: (forceFull?: boolean) => Promise<void>;
  resolveConflict: (record: OutboxRecord, strategy: "retry" | "discard") => Promise<void>;
  clear: () => Promise<void>;
};

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [activeHouseholdId, setActiveHousehold] = useState("");
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [outbox, setOutbox] = useState<OutboxRecord[]>([]);
  const [online, setOnline] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [apiMode, setApiMode] = useState<"connected" | "demo">(
    getObservedApiMode,
  );
  const inFlight = useRef<Promise<void> | null>(null);
  const syncSuppressed = useRef(false);
  const queueDisabled = useRef(true);
  const syncGeneration = useRef(0);
  const householdRef = useRef(activeHouseholdId);

  useEffect(() => {
    householdRef.current = activeHouseholdId;
  }, [activeHouseholdId]);

  useEffect(() => {
    let cancelled = false;
    void getPersistedActiveHouseholdId().then((id) => {
      if (cancelled) return;
      householdRef.current = id ?? "";
      queueDisabled.current = !id;
      setActiveHousehold(id ?? "");
      setOnline(navigator.onLine);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeHouseholdId) return;
    const db = getOfflineDb();
    const lotsSubscription = liveQuery(() =>
      db.lots.where("householdId").equals(activeHouseholdId).toArray(),
    ).subscribe({ next: setLots });
    const outboxSubscription = liveQuery(() =>
      db.outbox.where("householdId").equals(activeHouseholdId).sortBy("sequence"),
    ).subscribe({ next: setOutbox });
    const snapshotSubscription = liveQuery(() => db.snapshots.get(activeHouseholdId)).subscribe({
      next: (snapshot) => setLastSyncedAt(snapshot?.refreshedAt ?? null),
    });
    return () => {
      lotsSubscription.unsubscribe();
      outboxSubscription.unsubscribe();
      snapshotSubscription.unsubscribe();
    };
  }, [activeHouseholdId]);

  const evictRevokedHousehold = useCallback(async () => {
    syncGeneration.current += 1;
    syncSuppressed.current = true;
    queueDisabled.current = true;
    householdRef.current = "";
    setActiveHousehold("");
    setLots([]);
    setOutbox([]);
    setLastSyncedAt(null);
    await clearOfflineData();
  }, []);

  const handleSyncFailure = useCallback(
    async (error: unknown) => {
      const disposition = classifyOfflineFailure(error, navigator.onLine);
      if (disposition === "access_revoked") {
        await evictRevokedHousehold();
        setOnline(true);
        setSyncState("error");
      } else if (disposition === "network_offline") {
        setOnline(false);
        setSyncState("offline");
      } else {
        setOnline(navigator.onLine);
        setSyncState("error");
      }
      setSyncError(error instanceof Error ? error.message : "Foodtopia could not sync.");
    },
    [evictRevokedHousehold],
  );

  const performSync = useCallback(async (forceFull: boolean): Promise<void> => {
    const generation = syncGeneration.current;
    setSyncState("syncing");
    setSyncError(null);
    try {
      const result = await synchronizeOfflineInventory(
        forceFull,
        (householdId) => {
          if (generation !== syncGeneration.current) return;
          queueDisabled.current = true;
          householdRef.current = householdId;
          setActiveHousehold(householdId);
          setLots([]);
          setOutbox([]);
          setLastSyncedAt(null);
        },
      );
      if (generation !== syncGeneration.current) return;
      householdRef.current = result.householdId;
      queueDisabled.current = false;
      setActiveHousehold(result.householdId);
      setLastSyncedAt(result.refreshedAt);
      setApiMode(getObservedApiMode());
      setOnline(true);
      setSyncState("idle");
    } catch (error) {
      if (generation !== syncGeneration.current) return;
      await handleSyncFailure(error);
    }
  }, [handleSyncFailure]);

  const runSync = useCallback(async (forceFull = false): Promise<void> => {
    if (syncSuppressed.current) return;
    if (!navigator.onLine) {
      setOnline(false);
      setSyncState("offline");
      return;
    }

    const existing = inFlight.current;
    if (existing) {
      await existing;
      if (syncSuppressed.current) return;
      if (!navigator.onLine) {
        setOnline(false);
        setSyncState("offline");
        return;
      }
      if (inFlight.current) return inFlight.current;
    }

    const task = performSync(forceFull);
    inFlight.current = task;
    try {
      await task;
    } finally {
      if (inFlight.current === task) inFlight.current = null;
    }
  }, [performSync]);

  useEffect(() => {
    if (!hydrated) return;
    const initialSync = window.setTimeout(() => void runSync(), 0);
    const onOnline = () => {
      setOnline(true);
      void runSync();
    };
    const onOffline = () => {
      setOnline(false);
      setSyncState("offline");
    };
    const onFocus = () => void runSync();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void runSync();
    }, 15_000);
    return () => {
      window.clearTimeout(initialSync);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [hydrated, runSync]);

  const queueCommand = useCallback(
    async (command: InventoryCommand) => {
      if (queueDisabled.current || !householdRef.current) {
        throw new Error("Reconnect to verify your household before editing inventory.");
      }
      await enqueueInventoryCommand(command);
      if (navigator.onLine) void runSync();
      else setSyncState("offline");
    },
    [runSync],
  );

  const resolveConflict = useCallback(
    async (record: OutboxRecord, strategy: "retry" | "discard") => {
      try {
        const result = await resolveOutboxConflict(record, strategy);
        if (result.householdId !== householdRef.current) {
          householdRef.current = result.householdId;
          setActiveHousehold(result.householdId);
        }
        queueDisabled.current = false;
        if (navigator.onLine) await runSync(true);
      } catch (error) {
        await handleSyncFailure(error);
        throw error;
      }
    },
    [handleSyncFailure, runSync],
  );

  const clear = useCallback(async () => {
    syncGeneration.current += 1;
    syncSuppressed.current = true;
    queueDisabled.current = true;
    householdRef.current = "";
    setActiveHousehold("");
    setLots([]);
    setOutbox([]);
    setLastSyncedAt(null);
    if (inFlight.current) await inFlight.current.catch(() => undefined);
    await clearOfflineData();
    setSyncError(null);
    setSyncState("idle");
  }, []);

  return (
    <OfflineContext.Provider
      value={{
        activeHouseholdId,
        lots,
        outbox,
        conflicts: outbox.filter((record) => record.status === "conflict"),
        online,
        hydrated,
        syncState,
        lastSyncedAt,
        syncError,
        apiMode,
        queueCommand,
        refresh: runSync,
        resolveConflict,
        clear,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

export function useOfflineInventory() {
  const value = useContext(OfflineContext);
  if (!value) throw new Error("useOfflineInventory must be used inside OfflineProvider.");
  return value;
}
