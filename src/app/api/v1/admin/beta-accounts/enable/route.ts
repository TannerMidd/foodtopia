import type { NextRequest } from "next/server";

import {
  betaAccountMutationRequestSchema,
  betaAccountMutationResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/server/auth/admin-user";
import { correlationId, errorResponse, json, parseJson } from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import { assertSameOrigin } from "@/server/origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Administrator enablement. The request selects who joins the beta; the batch
 * is capped so one action can never silently admit an unbounded number of
 * pending accounts. Already-enabled users are left untouched (idempotent).
 */
export async function POST(request: NextRequest) {
  const id = correlationId(request);
  try {
    assertSameOrigin(request);
    const input = await parseJson(request, betaAccountMutationRequestSchema);
    if (!isDemoMode) {
      const admin = await requireAdminSession();
      const serviceRole = createAdminSupabaseClient();
      const { data, error } = await serviceRole
        .from("profiles")
        .update({
          status: "enabled",
          enabled_at: new Date().toISOString(),
          enabled_by: admin.userId,
        })
        .in("id", input.userIds)
        .neq("status", "enabled")
        .select("id");
      if (error) throw error;
      return json(
        betaAccountMutationResponseSchema.parse({
          changedCount: data?.length ?? 0,
        }),
      );
    }
    return json(
      betaAccountMutationResponseSchema.parse({
        changedCount: input.userIds.length,
      }),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "BETA_ACCOUNT_ENABLE_FAILED",
        message: "The selected accounts could not be enabled.",
      }),
      id,
    );
  }
}
