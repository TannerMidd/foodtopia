import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RecipeAssessment } from "@/contracts/domain";

const mocks = vi.hoisted(() => ({
  getSuggestions: vi.fn(),
  decideProposal: vi.fn(),
  saveAssessment: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/client/api", () => ({
  getRecipeSuggestions: mocks.getSuggestions,
  decideRecipeProposal: mocks.decideProposal,
}));
vi.mock("@/lib/client/recipe-cache", () => ({ saveRecipeAssessment: mocks.saveAssessment }));
vi.mock("./offline-provider", () => ({
  useOfflineInventory: () => ({ online: true, lots: [], hydrated: true }),
}));

import { RecipeProposalPreview, RecipeRow, RecipeSuggestions } from "./recipe-suggestions";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const assessment: RecipeAssessment = {
  recipe: {
    id: "accessible-substitutions",
    slug: "accessible-substitutions",
    title: "Accessible Substitutions",
    description: "A test recipe with two visible ingredient changes.",
    servings: 4,
    totalMinutes: 30,
    mealTypes: ["dinner"],
    cuisines: ["Test"],
    dietaryTags: [],
    ingredients: [
      {
        id: "chicken",
        foodConceptId: "chicken-breast",
        name: "chicken breast",
        amount: 1,
        unit: "lb",
        display: "1 pound chicken breast, diced",
        required: true,
        acceptedForms: ["fresh", "frozen"],
      },
      {
        id: "lemon",
        foodConceptId: "lemon",
        name: "lemon",
        amount: 1,
        unit: "count",
        display: "1 lemon, juiced",
        required: true,
        acceptedForms: ["fresh"],
      },
    ],
    steps: ["Cook the chicken breast completely.", "Finish the chicken breast with lemon."],
    rights: {
      owner: "Foodtopia",
      author: "Foodtopia Editorial",
      reviewer: "Reviewer",
      reviewedAt: "2026-08-23",
      status: "reviewed",
    },
  },
  tier: "likely_ready",
  missingCount: 0,
  unknownQuantityCount: 0,
  substitutionCount: 2,
  usesSoonCount: 0,
  explanation: "Two curated substitutions need confirmation.",
  evidence: [
    {
      ingredientId: "chicken",
      ingredientName: "chicken breast",
      status: "present_sufficient",
      lotIds: [],
      detail: "Use chicken thigh.",
      substitution: {
        requestedConceptId: "chicken-breast",
        requestedName: "chicken breast",
        matchedConceptId: "chicken-thigh",
        matchedName: "chicken thigh",
        guidance: "Cook until fully done.",
      },
    },
    {
      ingredientId: "lemon",
      ingredientName: "lemon",
      status: "present_sufficient",
      lotIds: [],
      detail: "Use lime.",
      substitution: {
        requestedConceptId: "lemon",
        requestedName: "lemon",
        matchedConceptId: "lime",
        matchedName: "lime",
        guidance: "The flavor will change slightly.",
      },
    },
  ],
};

