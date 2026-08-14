import "server-only";

import { z } from "zod";

import {
  aiModelIdSchema,
  openRouterModelsResponseSchema,
  type OpenRouterModelsResponse,
} from "@/contracts/api";
import { serverEnv } from "@/lib/env";
import { ApiFault } from "@/server/http";

const OPENROUTER_USER_MODELS_URL = "https://openrouter.ai/api/v1/models/user";
const MODEL_DISCOVERY_TIMEOUT_MS = 12_000;

const openRouterModelSchema = z
  .object({
    id: aiModelIdSchema,
    name: z.string().trim().min(1).max(240),
    context_length: z.number().int().positive().nullable().optional(),
    architecture: z
      .object({
        input_modalities: z.array(z.string()).default([]),
        output_modalities: z.array(z.string()).default([]),
      })
      .passthrough(),
    supported_parameters: z.array(z.string()).default([]),
  })
  .passthrough();

const openRouterModelsPayloadSchema = z
  .object({
    data: z.array(openRouterModelSchema).max(2000),
  })
  .passthrough();

function supportsStructuredOutput(parameters: string[]) {
  return (
    parameters.includes("structured_outputs") ||
    parameters.includes("response_format")
  );
}

export async function discoverOpenRouterModels(
  apiKey: string,
): Promise<OpenRouterModelsResponse> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-OpenRouter-Title": "Foodtopia",
  };
  if (serverEnv.appUrl) headers["HTTP-Referer"] = serverEnv.appUrl;

  let response: Response;
  try {
    response = await fetch(OPENROUTER_USER_MODELS_URL, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
    });
  } catch {
    throw new ApiFault(
      "OPENROUTER_MODELS_UNAVAILABLE",
      "OpenRouter model choices could not be loaded. Try again shortly.",
      503,
      true,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ApiFault(
      "OPENROUTER_KEY_INVALID",
      "OpenRouter rejected this API key.",
      401,
    );
  }
  if (response.status === 429) {
    throw new ApiFault(
      "OPENROUTER_RATE_LIMITED",
      "OpenRouter is rate limiting model discovery. Try again shortly.",
      429,
      true,
    );
  }
  if (!response.ok) {
    throw new ApiFault(
      "OPENROUTER_MODELS_UNAVAILABLE",
      "OpenRouter model choices could not be loaded. Try again shortly.",
      502,
      true,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiFault(
      "OPENROUTER_MODELS_INVALID",
      "OpenRouter returned an invalid model list.",
      502,
      true,
    );
  }

  const parsed = openRouterModelsPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiFault(
      "OPENROUTER_MODELS_INVALID",
      "OpenRouter returned an invalid model list.",
      502,
      true,
    );
  }

  const models = parsed.data.data
    .filter((model) => {
      const inputs = model.architecture.input_modalities;
      const outputs = model.architecture.output_modalities;
      return (
        inputs.includes("text") &&
        outputs.includes("text") &&
        supportsStructuredOutput(model.supported_parameters)
      );
    })
    .map((model) => ({
      id: model.id,
      name: model.name,
      contextLength: model.context_length ?? null,
      supportsVision: model.architecture.input_modalities.includes("image"),
    }));

  return openRouterModelsResponseSchema.parse({
    models,
    fetchedAt: new Date().toISOString(),
  });
}
