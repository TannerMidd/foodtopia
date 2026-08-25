import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecipeAssessment } from "@/contracts/domain";

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));

import { createProductionCookSession } from "./cooking";

const assessment = {
  recipe: {
    id: "household-generated",
    slug: "household-generated",
    title: "Household Generated",
    description: "A private household recipe used for trusted write tests.",
    servings: 2,
    totalMinutes: 20,
    mealTypes: ["dinner"],
    cuisines: ["Test"],
    dietaryTags: [],
    ingredients: [
      {
        id: "rice",
        foodConceptId: "rice",
        name: "rice",
        amount: 1,
        unit: "cup",
        display: "1 cup dry rice",
        required: true,
        acceptedForms: ["dried"],
      },
      {
        id: "water",
        foodConceptId: "water",
        name: "water",
        amount: 2,
        unit: "cup",
        display: "2 cups water",
        required: true,
        acceptedForms: ["unspecified"],
      },
    ],
    steps: ["Simmer the rice in water.", "Rest the rice before serving."],
    rights: {
      owner: "Household",
      author: "Household AI",
      reviewer: null,
      reviewedAt: null,
      status: "draft",
    },
  },
  tier: "ready",
  missingCount: 0,
  unknownQuantityCount: 0,
  substitutionCount: 0,
  usesSoonCount: 0,
  explanation: "Ready.",
  evidence: [],
} satisfies RecipeAssessment;

const session = {
  householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
  userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
};

describe("trusted cook-session creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "79a886b8-df1b-4f87-bb36-b3b5bd485fd9",
        recipe_id: assessment.recipe.id,
        started_at: "2026-08-26T12:00:00.000Z",
      },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    mocks.insert.mockReturnValue({ select });
    mocks.createAdmin.mockReturnValue({
      from: vi.fn(() => ({ insert: mocks.insert })),
    });
  });

  it("uses the server-only admin DAL after route authorization", async () => {
    await createProductionCookSession(session, assessment);

    expect(mocks.createAdmin).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledWith({
      household_id: session.householdId,
      recipe_id: assessment.recipe.id,
      recipe_snapshot: assessment.recipe,
      servings: assessment.recipe.servings,
      status: "active",
      started_by: session.userId,
    });
  });
});
