import { isDemoMode, serverEnv } from "@/lib/env";
import {
  DemoRecipeAssistant,
  DemoVisionAnalyzer,
} from "@/server/ai/demo-adapters";
import {
  OpenAIRecipeAssistant,
  OpenAIVisionAnalyzer,
} from "@/server/ai/openai-adapters";
import {
  OpenRouterRecipeAssistant,
  OpenRouterVisionAnalyzer,
} from "@/server/ai/openrouter-adapters";
import type {
  RecipeAssistant,
  VisionAnalyzer,
} from "@/server/ai/contracts";
import type { HouseholdAiRuntimeConfig } from "@/server/services/household-ai-settings";

const requireRuntimeConfig = (
  config: HouseholdAiRuntimeConfig | undefined,
): HouseholdAiRuntimeConfig => {
  if (!config) {
    throw new Error("Household AI runtime configuration is required.");
  }
  return config;
};

export const createVisionAnalyzer = (
  config?: HouseholdAiRuntimeConfig,
): VisionAnalyzer => {
  if (isDemoMode) return new DemoVisionAnalyzer();
  const runtime = requireRuntimeConfig(config);
  return runtime.provider === "openrouter"
    ? new OpenRouterVisionAnalyzer({
        apiKey: runtime.apiKey,
        model: runtime.visionModelId,
        appUrl: serverEnv.appUrl,
        appTitle: "Foodtopia",
      })
    : new OpenAIVisionAnalyzer({
        apiKey: runtime.apiKey,
        model: runtime.visionModelId,
      });
};

export const createRecipeAssistant = (
  config?: HouseholdAiRuntimeConfig,
): RecipeAssistant => {
  if (isDemoMode) return new DemoRecipeAssistant();
  const runtime = requireRuntimeConfig(config);
  return runtime.provider === "openrouter"
    ? new OpenRouterRecipeAssistant({
        apiKey: runtime.apiKey,
        model: runtime.recipeModelId,
        appUrl: serverEnv.appUrl,
        appTitle: "Foodtopia",
      })
    : new OpenAIRecipeAssistant({
        apiKey: runtime.apiKey,
        model: runtime.recipeModelId,
      });
};
