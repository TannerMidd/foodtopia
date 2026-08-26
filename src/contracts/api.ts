import { z } from "zod";

import {
  analysisCandidateBaseSchema,
  analysisSchema,
  inventoryCommandSchema,
  inventoryLotSchema,
  recipeAssessmentSchema,
  recipeIntentSchema,
  recipeSchema,
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
  // Legacy personal invitations carry a token; administrator-enabled open-beta
  // accounts create their household without one.
  betaToken: z.string().min(20).max(512).optional(),
});

export const householdBootstrapResponseSchema = z.object({
  householdId: z.uuid(),
});

export const accountStatusSchema = z.enum(["pending", "enabled", "disabled"]);

// Timestamps sourced from Supabase (PostgREST/GoTrue) may carry a "+00:00"
// offset rather than "Z" depending on how a row was written; accept both.
const supabaseDatetime = z.iso.datetime({ offset: true });

export const accountStatusResponseSchema = z.object({
  status: accountStatusSchema,
});

export const betaAccountSchema = z.object({
  userId: z.uuid(),
  email: z.string().min(3).max(320),
  displayName: z.string().nullable(),
  status: accountStatusSchema,
  createdAt: supabaseDatetime,
  emailConfirmedAt: supabaseDatetime.nullable(),
  lastSignInAt: supabaseDatetime.nullable(),
  enabledAt: supabaseDatetime.nullable(),
});

export const betaAccountsResponseSchema = z.object({
  signupsOpen: z.boolean(),
  counts: z.object({
    pending: z.number().int().nonnegative(),
    enabled: z.number().int().nonnegative(),
    disabled: z.number().int().nonnegative(),
  }),
  accounts: z.array(betaAccountSchema),
});

export const betaAccountMutationRequestSchema = z
  .object({
    userIds: z.array(z.uuid()).min(1).max(50),
  })
  .strict();

export const betaAccountMutationResponseSchema = z.object({
  changedCount: z.number().int().nonnegative(),
});

export const signupWindowUpdateRequestSchema = z
  .object({
    open: z.boolean(),
  })
  .strict();

export const signupWindowResponseSchema = z.object({
  signupsOpen: z.boolean(),
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
export const aiModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(
    /^[A-Za-z0-9~][A-Za-z0-9._:/~-]*$/,
    "Use the provider's model ID without spaces or query parameters.",
  );

export const aiSettingsResponseSchema = z
  .object({
    provider: aiProviderSchema,
    visionModelId: aiModelIdSchema,
    recipeModelId: aiModelIdSchema,
    credentialConfigured: z.boolean(),
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
  });

export const openRouterModelDiscoveryRequestSchema = z
  .object({
    apiKey: z
      .string()
      .trim()
      .min(8)
      .max(1024)
      .refine(
        (value) => !/[\u0000-\u001f\u007f]/.test(value),
        "The API key contains unsupported characters.",
      )
      .optional(),
  })
  .strict();

export const openRouterModelChoiceSchema = z
  .object({
    id: aiModelIdSchema,
    name: z.string().trim().min(1).max(240),
    contextLength: z.number().int().positive().nullable(),
    supportsVision: z.boolean(),
  })
  .strict();

export const openRouterModelsResponseSchema = z
  .object({
    models: z.array(openRouterModelChoiceSchema).max(2000),
    fetchedAt: z.iso.datetime(),
  })
  .strict();

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
    generationRequestId: z.uuid().optional(),
  })
  .refine((value) => value.prompt !== undefined || value.intent !== undefined, {
    message: "Provide a prompt or structured intent.",
  });

export const recipeProposalStatusSchema = z.enum(["proposed", "approved", "denied"]);

export const recipeProposalSchema = z
  .object({
    id: z.uuid(),
    status: z.literal("proposed"),
    recipe: recipeSchema,
    provider: z.enum(["openai", "openrouter", "demo"]),
    model: z.string().min(1).max(160).nullable(),
    createdAt: z.iso.datetime(),
    version: z.number().int().nonnegative(),
  })
  .strict();

export const recipeSuggestionResponseSchema = z.object({
  parsedIntent: recipeIntentSchema,
  assessments: z.array(recipeAssessmentSchema).max(24),
  proposal: recipeProposalSchema.nullable(),
  fallbackNotice: z.string().max(280).nullable(),
  generatedAt: z.iso.datetime(),
  allergyNotice: z.string(),
});

