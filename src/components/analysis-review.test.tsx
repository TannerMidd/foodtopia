import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Analysis, AnalysisCandidate } from "@/contracts/domain";

const api = vi.hoisted(() => ({
  applyAnalysis: vi.fn(),
  cancelAnalysis: vi.fn(),
  getAnalysis: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const offline = vi.hoisted(() => ({ online: true, refresh: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/client/api", () => api);
vi.mock("./offline-provider", () => ({ useOfflineInventory: () => offline }));

import { AnalysisReview } from "./analysis-review";

const analysisId = "11111111-1111-4111-8111-111111111111";

function candidate(overrides: Partial<AnalysisCandidate> = {}): AnalysisCandidate {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    analysisId,
    rawLabel: "Tomatoes",
    suggestedConceptId: "tomato",
    suggestedName: "Tomatoes",
    category: "Produce",
    quantityStatus: "unknown",
    quantity: null,
    unit: null,
    form: "fresh",
    location: "fridge",
    imageIndexes: [0],
    uncertaintyReason: null,
    accepted: true,
    ...overrides,
  };
}

function review(candidates: AnalysisCandidate[]): Analysis {
  return {
    id: analysisId,
    householdId: "33333333-3333-4333-8333-333333333333",
    status: "needs_review",
    candidates,
    errorCode: null,
    createdAt: "2026-08-14T12:00:00.000Z",
    updatedAt: "2026-08-14T12:00:00.000Z",
  };
}

describe("analysis review confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAnalysis.mockResolvedValue(review([candidate()]));
    api.applyAnalysis.mockResolvedValue(undefined);
    offline.online = true;
    offline.refresh.mockResolvedValue(undefined);
  });

  async function renderReview() {
    render(<AnalysisReview analysisId={analysisId} />);
    return screen.findByRole("button", { name: "Save one item" });
  }

  it("navigates after an applied analysis even if refreshing inventory fails", async () => {
    const user = userEvent.setup();
    offline.refresh.mockRejectedValue(new Error("Inventory refresh failed"));
    const confirm = await renderReview();

    await user.click(confirm);

    await waitFor(() => {
      expect(api.applyAnalysis).toHaveBeenCalledWith(analysisId, [candidate()]);
      expect(offline.refresh).toHaveBeenCalledWith(true);
      expect(navigation.replace).toHaveBeenCalledWith("/inventory?batch=added");
    });
    expect(screen.queryByText("Inventory refresh failed")).toBeNull();
  });

  it("keeps the review open when applying the analysis fails", async () => {
    const user = userEvent.setup();
    api.applyAnalysis.mockRejectedValue(new Error("Could not apply analysis"));
    const confirm = await renderReview();

    await user.click(confirm);

    expect(await screen.findByText("Could not apply analysis")).toBeInTheDocument();
    expect(offline.refresh).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it.each([
    ["known", null],
    ["estimated", "  "],
  ] as const)("blocks a %s tracked quantity without a usable unit before applying", async (quantityStatus, unit) => {
    const user = userEvent.setup();
    api.getAnalysis.mockResolvedValue(
      review([candidate({ quantityStatus, quantity: 2, unit })]),
    );
    const confirm = await renderReview();

    await user.click(confirm);

    expect(
      await screen.findByText("Enter a unit for every item whose amount is tracked."),
    ).toBeInTheDocument();
    expect(api.applyAnalysis).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
