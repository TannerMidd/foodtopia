import { describe, expect, it, vi } from "vitest";

import { readHouseholdAiSettings, writeHouseholdAiSettings } from "./ai-settings";

describe("household AI settings repository", () => {
  it("accepts PostgreSQL timestamptz offsets from the JSON RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        provider: "openai",
        visionModelId: "gpt-5.6-terra",
        recipeModelId: "gpt-5.6-luna",
        householdCredentialConfigured: false,
        updatedAt: "2026-08-14T12:00:00+00:00",
        version: 1,
      },
      error: null,
    });

    await expect(
      readHouseholdAiSettings({ rpc } as never),
    ).resolves.toMatchObject({
      updatedAt: "2026-08-14T12:00:00+00:00",
      version: 1,
    });
  });

  it("sends the BYO-only write payload without a credential source", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        provider: "openrouter",
        visionModelId: "vendor/vision",
        recipeModelId: "vendor/recipe",
        householdCredentialConfigured: true,
        updatedAt: "2026-08-14T12:00:00+00:00",
        version: 2,
      },
      error: null,
    });

    await expect(
      writeHouseholdAiSettings(
        { rpc } as never,
        {
          provider: "openrouter",
          visionModelId: "vendor/vision",
          recipeModelId: "vendor/recipe",
          credentialAction: "replace",
          apiKey: "sk-or-household-secret",
          expectedVersion: 2,
        },
        { encryptedApiKey: "v1.id.tag.ciphertext", encryptionKeyId: "current" },
      ),
    ).resolves.toMatchObject({ provider: "openrouter" });
    expect(rpc).toHaveBeenCalledWith(
      "write_household_ai_settings",
      expect.not.objectContaining({ p_credential_source: expect.anything() }),
    );
  });
});
