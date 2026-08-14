import { z } from "zod";

import {
  foodFormSchema,
  foodLocationSchema,
  quantityStatusSchema,
  recipeAssessmentSchema,
  recipeIntentSchema,
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

export { explanationsSchema, recipeAssessmentSchema };

export interface RecipeAssistant {
  parseIntent(prompt: string): Promise<RecipeIntent>;
  explain(
    intent: RecipeIntent,
    assessments: RecipeAssessment[],
  ): Promise<Map<string, string>>;
}

export class ModelRefusalError extends Error {
  readonly retryable = false;

  constructor(message = "The model could not analyze this request.") {
    super(message);
    this.name = "ModelRefusalError";
  }
}
