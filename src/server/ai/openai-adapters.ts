import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import type { RecipeAssessment, RecipeIntent } from "@/contracts/domain";
import {
  explanationsSchema,
  generatedRecipeDraftSchema,
  ModelRefusalError,
  parsedRecipeIntentSchema,
  visionBatchResultSchema,
  type GeneratedRecipeDraft,
  type RecipeAssistant,
  type RecipeGenerationContext,
  type VisionAnalyzer,
  type VisionBatchResult,
} from "@/server/ai/contracts";

export type OpenAIAdapterConfig = {
  apiKey: string;
  model: string;
};

const requireConfigValue = (value: string, name: string) => {
  if (!value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const visionInstructions = `You propose visible food items for a human review screen.
Inspect all images as one batch. Merge the same physical item across duplicate views.
Prefer precision over recall: omit uncertain non-food objects. Never infer hidden food.
Use ordinary US-English names and conservative quantities. Mark quantity unknown when it
cannot be credibly counted or read. Do not infer freshness, safety, expiration, brand,
nutrition, allergens, or edibility. Return only the requested structured data.`;

export class OpenAIVisionAnalyzer implements VisionAnalyzer {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: OpenAIAdapterConfig) {
    this.client = new OpenAI({
      apiKey: requireConfigValue(config.apiKey, "OpenAI API key"),
    });
    this.model = requireConfigValue(config.model, "OpenAI vision model");
  }

  async analyze(input: {
    analysisId: string;
    images: { index: number; mimeType: "image/jpeg"; bytes: Uint8Array }[];
  }): Promise<VisionBatchResult> {
    const content: OpenAI.Responses.ResponseInputContent[] = [
      {
        type: "input_text",
        text: `${visionInstructions}\nImage indexes in this batch: ${input.images
          .map((image) => image.index)
          .join(", ")}.`,
      },
      ...input.images.map((image) => ({
        type: "input_image" as const,
        detail: "high" as const,
        image_url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`,
      })),
    ];

    const response = await this.client.responses.parse(
      {
        model: this.model,
        store: false,
        input: [{ role: "user", content }],
        text: {
          format: zodTextFormat(visionBatchResultSchema, "food_batch_analysis"),
        },
      },
      { idempotencyKey: input.analysisId },
    );

    if (!response.output_parsed) {
      throw new ModelRefusalError();
    }
    return visionBatchResultSchema.parse(response.output_parsed);
  }
}

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

const generationInstructions = `Create exactly one practical recipe from the supplied structured kitchen context.
Use only supplied foodConceptId/name pairs and only listed forms. Staples are available without verified quantities.
Do not invent substitutions, foods, IDs, metadata, provenance, rights, safety claims, preservation, fermentation, or canning.
Every step must list the exact foodConceptIds it uses. Every required ingredient must be referenced by at least one step. Do not add display text; the server derives it from amount, unit, and canonical name. For each raw animal protein, one positive cooking clause must repeat its exact canonical name after a cooking verb and before an explicit doneness endpoint such as fully cooked or a safe internal temperature. Keep quantities conservative when availability is uncertain; staples without verified quantities must use null amount and unit. Obey all supplied structured intent limits. Return only the strict recipe draft.`;

export class OpenAIRecipeAssistant implements RecipeAssistant {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: OpenAIAdapterConfig) {
    this.client = new OpenAI({
      apiKey: requireConfigValue(config.apiKey, "OpenAI API key"),
    });
    this.model = requireConfigValue(config.model, "OpenAI recipe model");
  }

  async parseIntent(prompt: string): Promise<RecipeIntent> {
    if (!prompt.trim()) return emptyIntent("");

    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      input: [
        {
          role: "system",
          content:
            "Extract meal-search intent only. Do not propose recipes, substitutions, ingredients, or instructions. Keep concept IDs empty unless explicitly supplied as IDs.",
        },
        { role: "user", content: prompt },
      ],
      text: {
        format: zodTextFormat(parsedRecipeIntentSchema, "recipe_search_intent"),
      },
    });

    if (!response.output_parsed) return emptyIntent(prompt);
    return parsedRecipeIntentSchema.parse({
      ...response.output_parsed,
      query: prompt,
    });
  }

  async generate(context: RecipeGenerationContext): Promise<GeneratedRecipeDraft> {
    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      input: [
        { role: "system", content: generationInstructions },
        { role: "user", content: JSON.stringify(context) },
      ],
      text: {
        format: zodTextFormat(generatedRecipeDraftSchema, "generated_recipe_draft"),
      },
    });
    if (!response.output_parsed) throw new ModelRefusalError("The model did not return a recipe draft.");
    return generatedRecipeDraftSchema.parse(response.output_parsed);
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

    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      input: [
        {
          role: "system",
          content:
            "Explain deterministic recipe matches in one short factual sentence each. You may not change ranking, eligibility, ingredients, quantities, substitutions, or instructions. Do not make allergy or food-safety claims.",
        },
        {
          role: "user",
          content: JSON.stringify({ intent, assessments: evidenceOnly }),
        },
      ],
      text: {
        format: zodTextFormat(explanationsSchema, "recipe_explanations"),
      },
    });

    const parsed = response.output_parsed
      ? explanationsSchema.parse(response.output_parsed)
      : { explanations: [] };
    const allowed = new Set(assessments.map((item) => item.recipe.id));
    return new Map(
      parsed.explanations
        .filter((item) => allowed.has(item.recipeId))
        .map((item) => [item.recipeId, item.explanation]),
    );
  }
}
