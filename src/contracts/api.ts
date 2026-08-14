import { z } from "zod";

import {
  analysisCandidateBaseSchema,
  analysisSchema,
  inventoryCommandSchema,
  inventoryLotSchema,
  recipeAssessmentSchema,
  recipeIntentSchema,
} from "./domain";

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  correlationId: z.string(),
});

export const inventorySyncResponseSchema = z.object({
  householdId: z.uuid(),
  lots: z.array(inventoryLotSchema),
  cursor: z.string(),
  events: z.array(
    z.object({
      id: z.uuid(),
      lotId: z.uuid(),
      type: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export const inventoryCommandRequestSchema = z.object({
  command: inventoryCommandSchema,
});

export const inventoryCommandResponseSchema = z.object({
  lot: inventoryLotSchema,
  replayed: z.boolean(),
});

export const inviteCreateRequestSchema = z.object({
  email: z.email(),
});

export const inviteCreateResponseSchema = z.object({
  inviteId: z.uuid(),
  email: z.email(),
  expiresAt: z.iso.datetime(),
  delivery: z.enum(["queued", "demo"]),
});

export const householdInviteAcceptRequestSchema = z.object({
  token: z.string().min(20).max(512),
});

export const householdInviteAcceptResponseSchema = z.object({
  householdId: z.uuid(),
});

export const householdBootstrapRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  betaToken: z.string().min(20).max(512),
});

export const householdBootstrapResponseSchema = z.object({
  householdId: z.uuid(),
});

export const householdCurrentResponseSchema = z.object({
  householdId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  role: z.enum(["owner", "member"]),
});

export const visionConsentResponseSchema = z.object({
  version: z.literal("vision-v2"),
  consented: z.boolean(),
  consentedAt: z.iso.datetime().nullable(),
});

export const aiProviderSchema = z.enum(["openai", "openrouter"]);
export const aiCredentialSourceSchema = z.enum(["platform", "household"]);
export const aiModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "Use the provider's model ID without spaces or query parameters.",
  );

export const aiSettingsResponseSchema = z
  .object({
    provider: aiProviderSchema,
    visionModelId: aiModelIdSchema,
    recipeModelId: aiModelIdSchema,
    credentialSource: aiCredentialSourceSchema,
    credentialConfigured: z.boolean(),
    platformCredentials: z.object({
      openai: z.boolean(),
      openrouter: z.boolean(),
    }),
    modelDefaults: z.object({
      openai: z.object({
        visionModelId: aiModelIdSchema,
        recipeModelId: aiModelIdSchema,
      }),
      openrouter: z.object({
        visionModelId: aiModelIdSchema.nullable(),
        recipeModelId: aiModelIdSchema.nullable(),
      }),
    }),
    householdCredentialsAvailable: z.boolean(),
    canEdit: z.boolean(),
    updatedAt: z.iso.datetime(),
    version: z.number().int().positive(),
  })
  .strict();

export const aiSettingsUpdateRequestSchema = z
  .object({
    provider: aiProviderSchema,
    visionModelId: aiModelIdSchema,
    recipeModelId: aiModelIdSchema,
    credentialSource: aiCredentialSourceSchema,
    credentialAction: z.enum(["retain", "replace", "clear"]),
    apiKey: z.string().trim().min(8).max(1024).optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.credentialAction === "replace" && !value.apiKey) {
      context.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "Enter a provider API key to replace the household credential.",
      });
    }
    if (value.credentialAction !== "replace" && value.apiKey !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "An API key is accepted only when replacing the credential.",
      });
    }
    if (
      value.credentialSource === "platform" &&
      value.credentialAction === "replace"
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentialAction"],
        message: "Platform credentials cannot be replaced from the household UI.",
      });
    }
    if (
      value.credentialSource === "household" &&
      value.credentialAction === "clear"
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentialAction"],
        message: "Switch to platform credentials before clearing the household key.",
      });
    }
  });

export const householdMemberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  email: z.email().nullable(),
  role: z.enum(["owner", "member"]),
  joinedAt: z.iso.datetime(),
});

