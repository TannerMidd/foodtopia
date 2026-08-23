import {
  householdBootstrapRequestSchema,
  householdBootstrapResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DEMO_HOUSEHOLD_ID } from "@/server/demo/store";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { asApiError } from "@/server/repositories/errors";

export async function POST(request: Request) {
  const correlation = correlationId(request);
  try {
    const input = await parseJson(request, householdBootstrapRequestSchema);
    if (isDemoMode) {
      return json(
        householdBootstrapResponseSchema.parse({
          householdId: DEMO_HOUSEHOLD_ID,
        }),
        { status: 201 },
      );
    }
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user) {
      throw new ApiFault(
        "AUTHENTICATION_REQUIRED",
        "Sign in with the invited email before creating a household.",
        401,
      );
    }
    const { data: householdId, error } = await client.rpc(
      "bootstrap_household",
      { p_name: input.name, p_beta_token: input.betaToken ?? null },
    );
    if (error) throw error;
    return json(
      householdBootstrapResponseSchema.parse({ householdId }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "HOUSEHOLD_BOOTSTRAP_FAILED",
        message: "The invited household could not be created.",
      }),
      correlation,
    );
  }
}