describe("AI recipe proposal review", () => {
  const proposal = {
    id: "12345678-1234-4234-8234-123456789abc",
    status: "proposed" as const,
    recipe: {
      ...assessment.recipe,
      id: "generated-12345678-1234-4234-8234-123456789abc",
      slug: "generated-accessible-substitutions",
      title: "AI Chicken Dinner",
      rights: {
        owner: "Household",
        author: "AI-assisted household recipe",
        reviewer: null,
        reviewedAt: null,
        status: "draft" as const,
      },
    },
    provider: "openai" as const,
    model: "recipe-model",
    createdAt: "2026-08-26T00:00:00.000Z",
    version: 0,
  };

  it("shows full cautionary review and invokes explicit approve or deny", async () => {
    const user = userEvent.setup();
    const approve = vi.fn();
    const deny = vi.fn();
    render(
      <RecipeProposalPreview
        proposal={proposal}
        online
        busy={null}
        error={null}
        onApprove={approve}
        onDeny={deny}
      />,
    );

    expect(screen.getByRole("heading", { name: "AI Chicken Dinner" })).toBeVisible();
    expect(screen.getByText(/AI-generated recipes can be wrong/i)).toBeVisible();
    expect(screen.getByText("1 pound chicken breast, diced")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Approve and save" }));
    await user.click(screen.getByRole("button", { name: "Deny draft" }));
    expect(approve).toHaveBeenCalledOnce();
    expect(deny).toHaveBeenCalledOnce();
  });

  it("disables decisions offline and explains reconnection", () => {
    render(
      <RecipeProposalPreview
        proposal={proposal}
        online={false}
        busy={null}
        error="Decision failed safely."
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Approve and save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny draft" })).toBeDisabled();
    expect(screen.getByText(/Reconnect to approve or deny/i)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Decision failed safely.");
  });
});

describe("RecipeSuggestions proposal lifecycle", () => {
  const proposal = {
    id: "12345678-1234-4234-8234-123456789abc",
    status: "proposed" as const,
    recipe: {
      ...assessment.recipe,
      id: "generated-12345678-1234-4234-8234-123456789abc",
      slug: "generated-accessible-substitutions",
      title: "AI Chicken Dinner",
      rights: { owner: "Household", author: "AI-assisted household recipe", reviewer: null, reviewedAt: null, status: "draft" as const },
    },
    provider: "openai" as const,
    model: "recipe-model",
    createdAt: "2026-08-26T00:00:00.000Z",
    version: 0,
  };
  const response = {
    parsedIntent: { query: "dinner", maxMinutes: null, servings: null, mealTypes: ["dinner"], cuisines: [], dietaryTags: [], includeConceptIds: [], excludeConceptIds: [] },
    assessments: [],
    proposal,
    fallbackNotice: "AI draft prepared.",
    generatedAt: "2026-08-26T00:00:00.000Z",
    allergyNotice: "Not an allergy control.",
  };

  it("removes a prior proposal when a subsequent search fails", async () => {
    const user = userEvent.setup();
    mocks.getSuggestions.mockReset().mockResolvedValueOnce(response).mockRejectedValueOnce(new Error("Search failed"));
    render(<RecipeSuggestions />);
    const prompt = screen.getByLabelText("What sounds good?");
    await user.type(prompt, "first dinner");
    await user.click(screen.getByRole("button", { name: "Find recipes" }));
    expect(await screen.findByRole("heading", { name: "AI Chicken Dinner" })).toBeVisible();

    await user.clear(prompt);
    await user.type(prompt, "second dinner");
    await user.click(screen.getByRole("button", { name: "Find recipes" }));
    expect(await screen.findByText("Search failed")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "AI Chicken Dinner" })).toBeNull();
  });

  it("keeps the newest result when overlapping searches resolve out of order", async () => {
    const user = userEvent.setup();
    const first = deferred<typeof response>();
    const newerProposal = {
      ...proposal,
      id: "22345678-1234-4234-8234-123456789abc",
      recipe: { ...proposal.recipe, title: "Newest AI Dinner" },
    };
    const second = deferred<typeof response>();
    mocks.getSuggestions
      .mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<RecipeSuggestions />);

    await user.type(screen.getByLabelText("What sounds good?"), "older dinner");
    await user.click(screen.getByRole("button", { name: "Find recipes" }));
    await user.click(screen.getByRole("button", { name: "dinner in 30" }));
    second.resolve({ ...response, proposal: newerProposal });
    expect(await screen.findByRole("heading", { name: "Newest AI Dinner" })).toBeVisible();

    first.resolve(response);
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "AI Chicken Dinner" })).toBeNull(),
    );
    expect(screen.getByRole("heading", { name: "Newest AI Dinner" })).toBeVisible();
  });

  it("ignores an old proposal decision after a newer search", async () => {
    const user = userEvent.setup();
    const decision = deferred<{
      proposalId: string;
      status: "denied";
      recipeId: null;
      version: number;
      replayed: boolean;
    }>();
    const newerProposal = {
      ...proposal,
      id: "32345678-1234-4234-8234-123456789abc",
      recipe: { ...proposal.recipe, title: "Replacement AI Dinner" },
    };
    mocks.getSuggestions
      .mockReset()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ ...response, proposal: newerProposal });
    mocks.decideProposal.mockReset().mockReturnValue(decision.promise);
    mocks.push.mockReset();
    render(<RecipeSuggestions />);

    await user.type(screen.getByLabelText("What sounds good?"), "first dinner");
    await user.click(screen.getByRole("button", { name: "Find recipes" }));
    await user.click(await screen.findByRole("button", { name: "Deny draft" }));
    await user.click(screen.getByRole("button", { name: "dinner in 30" }));
    expect(await screen.findByRole("heading", { name: "Replacement AI Dinner" })).toBeVisible();

    decision.resolve({
      proposalId: proposal.id,
      status: "denied",
      recipeId: null,
      version: 1,
      replayed: false,
    });
    await waitFor(() => expect(screen.queryByLabelText("AI draft denied")).toBeNull());
    expect(screen.getByRole("heading", { name: "Replacement AI Dinner" })).toBeVisible();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("moves focus to the terminal denial status", async () => {
    const user = userEvent.setup();
    mocks.getSuggestions.mockReset().mockResolvedValue(response);
    mocks.decideProposal.mockReset().mockResolvedValue({
      proposalId: proposal.id,
      status: "denied",
      recipeId: null,
      version: 1,
      replayed: false,
    });
    render(<RecipeSuggestions />);
    await user.type(screen.getByLabelText("What sounds good?"), "dinner");
    await user.click(screen.getByRole("button", { name: "Find recipes" }));
    await user.click(await screen.findByRole("button", { name: "Deny draft" }));
    const status = await screen.findByLabelText("AI draft denied");
    await waitFor(() => expect(status).toHaveFocus());
  });
});

describe("RecipeRow substitution accessibility", () => {
  it("describes the button with count-aware reason and visible substitution notes", () => {
    render(<RecipeRow assessment={assessment} lit={false} onOpen={vi.fn()} />);

    const button = screen.getByRole("button", {
      name: "Open Accessible Substitutions",
      description: /confirm 2 ingredient changes.*chicken thigh.*lime/i,
    });
    expect(button).toBeVisible();
    expect(screen.getByText("Works if you confirm 2 ingredient changes.")).toBeVisible();
  });
});
