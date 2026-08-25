import { z } from "zod";

import {
  foodFormSchema,
  foodLocationSchema,
  quantityStatusSchema,
  recipeAssessmentSchema,
  recipeIntentSchema,
  type FoodForm,
  type RecipeAssessment,
  type RecipeIntent,
} from "@/contracts/domain";

export const visionProposalSchema = z
  .object({
    rawLabel: z.string().trim().min(1).max(160),
    suggestedName: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(80),
    quantityStatus: quantityStatusSchema,
    quantity: z.number().positive().nullable(),
    unit: z.string().trim().max(24).nullable(),
    form: foodFormSchema,
    location: foodLocationSchema,
    imageIndexes: z.array(z.number().int().min(0).max(2)).min(1),
    uncertaintyReason: z.string().trim().max(240).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.quantityStatus === "unknown" && value.quantity !== null) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Unknown quantities must not include a numeric value.",
      });
    }
    if (value.quantityStatus !== "unknown" && value.quantity === null) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Known or estimated quantities require a numeric value.",
      });
    }
  });

export const visionBatchResultSchema = z
  .object({
    proposals: z.array(visionProposalSchema).max(80),
    batchNotes: z.string().trim().max(400).nullable(),
  })
  .strict();

export type VisionProposal = z.infer<typeof visionProposalSchema>;
export type VisionBatchResult = z.infer<typeof visionBatchResultSchema>;

export type VisionImage = {
  index: number;
  mimeType: "image/jpeg";
  bytes: Uint8Array;
};

export interface VisionAnalyzer {
  analyze(input: {
    analysisId: string;
    images: VisionImage[];
    fileNames?: string[];
  }): Promise<VisionBatchResult>;
}

export const parsedRecipeIntentSchema = recipeIntentSchema.strict();

const explanationsSchema = z
  .object({
    explanations: z.array(
      z
        .object({
          recipeId: z.string(),
          explanation: z.string().trim().min(1).max(280),
        })
        .strict(),
    ),
  })
  .strict();

export const generatedRecipeIngredientSchema = z
  .object({
    foodConceptId: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(160),
    amount: z.number().positive().max(100).nullable(),
    unit: z.string().trim().min(1).max(40).nullable(),
    required: z.boolean(),
    acceptedForms: z.array(foodFormSchema).min(1).max(8),
  })
  .strict();

export const generatedRecipeStepSchema = z
  .object({
    instruction: z.string().trim().min(8).max(600),
    foodConceptIds: z.array(z.string().trim().min(1).max(120)).min(1).max(16),
  })
  .strict();

/** Model-controlled recipe content only. Scope, IDs, rights and provenance are server-owned. */
export const generatedRecipeDraftSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(360),
    servings: z.number().int().positive().max(24),
    totalMinutes: z.number().int().positive().max(180),
    mealTypes: z.array(z.string().trim().min(1).max(40)).min(1).max(4),
    cuisines: z.array(z.string().trim().min(1).max(60)).max(4),
    dietaryTags: z.array(z.string().trim().min(1).max(60)).max(8),
    ingredients: z.array(generatedRecipeIngredientSchema).min(2).max(16),
    steps: z.array(generatedRecipeStepSchema).min(2).max(12),
  })
  .strict();

export type GeneratedRecipeDraft = z.infer<typeof generatedRecipeDraftSchema>;

export type RecipeGenerationContext = Readonly<{
  intent: RecipeIntent;
  foods: readonly Readonly<{
    foodConceptId: string;
    name: string;
    forms: readonly FoodForm[];
    quantities: readonly Readonly<{ quantity: number; unit: string; form: FoodForm }>[];
    unknownQuantityForms: readonly FoodForm[];
  }>[];
  staples: readonly Readonly<{ foodConceptId: string; name: string }>[];
  dietaryTags: readonly string[];
  excludedConceptIds: readonly string[];
}>;

export { explanationsSchema, recipeAssessmentSchema };

export interface RecipeAssistant {
  parseIntent(prompt: string): Promise<RecipeIntent>;
  explain(
    intent: RecipeIntent,
    assessments: RecipeAssessment[],
  ): Promise<Map<string, string>>;
  generate(context: RecipeGenerationContext): Promise<GeneratedRecipeDraft>;
}

export class ModelRefusalError extends Error {
  readonly retryable = false;

  constructor(message = "The model could not analyze this request.") {
    super(message);
    this.name = "ModelRefusalError";
  }
}
