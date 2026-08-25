import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createClient: vi.fn(),
  flagVisibleRecipe: vi.fn(),
  demoMode: false,
}));

vi.mock("@/lib/env", () => ({
  get isDemoMode() {
    return mocks.demoMode;
  },
}));
vi.mock("@/server/auth/session", () => ({
  requireHouseholdSession: mocks.requireSession,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createClient,
}));
vi.mock("@/server/repositories/recipes", () => ({
  flagVisibleRecipe: mocks.flagVisibleRecipe,
}));

const session = {
  userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
  householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
  role: "member" as const,
};

function request(body: unknown) {
  return new Request("https://foodtopia.example/api/v1/recipe-flags", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/recipe-flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(session);
    mocks.createClient.mockResolvedValue({ kind: "user-client" });
    mocks.flagVisibleRecipe.mockResolvedValue(undefined);
    mocks.demoMode = false;
  });

  it("flags a visible recipe with server-derived household identity", async () => {
    const { POST } = await import("./route");
    const response = await POST(request({ recipeId: "recipe-081", reason: "inaccurate" }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ flagged: true, simulated: false });
    expect(mocks.flagVisibleRecipe).toHaveBeenCalledWith(
      { kind: "user-client" },
      {
        householdId: session.householdId,
        userId: session.userId,
        recipeId: "recipe-081",
        reason: "inaccurate",
      },
    );
  });

  it("labels demo feedback as simulated instead of promising persistence", async () => {
    mocks.demoMode = true;
    const { POST } = await import("./route");
    const response = await POST(request({ recipeId: "recipe-081", reason: "unsafe" }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ flagged: true, simulated: true });
    expect(mocks.requireSession).not.toHaveBeenCalled();
    expect(mocks.flagVisibleRecipe).not.toHaveBeenCalled();
  });

  it("rejects unbounded or unknown feedback instead of storing free text", async () => {
    const { POST } = await import("./route");
    const response = await POST(request({
      recipeId: "recipe-081",
      reason: "the full raw prompt and a long complaint",
    }));

    expect(response.status).toBe(422);
    expect(mocks.flagVisibleRecipe).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mocks.requireSession.mockRejectedValue(
      Object.assign(new Error("Authentication is required."), {
        code: "authentication_required",
        status: 401,
      }),
    );
    const { POST } = await import("./route");
    const response = await POST(request({ recipeId: "recipe-081", reason: "unsafe" }));

    expect(response.status).toBe(401);
    expect(mocks.flagVisibleRecipe).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected repository failures", async () => {
    mocks.flagVisibleRecipe.mockRejectedValue(new Error("private database details"));
    const { POST } = await import("./route");
    const response = await POST(request({ recipeId: "recipe-081", reason: "other" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).toBe("The recipe could not be flagged.");
    expect(JSON.stringify(body)).not.toContain("private database details");
  });

  it("does not expose cross-household or unavailable recipes", async () => {
    mocks.flagVisibleRecipe.mockRejectedValue(
      Object.assign(new Error("Recipe is unavailable."), { code: "P0002", status: 404 }),
    );
    const { POST } = await import("./route");
    const response = await POST(request({ recipeId: "private-other-household", reason: "other" }));

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("RESOURCE_NOT_FOUND");
  });
});
