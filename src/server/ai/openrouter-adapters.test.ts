import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  clients: [] as Array<Record<string, unknown>>,
  chatResponse: { choices: [{ message: { parsed: null, refusal: null } }] } as Record<
    string,
    unknown
  >,
  chatCalls: [] as Array<{ body: Record<string, unknown>; options?: unknown }>,
  responsesResponse: { output_parsed: null } as Record<string, unknown>,
  responsesCalls: [] as Array<{ body: Record<string, unknown>; options?: unknown }>,
}));

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    responses = {
      parse: (body: Record<string, unknown>, options?: unknown) => {
        state.responsesCalls.push({ body, options });
        return Promise.resolve(state.responsesResponse);
      },
    };

    chat = {
      completions: {
        parse: (body: Record<string, unknown>, options?: unknown) => {
          state.chatCalls.push({ body, options });
          return Promise.resolve(state.chatResponse);
        },
      },
    };

    constructor(config: Record<string, unknown>) {
      state.clients.push(config);
    }
  },
}));

import { ModelRefusalError, type RecipeGenerationContext } from "./contracts";
import { OpenAIRecipeAssistant, OpenAIVisionAnalyzer } from "./openai-adapters";
import {
  OpenRouterRecipeAssistant,
  OpenRouterVisionAnalyzer,
} from "./openrouter-adapters";

const generatedDraft = {
  title: "Rice and Tomato Skillet",
  description: "A simple generated dinner using confirmed foods only.",
  servings: 2,
  totalMinutes: 25,
  mealTypes: ["dinner"],
  cuisines: [],
  dietaryTags: [],
  ingredients: [
    { foodConceptId: "rice", name: "rice", amount: 1, unit: "cup", required: true, acceptedForms: ["dried"] },
    { foodConceptId: "tomato", name: "tomato", amount: 2, unit: "count", required: true, acceptedForms: ["fresh"] },
  ],
  steps: [
    { instruction: "Cook the rice until tender.", foodConceptIds: ["rice"] },
    { instruction: "Add the tomato and cook until hot.", foodConceptIds: ["tomato"] },
  ],
};
const generationContext: RecipeGenerationContext = {
  intent: { query: "dinner", maxMinutes: null, servings: null, mealTypes: ["dinner"], cuisines: [], dietaryTags: [], includeConceptIds: [], excludeConceptIds: [] },
  foods: [
    { foodConceptId: "rice", name: "rice", forms: ["dried"], quantities: [], unknownQuantityForms: ["dried"] },
    { foodConceptId: "tomato", name: "tomato", forms: ["fresh"], quantities: [], unknownQuantityForms: ["fresh"] },
  ],
  staples: [],
  dietaryTags: [],
  excludedConceptIds: [],
};

const proposal = {
  rawLabel: "tomato",
  suggestedName: "Tomato",
  category: "Produce",
  quantityStatus: "unknown",
  quantity: null,
  unit: null,
  form: "fresh",
  location: "fridge",
  imageIndexes: [0],
  uncertaintyReason: null,
};

describe("OpenRouter adapters", () => {
  it("keeps OpenAI Responses configuration instance-scoped", async () => {
    state.clients.length = 0;
    state.responsesCalls.length = 0;
    state.responsesResponse = {
      output_parsed: { proposals: [proposal], batchNotes: null },
    };
    const analyzer = new OpenAIVisionAnalyzer({
      apiKey: "sk-openai-private-key",
      model: "gpt-vision-private",
    });

    await analyzer.analyze({ analysisId: "analysis-1", images: [] });

    expect(state.clients[0]).toMatchObject({ apiKey: "sk-openai-private-key" });
    expect(state.responsesCalls[0]).toMatchObject({
      body: { model: "gpt-vision-private", store: false },
      options: { idempotencyKey: "analysis-1" },
    });
    expect(JSON.stringify(state.responsesCalls[0]?.body)).toContain(
      "Prefer pantry, fridge, or freezer over unknown",
    );
  });

  it("uses chat structured output, private routing, and inline high-detail images", async () => {
    state.clients.length = 0;
    state.chatCalls.length = 0;
    state.chatResponse = {
      choices: [{ message: { parsed: { proposals: [proposal], batchNotes: null } } }],
    };
    const analyzer = new OpenRouterVisionAnalyzer({
      apiKey: "or-private-key",
      model: "vendor/vision-model",
      appUrl: "https://foodtopia.example",
      appTitle: "Foodtopia",
    });

    await expect(
      analyzer.analyze({
        analysisId: "analysis-1",
        images: [{ index: 0, mimeType: "image/jpeg", bytes: new Uint8Array([1, 2]) }],
      }),
    ).resolves.toMatchObject({ proposals: [proposal] });

    expect(state.clients[0]).toMatchObject({
      apiKey: "or-private-key",
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://foodtopia.example",
        "X-OpenRouter-Title": "Foodtopia",
      },
    });
    const call = state.chatCalls[0];
    expect(call?.body).toMatchObject({
      model: "vendor/vision-model",
      provider: {
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      },
    });
    expect(call?.body).not.toHaveProperty("store");
    expect(JSON.stringify(call?.body)).toContain("data:image/jpeg;base64,AQI=");
    expect(JSON.stringify(call?.body)).toContain('"detail":"high"');
    expect(JSON.stringify(call?.body)).toContain(
      "Prefer pantry, fridge, or freezer over unknown",
    );
    expect(call?.options).toEqual({ headers: { "Idempotency-Key": "analysis-1" } });
  });

  it("uses strict private structured calls for OpenAI and OpenRouter recipe generation", async () => {
    state.responsesCalls.length = 0;
    state.responsesResponse = { output_parsed: generatedDraft };
    const openai = new OpenAIRecipeAssistant({ apiKey: "sk-private", model: "gpt-recipe" });
    await expect(openai.generate(generationContext)).resolves.toEqual(generatedDraft);
    expect(state.responsesCalls[0]?.body).toMatchObject({ model: "gpt-recipe", store: false });
    expect(JSON.stringify(state.responsesCalls[0]?.body)).toContain("generated_recipe_draft");

    state.chatCalls.length = 0;
    state.chatResponse = { choices: [{ message: { parsed: generatedDraft, refusal: null } }] };
    const openrouter = new OpenRouterRecipeAssistant({ apiKey: "or-private", model: "vendor/recipe" });
    await expect(openrouter.generate(generationContext)).resolves.toEqual(generatedDraft);
    expect(state.chatCalls[0]?.body).toMatchObject({
      model: "vendor/recipe",
      provider: { require_parameters: true, data_collection: "deny", zdr: true },
    });
  });

  it("raises a refusal for vision and preserves empty-result recipe fallbacks", async () => {
    state.chatCalls.length = 0;
    state.chatResponse = { choices: [{ message: { parsed: null, refusal: "no" } }] };
    const analyzer = new OpenRouterVisionAnalyzer({
      apiKey: "or-private-key",
      model: "vendor/vision-model",
    });
    await expect(
      analyzer.analyze({ analysisId: "analysis-1", images: [] }),
    ).rejects.toBeInstanceOf(ModelRefusalError);

    state.chatResponse = { choices: [{ message: { parsed: null, refusal: null } }] };
    const assistant = new OpenRouterRecipeAssistant({
      apiKey: "or-private-key",
      model: "vendor/text-model",
    });
    await expect(assistant.parseIntent("quick dinner")).resolves.toMatchObject({
      query: "quick dinner",
      maxMinutes: null,
    });
  });
});
