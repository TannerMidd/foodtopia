import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const RECIPE_PROPOSAL_PURGE_CRON = "17 * * * *";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

/** Clears every overdue pending payload without reading or logging its content. */
export async function purgeExpiredRecipeProposals(
  admin: AdminClient = createAdminSupabaseClient(),
  observedAt: Date = new Date(),
): Promise<{ expiredCount: number }> {
  const timestamp = observedAt.toISOString();
  const { data, error } = await admin
    .from("recipe_proposals")
    .update({
      status: "expired",
      recipe_payload: null,
      content_hash: null,
      decided_at: timestamp,
      version: 1,
    })
    .eq("status", "proposed")
    .lte("expires_at", timestamp)
    .select("id");
  if (error) throw error;
  return { expiredCount: data?.length ?? 0 };
}
