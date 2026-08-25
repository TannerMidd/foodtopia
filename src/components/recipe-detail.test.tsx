import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecipeAssessment } from "@/contracts/domain";
import { RecipeDetail } from "./recipe-detail";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  loadAssessment: vi.fn(),
  flagRecipe: vi.fn(),
  recordRecipeOpened: vi.fn(),
  createCookSession: vi.fn(),
  saveRecipeAssessment: vi.fn(),
  saveCookSession: vi.fn(),
  online: true,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/client/recipe-cache", () => ({
  loadRecipeAssessment: mocks.loadAssessment,
  saveRecipeAssessment: mocks.saveRecipeAssessment,
  saveCookSession: mocks.saveCookSession,
}));
vi.mock("@/lib/client/api", () => ({
  ApiClientError: class ApiClientError extends Error {
    status: number;
    code: string;
    retryable = false;
    correlationId = null;
    latestAssessment: RecipeAssessment | null;

    constructor(options: { message: string; status: number; code: string; latestAssessment?: RecipeAssessment }) {
      super(options.message);
      this.status = options.status;
      this.code = options.code;
      this.latestAssessment = options.latestAssessment ?? null;
    }
  },
  flagRecipe: mocks.flagRecipe,
  recordRecipeOpened: mocks.recordRecipeOpened,
  createCookSession: mocks.createCookSession,
}));
vi.mock("./offline-provider", () => ({
  useOfflineInventory: () => ({ online: mocks.online }),
}));

const assessment: RecipeAssessment = {
  recipe: {
    id: "recipe-081",
    slug: "paprika-chicken-thigh-rice",
    title: "Paprika Chicken Thigh Rice",
    description: "A simple paprika chicken thigh dinner served with tender rice.",
    servings: 4,
    totalMinutes: 35,
    mealTypes: ["dinner"],
    cuisines: ["European-inspired"],
    dietaryTags: ["dairy-free"],
    ingredients: [
      {
        id: "rice",
        foodConceptId: "rice",
        name: "rice",
        amount: 1.5,
        unit: "cup",
        display: "1 1/2 cups dry rice",
        required: true,
        acceptedForms: ["dried"],
      },
      {
        id: "water",
        foodConceptId: "water",
        name: "water",
        amount: 3,
        unit: "cup",
        display: "3 cups water",
        required: true,
        acceptedForms: ["unspecified"],
      },
    ],
    steps: ["Simmer the rice in water until tender.", "Rest the rice and serve it warm."],
    rights: {
      owner: "Foodtopia",
      author: "Foodtopia Initial Catalog",
      reviewer: null,
      reviewedAt: null,
      status: "seeded",
    },
  },
  tier: "ready",
  missingCount: 0,
  unknownQuantityCount: 0,
  substitutionCount: 0,
  usesSoonCount: 0,
  explanation: "All required ingredients are present.",
  evidence: [
    {
      ingredientId: "rice",
      ingredientName: "rice",
      status: "present_sufficient",
      lotIds: [],
      detail: "Rice is present.",
      substitution: null,
    },
    {
      ingredientId: "water",
      ingredientName: "water",
      status: "assumed_staple",
      lotIds: [],
      detail: "Water is an assumed staple.",
      substitution: null,
    },
  ],
};

