import { describe, expect, it } from "vitest";

import {
  aiSettingsResponseSchema,
  aiSettingsUpdateRequestSchema,
  openRouterModelDiscoveryRequestSchema,
} from "./api";

const base = {
  provider: "openrouter" as const,
  visionModelId: "vendor/vision-model",
  recipeModelId: "vendor/recipe-model",
  expectedVersion: 3,
};

describe("AI settings HTTP contracts", () => {
  it("accepts a household credential replacement", () => {
    expect(
      aiSettingsUpdateRequestSchema.parse({
        ...base,
        credentialAction: "replace",
        apiKey: "sk-or-household-secret",
      }),
    ).toMatchObject({ provider: "openrouter", credentialAction: "replace" });
  });

  it("rejects credentials outside a replacement", () => {
    expect(
      aiSettingsUpdateRequestSchema.safeParse({
        ...base,
        credentialAction: "retain",
        apiKey: "must-not-be-accepted",
      }).success,
    ).toBe(false);
    expect(
      aiSettingsUpdateRequestSchema.safeParse({
        ...base,
        credentialAction: "clear",
      }).success,
    ).toBe(true);
  });

  it("requires an API key for a replacement action", () => {
    expect(
      aiSettingsUpdateRequestSchema.safeParse({
        ...base,
        credentialAction: "replace",
      }).success,
    ).toBe(false);
  });

  it("rejects model IDs that can smuggle whitespace or query parameters", () => {
    expect(
      aiSettingsUpdateRequestSchema.safeParse({
        ...base,
        visionModelId: "vendor/model?debug=true",
        credentialAction: "retain",
      }).success,
    ).toBe(false);
  });

  it("makes a secret-bearing settings response impossible", () => {
    const response = {
      provider: "openai",
      visionModelId: "gpt-vision",
      recipeModelId: "gpt-recipes",
      credentialConfigured: true,
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

  it("keeps OpenRouter discovery key optional with no platform route", () => {
    expect(openRouterModelDiscoveryRequestSchema.parse({})).toEqual({});
    expect(
      openRouterModelDiscoveryRequestSchema.safeParse({
        apiKey: "sk-or-household-secret",
      }).success,
    ).toBe(true);
    expect(
      openRouterModelDiscoveryRequestSchema.safeParse({
        credentialSource: "platform",
      }).success,
    ).toBe(false);
  });
});
