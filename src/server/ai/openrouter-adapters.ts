import "server-only";

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";

import type { RecipeAssessment, RecipeIntent } from "@/contracts/domain";
import {
  explanationsSchema,
  ModelRefusalError,
  parsedRecipeIntentSchema,
  visionBatchResultSchema,
  type RecipeAssistant,
  type VisionAnalyzer,
  type VisionBatchResult,
} from "@/server/ai/contracts";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const visionInstructions = `You propose visible food items for a human review screen.
Inspect all images as one batch. Merge the same physical item across duplicate views.
Prefer precision over recall: omit uncertain non-food objects. Never infer hidden food.
Use ordinary US-English names and conservative quantities. Mark quantity unknown when it
cannot be credibly counted or read. Do not infer freshness, safety, expiration, brand,
nutrition, allergens, or edibility. Return only the requested structured data.`;

export type OpenRouterAdapterConfig = {
  apiKey: string;
  model: string;
  appUrl?: string | null;
  appTitle?: string | null;
};

type OpenRouterProviderRouting = {
  require_parameters: true;
  data_collection: "deny";
  zdr: true;
};

const openRouterProviderRouting: OpenRouterProviderRouting = {
  require_parameters: true,
  data_collection: "deny",
  zdr: true,
};

const requireConfigValue = (value: string, name: string) => {
  if (!value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const optionalHeader = (value: string | null | undefined) =>
  value?.trim() || undefined;

const createClient = (config: OpenRouterAdapterConfig) => {
  const defaultHeaders: Record<string, string> = {};
  const appUrl = optionalHeader(config.appUrl);
  const appTitle = optionalHeader(config.appTitle);
  if (appUrl) defaultHeaders["HTTP-Referer"] = appUrl;
  if (appTitle) defaultHeaders["X-OpenRouter-Title"] = appTitle;

  return new OpenAI({
    apiKey: requireConfigValue(config.apiKey, "OpenRouter API key"),
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders,
  });
};

const withOpenRouterRouting = <T extends object>(request: T) => ({
  ...request,
  provider: openRouterProviderRouting,
});

const emptyIntent = (query: string): RecipeIntent => ({
  query,
  maxMinutes: null,
  servings: null,
  mealTypes: [],
  cuisines: [],
  dietaryTags: [],
  includeConceptIds: [],
  excludeConceptIds: [],
});

export class OpenRouterVisionAnalyzer implements VisionAnalyzer {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: OpenRouterAdapterConfig) {
    this.client = createClient(config);
    this.model = requireConfigValue(config.model, "OpenRouter vision model");
  }

  async analyze(input: {
    analysisId: string;
    images: { index: number; mimeType: "image/jpeg"; bytes: Uint8Array }[];
  }): Promise<VisionBatchResult> {
    const response = await this.client.chat.completions.parse(
      withOpenRouterRouting({
        model: this.model,
        messages: [
          {
            role: "system" as const,
            content: `${visionInstructions}\nImage indexes in this batch: ${input.images
              .map((image) => image.index)
              .join(", ")}.`,
          },
          {
            role: "user" as const,
            content: input.images.map((image) => ({
              type: "image_url" as const,
              image_url: {
                url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`,
                detail: "high" as const,
              },
            })),
          },
        ],
        response_format: zodResponseFormat(
          visionBatchResultSchema,
          "food_batch_analysis",
        ),
      }),
      { headers: { "Idempotency-Key": input.analysisId } },
    );

    const message = response.choices[0]?.message;
    if (message?.refusal || !message?.parsed) {
      throw new ModelRefusalError();
    }
    return visionBatchResultSchema.parse(message.parsed);
  }
}

export class OpenRouterRecipeAssistant implements RecipeAssistant {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: OpenRouterAdapterConfig) {
    this.client = createClient(config);
    this.model = requireConfigValue(config.model, "OpenRouter recipe model");
  }

  async parseIntent(prompt: string): Promise<RecipeIntent> {
    if (!prompt.trim()) return emptyIntent("");

    const response = await this.client.chat.completions.parse(
      withOpenRouterRouting({
        model: this.model,
        messages: [
          {
            role: "system" as const,
            content:
              "Extract meal-search intent only. Do not propose recipes, substitutions, ingredients, or instructions. Keep concept IDs empty unless explicitly supplied as IDs.",
          },
          { role: "user" as const, content: prompt },
        ],
        response_format: zodResponseFormat(
          parsedRecipeIntentSchema,
          "recipe_search_intent",
        ),
      }),
    );

    const message = response.choices[0]?.message;
    if (message?.refusal) throw new ModelRefusalError();
    if (!message?.parsed) return emptyIntent(prompt);
    return parsedRecipeIntentSchema.parse({
      ...message.parsed,
      query: prompt,
    });
  }

  async explain(
    intent: RecipeIntent,
    assessments: RecipeAssessment[],
  ): Promise<Map<string, string>> {
    if (assessments.length === 0) return new Map();

    const evidenceOnly = assessments.slice(0, 10).map((assessment) => ({
      recipeId: assessment.recipe.id,
      title: assessment.recipe.title,
      tier: assessment.tier,
      totalMinutes: assessment.recipe.totalMinutes,
      evidence: assessment.evidence.map((item) => ({
        ingredient: item.ingredientName,
        status: item.status,
      })),
    }));

    const response = await this.client.chat.completions.parse(
      withOpenRouterRouting({
        model: this.model,
        messages: [
          {
            role: "system" as const,
            content:
              "Explain deterministic recipe matches in one short factual sentence each. You may not change ranking, eligibility, ingredients, quantities, substitutions, or instructions. Do not make allergy or food-safety claims.",
          },
          {
            role: "user" as const,
            content: JSON.stringify({ intent, assessments: evidenceOnly }),
          },
        ],
        response_format: zodResponseFormat(
          explanationsSchema,
          "recipe_explanations",
        ),
      }),
    );

    const message = response.choices[0]?.message;
    if (message?.refusal) throw new ModelRefusalError();
    const parsed = message?.parsed
      ? explanationsSchema.parse(message.parsed)
      : { explanations: [] };
    const allowed = new Set(assessments.map((item) => item.recipe.id));
    return new Map(
      parsed.explanations
        .filter((item) => allowed.has(item.recipeId))
        .map((item) => [item.recipeId, item.explanation]),
    );
  }
}
