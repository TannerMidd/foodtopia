import {
  householdInviteAcceptRequestSchema,
  householdInviteAcceptResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DEMO_HOUSEHOLD_ID } from "@/server/demo/store";
import { requireEnabledAccount } from "@/server/auth/session";
import {
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { asApiError } from "@/server/repositories/errors";

export async function POST(request: Request) {
  const correlation = correlationId(request);
  try {
    const { token } = await parseJson(
      request,
      householdInviteAcceptRequestSchema,
    );
    if (isDemoMode) {
      return json(
        householdInviteAcceptResponseSchema.parse({
          householdId: DEMO_HOUSEHOLD_ID,
        }),
      );
    }
    // Household members are pre-approved through their invitation, but the
    // admission boundary still applies: an administrator-disabled or not-yet-
    // enabled account cannot join a household.
    await requireEnabledAccount();
    const client = await createServerSupabaseClient();
    const { data: householdId, error } = await client.rpc(
      "accept_household_invite",
      { p_token: token },
    );
    if (error) throw error;
    return json(
      householdInviteAcceptResponseSchema.parse({ householdId }),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "HOUSEHOLD_INVITE_ACCEPT_FAILED",
        message: "The household invitation could not be accepted.",
      }),
      correlation,
    );
  }
}
