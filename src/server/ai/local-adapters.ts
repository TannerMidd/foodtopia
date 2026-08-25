import type { RecipeAssessment, RecipeIntent } from "@/contracts/domain";
import type {
  GeneratedRecipeDraft,
  RecipeAssistant,
  RecipeGenerationContext,
  VisionAnalyzer,
  VisionBatchResult,
} from "@/server/ai/contracts";
import { demoGeneratedDraft } from "@/server/services/generated-recipes";

const foodWords = [
  ["tomato", "Tomatoes", "Produce"],
  ["egg", "Eggs", "Dairy & eggs"],
  ["milk", "Milk", "Dairy & eggs"],
  ["chicken", "Chicken", "Meat"],
  ["rice", "Rice", "Pantry"],
  ["bean", "Black beans", "Pantry"],
  ["broccoli", "Broccoli", "Produce"],
  ["onion", "Onions", "Produce"],
] as const;

export class DemoVisionAnalyzer implements VisionAnalyzer {
  async analyze(input: {
    analysisId: string;
    images: { index: number }[];
    fileNames?: string[];
  }): Promise<VisionBatchResult> {
    const names = input.fileNames?.join(" ").toLowerCase() ?? "";
    const detected = foodWords.filter(([word]) => names.includes(word));
    const suggestions = detected.length
      ? detected
      : [foodWords[0], foodWords[1], foodWords[6]];
    return {
      proposals: suggestions.map(([, name, category], index) => ({
        rawLabel: name,
        suggestedName: name,
        category,
        quantityStatus: "unknown" as const,
        quantity: null,
        unit: null,
        form: "fresh" as const,
        location: "fridge" as const,
        imageIndexes: [Math.min(index, input.images.length - 1)],
        uncertaintyReason:
          "Demo suggestion—confirm the item before it changes inventory.",
      })),
      batchNotes:
        "Local demo mode uses representative suggestions because cloud vision is not configured.",
    };
  }
}

const cuisines = ["italian", "mexican", "mediterranean", "asian", "american"];
const mealTypes = ["breakfast", "lunch", "dinner", "snack"];
const dietaryTags = ["vegetarian", "vegan", "gluten-free", "dairy-free"];

export class HeuristicRecipeAssistant implements RecipeAssistant {
  async generate(context: RecipeGenerationContext): Promise<GeneratedRecipeDraft> {
    return demoGeneratedDraft(context);
  }

  async parseIntent(prompt: string): Promise<RecipeIntent> {
    const normalized = prompt.toLowerCase();
    const time = normalized.match(/(?:under|within|in)\s+(\d{1,3})\s*(?:minutes?|mins?)/);
    const servings = normalized.match(/(?:for|serves?)\s+(\d{1,2})/);
    return {
      query: prompt,
      maxMinutes: time ? Number(time[1]) : null,
      servings: servings ? Number(servings[1]) : null,
      cuisines: cuisines.filter((value) => normalized.includes(value)),
      mealTypes: mealTypes.filter((value) => normalized.includes(value)),
      dietaryTags: dietaryTags.filter((value) => normalized.includes(value)),
      includeConceptIds: [],
      excludeConceptIds: [],
    };
  }

  async explain(
    intent: RecipeIntent,
    assessments: RecipeAssessment[],
  ): Promise<Map<string, string>> {
    return new Map(
      assessments.map((assessment) => {
        const available = assessment.evidence.filter((item) =>
          [
            "present_sufficient",
            "present_quantity_unknown",
            "assumed_staple",
          ].includes(item.status),
        ).length;
        const promptFit = intent.query
          ? " and fits the filters we could verify"
          : "";
        return [
          assessment.recipe.id,
          `${available} required ingredients are accounted for${promptFit}.`,
        ];
      }),
    );
  }
}