export const householdMembersResponseSchema = z.object({
  members: z.array(householdMemberSchema),
});

export const householdMemberRemoveResponseSchema = z.object({
  removedUserId: z.uuid(),
});

export const householdDeleteResponseSchema = z.union([
  z.object({
    householdId: z.uuid(),
    status: z.literal("deletion_pending"),
    finalizeAfter: z.iso.datetime(),
  }),
  z.object({
    householdId: z.uuid(),
    deleted: z.literal(true),
  }),
]);

export const recipeSuggestionRequestSchema = z
  .object({
    prompt: z.string().trim().max(500).optional(),
    intent: recipeIntentSchema.partial().optional(),
  })
  .refine((value) => value.prompt !== undefined || value.intent !== undefined, {
    message: "Provide a prompt or structured intent.",
  });

export const recipeSuggestionResponseSchema = z.object({
  parsedIntent: recipeIntentSchema,
  assessments: z.array(recipeAssessmentSchema),
  generatedAt: z.iso.datetime(),
  allergyNotice: z.string(),
});

export const analysisCreateRequestSchema = z.object({
  imageCount: z.number().int().min(1).max(3),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(180),
        contentType: z.literal("image/jpeg"),
        size: z.number().int().positive().max(5_000_000),
      }),
    )
    .min(1)
    .max(3),
});

export const analysisUploadDescriptorSchema = z.object({
  assetId: z.uuid(),
  objectPath: z.string(),
  token: z.string().nullable(),
  signedUrl: z.url().nullable(),
});

export const analysisCreateResponseSchema = z.object({
  analysisId: z.uuid(),
  uploadMode: z.enum(["signed", "demo"]),
  uploads: z.array(analysisUploadDescriptorSchema).min(1).max(3),
});

export const analysisCompleteRequestSchema = z.object({
  assetIds: z.array(z.uuid()).min(1).max(3),
});

export const analysisApplyCandidateSchema = analysisCandidateBaseSchema
  .omit({ analysisId: true })
  .extend({ analysisId: z.uuid().optional() })
  .superRefine((value, context) => {
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
  });

export const analysisApplyRequestSchema = z.object({
  candidates: z.array(analysisApplyCandidateSchema).min(1),
});

export const analysisResponseSchema = analysisSchema;

export const unfinishedAnalysesResponseSchema = z.object({
  analyses: z.array(
    z.object({
      id: z.uuid(),
      status: analysisSchema.shape.status,
      candidateCount: z.number().int().nonnegative(),
      updatedAt: z.iso.datetime(),
    }),
  ),
});

export const cookReconciliationRequestSchema = z.object({
  changes: z.array(
    z.object({
      ingredientId: z.string(),
      lotId: z.uuid(),
      action: z.enum(["no_change", "used_some", "used_up"]),
      quantity: z.number().positive().nullable(),
      unit: z.string().max(24).nullable(),
      expectedVersion: z.number().int().nonnegative(),
    }),
  ),
});

export const cookSessionCreateRequestSchema = z.object({
  recipeId: z.string().min(1),
  assessment: recipeAssessmentSchema,
});

export const cookSessionCreateResponseSchema = z.object({
  cookSessionId: z.uuid(),
  recipeId: z.string(),
  createdAt: z.iso.datetime(),
});

export type InventorySyncResponse = z.infer<
  typeof inventorySyncResponseSchema
>;
export type RecipeSuggestionResponse = z.infer<
  typeof recipeSuggestionResponseSchema
>;
export type AnalysisCreateResponse = z.infer<
  typeof analysisCreateResponseSchema
>;
export type AiProvider = z.infer<typeof aiProviderSchema>;
export type AiCredentialSource = z.infer<typeof aiCredentialSourceSchema>;
export type AiSettingsResponse = z.infer<typeof aiSettingsResponseSchema>;
export type AiSettingsUpdateRequest = z.infer<
  typeof aiSettingsUpdateRequestSchema
>;
