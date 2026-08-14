import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { asApiError } from "@/server/repositories/errors";

const requestSchema = z.object({
  name: z.literal("recipe_opened"),
  properties: z.object({}).strict(),
});

export async function POST(request: Request) {
  const correlation = correlationId(request);
  try {
    const input = await parseJson(request, requestSchema);
    if (!isDemoMode) {
      await requireHouseholdSession();
      const client = await createServerSupabaseClient();
      // Telemetry is deliberately best-effort, but the user-scoped RPC is the
      // privacy boundary: no arbitrary event names, identifiers, or text.
      await client.rpc("record_product_event", {
        p_event_name: input.name,
        p_properties: input.properties,
      });
    }
    return json({ accepted: true }, { status: 202 });
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "PRODUCT_EVENT_REJECTED",
        message: "The product event could not be accepted.",
      }),
      correlation,
    );
  }
}
