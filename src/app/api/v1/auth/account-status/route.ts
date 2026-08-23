import { accountStatusResponseSchema } from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
} from "@/server/http";
import { asApiError } from "@/server/repositories/errors";

export const dynamic = "force-dynamic";

/**
 * Waiting-room status for a signed-in open-beta account. Reads the caller's
 * own profile through RLS, so pending accounts can observe enablement without
 * gaining any other capability.
 */
export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    if (isDemoMode) {
      return json(accountStatusResponseSchema.parse({ status: "enabled" }));
    }
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new ApiFault(
        "AUTHENTICATION_REQUIRED",
        "Sign in to check your account status.",
        401,
      );
    }
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    return json(
      accountStatusResponseSchema.parse({
        status: profile?.status ?? "pending",
      }),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "ACCOUNT_STATUS_FAILED",
        message: "The account status could not be determined.",
      }),
      id,
    );
  }
}
