import {
  inventoryCommandRequestSchema,
  inventoryCommandResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import { applyDemoCommand } from "@/server/demo/store";
import {
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import {
  applyInventoryCommand,
  assertInventoryCommandHousehold,
} from "@/server/repositories/inventory";
import { enforceRateLimit } from "@/server/repositories/rate-limit";
import { recordProductEvent } from "@/server/repositories/telemetry";

export async function POST(request: Request) {
  const id = correlationId(request);
  try {
    const { command } = await parseJson(request, inventoryCommandRequestSchema);
    const result = isDemoMode
      ? applyDemoCommand(command)
      : await (async () => {
          const session = await requireHouseholdSession();
          const client = await createServerSupabaseClient();
          assertInventoryCommandHousehold(command, session.householdId);
          await enforceRateLimit(client, "inventory_command", 300, 60 * 60);
          const applied = await applyInventoryCommand(client, command);
          await recordProductEvent({
            householdId: session.householdId,
            userId: session.userId,
            eventName: "inventory_command_applied",
            properties: {
              replayed: applied.replayed,
            },
            idempotencyKey: `inventory-command:${command.commandId}`,
          });
          return applied;
        })();
    return json(
      inventoryCommandResponseSchema.parse(result),
      { status: 200 },
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "INVENTORY_COMMAND_FAILED",
        message: "The inventory change could not be applied.",
      }),
      id,
    );
  }
}