describe("RecipeDetail seed provenance and flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.online = true;
    mocks.loadAssessment.mockReturnValue(assessment);
    mocks.flagRecipe.mockResolvedValue({ flagged: true, simulated: false });
    mocks.recordRecipeOpened.mockResolvedValue(undefined);
    mocks.createCookSession.mockResolvedValue({
      cookSessionId: "7b3e50ec-2757-44ad-a94d-941828980981",
      recipeId: assessment.recipe.id,
      createdAt: "2026-08-26T12:00:00.000Z",
      assessment,
    });
  });

  it("labels seed content without claiming editorial review", async () => {
    render(<RecipeDetail slug={assessment.recipe.slug} />);

    expect(await screen.findByText(/initial recipe/i)).toBeVisible();
    expect(screen.getByText(/initial catalog seed/i)).toBeVisible();
    expect(screen.queryByText(/reviewed by/i)).toBeNull();
  });

  it("submits bounded categorical feedback and confirms it", async () => {
    const user = userEvent.setup();
    render(<RecipeDetail slug={assessment.recipe.slug} />);

    await user.click(await screen.findByRole("button", { name: /flag a problem/i }));
    expect(screen.getByLabelText(/what is wrong/i)).toHaveFocus();
    await user.selectOptions(screen.getByLabelText(/what is wrong/i), "unsafe");
    await user.click(screen.getByRole("button", { name: /submit flag/i }));

    expect(mocks.flagRecipe).toHaveBeenCalledWith(assessment.recipe.id, "unsafe");
    expect(await screen.findByRole("status")).toHaveTextContent(/flagged for review/i);
  });

  it("shows a simulated demo result without promising persistent moderation", async () => {
    mocks.flagRecipe.mockResolvedValue({ flagged: true, simulated: true });
    const user = userEvent.setup();
    render(<RecipeDetail slug={assessment.recipe.slug} />);

    await user.click(await screen.findByRole("button", { name: /flag a problem/i }));
    await user.click(screen.getByRole("button", { name: /submit flag/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /demo mode simulated this flag; no moderation record was saved/i,
    );
  });

  it("requires accessible confirmation and caches the authoritative cook assessment", async () => {
    const substituted: RecipeAssessment = {
      ...assessment,
      tier: "likely_ready",
      substitutionCount: 1,
      evidence: [
        {
          ...assessment.evidence[0],
          substitution: {
            requestedConceptId: "rice",
            requestedName: "rice",
            matchedConceptId: "brown-rice",
            matchedName: "brown rice",
            guidance: "Use the same measured amount and allow extra cooking time.",
          },
        },
        assessment.evidence[1],
      ],
    };
    mocks.loadAssessment.mockReturnValue(substituted);
    const authoritative = {
      ...substituted,
      recipe: {
        ...substituted.recipe,
        description: "The server-authorized effective recipe snapshot.",
        steps: ["Review the server substitution note.", ...substituted.recipe.steps],
      },
    } satisfies RecipeAssessment;
    mocks.createCookSession.mockResolvedValue({
      cookSessionId: "7b3e50ec-2757-44ad-a94d-941828980981",
      recipeId: substituted.recipe.id,
      createdAt: "2026-08-26T12:00:00.000Z",
      assessment: authoritative,
    });
    const user = userEvent.setup();
    render(<RecipeDetail slug={substituted.recipe.slug} />);

    expect(await screen.findByText(/use brown rice instead of rice/i)).toBeVisible();
    const cook = screen.getByRole("button", { name: /cook this/i });
    expect(cook).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", {
        name: /reviewed these substitutions/i,
      }),
    );
    expect(cook).toBeEnabled();
    await user.click(cook);

    expect(mocks.createCookSession).toHaveBeenCalledWith(substituted);
    expect(mocks.saveRecipeAssessment).toHaveBeenCalledWith(authoritative);
    expect(mocks.saveCookSession).toHaveBeenCalled();
  });

  it("refreshes stale substitution evidence and requires confirmation again", async () => {
    const substituted: RecipeAssessment = {
      ...assessment,
      tier: "likely_ready",
      substitutionCount: 1,
      evidence: assessment.evidence.map((item, index) =>
        index === 0
          ? {
              ...item,
              substitution: {
                requestedConceptId: "rice",
                requestedName: "rice",
                matchedConceptId: "brown-rice",
                matchedName: "brown rice",
                guidance: "Allow extra cooking time.",
              },
            }
          : item,
      ),
    };
    const latest = { ...assessment, explanation: "The exact rice is now present." };
    mocks.loadAssessment.mockReturnValue(substituted);
    const { ApiClientError } = await import("@/lib/client/api");
    mocks.createCookSession.mockRejectedValue(
      new ApiClientError({
        message: "Substitutions changed.",
        status: 409,
        code: "RECIPE_SUBSTITUTIONS_CHANGED",
        latestAssessment: latest,
      }),
    );
    const user = userEvent.setup();
    render(<RecipeDetail slug={substituted.recipe.slug} />);

    await user.click(await screen.findByRole("checkbox", { name: /reviewed these substitutions/i }));
    await user.click(screen.getByRole("button", { name: /cook this/i }));

    expect(await screen.findByText(/kitchen changed/i)).toBeVisible();
    expect(mocks.saveRecipeAssessment).toHaveBeenCalledWith(latest);
    expect(screen.queryByRole("checkbox", { name: /reviewed these substitutions/i })).toBeNull();
  });

  it("disables cooking offline and explains the reconnect requirement", async () => {
    mocks.online = false;
    render(<RecipeDetail slug={assessment.recipe.slug} />);

    expect(await screen.findByRole("button", { name: /cook this/i })).toBeDisabled();
    expect(screen.getByText(/reconnect to start cooking/i)).toBeVisible();
  });

  it("keeps a rejected flag editable and clears stale errors on cancel or reopen", async () => {
    mocks.flagRecipe.mockRejectedValueOnce(new Error("The recipe could not be flagged."));
    const user = userEvent.setup();
    render(<RecipeDetail slug={assessment.recipe.slug} />);

    await user.click(await screen.findByRole("button", { name: /flag a problem/i }));
    await user.click(screen.getByRole("button", { name: /submit flag/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be flagged/i);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("alert")).toBeNull();

    await user.click(screen.getByRole("button", { name: /flag a problem/i }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText(/what is wrong/i)).toHaveFocus();
  });
});
