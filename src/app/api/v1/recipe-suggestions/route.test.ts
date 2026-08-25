import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Recipe } from "@/contracts/domain";

const mocks = vi.hoisted(() => ({
  demoMode: false,
  parseIntent: vi.fn(),
  explain: vi.fn(),
  generate: vi.fn(),
  suggestRecipes: vi.fn(),
  enforceRateLimit: vi.fn(),
  createProposal: vi.fn(),
  preflightProposal: vi.fn(),
  purgeProposals: vi.fn(),
  listRecipes: vi.fn(),
  inventory: vi.fn(),
  preferences: vi.fn(),
  resolveConfig: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ get isDemoMode() { return mocks.demoMode; } }));
vi.mock("@/server/ai", () => ({
  createRecipeAssistant: () => ({
    parseIntent: mocks.parseIntent,
    explain: mocks.explain,
    generate: mocks.generate,
  }),
}));
vi.mock("@/domain/assessment", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/domain/assessment")>();
  return { ...original, suggestRecipes: mocks.suggestRecipes };
});
vi.mock("@/server/auth/session", () => ({
  requireHouseholdSession: vi.fn().mockResolvedValue({
    userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
    householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
    role: "member",
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn().mockResolvedValue({ kind: "user" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => ({ kind: "admin" }) }));
vi.mock("@/server/repositories/rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock("@/server/repositories/inventory", () => ({ getInventorySync: mocks.inventory }));
vi.mock("@/server/repositories/recipes", () => ({
  listSuggestibleRecipes: mocks.listRecipes,
  getHouseholdPreferences: mocks.preferences,
  createRecipeProposal: mocks.createProposal,
  preflightRecipeProposal: mocks.preflightProposal,
}));
vi.mock("@/server/repositories/telemetry", () => ({ recordProductEvent: vi.fn() }));
vi.mock("@/server/services/recipe-proposal-retention", () => ({
  purgeExpiredRecipeProposals: mocks.purgeProposals,
}));
vi.mock("@/server/services/household-ai-settings", () => ({
  AiConfigurationError: class AiConfigurationError extends Error {},
  resolveHouseholdAiRuntimeConfig: mocks.resolveConfig,
}));

const parsedIntent = {
  query: "unmatched dinner",
  maxMinutes: null,
  servings: null,
  mealTypes: ["dinner"],
  cuisines: [],
  dietaryTags: [],
  includeConceptIds: [],
  excludeConceptIds: [],
};
const recipe: Recipe = {
  id: "generated-12345678-1234-4234-8234-123456789abc",
  slug: "generated-dinner-12345678",
  title: "Generated Dinner",
  description: "A generated recipe from the confirmed household foods.",
  servings: 2,
  totalMinutes: 25,
  mealTypes: ["dinner"],
  cuisines: [],
  dietaryTags: [],
  ingredients: [
    { id: "rice-1", foodConceptId: "rice", name: "rice", amount: 1, unit: "cup", display: "1 cup rice", required: true, acceptedForms: ["dried"] },
    { id: "water-2", foodConceptId: "water", name: "water", amount: 2, unit: "cup", display: "2 cups water", required: true, acceptedForms: ["unspecified"] },
  ],
  steps: ["Combine the rice and water in a pot.", "Cook the rice and water until tender."],
  rights: { owner: "Household", author: "AI-assisted household recipe", reviewer: null, reviewedAt: null, status: "draft" },
};

function request(body: Record<string, unknown> = {
  prompt: "unmatched dinner",
  generationRequestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
}) {
  return new Request("https://foodtopia.example/api/v1/recipe-suggestions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("recipe suggestion AI fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.demoMode = false;
    mocks.resolveConfig.mockResolvedValue({
      provider: "openai",
      apiKey: "private",
      visionModelId: "vision",
      recipeModelId: "recipe-model",
    });
    mocks.parseIntent.mockResolvedValue(parsedIntent);
    mocks.explain.mockResolvedValue(new Map());
    mocks.generate.mockResolvedValue({});
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true });
    mocks.listRecipes.mockResolvedValue([]);
    mocks.inventory.mockResolvedValue({ lots: [] });
    mocks.preferences.mockResolvedValue({ staples: ["water"], dietaryTags: [], excludedConceptIds: [] });
    mocks.preflightProposal.mockResolvedValue({ kind: "none" });
    mocks.purgeProposals.mockResolvedValue({ expiredCount: 0 });
    mocks.createProposal.mockResolvedValue({
      id: "12345678-1234-4234-8234-123456789abc",
      status: "proposed",
      recipe,
      provider: "openai",
      model: "recipe-model",
      createdAt: "2026-08-26T00:00:00.000Z",
      version: 0,
    });
  });

  it("generates and persists exactly one proposal only after zero deterministic results", async () => {
    mocks.suggestRecipes.mockReturnValue([]);
    const service = await import("@/server/services/generated-recipes");
    const materialize = vi.spyOn(service, "validateAndMaterializeGeneratedRecipe").mockReturnValue({ recipe, contentHash: "a".repeat(64) });
    vi.spyOn(service, "buildRecipeGenerationContext").mockReturnValue({
      intent: { ...parsedIntent, query: "" }, foods: [], staples: [{ foodConceptId: "water", name: "water" }], dietaryTags: [], excludedConceptIds: [],
    });
    const { POST } = await import("./route");
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.createProposal).toHaveBeenCalledWith(
      { kind: "admin" },
      expect.objectContaining({
        householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
        userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
        idempotencyKey: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(
      { kind: "user" }, "recipe_generate", 6, 3600,
    );
    expect(body.proposal.recipe.id).toBe(recipe.id);
    expect(mocks.purgeProposals).toHaveBeenCalledWith({ kind: "admin" });
    materialize.mockRestore();
  });

  it("does not generate when deterministic assessments exist and caps results at 24", async () => {
    const assessment = {
      recipe,
      tier: "ready",
      missingCount: 0,
      unknownQuantityCount: 0,
      substitutionCount: 0,
      usesSoonCount: 0,
      explanation: "Ready.",
      evidence: recipe.ingredients.map((ingredient) => ({ ingredientId: ingredient.id, ingredientName: ingredient.name, status: "assumed_staple", lotIds: [], detail: "Staple.", substitution: null })),
    };
    mocks.suggestRecipes.mockReturnValue(Array.from({ length: 30 }, (_, index) => ({
      ...assessment,
      recipe: { ...recipe, id: `generated-${index.toString().padStart(8, "0")}-1234-4234-8234-123456789abc`, slug: `recipe-${index}` },
    })));
    const { POST } = await import("./route");
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessments).toHaveLength(24);
    expect(body.proposal).toBeNull();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.enforceRateLimit).not.toHaveBeenCalledWith(
      expect.anything(), "recipe_generate", expect.anything(), expect.anything(),
    );
  });

  it("returns the deterministic empty response when generation fails safely", async () => {
    mocks.suggestRecipes.mockReturnValue([]);
    mocks.generate.mockRejectedValue(new Error("raw provider details"));
    const { POST } = await import("./route");
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessments).toEqual([]);
    expect(body.proposal).toBeNull();
    expect(body.fallbackNotice).toMatch(/could not be prepared safely/i);
    expect(JSON.stringify(body)).not.toContain("raw provider details");
  });

  it("replays a pending idempotent proposal before provider work or generation cost", async () => {
    mocks.suggestRecipes.mockReturnValue([]);
    mocks.preflightProposal.mockResolvedValue({
      kind: "pending",
      proposal: {
        id: "12345678-1234-4234-8234-123456789abc",
        status: "proposed",
        recipe,
        provider: "openai",
        model: "recipe-model",
        createdAt: "2026-08-26T00:00:00.000Z",
        version: 0,
      },
    });
    const { POST } = await import("./route");
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.proposal.id).toBe("12345678-1234-4234-8234-123456789abc");
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.enforceRateLimit).not.toHaveBeenCalledWith(
      expect.anything(), "recipe_generate", expect.anything(), expect.anything(),
    );
  });

  it("returns terminal replay state without regenerating", async () => {
    mocks.suggestRecipes.mockReturnValue([]);
    mocks.preflightProposal.mockResolvedValue({ kind: "terminal", status: "denied" });
    const { POST } = await import("./route");
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.proposal).toBeNull();
    expect(body.fallbackNotice).toMatch(/already denied/i);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("rejects reuse of a generation request ID for different structured inputs", async () => {
    mocks.suggestRecipes.mockReturnValue([]);
    mocks.preflightProposal.mockRejectedValue(
      Object.assign(new Error("already used for different recipe inputs"), { status: 409 }),
    );
    const { POST } = await import("./route");
    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("replays the same demo fallback request without regenerating", async () => {
    mocks.demoMode = true;
    mocks.suggestRecipes.mockReturnValue([]);
    const demoStore = await import("@/server/demo/store");
    demoStore.resetDemoStateForTests();
    const service = await import("@/server/services/generated-recipes");
    const materialize = vi
      .spyOn(service, "validateAndMaterializeGeneratedRecipe")
      .mockReturnValue({ recipe, contentHash: "a".repeat(64) });
    const { POST } = await import("./route");

    const firstResponse = await POST(request());
    const first = await firstResponse.json();
    const replayResponse = await POST(request());
    const replay = await replayResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    expect(replay.proposal.id).toBe(first.proposal.id);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(replay.fallbackNotice).toMatch(/existing AI draft/i);
    materialize.mockRestore();
  });

  it("serves structured deterministic matches without configured AI", async () => {
    const settings = await import("@/server/services/household-ai-settings");
    mocks.resolveConfig.mockRejectedValue(new settings.AiConfigurationError("missing"));
    mocks.suggestRecipes.mockReturnValue([
      {
        recipe,
        tier: "ready",
        missingCount: 0,
        unknownQuantityCount: 0,
        substitutionCount: 0,
        usesSoonCount: 0,
        explanation: "Ready.",
        evidence: recipe.ingredients.map((ingredient) => ({
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          status: "assumed_staple",
          lotIds: [],
          detail: "Staple.",
          substitution: null,
        })),
      },
    ]);
    const { POST } = await import("./route");
    const response = await POST(request({ intent: { mealTypes: ["dinner"] } }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessments).toHaveLength(1);
    expect(body.proposal).toBeNull();
  });

  it("returns a bounded structured no-result notice when AI is unconfigured", async () => {
    const settings = await import("@/server/services/household-ai-settings");
    mocks.resolveConfig.mockRejectedValue(new settings.AiConfigurationError("missing"));
    mocks.suggestRecipes.mockReturnValue([]);
    const { POST } = await import("./route");
    const response = await POST(request({ intent: { mealTypes: ["dinner"] } }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessments).toEqual([]);
    expect(body.fallbackNotice).toMatch(/configure a household AI provider/i);
  });
});
