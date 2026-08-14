import { inventorySyncResponseSchema } from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { demoEvents } from "@/server/demo/store";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  correlationId,
  errorResponse,
  json,
} from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import { getInventorySync } from "@/server/repositories/inventory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (isDemoMode) {
      return json(
        inventorySyncResponseSchema.parse(demoEvents(cursor)),
      );
    }
    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    return json(
      inventorySyncResponseSchema.parse({
        householdId: session.householdId,
        ...(await getInventorySync(client, cursor)),
      }),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "INVENTORY_SYNC_FAILED",
        message: "Inventory could not be synchronized.",
        status: 503,
      }),
      id,
    );
  }
}