export const recipeProposalDecisionRequestSchema = z
  .object({
    decision: z.enum(["approve", "deny"]),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export const recipeProposalDecisionResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      proposalId: z.uuid(),
      status: z.literal("approved"),
      recipeId: z.string().min(1).max(120),
      version: z.number().int().nonnegative(),
      replayed: z.boolean(),
      assessment: recipeAssessmentSchema,
    })
    .strict(),
  z
    .object({
      proposalId: z.uuid(),
      status: z.literal("denied"),
      recipeId: z.null(),
      version: z.number().int().nonnegative(),
      replayed: z.boolean(),
    })
    .strict(),
  z
    .object({
      proposalId: z.uuid(),
      status: z.literal("expired"),
      recipeId: z.null(),
      version: z.number().int().nonnegative(),
      replayed: z.boolean(),
    })
    .strict(),
]);

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
    if (value.quantityStatus !== "unknown" && !value.unit?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["unit"],
        message: "Estimated and known quantity states require a unit.",
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

export const recipeFlagReasonSchema = z.enum([
  "inaccurate",
  "unsafe",
  "poor_instructions",
  "rights_concern",
  "other",
]);

export const recipeFlagRequestSchema = z
  .object({
    recipeId: z.string().min(1).max(120),
    reason: recipeFlagReasonSchema,
  })
  .strict();

export const recipeFlagResponseSchema = z.object({
  flagged: z.literal(true),
  simulated: z.boolean(),
}).strict();

export const confirmedRecipeSubstitutionSchema = z
  .object({
    ingredientId: z.string().min(1).max(120),
    matchedConceptId: z.string().min(1).max(120),
  })
  .strict();

export const cookSessionCreateRequestSchema = z
  .object({
    recipeId: z.string().min(1).max(120),
    servings: z.number().int().positive().max(24),
    confirmedSubstitutions: z.array(confirmedRecipeSubstitutionSchema).max(40),
  })
  .strict();

export const cookSessionCreateResponseSchema = z.object({
  cookSessionId: z.uuid(),
  recipeId: z.string(),
  createdAt: z.iso.datetime(),
  assessment: recipeAssessmentSchema,
});

export const cookSessionSubstitutionConflictSchema = z
  .object({
    code: z.literal("RECIPE_SUBSTITUTIONS_CHANGED"),
    message: z.string(),
    retryable: z.literal(false),
    correlationId: z.string(),
    latestAssessment: recipeAssessmentSchema,
  })
  .strict();

/**
 * Retail product codes as scanners report them: EAN-8, UPC-A/E (8 digits),
 * EAN-13 and ITF-14. UPC-A is commonly reported as a 13-digit EAN-13 with a
 * leading zero; the lookup service normalizes upstream instead of guessing.
 */
export const barcodeLookupRequestSchema = z.object({
  barcode: z
    .string()
    .trim()
    .regex(/^(\d{8}|\d{12}|\d{13}|\d{14})$/, "A retail barcode has 8, 12, 13 or 14 digits."),
});

export const barcodeLookupResponseSchema = z.object({
  barcode: z.string().regex(/^\d{6,18}$/),
  found: z.boolean(),
  name: z.string().trim().min(1).max(160).nullable(),
  brands: z.string().trim().max(160).nullable(),
  quantityLabel: z.string().trim().max(60).nullable(),
  imageUrl: z.url().nullable(),
});

// Browsable recipe catalog: every recipe the household can cook or see, in
// full, so the client can cache them for offline browsing/detail pages and
// compute readiness tiers locally against its inventory snapshot.
export const recipeCatalogResponseSchema = z.object({
  recipes: z.array(recipeSchema),
  syncedAt: z.iso.datetime(),
});

export const recipeDetailResponseSchema = z.object({
  recipe: recipeSchema,
});

// Cook history surfaces completed (reconciled) sessions only; active and
// cancelled sessions never appear as history.
export const cookHistoryEntrySchema = z.object({
  id: z.uuid(),
  recipeId: z.string().nullable(),
  slug: z.string().nullable(),
  title: z.string().min(1),
  servings: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
});

export const cookHistoryResponseSchema = z.object({
  sessions: z.array(cookHistoryEntrySchema).max(50),
});

export const recipeFavoriteItemSchema = z.object({
  recipeId: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(),
  title: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export const recipeFavoritesResponseSchema = z.object({
  favorites: z.array(recipeFavoriteItemSchema).max(200),
});

export const recipeFavoriteMutationRequestSchema = z
  .object({
    recipeId: z.string().min(1).max(120),
  })
  .strict();

export const recipeFavoriteMutationResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("added"),
    favorite: recipeFavoriteItemSchema,
    replayed: z.boolean(),
  }),
  z.object({
    status: z.literal("removed"),
    replayed: z.boolean(),
  }),
]);

