import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import { correlationId, errorResponse, json } from "@/server/http";
import {
  getDemoVisionConsent,
  getVisionConsent,
  recordDemoVisionConsent,
  recordVisionConsent,
  VISION_CONSENT_VERSION,
} from "@/server/repositories/consent";
import { asApiError } from "@/server/repositories/errors";

const responseSchema = z.object({
  version: z.literal(VISION_CONSENT_VERSION),
  consented: z.boolean(),
  consentedAt: z.iso.datetime().nullable(),
});

export async function readVisionConsent(request: Request) {
  const correlation = correlationId(request);
  try {
    if (isDemoMode) return json(responseSchema.parse(getDemoVisionConsent()));
    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    return json(
      responseSchema.parse(await getVisionConsent(client, session)),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "VISION_CONSENT_READ_FAILED",
        message: "The photo-analysis consent status could not be loaded.",
      }),
      correlation,
    );
  }
}

export async function saveVisionConsent(request: Request) {
  const correlation = correlationId(request);
  try {
    if (isDemoMode) return json(responseSchema.parse(recordDemoVisionConsent()));
    await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    return json(responseSchema.parse(await recordVisionConsent(client)));
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "VISION_CONSENT_WRITE_FAILED",
        message: "Photo-analysis consent could not be recorded.",
      }),
      correlation,
    );
  }
}
