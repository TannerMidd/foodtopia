import Dexie, { type EntityTable } from "dexie";
import type { InventoryCommand, InventoryLot, Recipe, RecipeAssessment } from "@/contracts/domain";

export const DEMO_HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";

export type OutboxStatus = "pending" | "sending" | "conflict" | "failed";

export type OutboxRecord = {
  commandId: string;
  householdId: string;
  sequence: number;
  command: InventoryCommand;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
};

export type SnapshotRecord = {
  householdId: string;
  cursor: string | null;
  refreshedAt: string | null;
};

export type MetaRecord = {
  key: string;
  value: string | number | null;
};

/**
 * Durable per-recipe cooking context. Survives tab close and device restarts,
 * unlike the sessionStorage it replaces: a kitchen tablet must not lose the
 * ingredient comparison or server session id mid-cook.
 */
export type CookSessionRecord = {
  slug: string;
  assessment: RecipeAssessment;
  sessionId: string | null;
  savedAt: string;
};

class FoodtopiaDatabase extends Dexie {
  lots!: EntityTable<InventoryLot, "id">;
  outbox!: EntityTable<OutboxRecord, "commandId">;
  snapshots!: EntityTable<SnapshotRecord, "householdId">;
  meta!: EntityTable<MetaRecord, "key">;
  catalogRecipes!: EntityTable<Recipe, "slug">;
  cookSessions!: EntityTable<CookSessionRecord, "slug">;

  constructor() {
    super("foodtopia-offline-v1");
    this.version(1).stores({
      lots: "id, householdId, [householdId+status], updatedAt",
      outbox: "commandId, householdId, [householdId+sequence], status, sequence",
      snapshots: "householdId, refreshedAt",
      meta: "key",
    });
    // Version 2 adds the browsable recipe cache and durable cooking sessions.
    // Neither is household-keyed because every row already belongs to the one
    // bound household and both are cleared together in resetAndBind.
    this.version(2).stores({
      lots: "id, householdId, [householdId+status], updatedAt",
      outbox: "commandId, householdId, [householdId+sequence], status, sequence",
      snapshots: "householdId, refreshedAt",
      meta: "key",
      catalogRecipes: "slug",
      cookSessions: "slug",
    });
  }
}

let database: FoodtopiaDatabase | null = null;

export function getOfflineDb() {
  if (!database) database = new FoodtopiaDatabase();
  return database;
}

export async function getActiveHouseholdId() {
  return (await getPersistedActiveHouseholdId()) ?? DEMO_HOUSEHOLD_ID;
}

export async function getPersistedActiveHouseholdId() {
  const record = await getOfflineDb().meta.get("activeHouseholdId");
  return typeof record?.value === "string" && record.value.length > 0
    ? record.value
    : null;
}

export async function setActiveHouseholdId(householdId: string) {
  await getOfflineDb().meta.put({ key: "activeHouseholdId", value: householdId });
}

export async function clearOfflineData() {
  const db = getOfflineDb();
  await db.transaction(
    "rw",
    [db.lots, db.outbox, db.snapshots, db.meta, db.catalogRecipes, db.cookSessions],
    async () => {
      await Promise.all([
        db.lots.clear(),
        db.outbox.clear(),
        db.snapshots.clear(),
        db.meta.clear(),
        db.catalogRecipes.clear(),
        db.cookSessions.clear(),
      ]);
    },
  );
}

/** Atomically removes every prior tenant row and installs the new binding. */
export async function resetAndBindOfflineHousehold(householdId: string) {
  const db = getOfflineDb();
  await db.transaction(
    "rw",
    [db.lots, db.outbox, db.snapshots, db.meta, db.catalogRecipes, db.cookSessions],
    async () => {
      await Promise.all([
        db.lots.clear(),
        db.outbox.clear(),
        db.snapshots.clear(),
        db.meta.clear(),
        db.catalogRecipes.clear(),
        db.cookSessions.clear(),
      ]);
      await db.meta.put({ key: "activeHouseholdId", value: householdId });
    },
  );
}
