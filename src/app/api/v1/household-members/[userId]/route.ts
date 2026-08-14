import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import { ApiFault, correlationId, errorResponse, json } from "@/server/http";
import { asApiError } from "@/server/repositories/errors";

type Context = { params: Promise<{ userId: string }> };

const responseSchema = z.object({ removedUserId: z.uuid() });

export async function DELETE(request: Request, { params }: Context) {
  const correlation = correlationId(request);
  try {
    const userId = z.uuid().parse((await params).userId);
    if (isDemoMode) {
      return json(responseSchema.parse({ removedUserId: userId }));
    }
    const session = await requireHouseholdSession();
    if (session.role !== "owner") {
      throw new ApiFault(
        "HOUSEHOLD_OWNER_REQUIRED",
        "Only a household owner can remove members.",
        403,
      );
    }
    const client = await createServerSupabaseClient();
    const { data, error } = await client.rpc("remove_household_member", {
      p_user_id: userId,
    });
    if (error) throw error;
    const removed = z
      .object({ userId: z.uuid(), removed: z.literal(true) })
      .parse(data);
    return json(responseSchema.parse({ removedUserId: removed.userId }));
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "HOUSEHOLD_MEMBER_REMOVE_FAILED",
        message: "The household member could not be removed.",
      }),
      correlation,
    );
  }
}
