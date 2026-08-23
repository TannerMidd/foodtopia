import type { NextRequest } from "next/server";

import {
  betaAccountMutationRequestSchema,
  betaAccountMutationResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/server/auth/admin-user";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import { assertSameOrigin } from "@/server/origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Administrator revocation. Disabling clears the enablement record so the
 * account returns to a state only an explicit re-enable can leave. The acting
 * administrator cannot disable their own operational identity.
 */
export async function POST(request: NextRequest) {
  const id = correlationId(request);
  try {
    assertSameOrigin(request);
    const input = await parseJson(request, betaAccountMutationRequestSchema);
    if (!isDemoMode) {
      const admin = await requireAdminSession();
      if (input.userIds.includes(admin.userId)) {
        throw new ApiFault(
          "ADMIN_SELF_DISABLE_REJECTED",
          "Administrators cannot disable their own account.",
          422,
        );
      }
      const serviceRole = createAdminSupabaseClient();
      const { data, error } = await serviceRole
        .from("profiles")
        .update({
          status: "disabled",
          enabled_at: null,
          enabled_by: null,
        })
        .in("id", input.userIds)
        .neq("status", "disabled")
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
        code: "BETA_ACCOUNT_DISABLE_FAILED",
        message: "The selected accounts could not be disabled.",
      }),
      id,
    );
  }
}
