import { describe, expect, it, vi } from "vitest";

import {
  getVisionConsent,
  recordVisionConsent,
} from "./consent";

const databaseTimestamp = "2026-08-14T20:15:30.123456+00:00";
const apiTimestamp = "2026-08-14T20:15:30.123Z";

describe("vision consent repository", () => {
  it("canonicalizes PostgreSQL timestamps returned by the consent read", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { consented_at: databaseTimestamp },
        error: null,
      }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const client = { from: vi.fn().mockReturnValue(query) };

    await expect(
      getVisionConsent(client as never, {
        householdId: "00000000-0000-4000-8000-000000000001",
        userId: "00000000-0000-4000-8000-000000000002",
      }),
    ).resolves.toEqual({
      version: "vision-v2",
      consented: true,
      consentedAt: apiTimestamp,
    });
  });

  it("canonicalizes PostgreSQL timestamps returned by consent recording", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          consentVersion: "vision-v2",
          consentedAt: databaseTimestamp,
          replayed: false,
        },
        error: null,
      }),
    };

    await expect(recordVisionConsent(client as never)).resolves.toEqual({
      version: "vision-v2",
      consented: true,
      consentedAt: apiTimestamp,
    });
  });
});
