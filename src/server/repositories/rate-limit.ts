import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ApiFault } from "@/server/http";

type UserClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type RateLimitAction =
  | "analysis_create"
  | "recipe_suggest"
  | "recipe_generate"
  | "invite_create"
  | "inventory_command"
  | "cook_reconcile";

const responseSchema = z.object({
  allowed: z.boolean(),
  remaining: z.number().int().nonnegative(),
  retryAfterSeconds: z.number().int().nonnegative(),
});

export async function enforceRateLimit(
  client: UserClient,
  action: RateLimitAction,
  limit: number,
  windowSeconds: number,
) {
  const { data, error } = await client.rpc("consume_rate_limit", {
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    throw new ApiFault(
      "RATE_LIMIT_CHECK_FAILED",
      "Request limits could not be verified. Try again shortly.",
      503,
      true,
    );
  }
  const result = responseSchema.parse(data);
  if (!result.allowed) {
    throw new ApiFault(
      "RATE_LIMITED",
      `Too many requests. Try again in about ${result.retryAfterSeconds} seconds.`,
      429,
      true,
    );
  }
  return result;
}
