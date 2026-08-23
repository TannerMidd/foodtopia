import type { NextRequest } from "next/server";

import {
  signupWindowResponseSchema,
  signupWindowUpdateRequestSchema,
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
 * Global open-beta tap. When closed, the before_user_created hook admits only
 * live invitation emails; accounts that already signed up stay pending until
 * individually enabled.
 */
export async function POST(request: NextRequest) {
  const id = correlationId(request);
  try {
    assertSameOrigin(request);
    const input = await parseJson(request, signupWindowUpdateRequestSchema);
    if (!isDemoMode) {
      const admin = await requireAdminSession();
      const serviceRole = createAdminSupabaseClient();
      const { error } = await serviceRole
        .from("beta_signup_settings")
        .upsert({
          id: 1,
          signups_open: input.open,
          updated_by: admin.userId,
        });
      if (error) throw error;
    }
    return json(signupWindowResponseSchema.parse({ signupsOpen: input.open }));
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "BETA_SIGNUP_WINDOW_FAILED",
        message: "The signup window could not be updated.",
      }),
      id,
    );
  }
}
