import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type ProductEventName =
  | "analysis_created"
  | "analysis_completed"
  | "analysis_applied"
  | "analysis_failed"
  | "recipe_suggestions_returned"
  | "cook_started"
  | "cook_reconciled"
  | "invite_created"
  | "purge_completed"
  | "recipe_opened"
  | "inventory_command_applied";

type SafeValue = number | boolean | string;

const allowedProperties: Readonly<Record<ProductEventName, ReadonlySet<string>>> = {
  analysis_created: new Set(["imageCount"]),
  analysis_completed: new Set(["imageCount", "durationMs"]),
  analysis_applied: new Set([
    "acceptedCount",
    "rejectedCount",
    "correctionCount",
    "durationMs",
  ]),
  analysis_failed: new Set(["retryCount", "durationMs"]),
  recipe_suggestions_returned: new Set(["itemCount", "durationMs"]),
  cook_started: new Set(["itemCount"]),
  cook_reconciled: new Set(["itemCount", "durationMs"]),
  invite_created: new Set([]),
  purge_completed: new Set(["itemCount", "durationMs"]),
  recipe_opened: new Set([]),
  inventory_command_applied: new Set(["replayed"]),
};

function safeProperties(
  eventName: ProductEventName,
  value: Readonly<Record<string, unknown>>,
): Record<string, SafeValue> {
  const result: Record<string, SafeValue> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!allowedProperties[eventName].has(key)) continue;
    if (typeof candidate === "boolean") {
      result[key] = candidate;
    } else if (
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      Number.isInteger(candidate) &&
      candidate >= 0 &&
      candidate <= 86_400_000
    ) {
      result[key] = candidate;
    } else if (
      candidate === "ready" ||
      candidate === "likely_ready" ||
      candidate === "almost_ready" ||
      candidate === "incompatible"
    ) {
      result[key] = candidate;
    }
  }
  return result;
}

/** Best-effort and privacy-safe by construction; product actions never await failure. */
export async function recordProductEvent(input: {
  householdId: string;
  userId: string;
  eventName: ProductEventName;
  source?: "server" | "worker";
  properties?: Readonly<Record<string, unknown>>;
  idempotencyKey?: string;
}) {
  try {
    const admin = createAdminSupabaseClient();
    const { error } = await admin.from("product_events").insert({
      household_id: input.householdId,
      user_id: input.userId,
      event_name: input.eventName,
      source: input.source ?? "server",
      properties: safeProperties(input.eventName, input.properties ?? {}),
      client_session_id: null,
      idempotency_key: input.idempotencyKey?.slice(0, 160) ?? null,
      occurred_at: new Date().toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}
