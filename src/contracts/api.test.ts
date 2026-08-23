import { describe, expect, it } from "vitest";

import { betaAccountsResponseSchema } from "./api";

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
