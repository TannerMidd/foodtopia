import type { InventoryCommand, InventoryLot } from "@/contracts/domain";
import {
  ApiClientError,
  getCurrentHousehold,
  sendInventoryCommand,
  syncInventory,
} from "@/lib/client/api";
import {
  getPersistedActiveHouseholdId,
  getOfflineDb,
  resetAndBindOfflineHousehold,
  type OutboxRecord,
} from "./db";
import {
  isPermanentOutboxFailure,
  runBoundInventorySync,
} from "./isolation";

function optimisticLot(command: InventoryCommand, current?: InventoryLot): InventoryLot {
  const now = new Date().toISOString();
  if (command.type === "add") {
    return {
      ...command.payload,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
  }
  if (!current) throw new Error("This item is no longer in the offline inventory.");

  const status =
    command.type === "consume"
      ? "consumed"
      : command.type === "discard"
        ? "discarded"
        : command.type === "restore"
          ? "active"
          : current.status;

  const payload =
    command.type === "adjust"
      ? (({ lotId: _lotId, ...changes }) => {
          void _lotId;
          return changes;
        })(command.payload)
      : {};
  return {
    ...current,
    ...payload,
    status,
    version: current.version + 1,
    updatedAt: now,
  };
}

export async function enqueueInventoryCommand(command: InventoryCommand) {
  const db = getOfflineDb();
  await db.transaction("rw", db.lots, db.outbox, db.meta, async () => {
    const binding = await db.meta.get("activeHouseholdId");
    const boundHouseholdId =
      typeof binding?.value === "string" ? binding.value : null;
    if (!boundHouseholdId) {
      throw new Error("Reconnect to verify your household before editing inventory.");
    }
    const current = command.type === "add"
      ? undefined
      : await db.lots.get(command.payload.lotId);
    const householdId = command.type === "add"
      ? command.payload.householdId
      : current?.householdId;
    if (!householdId || householdId !== boundHouseholdId) {
      throw new Error("This item is not available in the verified household.");
    }
    const sequenceRecord = await db.meta.get("outboxSequence");
    const sequence = (typeof sequenceRecord?.value === "number" ? sequenceRecord.value : 0) + 1;
    const lot = optimisticLot(command, current);
    await db.meta.put({ key: "outboxSequence", value: sequence });
    await db.outbox.put({
      commandId: command.commandId,
      householdId,
      sequence,
      command,
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
    });
    await db.lots.put(lot);
  });
}

export async function replayOutbox(householdId: string) {
  const db = getOfflineDb();
  const commands = await db.outbox.where("householdId").equals(householdId).sortBy("sequence");

  for (const record of commands) {
    if (record.status === "conflict") return { conflict: true, failed: false };
    if (record.status === "failed") return { conflict: false, failed: true };
    await db.outbox.update(record.commandId, {
      status: "sending",
      attempts: record.attempts + 1,
      lastError: null,
    });
    try {
      const lot = await sendInventoryCommand(record.command);
      await db.transaction("rw", db.lots, db.outbox, async () => {
        await db.lots.put(lot);
        await db.outbox.delete(record.commandId);
      });
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        await db.outbox.update(record.commandId, {
          status: "conflict",
          lastError: error.message,
        });
        return { conflict: true, failed: false };
      }
      const permanent = isPermanentOutboxFailure(error);
      await db.outbox.update(record.commandId, {
        status: permanent ? "failed" : "pending",
        lastError: error instanceof Error ? error.message : "Could not sync this change.",
      });
      if (permanent) return { conflict: false, failed: true };
      throw error;
    }
  }
  return { conflict: false, failed: false };
}

