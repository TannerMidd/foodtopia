import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readRuntime: vi.fn(),
  rotateCredential: vi.fn(),
  decryptCredential: vi.fn(),
  encryptCredential: vi.fn(),
  needsRotation: vi.fn(),
  keyringStatus: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  serverEnv: {
    openaiApiKey: "platform-openai-key",
    openaiVisionModel: "openai-vision-env",
    openaiRecipeModel: "openai-recipe-env",
    openrouterApiKey: "platform-openrouter-key",
    openrouterVisionModel: "vendor/vision-default",
    openrouterRecipeModel: "vendor/recipe-default",
  },
}));

vi.mock("@/server/repositories/ai-settings", () => ({
  readHouseholdAiRuntimeRecord: mocks.readRuntime,
  rotateHouseholdAiCredential: mocks.rotateCredential,
}));

vi.mock("@/server/services/household-ai-credentials", () => ({
  decryptHouseholdApiKey: mocks.decryptCredential,
  encryptHouseholdApiKey: mocks.encryptCredential,
  getCredentialKeyringStatus: mocks.keyringStatus,
  needsCredentialRotation: mocks.needsRotation,
}));

import {
  AiConfigurationError,
  presentHouseholdAiSettings,
  resolveHouseholdAiRuntimeConfig,
} from "./household-ai-settings";

const updatedAt = "2026-08-14T12:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.keyringStatus.mockReturnValue({
    available: true,
    activeKeyId: "current",
  });
  mocks.needsRotation.mockReturnValue(false);
});

describe("household AI runtime resolution", () => {
  it("uses only the selected OpenRouter platform key and models", async () => {
    mocks.readRuntime.mockResolvedValue({
      provider: "openrouter",
      visionModelId: "vendor/vision",
      recipeModelId: "vendor/recipe",
      credentialSource: "platform",
      encryptedApiKey: null,
      encryptionKeyId: null,
      updatedAt,
      version: 2,
    });

    await expect(resolveHouseholdAiRuntimeConfig("household-1")).resolves.toEqual({
      provider: "openrouter",
      apiKey: "platform-openrouter-key",
      visionModelId: "vendor/vision",
      recipeModelId: "vendor/recipe",
    });
    expect(mocks.decryptCredential).not.toHaveBeenCalled();
  });

  it("fails closed instead of falling back to an OpenAI deployment key", async () => {
    mocks.readRuntime.mockResolvedValue({
      provider: "openrouter",
      visionModelId: "vendor/vision",
      recipeModelId: "vendor/recipe",
      credentialSource: "household",
      encryptedApiKey: null,
      encryptionKeyId: null,
      updatedAt,
      version: 2,
    });

    await expect(
      resolveHouseholdAiRuntimeConfig("household-1"),
    ).rejects.toBeInstanceOf(AiConfigurationError);
    expect(mocks.decryptCredential).not.toHaveBeenCalled();
  });

  it("decrypts a household key and rotates an old envelope with CAS", async () => {
    mocks.readRuntime.mockResolvedValue({
      provider: "openai",
      visionModelId: "vision-custom",
      recipeModelId: "recipe-custom",
      credentialSource: "household",
      encryptedApiKey: "v1.old.tag.ciphertext",
      encryptionKeyId: "old",
      updatedAt,
      version: 4,
    });
    mocks.decryptCredential.mockReturnValue("household-secret");
    mocks.needsRotation.mockReturnValue(true);
    mocks.encryptCredential.mockReturnValue({
      encryptedApiKey: "v1.new.tag.ciphertext",
      encryptionKeyId: "current",
    });
    mocks.rotateCredential.mockResolvedValue(true);

    await expect(resolveHouseholdAiRuntimeConfig("household-1")).resolves.toEqual({
      provider: "openai",
      apiKey: "household-secret",
      visionModelId: "vision-custom",
      recipeModelId: "recipe-custom",
    });
    expect(mocks.rotateCredential).toHaveBeenCalledWith({
      householdId: "household-1",
      provider: "openai",
      expectedEncryptionKeyId: "old",
      expectedEncryptedApiKey: "v1.old.tag.ciphertext",
      newEncryptionKeyId: "current",
      newEncryptedApiKey: "v1.new.tag.ciphertext",
    });
  });

  it("presents only secret-free capability metadata", () => {
    const result = presentHouseholdAiSettings(
      {
        provider: "openai",
        visionModelId: "vision-custom",
        recipeModelId: "recipe-custom",
        credentialSource: "household",
        householdCredentialConfigured: true,
        updatedAt,
        version: 2,
      },
      true,
    );

    expect(result.credentialConfigured).toBe(true);
    expect(result.canEdit).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/apiKey|encrypted|keyId|secret/i);
  });
});
