import "server-only";

import type {
  AiProvider,
  AiSettingsResponse,
} from "@/contracts/api";
import { serverEnv } from "@/lib/env";
import {
  decryptHouseholdApiKey,
  encryptHouseholdApiKey,
  getCredentialKeyringStatus,
  needsCredentialRotation,
} from "@/server/services/household-ai-credentials";
import {
  readHouseholdAiRuntimeRecord,
  rotateHouseholdAiCredential,
  type StoredHouseholdAiSettings,
} from "@/server/repositories/ai-settings";

const DEFAULT_OPENAI_VISION_MODEL = "gpt-5.6-terra";
const DEFAULT_OPENAI_RECIPE_MODEL = "gpt-5.6-luna";

export type HouseholdAiRuntimeConfig = Readonly<{
  provider: AiProvider;
  apiKey: string;
  visionModelId: string;
  recipeModelId: string;
}>;

export class AiConfigurationError extends Error {
  constructor(message = "The household AI provider is not configured.") {
    super(message);
    this.name = "AiConfigurationError";
  }
}

function effectiveModels(settings: StoredHouseholdAiSettings) {
  // Migration-created rows preserve the pre-settings deployment model
  // overrides until an owner explicitly saves household model IDs.
  const untouchedOpenAiDefault =
    settings.version === 1 &&
    settings.provider === "openai" &&
    settings.visionModelId === DEFAULT_OPENAI_VISION_MODEL &&
    settings.recipeModelId === DEFAULT_OPENAI_RECIPE_MODEL;
  return untouchedOpenAiDefault
    ? {
        visionModelId: serverEnv.openaiVisionModel,
        recipeModelId: serverEnv.openaiRecipeModel,
      }
    : {
        visionModelId: settings.visionModelId,
        recipeModelId: settings.recipeModelId,
      };
}

function platformApiKey(provider: AiProvider) {
  return provider === "openai"
    ? serverEnv.openaiApiKey
    : serverEnv.openrouterApiKey;
}

function keyringAvailability() {
  try {
    return getCredentialKeyringStatus();
  } catch {
    return { available: false, activeKeyId: null } as const;
  }
}

export function presentHouseholdAiSettings(
  settings: StoredHouseholdAiSettings,
  canEdit: boolean,
): AiSettingsResponse {
  const models = effectiveModels(settings);
  const keyring = keyringAvailability();
  const credentialConfigured = settings.credentialSource === "platform"
    ? Boolean(platformApiKey(settings.provider))
    : settings.householdCredentialConfigured && keyring.available;
  return {
    ...models,
    provider: settings.provider,
    credentialSource: settings.credentialSource,
    credentialConfigured,
    platformCredentials: {
      openai: Boolean(serverEnv.openaiApiKey),
      openrouter: Boolean(serverEnv.openrouterApiKey),
    },
    modelDefaults: {
      openai: {
        visionModelId: serverEnv.openaiVisionModel,
        recipeModelId: serverEnv.openaiRecipeModel,
      },
      openrouter: {
        visionModelId: serverEnv.openrouterVisionModel,
        recipeModelId: serverEnv.openrouterRecipeModel,
      },
    },
    householdCredentialsAvailable: keyring.available,
    canEdit,
    updatedAt: new Date(settings.updatedAt).toISOString(),
    version: settings.version,
  };
}

export async function resolveHouseholdAiRuntimeConfig(
  householdId: string,
): Promise<HouseholdAiRuntimeConfig> {
  const settings = await readHouseholdAiRuntimeRecord(householdId);
  const models = effectiveModels({
    ...settings,
    householdCredentialConfigured: settings.encryptedApiKey !== null,
  });

  if (settings.credentialSource === "platform") {
    const apiKey = platformApiKey(settings.provider);
    if (!apiKey) throw new AiConfigurationError();
    return {
      provider: settings.provider,
      apiKey,
      ...models,
    };
  }

  if (!settings.encryptedApiKey || !settings.encryptionKeyId) {
    throw new AiConfigurationError();
  }

  let apiKey: string;
  try {
    apiKey = decryptHouseholdApiKey(
      {
        encryptedApiKey: settings.encryptedApiKey,
        encryptionKeyId: settings.encryptionKeyId,
      },
      { householdId, provider: settings.provider },
    );
  } catch {
    throw new AiConfigurationError();
  }

  if (needsCredentialRotation(settings.encryptionKeyId)) {
    const rotated = encryptHouseholdApiKey(apiKey, {
      householdId,
      provider: settings.provider,
    });
    await rotateHouseholdAiCredential({
      householdId,
      provider: settings.provider,
      expectedEncryptionKeyId: settings.encryptionKeyId,
      expectedEncryptedApiKey: settings.encryptedApiKey,
      newEncryptionKeyId: rotated.encryptionKeyId,
      newEncryptedApiKey: rotated.encryptedApiKey,
    });
  }

  return {
    provider: settings.provider,
    apiKey,
    ...models,
  };
}
