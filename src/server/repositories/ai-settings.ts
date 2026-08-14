import "server-only";

import { z } from "zod";

import {
  aiCredentialSourceSchema,
  aiModelIdSchema,
  aiProviderSchema,
  type AiSettingsUpdateRequest,
} from "@/contracts/api";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type UserClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

const storedSettingsSchema = z
  .object({
    provider: aiProviderSchema,
    visionModelId: aiModelIdSchema,
    recipeModelId: aiModelIdSchema,
    credentialSource: aiCredentialSourceSchema,
    householdCredentialConfigured: z.boolean(),
    // PostgreSQL JSON encodes timestamptz values with an explicit +00:00
    // offset. Accept offsets at the storage boundary, then normalize the
    // public DTO to canonical UTC in the presentation service.
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.number().int().positive(),
  })
  .strict();

const runtimeSettingsSchema = storedSettingsSchema
  .omit({ householdCredentialConfigured: true })
  .extend({
    encryptedApiKey: z.string().min(1).max(4096).nullable(),
    encryptionKeyId: z.string().min(1).max(80).nullable(),
  })
  .strict();

export type StoredHouseholdAiSettings = z.infer<typeof storedSettingsSchema>;
export type HouseholdAiRuntimeRecord = z.infer<typeof runtimeSettingsSchema>;

export async function readHouseholdAiSettings(
  client: UserClient,
): Promise<StoredHouseholdAiSettings> {
  const { data, error } = await client.rpc("get_household_ai_settings");
  if (error) throw error;
  return storedSettingsSchema.parse(data);
}

export async function writeHouseholdAiSettings(
  client: UserClient,
  input: AiSettingsUpdateRequest,
  credential: {
    encryptedApiKey: string;
    encryptionKeyId: string;
  } | null,
): Promise<StoredHouseholdAiSettings> {
  const { data, error } = await client.rpc("write_household_ai_settings", {
    p_provider: input.provider,
    p_vision_model_id: input.visionModelId,
    p_recipe_model_id: input.recipeModelId,
    p_credential_source: input.credentialSource,
    p_credential_action: input.credentialAction,
    p_encrypted_api_key: credential?.encryptedApiKey ?? null,
    p_encryption_key_id: credential?.encryptionKeyId ?? null,
    p_expected_version: input.expectedVersion,
  });
  if (error) throw error;
  return storedSettingsSchema.parse(data);
}

export async function readHouseholdAiRuntimeRecord(
  householdId: string,
): Promise<HouseholdAiRuntimeRecord> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("get_household_ai_runtime_config", {
    p_household_id: householdId,
  });
  if (error) throw error;
  return runtimeSettingsSchema.parse(data);
}

export async function rotateHouseholdAiCredential(input: {
  householdId: string;
  provider: "openai" | "openrouter";
  expectedEncryptionKeyId: string;
  expectedEncryptedApiKey: string;
  newEncryptionKeyId: string;
  newEncryptedApiKey: string;
}) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.rpc("rotate_household_ai_credential", {
    p_household_id: input.householdId,
    p_expected_provider: input.provider,
    p_expected_encryption_key_id: input.expectedEncryptionKeyId,
    p_expected_encrypted_api_key: input.expectedEncryptedApiKey,
    p_new_encryption_key_id: input.newEncryptionKeyId,
    p_new_encrypted_api_key: input.newEncryptedApiKey,
  });
  if (error) throw error;
  return data;
}
