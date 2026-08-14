import "server-only";

import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ApiFault } from "@/server/http";

const responseSchema = z.object({
  allowed: z.boolean(),
  remaining: z.number().int().nonnegative(),
  retryAfterSeconds: z.number().int().nonnegative(),
});

const WINDOWS = [
  { limit: 5, seconds: 900 },
  { limit: 20, seconds: 3_600 },
] as const;

/** Returns a Retry-After value when blocked, otherwise null. */
export async function consumeAdminLoginRateLimit(): Promise<number | null> {
  const client = createAdminSupabaseClient();

  for (const window of WINDOWS) {
    const { data, error } = await client.rpc("consume_pre_auth_rate_limit", {
      p_bucket: "admin_password_login",
      p_limit: window.limit,
      p_window_seconds: window.seconds,
    });
    if (error) {
      throw new ApiFault(
        "RATE_LIMIT_CHECK_FAILED",
        "Sign-in limits could not be verified. Try again shortly.",
        503,
        true,
      );
    }
    const result = responseSchema.parse(data);
    if (!result.allowed) return Math.max(result.retryAfterSeconds, 1);
  }

  return null;
}
