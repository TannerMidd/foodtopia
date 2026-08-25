import { describe, expect, it } from "vitest";

import {
  betaAccountsResponseSchema,
  cookSessionCreateRequestSchema,
  recipeFlagRequestSchema,
  recipeFlagResponseSchema,
} from "./api";

describe("betaAccountsResponseSchema", () => {
  const baseAccount = {
    userId: "0d7ad6ef-3e4c-4b8f-9db1-2f0a5f6f7a01",
    email: "tmiddleton@middmail.net",
    displayName: null,
    status: "pending" as const,
    createdAt: "2026-08-23T22:34:30.016007Z",
    emailConfirmedAt: "2026-08-23T22:34:30.027654Z",
    lastSignInAt: null,
    enabledAt: null,
  };

  it("accepts Z-suffixed timestamps", () => {
    expect(
      betaAccountsResponseSchema.safeParse({
        signupsOpen: true,
        counts: { pending: 1, enabled: 0, disabled: 0 },
        accounts: [baseAccount],
      }).success,
    ).toBe(true);
  });

  // Rows written via raw SQL can carry "+00:00" offsets; one invalid row must
  // not invalidate the whole roster response.
  it("accepts +00:00 offset timestamps", () => {
    expect(
      betaAccountsResponseSchema.safeParse({
        signupsOpen: true,
        counts: { pending: 0, enabled: 1, disabled: 0 },
        accounts: [
          { ...baseAccount, status: "enabled", enabledAt: "2026-08-14T15:51:52.767434+00:00" },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("cook session create contract", () => {
  it("accepts only recipe identity, servings, and bounded confirmations", () => {
    expect(
      cookSessionCreateRequestSchema.parse({
        recipeId: "recipe-042",
        servings: 4,
        confirmedSubstitutions: [
          { ingredientId: "chicken", matchedConceptId: "chicken-thigh" },
        ],
      }),
    ).toEqual({
      recipeId: "recipe-042",
      servings: 4,
      confirmedSubstitutions: [
        { ingredientId: "chicken", matchedConceptId: "chicken-thigh" },
      ],
    });
    expect(
      cookSessionCreateRequestSchema.safeParse({
        recipeId: "recipe-042",
        servings: 4,
        confirmedSubstitutions: [],
        assessment: { tier: "ready" },
      }).success,
    ).toBe(false);
  });
});

describe("recipe flag contracts", () => {
  it("requires an explicit simulated-persistence indicator in responses", () => {
    expect(recipeFlagResponseSchema.parse({ flagged: true, simulated: false })).toEqual({
      flagged: true,
      simulated: false,
    });
    expect(recipeFlagResponseSchema.safeParse({ flagged: true }).success).toBe(false);
  });

  it("accepts only a bounded categorical reason", () => {
    expect(
      recipeFlagRequestSchema.parse({ recipeId: "recipe-081", reason: "unsafe" }),
    ).toEqual({ recipeId: "recipe-081", reason: "unsafe" });
    expect(
      recipeFlagRequestSchema.safeParse({
        recipeId: "recipe-081",
        reason: "unsafe",
        comment: "free-form text is intentionally not retained",
      }).success,
    ).toBe(false);
    expect(
      recipeFlagRequestSchema.safeParse({ recipeId: "recipe-081", reason: "bad" }).success,
    ).toBe(false);
  });
});
