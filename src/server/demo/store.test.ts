import { beforeEach, describe, expect, it } from "vitest";

import type { RecipeProposal } from "@/contracts/api";
import type { InventoryCommand } from "@/contracts/domain";

import {
  applyDemoCommand,
  decideDemoRecipeProposal,
  listDemoInventory,
  preflightDemoRecipeProposal,
  purgeExpiredDemoRecipeProposals,
  resetDemoStateForTests,
  saveDemoRecipeProposal,
} from "./store";

const proposal: RecipeProposal = {
  id: "12345678-1234-4234-8234-123456789abc",
  status: "proposed",
  recipe: {
    id: "generated-12345678-1234-4234-8234-123456789abc",
    slug: "demo-generated-recipe",
    title: "Demo Generated Recipe",
    description: "A private generated recipe for demo lifecycle tests.",
    servings: 2,
    totalMinutes: 20,
    mealTypes: ["dinner"],
    cuisines: [],
    dietaryTags: [],
    ingredients: [
      { id: "rice", foodConceptId: "rice", name: "rice", amount: null, unit: null, display: "rice, as needed", required: true, acceptedForms: ["dried"] },
      { id: "water", foodConceptId: "water", name: "water", amount: null, unit: null, display: "water, as needed", required: true, acceptedForms: ["unspecified"] },
    ],
    steps: ["Combine the rice and water in a pot.", "Cook the rice and water until tender."],
    rights: { owner: "Household", author: "AI-assisted household recipe", reviewer: null, reviewedAt: null, status: "draft" },
  },
  provider: "demo",
  model: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  version: 0,
};

const proposalRequest = {
  idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  requestFingerprint: "b".repeat(64),
};

describe("demo persistence contract", () => {
  beforeEach(resetDemoStateForTests);

  it("replays the same command without a second event or version change", () => {
    const tomato = listDemoInventory().find((lot) => lot.name === "Tomatoes")!;
    const command: InventoryCommand = {
      commandId: crypto.randomUUID(),
      type: "adjust",
      expectedVersion: tomato.version,
      payload: { lotId: tomato.id, location: "pantry" },
    };

    const first = applyDemoCommand(command);
    const replay = applyDemoCommand(command);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.lot).toEqual(first.lot);
  });

  it("replays pending generation and rejects changed request semantics", () => {
    saveDemoRecipeProposal(proposal, proposalRequest);
    expect(preflightDemoRecipeProposal(proposalRequest)).toEqual({
      kind: "pending",
      proposal,
    });
    expect(() =>
      preflightDemoRecipeProposal({
        ...proposalRequest,
        requestFingerprint: "c".repeat(64),
      }),
    ).toThrow(/different recipe inputs/i);
  });

  it("replays the same terminal decision without losing the approved recipe", () => {
    saveDemoRecipeProposal(proposal, proposalRequest);
    const first = decideDemoRecipeProposal(proposal.id, "approve", 0);
    const replay = decideDemoRecipeProposal(proposal.id, "approve", 0);
    expect(first).toMatchObject({ status: "approved", version: 1, replayed: false });
    expect(replay).toMatchObject({ status: "approved", version: 1, replayed: true });
    expect(replay.recipe).toEqual(proposal.recipe);
  });

  it("expires pending demo payloads without another user action", () => {
    saveDemoRecipeProposal(proposal, {
      ...proposalRequest,
      expiresAt: "2026-08-26T01:00:00.000Z",
    });
    expect(
      purgeExpiredDemoRecipeProposals(new Date("2026-08-26T02:00:00.000Z")),
    ).toEqual({ expiredCount: 1 });
    expect(
      preflightDemoRecipeProposal({
        ...proposalRequest,
        observedAt: new Date("2026-08-26T02:00:00.000Z"),
      }),
    ).toEqual({ kind: "terminal", status: "expired" });
  });

  it("rejects a stale version before changing inventory", () => {
    const tomato = listDemoInventory().find((lot) => lot.name === "Tomatoes")!;
    applyDemoCommand({
      commandId: crypto.randomUUID(),
      type: "adjust",
      expectedVersion: tomato.version,
      payload: { lotId: tomato.id, location: "pantry" },
    });

    expect(() =>
      applyDemoCommand({
        commandId: crypto.randomUUID(),
        type: "discard",
        expectedVersion: tomato.version,
        payload: { lotId: tomato.id },
      }),
    ).toThrow(/changed in your household/i);
  });
});

