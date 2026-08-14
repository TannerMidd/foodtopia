import { describe, expect, it } from "vitest";

import { analysisApplyCandidateSchema } from "./api";

const candidate = {
  id: "11111111-1111-4111-8111-111111111111",
  rawLabel: "Tomatoes",
  suggestedConceptId: "tomato",
  suggestedName: "Tomatoes",
  category: "Produce",
  quantityStatus: "known" as const,
  quantity: 2,
  unit: null,
  form: "fresh" as const,
  location: "fridge" as const,
  imageIndexes: [0],
  uncertaintyReason: null,
  accepted: true,
};

describe("analysis apply candidate contract", () => {
  it.each([
    ["known", null],
    ["estimated", "  "],
  ] as const)("rejects a %s tracked quantity without a usable unit", (quantityStatus, unit) => {
    const result = analysisApplyCandidateSchema.safeParse({
      ...candidate,
      quantityStatus,
      unit,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["unit"] }),
        ]),
      );
    }
  });

  it("accepts a tracked quantity with a unit", () => {
    expect(
      analysisApplyCandidateSchema.safeParse({ ...candidate, unit: "count" }),
    ).toMatchObject({ success: true });
  });
});
