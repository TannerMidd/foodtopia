import {
  aiSettingsResponseSchema,
  aiSettingsUpdateRequestSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import {
  readHouseholdAiSettings,
  writeHouseholdAiSettings,
} from "@/server/repositories/ai-settings";
import { asApiError } from "@/server/repositories/errors";
import {
  encryptHouseholdApiKey,
  getCredentialKeyringStatus,
} from "@/server/services/household-ai-credentials";
import { presentHouseholdAiSettings } from "@/server/services/household-ai-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DatabaseErrorLike = {
  code?: unknown;
  message?: unknown;
};

/**
 * Settings writes have a small, app-owned set of database invariants. Map
 * those known failures to actionable owner-facing errors instead of the
 * repository-wide generic INVALID_OPERATION message. No provider key or
 * encrypted envelope is included in these database messages.
 */
function aiSettingsWriteError(error: unknown) {
  const candidate =
    typeof error === "object" && error !== null
      ? (error as DatabaseErrorLike)
      : null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message =
    typeof candidate?.message === "string" ? candidate.message : "";

  if (
    code === "22023" &&
    (message === "vision model ID is invalid" ||
      message === "recipe model ID is invalid")
  ) {
    return new ApiFault(
      "AI_MODEL_ID_INVALID",
      "One of the selected model IDs is not accepted. Choose another model or enter a valid provider model ID.",
      422,
    );
  }
  if (
    code === "22023" &&
    message === "retaining a household key requires keeping its provider"
  ) {
    return new ApiFault(
      "AI_SETTINGS_PROVIDER_CHANGED",
      "The saved provider changed while this form was open. Reload the latest settings before saving.",
      409,
    );
  }
  if (code === "23514") {
    return new ApiFault(
      "AI_SETTINGS_CREDENTIAL_STATE_CONFLICT",
      "The saved provider and API key are out of sync. Remove the saved key and enter it again.",
      409,
    );
  }

  return asApiError(error, {
    code: "AI_SETTINGS_WRITE_FAILED",
    message: "The household AI settings could not be saved.",
    status: 503,
    retryable: true,
  });
}

function demoSettings() {
  return aiSettingsResponseSchema.parse({
    provider: "openai",
    visionModelId: "local-demo-vision",
    recipeModelId: "local-demo-recipes",
    credentialConfigured: true,
    modelDefaults: {
      openai: {
        visionModelId: "local-demo-vision",
        recipeModelId: "local-demo-recipes",
      },
      openrouter: { visionModelId: null, recipeModelId: null },
    },
    householdCredentialsAvailable: false,
    canEdit: false,
    updatedAt: new Date(0).toISOString(),
    version: 1,
  });
}

export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    if (isDemoMode) return json(demoSettings());
    const session = await requireHouseholdSession();
    const client = await createServerSupabaseClient();
    const stored = await readHouseholdAiSettings(client);
    return json(
      aiSettingsResponseSchema.parse(
        presentHouseholdAiSettings(stored, session.role === "owner"),
      ),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "AI_SETTINGS_READ_FAILED",
        message: "The household AI settings could not be loaded.",
        status: 503,
        retryable: true,
      }),
      id,
    );
  }
}

export async function PUT(request: Request) {
  const id = correlationId(request);
  try {
    if (isDemoMode) {
      throw new ApiFault(
        "DEMO_AI_SETTINGS_READ_ONLY",
        "The local demo uses built-in assistants and has no cloud credentials.",
        409,
      );
    }
    const session = await requireHouseholdSession();
    if (session.role !== "owner") {
      throw new ApiFault(
        "AI_SETTINGS_OWNER_REQUIRED",
        "Only the household owner can change AI provider settings.",
        403,
      );
    }
    const input = await parseJson(request, aiSettingsUpdateRequestSchema);
    let credential: {
      encryptedApiKey: string;
      encryptionKeyId: string;
    } | null = null;
    if (input.credentialAction === "replace") {
      const keyring = getCredentialKeyringStatus();
      if (!keyring.available) {
        throw new ApiFault(
          "HOUSEHOLD_AI_CREDENTIALS_UNAVAILABLE",
          "Household API-key storage is not configured on this deployment.",
          503,
        );
      }
      if (input.apiKey) {
        credential = encryptHouseholdApiKey(input.apiKey, {
          householdId: session.householdId,
          provider: input.provider,
        });
      }
    }
    const client = await createServerSupabaseClient();
    const stored = await writeHouseholdAiSettings(client, input, credential);
    return json(
      aiSettingsResponseSchema.parse(presentHouseholdAiSettings(stored, true)),
    );
  } catch (error) {
    return errorResponse(aiSettingsWriteError(error), id);
  }
}