export async function refreshInventorySnapshot(householdId: string, forceFull = false) {
  const db = getOfflineDb();
  const snapshot = forceFull ? null : await db.snapshots.get(householdId);
  const response = await syncInventory(snapshot?.cursor ?? null);
  const responseHouseholdId = response.householdId;
  const refreshedAt = new Date().toISOString();

  if (responseHouseholdId !== householdId) {
    await db.transaction("rw", db.lots, db.outbox, db.snapshots, db.meta, async () => {
      await Promise.all([
        db.lots.clear(),
        db.outbox.clear(),
        db.snapshots.clear(),
        db.meta.clear(),
      ]);
      if (response.lots.length) await db.lots.bulkPut(response.lots);
      await db.snapshots.put({
        householdId: responseHouseholdId,
        cursor: response.cursor,
        refreshedAt,
      });
      await db.meta.put({
        key: "activeHouseholdId",
        value: responseHouseholdId,
      });
    });
    return {
      householdId: responseHouseholdId,
      refreshedAt,
      householdChanged: true,
    };
  }

  await db.transaction("rw", db.lots, db.snapshots, db.meta, async () => {
    if (!snapshot || forceFull) {
      const localIds = await db.lots.where("householdId").equals(responseHouseholdId).primaryKeys();
      const serverIds = new Set(response.lots.map((lot) => lot.id));
      const staleIds = localIds.filter((id) => !serverIds.has(String(id)));
      if (staleIds.length) await db.lots.bulkDelete(staleIds as string[]);
    }
    if (response.lots.length) await db.lots.bulkPut(response.lots);
    await db.snapshots.put({
      householdId: responseHouseholdId,
      cursor: response.cursor,
      refreshedAt,
    });
    await db.meta.put({ key: "activeHouseholdId", value: responseHouseholdId });
  });

  return {
    householdId: responseHouseholdId,
    refreshedAt,
    householdChanged: false,
  };
}

export async function synchronizeOfflineInventory(
  forceFull = false,
  onHouseholdReset?: (householdId: string) => void,
) {
  return runBoundInventorySync(
    {
      deriveServerHouseholdId: async () =>
        (await getCurrentHousehold()).householdId,
      readPersistedHouseholdId: getPersistedActiveHouseholdId,
      resetAndBind: resetAndBindOfflineHousehold,
      replay: replayOutbox,
      refresh: refreshInventorySnapshot,
      onHouseholdReset,
    },
    forceFull,
  );
}

export async function resolveOutboxConflict(record: OutboxRecord, strategy: "retry" | "discard") {
  const db = getOfflineDb();
  const serverHouseholdId = (await getCurrentHousehold()).householdId;
  const persistedHouseholdId = await getPersistedActiveHouseholdId();
  if (
    persistedHouseholdId !== serverHouseholdId ||
    record.householdId !== serverHouseholdId
  ) {
    await resetAndBindOfflineHousehold(serverHouseholdId);
    const refreshed = await refreshInventorySnapshot(serverHouseholdId, true);
    return { ...refreshed, householdChanged: true };
  }
  if (strategy === "discard") {
    await db.outbox.delete(record.commandId);
    return refreshInventorySnapshot(record.householdId, true);
  }

  await refreshInventorySnapshot(record.householdId, true);
  const current = record.command.type === "add"
    ? undefined
    : await db.lots.get(record.command.payload.lotId);
  if (record.command.type !== "add" && !current) {
    throw new Error("The latest item could not be found. Discard this pending change.");
  }
  const replacement: InventoryCommand = record.command.type === "add"
    ? { ...record.command, commandId: crypto.randomUUID() }
    : {
        ...record.command,
        commandId: crypto.randomUUID(),
        expectedVersion: current!.version,
      };
  const replacementLot = optimisticLot(replacement, current);
  await db.transaction("rw", db.lots, db.outbox, async () => {
    await db.outbox.delete(record.commandId);
    await db.outbox.put({
      ...record,
      commandId: replacement.commandId,
      command: replacement,
      status: "pending",
      attempts: 0,
      lastError: null,
    });
    await db.lots.put(replacementLot);
  });
  return {
    householdId: serverHouseholdId,
    refreshedAt: new Date().toISOString(),
    householdChanged: false,
  };
}
