import { z } from "zod";

export const householdRoleSchema = z.enum(["owner", "member"]);
export const quantityStatusSchema = z.enum(["unknown", "estimated", "known"]);
export const foodLocationSchema = z.enum([
  "unknown",
  "pantry",
  "fridge",
  "freezer",
  "other",
]);
export const foodFormSchema = z.enum([
  "unspecified",
  "fresh",
  "frozen",
  "canned",
  "dried",
  "cooked",
  "opened",
]);
export const dateLabelTypeSchema = z.enum([
  "best_before",
  "sell_by",
  "use_by",
  "unknown",
]);
export const inventoryLotStatusSchema = z.enum([
  "active",
  "consumed",
  "discarded",
]);
export const analysisStatusSchema = z.enum([
  "created",
  "uploaded",
  "queued",
  "processing",
  "needs_review",
  "applied",
  "failed",
  "cancelled",
  "expired",
]);

export type HouseholdRole = z.infer<typeof householdRoleSchema>;
export type QuantityStatus = z.infer<typeof quantityStatusSchema>;
export type FoodLocation = z.infer<typeof foodLocationSchema>;
export type FoodForm = z.infer<typeof foodFormSchema>;
export type DateLabelType = z.infer<typeof dateLabelTypeSchema>;
export type InventoryLotStatus = z.infer<typeof inventoryLotStatusSchema>;
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

const checkQuantityState = (
  value: { quantityStatus: QuantityStatus; quantity: number | null },
  context: z.RefinementCtx,
) => {
  if (value.quantityStatus === "unknown" && value.quantity !== null) {
    context.addIssue({
      code: "custom",
      path: ["quantity"],
      message: "Unknown quantity state cannot include a numeric quantity.",
    });
  }
  if (value.quantityStatus !== "unknown" && value.quantity === null) {
    context.addIssue({
      code: "custom",
      path: ["quantity"],
      message: "Estimated and known quantity states require a quantity.",
    });
  }
};

export const inventoryLotBaseSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  foodConceptId: z.string().min(1).nullable(),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80).default("Other"),
  quantityStatus: quantityStatusSchema,
  quantity: z.number().positive().nullable(),
  unit: z.string().trim().max(24).nullable(),
  form: foodFormSchema,
  location: foodLocationSchema,
  dateLabelType: dateLabelTypeSchema.nullable(),
  dateLabel: z.iso.date().nullable(),
  status: inventoryLotStatusSchema,
  version: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const inventoryLotSchema = inventoryLotBaseSchema.superRefine(
  checkQuantityState,
);

export type InventoryLot = z.infer<typeof inventoryLotSchema>;

export const analysisCandidateBaseSchema = z.object({
  id: z.uuid(),
  analysisId: z.uuid(),
  rawLabel: z.string().trim().min(1).max(160),
  suggestedConceptId: z.string().min(1).nullable(),
  suggestedName: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  quantityStatus: quantityStatusSchema,
  quantity: z.number().positive().nullable(),
  unit: z.string().trim().max(24).nullable(),
  form: foodFormSchema,
  location: foodLocationSchema,
  imageIndexes: z.array(z.number().int().min(0).max(2)).min(1),
  uncertaintyReason: z.string().trim().max(240).nullable(),
  accepted: z.boolean(),
});

export const analysisCandidateSchema = analysisCandidateBaseSchema.superRefine(
  checkQuantityState,
);

export type AnalysisCandidate = z.infer<typeof analysisCandidateSchema>;

export const analysisSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  status: analysisStatusSchema,
  candidates: z.array(analysisCandidateSchema),
  errorCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Analysis = z.infer<typeof analysisSchema>;

export const inventoryCommandSchema = z.discriminatedUnion("type", [
  z.object({
    commandId: z.uuid(),
    type: z.literal("add"),
    expectedVersion: z.null(),
    payload: inventoryLotBaseSchema
      .omit({
        version: true,
        createdAt: true,
        updatedAt: true,
      })
      .superRefine(checkQuantityState),
  }),
  z.object({
    commandId: z.uuid(),
    type: z.literal("adjust"),
    expectedVersion: z.number().int().nonnegative(),
    payload: z.object({
      lotId: z.uuid(),
      foodConceptId: z.string().trim().min(1).nullable().optional(),
      name: z.string().trim().min(1).max(120).optional(),
      category: z.string().trim().min(1).max(80).optional(),
      quantityStatus: quantityStatusSchema.optional(),
      quantity: z.number().positive().nullable().optional(),
      unit: z.string().trim().max(24).nullable().optional(),
      form: foodFormSchema.optional(),
      location: foodLocationSchema.optional(),
      dateLabelType: dateLabelTypeSchema.nullable().optional(),
      dateLabel: z.iso.date().nullable().optional(),
    }),
  }),
  z.object({
    commandId: z.uuid(),
    type: z.literal("consume"),
    expectedVersion: z.number().int().nonnegative(),
    payload: z.object({ lotId: z.uuid() }).strict(),
  }),
  z.object({
    commandId: z.uuid(),
    type: z.literal("discard"),
    expectedVersion: z.number().int().nonnegative(),
    payload: z.object({
      lotId: z.uuid(),
    }),
  }),
  z.object({
    commandId: z.uuid(),
    type: z.literal("restore"),
    expectedVersion: z.number().int().nonnegative(),
    payload: z.object({
      lotId: z.uuid(),
    }),
  }),
]);

