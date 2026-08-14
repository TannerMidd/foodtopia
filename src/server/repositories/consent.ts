import { z } from "zod";

import { createServerSupabaseClient } from "@/lib/supabase/server";

type UserClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export const VISION_CONSENT_VERSION = "vision-v2" as const;

let demoConsentedAt: string | null = null;

export function getDemoVisionConsent() {
  return {
    version: VISION_CONSENT_VERSION,
    consented: demoConsentedAt !== null,
    consentedAt: demoConsentedAt,
  };
}

export function recordDemoVisionConsent() {
  demoConsentedAt ??= new Date().toISOString();
  return getDemoVisionConsent();
}

export async function getVisionConsent(
  client: UserClient,
  session: { householdId: string; userId: string },
) {
  const { data, error } = await client
    .from("privacy_consents")
    .select("consented_at")
    .eq("household_id", session.householdId)
    .eq("user_id", session.userId)
    .eq("consent_version", VISION_CONSENT_VERSION)
    .maybeSingle();
  if (error) throw error;
  return {
    version: VISION_CONSENT_VERSION,
    consented: Boolean(data),
    consentedAt: data?.consented_at ?? null,
  };
}

export async function recordVisionConsent(client: UserClient) {
  const { data, error } = await client.rpc("record_privacy_consent", {
    p_consent_version: VISION_CONSENT_VERSION,
  });
  if (error) throw error;
  const recorded = z
    .object({
      consentVersion: z.literal(VISION_CONSENT_VERSION),
      consentedAt: z.iso.datetime(),
      replayed: z.boolean(),
    })
    .parse(data);
  return {
    version: VISION_CONSENT_VERSION,
    consented: true,
    consentedAt: recorded.consentedAt,
  };
}
