import type { InventoryCommand } from "@/contracts/domain";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ApiFault } from "@/server/http";

import { asObject, mapInventoryLot } from "./mappers";

type UserClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

type CursorValue = Readonly<{ createdAt: string; eventId: string }>;

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function encodeInventoryCursor(cursor: CursorValue | null): string {
  if (!cursor) return "";
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeInventoryCursor(value: string | null): CursorValue | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      eventId?: unknown;
    };
    if (
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(new Date(parsed.createdAt).valueOf()) ||
      typeof parsed.eventId !== "string" ||
      !isUuid(parsed.eventId)
    ) {
      throw new Error("invalid cursor fields");
    }
    return { createdAt: parsed.createdAt, eventId: parsed.eventId };
  } catch {
    throw new ApiFault(
      "INVALID_SYNC_CURSOR",
      "The inventory sync cursor is invalid. Refresh the full inventory snapshot.",
      400,
    );
  }
}

/**
 * Add payloads carry a household ID for the optimistic DTO only. The
 * authenticated session remains authoritative and a stale tenant payload is
 * rejected before it reaches the user-scoped RPC.
 */
export function assertInventoryCommandHousehold(
  command: InventoryCommand,
  authenticatedHouseholdId: string,
) {
  if (
    command.type === "add" &&
    command.payload.householdId !== authenticatedHouseholdId
  ) {
    throw new ApiFault(
      "HOUSEHOLD_CONTEXT_MISMATCH",
      "Your household changed before this inventory item could be applied. Refresh before editing.",
      403,
    );
  }
}

export async function getInventorySync(
  client: UserClient,
  cursorValue: string | null,
) {
  const cursor = decodeInventoryCursor(cursorValue);
  const { data, error } = await client.rpc("get_inventory_sync", {
    p_after_created_at: cursor?.createdAt ?? null,
    p_after_event_id: cursor?.eventId ?? null,
    p_limit: 500,
  });
  if (error) throw error;

  const result = asObject(data, "inventory sync");
  const lots = Array.isArray(result.lots)
    ? result.lots.map(mapInventoryLot)
    : [];
  const events = Array.isArray(result.events)
    ? result.events.map((value) => {
        const event = asObject(value, "inventory event");
        return {
          id: event.id,
          lotId: event.lotId ?? event.lot_id,
          type: event.type ?? event.event_type,
          createdAt: event.createdAt ?? event.created_at,
        };
      })
    : [];
  const returnedCursor =
    result.cursor && typeof result.cursor === "object"
      ? asObject(result.cursor, "inventory cursor")
      : null;

  return {
    lots,
    events,
    // A page with no new events retains the caller's cursor. Empty string is
    // the contract-safe initial cursor and requests a full snapshot next time.
    cursor:
      returnedCursor &&
      typeof returnedCursor.createdAt === "string" &&
      typeof returnedCursor.eventId === "string"
        ? encodeInventoryCursor({
            createdAt: returnedCursor.createdAt,
            eventId: returnedCursor.eventId,
          })
        : (cursorValue ?? ""),
  };
}

export async function applyInventoryCommand(
  client: UserClient,
  command: InventoryCommand,
) {
  const { data, error } = await client.rpc("apply_inventory_command", {
    p_command_id: command.commandId,
    p_command_type: command.type,
    p_expected_version: command.expectedVersion,
    p_payload: command.payload,
  });
  if (error) {
    if (
      error.code === "40001" &&
      command.type !== "add"
    ) {
      const { data: current } = await client
        .from("inventory_lots")
        .select("*")
        .eq("id", command.payload.lotId)
        .maybeSingle();
      throw new ApiFault(
        "VERSION_CONFLICT",
        "This item changed on another device. Review the current version before reapplying.",
        409,
        false,
        current ? mapInventoryLot(current) : null,
      );
    }
    throw error;
  }

  const result = asObject(data, "inventory command");
  return {
    lot: mapInventoryLot(result.lot),
    replayed: result.replayed === true,
  };
}
