import { describe, expect, it, vi } from "vitest";

import { readHouseholdAiSettings } from "./ai-settings";

describe("household AI settings repository", () => {
  it("accepts PostgreSQL timestamptz offsets from the JSON RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        provider: "openai",
        visionModelId: "gpt-5.6-terra",
        recipeModelId: "gpt-5.6-luna",
        credentialSource: "platform",
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
});
