import {
  inventoryCommandSchema,
  inventoryLotSchema,
  type InventoryCommand,
  type InventoryLot,
} from "../contracts/domain";
import { getUnitDefinition } from "./units";

export type InventoryEventType =
  | "lot_added"
  | "lot_adjusted"
  | "lot_consumed"
  | "lot_discarded"
  | "lot_restored";

export type InventoryEvent = Readonly<{
  eventId: string;
  commandId: string;
  commandFingerprint: string;
  type: InventoryEventType;
  lotId: string;
  previousVersion: number | null;
  version: number;
  occurredAt: string;
  lot: InventoryLot;
}>;

type ProcessedCommand = Readonly<{
  fingerprint: string;
  event: InventoryEvent;
}>;

export type InventoryState = Readonly<{
  lots: readonly InventoryLot[];
  processedCommands: Readonly<Record<string, ProcessedCommand>>;
}>;

export type InventoryReducerErrorCode =
  | "invalid_command"
  | "invalid_lot"
  | "lot_not_found"
  | "lot_already_exists"
  | "version_conflict"
  | "invalid_transition"
  | "command_id_reused";

export type InventoryReducerError = Readonly<{
  code: InventoryReducerErrorCode;
  message: string;
  lotId: string | null;
  expectedVersion: number | null;
  actualVersion: number | null;
}>;

export type InventoryReducerResult =
  | Readonly<{
      ok: true;
      state: InventoryState;
      event: InventoryEvent;
      replayed: boolean;
    }>
  | Readonly<{
      ok: false;
      state: InventoryState;
      error: InventoryReducerError;
    }>;