export type InventoryCommand = z.infer<typeof inventoryCommandSchema>;

export const recipeIngredientSchema = z.object({
  id: z.string().min(1),
  foodConceptId: z.string().min(1),
  name: z.string().min(1),
  amount: z.number().positive().nullable(),
  unit: z.string().nullable(),
  display: z.string().min(1),
  required: z.boolean(),
  acceptedForms: z.array(foodFormSchema),
});

export const recipeSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(360),
  servings: z.number().int().positive(),
  totalMinutes: z.number().int().positive(),
  mealTypes: z.array(z.string().min(1)),
  cuisines: z.array(z.string().min(1)),
  dietaryTags: z.array(z.string().min(1)),
  ingredients: z.array(recipeIngredientSchema).min(2),
  steps: z.array(z.string().min(8)).min(2),
  rights: z.object({
    owner: z.string().min(1),
    author: z.string().min(1),
    reviewer: z.string().nullable(),
    reviewedAt: z.iso.date().nullable(),
    status: z.enum(["draft", "seeded", "reviewed"]),
  }),
});

export type Recipe = z.infer<typeof recipeSchema>;
export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;

export const recipeIntentSchema = z.object({
  query: z.string().trim().max(500).default(""),
  maxMinutes: z.number().int().positive().max(480).nullable(),
  servings: z.number().int().positive().max(24).nullable(),
  mealTypes: z.array(z.string()),
  cuisines: z.array(z.string()),
  dietaryTags: z.array(z.string()),
  includeConceptIds: z.array(z.string()),
  excludeConceptIds: z.array(z.string()),
});

export type RecipeIntent = z.infer<typeof recipeIntentSchema>;

export const ingredientEvidenceStatusSchema = z.enum([
  "present_sufficient",
  "present_quantity_unknown",
  "insufficient",
  "missing",
  "ambiguous",
  "assumed_staple",
]);
export const recipeTierSchema = z.enum([
  "ready",
  "likely_ready",
  "almost_ready",
  "incompatible",
]);

export const ingredientSubstitutionSchema = z
  .object({
    requestedConceptId: z.string().min(1),
    requestedName: z.string().min(1),
    matchedConceptId: z.string().min(1),
    matchedName: z.string().min(1),
    guidance: z.string().min(1).max(280),
  })
  .strict();

export type IngredientSubstitution = z.infer<typeof ingredientSubstitutionSchema>;

export const recipeAssessmentSchema = z.object({
  recipe: recipeSchema,
  tier: recipeTierSchema,
  missingCount: z.number().int().nonnegative(),
  unknownQuantityCount: z.number().int().nonnegative(),
  substitutionCount: z.number().int().nonnegative(),
  usesSoonCount: z.number().int().nonnegative(),
  explanation: z.string().nullable(),
  evidence: z.array(
    z.object({
      ingredientId: z.string(),
      ingredientName: z.string(),
      status: ingredientEvidenceStatusSchema,
      lotIds: z.array(z.uuid()),
      detail: z.string(),
      substitution: ingredientSubstitutionSchema.nullable(),
    }),
  ),
});

export type IngredientEvidenceStatus = z.infer<
  typeof ingredientEvidenceStatusSchema
>;
export type RecipeTier = z.infer<typeof recipeTierSchema>;
export type RecipeAssessment = z.infer<typeof recipeAssessmentSchema>;

export const householdPreferencesSchema = z.object({
  staples: z.array(z.string()),
  dietaryTags: z.array(z.string()),
  excludedConceptIds: z.array(z.string()),
});

export type HouseholdPreferences = z.infer<typeof householdPreferencesSchema>;

export type ApiError = {
  code: string;
  message: string;
  retryable: boolean;
  correlationId: string;
};
