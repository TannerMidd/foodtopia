import { z } from "zod";

import { householdCurrentResponseSchema } from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import { DEMO_HOUSEHOLD_ID } from "@/server/demo/store";
import { ApiFault, correlationId, errorResponse, json } from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import {
  deleteCurrentHousehold,
  getCurrentHousehold,
} from "@/server/repositories/households";

const responseSchema = z.union([
  z.object({
    householdId: z.uuid(),
    status: z.literal("deletion_pending"),
    finalizeAfter: z.iso.datetime(),
  }),
  z.object({
    householdId: z.uuid(),
    deleted: z.literal(true),
  }),
]);

export async function GET(request: Request) {
  const correlation = correlationId(request);
  try {
    if (isDemoMode) {
      return json(
        householdCurrentResponseSchema.parse({
          householdId: DEMO_HOUSEHOLD_ID,
          name: "Maple Street",
          role: "owner",
        }),
      );
    }
    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    return json(
      householdCurrentResponseSchema.parse(
        await getCurrentHousehold(client, session),
      ),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "HOUSEHOLD_READ_FAILED",
        message: "The current household could not be loaded.",
      }),
      correlation,
    );
  }
}

export async function DELETE(request: Request) {
  const correlation = correlationId(request);
  try {
    if (isDemoMode) {
      return json(
        responseSchema.parse({ householdId: DEMO_HOUSEHOLD_ID, deleted: true }),
      );
    }
    let expectedHouseholdId: string | null = null;
    try {
      const session = await requireHouseholdSession();
      if (session.role !== "owner") {
        throw new ApiFault(
          "HOUSEHOLD_OWNER_REQUIRED",
          "Only a household owner can delete the household.",
          403,
        );
      }
      expectedHouseholdId = session.householdId;
    } catch (error) {
      // A retry after phase one is intentionally allowed: the household is
      // quarantined, so the normal membership helper no longer resolves it.
      if (error instanceof ApiFault) throw error;
    }
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user) {
      throw new ApiFault(
        "AUTHENTICATION_REQUIRED",
        "Authentication is required.",
        401,
      );
    }
    const result = responseSchema.parse(
      await deleteCurrentHousehold(client, expectedHouseholdId),
    );
    return json(result, {
      status: "status" in result ? 202 : 200,
    });
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "HOUSEHOLD_DELETE_FAILED",
        message:
          "The household is quarantined, but deletion has not finished. Retry later.",
        status: 503,
      }),
      correlation,
    );
  }
}
