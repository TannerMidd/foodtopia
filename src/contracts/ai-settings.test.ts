import { describe, expect, it } from "vitest";

import {
  aiSettingsResponseSchema,
  aiSettingsUpdateRequestSchema,
} from "./api";

const base = {
  provider: "openrouter" as const,
  visionModelId: "vendor/vision-model",
  recipeModelId: "vendor/recipe-model",
  expectedVersion: 3,
};

describe("AI settings HTTP contracts", () => {
  it("accepts a one-way household credential replacement", () => {
    expect(
      aiSettingsUpdateRequestSchema.parse({
        ...base,
        credentialSource: "household",
        credentialAction: "replace",
        apiKey: "sk-or-household-secret",
      }),
    ).toMatchObject({ provider: "openrouter", credentialAction: "replace" });
  });

  it("rejects credentials outside a household replacement", () => {
    expect(
      aiSettingsUpdateRequestSchema.safeParse({
        ...base,
        credentialSource: "platform",
        credentialAction: "retain",
        apiKey: "must-not-be-accepted",
      }).success,
    ).toBe(false);
    expect(
      aiSettingsUpdateRequestSchema.safeParse({
        ...base,
        credentialSource: "household",
        credentialAction: "clear",
      }).success,
    ).toBe(false);
  });

  it("rejects model IDs that can smuggle whitespace or query parameters", () => {
    expect(
      aiSettingsUpdateRequestSchema.safeParse({
        ...base,
        visionModelId: "vendor/model?debug=true",
        credentialSource: "platform",
        credentialAction: "retain",
      }).success,
    ).toBe(false);
  });

  it("makes a secret-bearing settings response impossible", () => {
    const response = {
      provider: "openai",
      visionModelId: "gpt-vision",
      recipeModelId: "gpt-recipes",
      credentialSource: "household",
      credentialConfigured: true,
      platformCredentials: { openai: true, openrouter: false },
      modelDefaults: {
        openai: {
          visionModelId: "gpt-vision",
          recipeModelId: "gpt-recipes",
        },
        openrouter: { visionModelId: null, recipeModelId: null },
      },
      householdCredentialsAvailable: true,
      canEdit: true,
      updatedAt: "2026-08-14T12:00:00.000Z",
      version: 2,
      apiKey: "must-never-return",
    };
    expect(aiSettingsResponseSchema.safeParse(response).success).toBe(false);
  });
});
