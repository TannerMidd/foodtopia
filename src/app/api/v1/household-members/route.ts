import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import { DEMO_HOUSEHOLD_ID } from "@/server/demo/store";
import { correlationId, errorResponse, json } from "@/server/http";
import { asApiError } from "@/server/repositories/errors";

const responseSchema = z.object({
  members: z.array(
    z.object({
      userId: z.uuid(),
      displayName: z.string().nullable(),
      email: z.email().nullable(),
      role: z.enum(["owner", "member"]),
      joinedAt: z.iso.datetime(),
    }),
  ),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlation = correlationId(request);
  try {
    if (isDemoMode) {
      return json(
        responseSchema.parse({
          members: [
            {
              userId: DEMO_HOUSEHOLD_ID,
              displayName: "Demo owner",
              email: null,
              role: "owner",
              joinedAt: new Date(0).toISOString(),
            },
          ],
        }),
      );
    }
    await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    const { data, error } = await client.rpc("list_household_members");
    if (error) throw error;
    const members = z
      .object({
        members: z.array(
          z.object({
            userId: z.uuid(),
            displayName: z.string().nullable(),
            role: z.enum(["owner", "member"]),
            joinedAt: z.iso.datetime(),
          }),
        ),
      })
      .parse(data).members;
    return json(
      responseSchema.parse({
        members: members.map((member) => ({ ...member, email: null })),
      }),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "HOUSEHOLD_MEMBERS_READ_FAILED",
        message: "Household members could not be loaded.",
      }),
      correlation,
    );
  }
}
