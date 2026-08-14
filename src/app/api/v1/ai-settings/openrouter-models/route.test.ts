import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  requireSession: vi.fn(),
  resolveRuntime: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  isDemoMode: false,
  serverEnv: { openrouterApiKey: null },
}));
vi.mock("@/server/auth/session", () => ({
  requireHouseholdSession: mocks.requireSession,
}));
vi.mock("@/server/ai/openrouter-models", () => ({
  discoverOpenRouterModels: mocks.discover,
}));
vi.mock("@/server/services/household-ai-settings", () => ({
  resolveHouseholdAiRuntimeConfig: mocks.resolveRuntime,
}));

describe("POST /api/v1/ai-settings/openrouter-models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({
      userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
      householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
      role: "owner",
    });
    mocks.discover.mockResolvedValue({
      models: [
        {
          id: "vendor/vision-ready",
          name: "Vision Ready",
          contextLength: 131072,
          supportsVision: true,
        },
      ],
      fetchedAt: "2026-08-14T18:00:00.000Z",
    });
  });

  it("uses an entered key ephemerally without reading the saved runtime credential", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request(
        "https://foodtopia.example/api/v1/ai-settings/openrouter-models",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            credentialSource: "household",
            apiKey: "fake-private-openrouter-key",
          }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.discover).toHaveBeenCalledWith("fake-private-openrouter-key");
    expect(mocks.resolveRuntime).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(
      "fake-private-openrouter-key",
    );
  });

  it("decrypts the already-saved household key only on the server", async () => {
    mocks.resolveRuntime.mockResolvedValue({
      provider: "openrouter",
      apiKey: "saved-private-openrouter-key",
      visionModelId: "vendor/vision",
      recipeModelId: "vendor/recipe",
    });
    const { POST } = await import("./route");
    const response = await POST(
      new Request(
        "https://foodtopia.example/api/v1/ai-settings/openrouter-models",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ credentialSource: "household" }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveRuntime).toHaveBeenCalledWith(
      "45ebd76e-773c-43c6-a66a-e941dac40d80",
    );
    expect(mocks.discover).toHaveBeenCalledWith(
      "saved-private-openrouter-key",
    );
  });

  it("rejects non-owners before accepting or resolving a key", async () => {
    mocks.requireSession.mockResolvedValue({
      userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
      householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
      role: "member",
    });
    const { POST } = await import("./route");
    const response = await POST(
      new Request(
        "https://foodtopia.example/api/v1/ai-settings/openrouter-models",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            credentialSource: "household",
            apiKey: "fake-private-openrouter-key",
          }),
        },
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.resolveRuntime).not.toHaveBeenCalled();
  });
});