// Shared household shopping list. Items are short human labels with an optional
// concept link for consistent category and ingredient identity.
export const shoppingListItemSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  foodConceptId: z.string().trim().min(1).max(120).nullable(),
  quantityText: z.string().trim().min(1).max(40).nullable(),
  done: z.boolean(),
  addedByName: z.string().trim().min(1).max(80),
  createdAt: z.iso.datetime(),
});

export const shoppingListResponseSchema = z.object({
  items: z.array(shoppingListItemSchema).max(100),
});

export const shoppingListAddRequestSchema = z
  .object({
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120),
          category: z.string().trim().min(1).max(80),
          foodConceptId: z.string().trim().min(1).max(120).nullable(),
          quantityText: z.string().trim().min(1).max(40).nullable(),
        }),
      )
      .min(1)
      .max(16),
  })
  .strict();

export const shoppingListAddResponseSchema = z.object({
  items: z.array(shoppingListItemSchema).max(100),
  added: z.number().int().min(0),
  replayedNames: z.array(z.string().trim().min(1).max(120)).max(16),
});

export const shoppingListUpdateRequestSchema = z
  .object({
    done: z.boolean(),
  })
  .strict();

export const shoppingListItemResponseSchema = z.object({
  item: shoppingListItemSchema,
});

export type InventorySyncResponse = z.infer<
  typeof inventorySyncResponseSchema
>;
export type RecipeSuggestionResponse = z.infer<
  typeof recipeSuggestionResponseSchema
>;
export type RecipeProposal = z.infer<typeof recipeProposalSchema>;
export type RecipeProposalDecisionRequest = z.infer<
  typeof recipeProposalDecisionRequestSchema
>;
export type RecipeProposalDecisionResponse = z.infer<
  typeof recipeProposalDecisionResponseSchema
>;
export type AnalysisCreateResponse = z.infer<
  typeof analysisCreateResponseSchema
>;
export type AiProvider = z.infer<typeof aiProviderSchema>;
export type AccountStatus = z.infer<typeof accountStatusSchema>;
export type BetaAccount = z.infer<typeof betaAccountSchema>;
export type BetaAccountsResponse = z.infer<
  typeof betaAccountsResponseSchema
>;
export type AiSettingsResponse = z.infer<typeof aiSettingsResponseSchema>;
export type AiSettingsUpdateRequest = z.infer<
  typeof aiSettingsUpdateRequestSchema
>;
export type OpenRouterModelDiscoveryRequest = z.infer<
  typeof openRouterModelDiscoveryRequestSchema
>;
export type OpenRouterModelChoice = z.infer<
  typeof openRouterModelChoiceSchema
>;
export type OpenRouterModelsResponse = z.infer<
  typeof openRouterModelsResponseSchema
>;
export type BarcodeLookupRequest = z.infer<
  typeof barcodeLookupRequestSchema
>;
export type BarcodeLookupResponse = z.infer<
  typeof barcodeLookupResponseSchema
>;
export type RecipeFlagReason = z.infer<typeof recipeFlagReasonSchema>;
export type RecipeFlagResponse = z.infer<typeof recipeFlagResponseSchema>;
export type RecipeCatalogResponse = z.infer<
  typeof recipeCatalogResponseSchema
>;
export type RecipeDetailResponse = z.infer<
  typeof recipeDetailResponseSchema
>;
export type CookHistoryEntry = z.infer<typeof cookHistoryEntrySchema>;
export type CookHistoryResponse = z.infer<
  typeof cookHistoryResponseSchema
>;
export type RecipeFavoritesResponse = z.infer<
  typeof recipeFavoritesResponseSchema
>;
export type RecipeFavoriteMutationResponse = z.infer<
  typeof recipeFavoriteMutationResponseSchema
>;
export type ShoppingListItem = z.infer<typeof shoppingListItemSchema>;
export type ShoppingListResponse = z.infer<
  typeof shoppingListResponseSchema
>;
export type ShoppingListAddRequest = z.infer<
  typeof shoppingListAddRequestSchema
>;
export type ShoppingListAddResponse = z.infer<
  typeof shoppingListAddResponseSchema
>;
