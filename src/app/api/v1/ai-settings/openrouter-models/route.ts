import {
  openRouterModelDiscoveryRequestSchema,
  openRouterModelsResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { requireHouseholdSession } from "@/server/auth/session";
import { discoverOpenRouterModels } from "@/server/ai/openrouter-models";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import { resolveHouseholdAiRuntimeConfig } from "@/server/services/household-ai-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const id = correlationId(request);
  try {
    if (isDemoMode) {
      throw new ApiFault(
        "DEMO_AI_SETTINGS_READ_ONLY",
        "OpenRouter model discovery requires a connected household.",
        409,
      );
    }
    const session = await requireHouseholdSession();
    if (session.role !== "owner") {
      throw new ApiFault(
        "AI_SETTINGS_OWNER_REQUIRED",
        "Only the household owner can load provider model choices.",
        403,
      );
    }
    const input = await parseJson(
      request,
      openRouterModelDiscoveryRequestSchema,
    );

    // A freshly entered key wins; otherwise reuse the saved household key.
    let apiKey = input.apiKey;
    if (!apiKey) {
      const runtimeConfig = await resolveHouseholdAiRuntimeConfig(
        session.householdId,
      );
      if (runtimeConfig.provider === "openrouter") {
        apiKey = runtimeConfig.apiKey;
      }
    }
    if (!apiKey) {
      throw new ApiFault(
        "OPENROUTER_KEY_REQUIRED",
        "Enter an OpenRouter API key before loading model choices.",
        409,
      );
    }

    return json(
      openRouterModelsResponseSchema.parse(
        await discoverOpenRouterModels(apiKey),
      ),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "OPENROUTER_MODELS_DISCOVERY_FAILED",
        message: "OpenRouter model choices could not be loaded.",
        status: 503,
        retryable: true,
      }),
      id,
    );
  }
}
