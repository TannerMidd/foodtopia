import { z } from "zod";

import { householdPreferencesSchema } from "@/contracts/domain";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import {
  readDemoPreferences,
  readPreferences,
  writeDemoPreferences,
  writePreferences,
} from "@/server/repositories/preferences";

const conceptIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const preferencesRequestSchema = z.object({
  staples: z.array(conceptIdSchema).max(40),
  dietaryTags: z.array(z.string().trim().min(1).max(80)).max(40),
  excludedConceptIds: z.array(conceptIdSchema).max(100),
});

function uniquePreferences(value: z.infer<typeof preferencesRequestSchema>) {
  return householdPreferencesSchema.parse({
    staples: [...new Set(value.staples)],
    dietaryTags: [...new Set(value.dietaryTags)],
    excludedConceptIds: [...new Set(value.excludedConceptIds)],
  });
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlation = correlationId(request);
  try {
    if (isDemoMode) {
      return json(
        householdPreferencesSchema.parse(readDemoPreferences()),
      );
    }
    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    return json(
      householdPreferencesSchema.parse(
        await readPreferences(client, session.householdId),
      ),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "PREFERENCES_READ_FAILED",
        message: "Household preferences could not be loaded.",
      }),
      correlation,
    );
  }
}

export async function PUT(request: Request) {
  const correlation = correlationId(request);
  try {
    const input = uniquePreferences(
      await parseJson(request, preferencesRequestSchema),
    );
    if (isDemoMode) {
      return json(
        householdPreferencesSchema.parse(writeDemoPreferences(input)),
      );
    }
    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    return json(
      householdPreferencesSchema.parse(
        await writePreferences(client, session, input),
      ),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "PREFERENCES_WRITE_FAILED",
        message: "Household preferences could not be saved.",
      }),
      correlation,
    );
  }
}