export function createInventoryState(
  lots: readonly InventoryLot[] = [],
  events: readonly InventoryEvent[] = [],
): InventoryState {
  const parsedLots = lots.map((lot) => inventoryLotSchema.parse(lot));
  const processedCommands = Object.fromEntries(
    events.map((event) => [
      event.commandId,
      { fingerprint: event.commandFingerprint, event },
    ]),
  );
  return { lots: parsedLots, processedCommands };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function inventoryCommandFingerprint(command: InventoryCommand): string {
  return JSON.stringify(stableValue(command));
}

function reducerError(
  state: InventoryState,
  code: InventoryReducerErrorCode,
  message: string,
  lotId: string | null = null,
  expectedVersion: number | null = null,
  actualVersion: number | null = null,
): InventoryReducerResult {
  return {
    ok: false,
    state,
    error: { code, message, lotId, expectedVersion, actualVersion },
  };
}

function timestamp(value: Date | string | undefined): string | null {
  const date = value instanceof Date ? new Date(value) : new Date(value ?? Date.now());
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function coherentLot(lot: InventoryLot): string | null {
  if (lot.quantityStatus === "unknown") {
    if (lot.quantity !== null || lot.unit !== null) {
      return "Unknown quantity must not carry a numeric quantity or unit.";
    }
  } else {
    if (lot.quantity === null || lot.unit === null) {
      return `${lot.quantityStatus} quantity requires both quantity and unit.`;
    }
    if (!getUnitDefinition(lot.unit)) {
      return `Unsupported inventory unit "${lot.unit}".`;
    }
  }

  if (lot.dateLabel === null && lot.dateLabelType !== null) {
    return "A date-label type requires a date.";
  }
  if (lot.dateLabel !== null && lot.dateLabelType === null) {
    return "A date requires an explicit date-label type, including unknown.";
  }
  return null;
}

function eventType(command: InventoryCommand): InventoryEventType {
  switch (command.type) {
    case "add":
      return "lot_added";
    case "adjust":
      return "lot_adjusted";
    case "consume":
      return "lot_consumed";
    case "discard":
      return "lot_discarded";
    case "restore":
      return "lot_restored";
  }
}

function transitionStatus(
  lot: InventoryLot,
  command: Exclude<InventoryCommand, { type: "add" }>,
): InventoryLot["status"] | null {
  switch (command.type) {
    case "adjust":
      return lot.status;
    case "consume":
      return lot.status === "active" ? "consumed" : null;
    case "discard":
      return lot.status === "active" ? "discarded" : null;
    case "restore":
      return lot.status === "consumed" || lot.status === "discarded"
        ? "active"
        : null;
  }
}

/**
 * Pure command reducer. A repeated command ID with identical content returns the
 * original event before version checks, which makes at-least-once delivery safe.
 */
export function reduceInventoryCommand(
  state: InventoryState,
  input: InventoryCommand,
  now?: Date | string,
): InventoryReducerResult {
  const parsed = inventoryCommandSchema.safeParse(input);
  if (!parsed.success) {
    return reducerError(
      state,
      "invalid_command",
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  const command = parsed.data;
  const fingerprint = inventoryCommandFingerprint(command);
  const processed = state.processedCommands[command.commandId];

  if (processed) {
    if (processed.fingerprint !== fingerprint) {
      return reducerError(
        state,
        "command_id_reused",
        "The command ID was already used with different content.",
        command.type === "add" ? command.payload.id : command.payload.lotId,
      );
    }
    return { ok: true, state, event: processed.event, replayed: true };
  }

  const occurredAt = timestamp(now);
  if (!occurredAt) {
    return reducerError(state, "invalid_command", "Reducer time must be valid.");
  }

  let previousVersion: number | null = null;
  let nextLot: InventoryLot;

  if (command.type === "add") {
    if (state.lots.some((lot) => lot.id === command.payload.id)) {
      return reducerError(
        state,
        "lot_already_exists",
        "An inventory lot already uses this ID.",
        command.payload.id,
      );
    }
    if (command.payload.status !== "active") {
      return reducerError(
        state,
        "invalid_transition",
        "New inventory lots must start active.",
        command.payload.id,
      );
    }
    nextLot = {
      ...command.payload,
      version: 0,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
  } else {
    const currentLot = state.lots.find((lot) => lot.id === command.payload.lotId);
    if (!currentLot) {
      return reducerError(
        state,
        "lot_not_found",
        "Inventory lot was not found.",
        command.payload.lotId,
        command.expectedVersion,
      );
    }
    if (currentLot.version !== command.expectedVersion) {
      return reducerError(
        state,
        "version_conflict",
        "Inventory lot changed after the caller read it.",
        currentLot.id,
        command.expectedVersion,
        currentLot.version,
      );
    }
    const status = transitionStatus(currentLot, command);
    if (status === null) {
      return reducerError(
        state,
        "invalid_transition",
        `Cannot ${command.type} a lot with status ${currentLot.status}.`,
        currentLot.id,
        command.expectedVersion,
        currentLot.version,
      );
    }
    const { lotId: _lotId, ...changes } = command.payload;
    void _lotId;
    previousVersion = currentLot.version;
    nextLot = {
      ...currentLot,
      ...changes,
      status,
      version: currentLot.version + 1,
      updatedAt: occurredAt,
    };
  }

  const parsedLot = inventoryLotSchema.safeParse(nextLot);
  if (!parsedLot.success) {
    return reducerError(
      state,
      "invalid_lot",
      parsedLot.error.issues.map((issue) => issue.message).join("; "),
      nextLot.id,
    );
  }
  const coherenceError = coherentLot(parsedLot.data);
  if (coherenceError) {
    return reducerError(state, "invalid_lot", coherenceError, parsedLot.data.id);
  }

  const event: InventoryEvent = {
    eventId: command.commandId,
    commandId: command.commandId,
    commandFingerprint: fingerprint,
    type: eventType(command),
    lotId: parsedLot.data.id,
    previousVersion,
    version: parsedLot.data.version,
    occurredAt,
    lot: parsedLot.data,
  };
  const lots =
    command.type === "add"
      ? [...state.lots, parsedLot.data]
      : state.lots.map((lot) =>
          lot.id === parsedLot.data.id ? parsedLot.data : lot,
        );
  const nextState: InventoryState = {
    lots,
    processedCommands: {
      ...state.processedCommands,
      [command.commandId]: { fingerprint, event },
    },
  };

  return { ok: true, state: nextState, event, replayed: false };
}
