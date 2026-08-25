import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createClient: vi.fn(),
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
  presentSettings: vi.fn(),
  keyringStatus: vi.fn(),
  encryptKey: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isDemoMode: false }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createClient,
}));
vi.mock("@/server/auth/session", () => ({
  requireHouseholdSession: mocks.requireSession,
}));
vi.mock("@/server/repositories/ai-settings", () => ({
  readHouseholdAiSettings: mocks.readSettings,
  writeHouseholdAiSettings: mocks.writeSettings,
}));
vi.mock("@/server/services/household-ai-credentials", () => ({
  encryptHouseholdApiKey: mocks.encryptKey,
  getCredentialKeyringStatus: mocks.keyringStatus,
}));
vi.mock("@/server/services/household-ai-settings", () => ({
  presentHouseholdAiSettings: mocks.presentSettings,
}));

const stored = {
  provider: "openrouter" as const,
  visionModelId: "vendor/current~vision",
  recipeModelId: "vendor/current~recipe",
  householdCredentialConfigured: true,
  updatedAt: "2026-08-25T12:00:00+00:00",
  version: 7,
};

const presented = {
  provider: "openrouter" as const,
  visionModelId: "vendor/model~vision-alias",
  recipeModelId: "vendor/model~recipe-alias",
  credentialConfigured: true,
  modelDefaults: {
    openai: { visionModelId: "gpt-vision", recipeModelId: "gpt-recipes" },
    openrouter: { visionModelId: null, recipeModelId: null },
  },
  householdCredentialsAvailable: true,
  canEdit: true,
  updatedAt: "2026-08-25T12:00:00.000Z",
  version: 8,
};

function updateRequest(overrides: Record<string, unknown> = {}) {
  return new Request("https://foodtopia.example/api/v1/ai-settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "openrouter",
      visionModelId: "vendor/model~vision-alias",
      recipeModelId: "vendor/model~recipe-alias",
      credentialAction: "retain",
      expectedVersion: 7,
      ...overrides,
    }),
  });
}

describe("PUT /api/v1/ai-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({
      userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
      householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
      role: "owner",
    });
    mocks.createClient.mockResolvedValue({ rpc: vi.fn() });
    mocks.writeSettings.mockResolvedValue({ ...stored, version: 8 });
    mocks.presentSettings.mockReturnValue(presented);
    mocks.keyringStatus.mockReturnValue({ available: true, activeKeyId: "k1" });
  });

  it("accepts discovered OpenRouter alias IDs containing a tilde", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(updateRequest());

    expect(response.status).toBe(200);
    expect(mocks.writeSettings).toHaveBeenCalledWith(
      expect.anything(),
      {
        provider: "openrouter",
        visionModelId: "vendor/model~vision-alias",
        recipeModelId: "vendor/model~recipe-alias",
        credentialAction: "retain",
        expectedVersion: 7,
      },
      null,
    );
  });

  it("returns an actionable model-ID error for the matching database invariant", async () => {
    mocks.writeSettings.mockRejectedValue(
      Object.assign(new Error("vision model ID is invalid"), {
        code: "22023",
      }),
    );
    const { PUT } = await import("./route");
    const response = await PUT(updateRequest());
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.code).toBe("AI_MODEL_ID_INVALID");
    expect(body.message).toMatch(/selected model IDs/i);
  });

  it("identifies a provider/key race instead of returning INVALID_OPERATION", async () => {
    mocks.writeSettings.mockRejectedValue(
      Object.assign(
        new Error("retaining a household key requires keeping its provider"),
        { code: "22023" },
      ),
    );
    const { PUT } = await import("./route");
    const response = await PUT(updateRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("AI_SETTINGS_PROVIDER_CHANGED");
    expect(body.message).toMatch(/provider changed/i);
  });
});
