import type { RecipeProposal } from "@/contracts/api";
import type {
  Analysis,
  AnalysisCandidate,
  InventoryCommand,
  InventoryLot,
  Recipe,
} from "@/contracts/domain";
import { ApiFault } from "@/server/http";

export const DEMO_HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000002";

type DemoEvent = {
  id: string;
  lotId: string;
  type: string;
  createdAt: string;
};

type DemoAnalysis = Analysis & {
  fileNames: string[];
  assetIds: string[];
  appliedLotIds: string[];
};

type DemoRecipeProposalRecord = {
  idempotencyKey: string;
  requestFingerprint: string;
  expiresAt: string;
  status: "proposed" | "approved" | "denied" | "expired";
  version: number;
  proposal: RecipeProposal | null;
  recipe: Recipe | null;
};

type DemoState = {
  lots: Map<string, InventoryLot>;
  events: DemoEvent[];
  commands: Map<string, InventoryLot>;
  analyses: Map<string, DemoAnalysis>;
  cookSessions: Map<
    string,
    { recipeId: string; createdAt: string; reconciled: boolean }
  >;
  recipeProposals: Map<string, DemoRecipeProposalRecord>;
  approvedRecipes: Map<string, Recipe>;
};

const now = () => new Date().toISOString();
const daysFromNow = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function lot(
  suffix: number,
  input: Partial<InventoryLot> & Pick<InventoryLot, "name" | "category">,
): InventoryLot {
  const createdAt = now();
  return {
    id: `10000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`,
    householdId: DEMO_HOUSEHOLD_ID,
    foodConceptId: null,
    quantityStatus: "unknown",
    quantity: null,
    unit: null,
    form: "unspecified",
    location: "unknown",
    dateLabelType: null,
    dateLabel: null,
    status: "active",
    version: 0,
    createdAt,
    updatedAt: createdAt,
    ...input,
  };
}

function initialState(): DemoState {
  const lots = [
    lot(1, {
      foodConceptId: "tomato",
      name: "Tomatoes",
      category: "Produce",
      quantityStatus: "known",
      quantity: 4,
      unit: "count",
      form: "fresh",
      location: "fridge",
      dateLabelType: "best_before",
      dateLabel: daysFromNow(2),
    }),
    lot(2, {
      foodConceptId: "eggs",
      name: "Eggs",
      category: "Dairy & eggs",
      quantityStatus: "known",
      quantity: 8,
      unit: "count",
      form: "fresh",
      location: "fridge",
    }),
    lot(3, {
      foodConceptId: "spinach",
      name: "Baby spinach",
      category: "Produce",
      form: "fresh",
      location: "fridge",
      dateLabelType: "use_by",
      dateLabel: daysFromNow(1),
    }),
    lot(4, {
      foodConceptId: "black-beans",
      name: "Black beans",
      category: "Pantry",
      quantityStatus: "known",
      quantity: 2,
      unit: "can",
      form: "canned",
      location: "pantry",
    }),
    lot(5, {
      foodConceptId: "rice",
      name: "Long-grain rice",
      category: "Pantry",
      quantityStatus: "known",
      quantity: 2,
      unit: "cup",
      form: "dried",
      location: "pantry",
    }),
    lot(6, {
      foodConceptId: "tortillas",
      name: "Corn tortillas",
      category: "Bakery",
      quantityStatus: "known",
      quantity: 6,
      unit: "count",
      form: "fresh",
      location: "fridge",
    }),
    lot(7, {
      foodConceptId: "cheddar",
      name: "Cheddar",
      category: "Dairy & eggs",
      quantityStatus: "estimated",
      quantity: 6,
      unit: "oz",
      form: "opened",
      location: "fridge",
    }),
    lot(8, {
      foodConceptId: "onion",
      name: "Yellow onion",
      category: "Produce",
      quantityStatus: "known",
      quantity: 2,
      unit: "count",
      form: "fresh",
      location: "pantry",
    }),
    lot(9, {
      foodConceptId: "broccoli",
      name: "Broccoli",
      category: "Produce",
      quantityStatus: "known",
      quantity: 1,
      unit: "count",
      form: "fresh",
      location: "fridge",
    }),
  ];
  return {
    lots: new Map(lots.map((item) => [item.id, item])),
    events: [],
    commands: new Map(),
    analyses: new Map(),
    cookSessions: new Map(),
    recipeProposals: new Map(),
    approvedRecipes: new Map(),
  };
}

const globalState = globalThis as typeof globalThis & {
  __foodtopiaDemoState?: DemoState;
};

const state = () => (globalState.__foodtopiaDemoState ??= initialState());

export function resetDemoStateForTests() {
  globalState.__foodtopiaDemoState = initialState();
}

export function listDemoInventory() {
  return [...state().lots.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function purgeExpiredDemoRecipeProposals(observedAt: Date = new Date()) {
  let expiredCount = 0;
  for (const record of state().recipeProposals.values()) {
    if (record.status !== "proposed" || record.expiresAt > observedAt.toISOString()) continue;
    record.status = "expired";
    record.version += 1;
    record.proposal = null;
    record.recipe = null;
    expiredCount += 1;
  }
  return { expiredCount };
}

export function preflightDemoRecipeProposal(input: {
  idempotencyKey: string;
  requestFingerprint: string;
  observedAt?: Date;
}) {
  purgeExpiredDemoRecipeProposals(input.observedAt);
  const record = [...state().recipeProposals.values()].find(
    (candidate) => candidate.idempotencyKey === input.idempotencyKey,
  );
  if (!record) return { kind: "none" as const };
  if (record.requestFingerprint !== input.requestFingerprint) {
    throw new ApiFault(
      "RECIPE_GENERATION_REQUEST_CONFLICT",
      "Generation request ID was already used for different recipe inputs.",
      409,
    );
  }
  if (record.status === "proposed" && record.proposal) {
    return { kind: "pending" as const, proposal: record.proposal };
  }
  return { kind: "terminal" as const, status: record.status };
}

export function saveDemoRecipeProposal(
  proposal: RecipeProposal,
  input: {
    idempotencyKey: string;
    requestFingerprint: string;
    expiresAt?: string;
  },
) {
  const replay = preflightDemoRecipeProposal({
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
  });
  if (replay.kind === "pending") return replay.proposal;
  if (replay.kind === "terminal") {
    throw new ApiFault("PROPOSAL_TERMINAL", "Recipe proposal already has a terminal decision.", 409);
  }
  state().recipeProposals.set(proposal.id, {
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    expiresAt:
      input.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    status: "proposed",
    version: proposal.version,
    proposal,
    recipe: proposal.recipe,
  });
  return proposal;
}

export function listDemoApprovedRecipes() {
  return [...state().approvedRecipes.values()];
}

export function decideDemoRecipeProposal(
  proposalId: string,
  decision: "approve" | "deny",
  expectedVersion: number,
  observedAt: Date = new Date(),
) {
  const record = state().recipeProposals.get(proposalId);
  if (!record) throw new ApiFault("PROPOSAL_NOT_FOUND", "Recipe proposal not found.", 404);
  if (record.status === "proposed" && record.expiresAt <= observedAt.toISOString()) {
    record.status = "expired";
    record.version += 1;
    record.proposal = null;
    record.recipe = null;
    return {
      proposalId,
      status: "expired" as const,
      recipeId: null,
      version: record.version,
      replayed: false,
      recipe: null,
    };
  }
  if (record.status !== "proposed") {
    if (
      (record.status === "approved" && decision === "approve") ||
      (record.status === "denied" && decision === "deny")
    ) {
      return {
        proposalId,
        status: record.status,
        recipeId: record.status === "approved" ? record.recipe?.id ?? null : null,
        version: record.version,
        replayed: true,
        recipe: record.status === "approved" ? record.recipe : null,
      };
    }
    if (record.status === "expired") {
      throw new ApiFault("PROPOSAL_EXPIRED", "Recipe proposal expired.", 409);
    }
    throw new ApiFault("PROPOSAL_DECIDED", "Recipe proposal already has a different decision.", 409);
  }
  if (record.version !== expectedVersion) {
    throw new ApiFault("STALE_VERSION", "The recipe proposal changed.", 409);
  }
  const recipe = record.recipe;
  record.status = decision === "approve" ? "approved" : "denied";
  record.version += 1;
  record.proposal = null;
  if (decision === "approve" && recipe) state().approvedRecipes.set(recipe.id, recipe);
  if (decision === "deny") record.recipe = null;
  return {
    proposalId,
    status: record.status,
    recipeId: decision === "approve" ? recipe?.id ?? null : null,
    version: record.version,
    replayed: false,
    recipe: decision === "approve" ? recipe : null,
  };
}

export function demoEvents(cursor?: string | null) {
  const events = state().events;
  const index = cursor ? Number(cursor) : 0;
  return {
    householdId: DEMO_HOUSEHOLD_ID,
    lots: listDemoInventory(),
    events: events.slice(Number.isFinite(index) ? index : 0),
    cursor: String(events.length),
  };
}

function recordEvent(lotId: string, type: string) {
  state().events.push({ id: crypto.randomUUID(), lotId, type, createdAt: now() });
}

function withVersion(lot: InventoryLot, patch: Partial<InventoryLot>) {
  return {
    ...lot,
    ...patch,
    householdId: DEMO_HOUSEHOLD_ID,
    version: lot.version + 1,
    updatedAt: now(),
  } satisfies InventoryLot;
}

export function applyDemoCommand(command: InventoryCommand) {
  const previous = state().commands.get(command.commandId);
  if (previous) {
    // The demo store retains the original command result; production also
    // fingerprints command semantics before replaying an idempotency key.
    return { lot: previous, replayed: true };
  }

  let next: InventoryLot;
  if (command.type === "add") {
    const timestamp = now();
    next = {
      ...command.payload,
      householdId: DEMO_HOUSEHOLD_ID,
      version: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (state().lots.has(next.id)) {
      throw new ApiFault("LOT_EXISTS", "That inventory item already exists.", 409);
    }
  } else {
    const current = state().lots.get(command.payload.lotId);
    if (!current) {
      throw new ApiFault("LOT_NOT_FOUND", "That inventory item no longer exists.", 404);
    }
    if (current.version !== command.expectedVersion) {
      throw new ApiFault(
        "STALE_VERSION",
        "This item changed in your household. Review the latest value before reapplying.",
        409,
        false,
        current,
      );
    }

    if (command.type === "discard") {
      next = withVersion(current, { status: "discarded" });
    } else if (command.type === "restore") {
      next = withVersion(current, { status: "active" });
    } else if (command.type === "consume") {
      next = withVersion(current, { status: "consumed" });
    } else {
      next = withVersion(current, command.payload);
    }
  }

  state().lots.set(next.id, next);
  state().commands.set(command.commandId, next);
  recordEvent(next.id, command.type);
  return { lot: next, replayed: false };
}

export function createDemoAnalysis(files: { name: string }[]) {
  const id = crypto.randomUUID();
  const timestamp = now();
  const assetIds = files.map(() => crypto.randomUUID());
  const analysis: DemoAnalysis = {
    id,
    householdId: DEMO_HOUSEHOLD_ID,
    status: "created",
    candidates: [],
    errorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    fileNames: files.map((file) => file.name),
    assetIds,
    appliedLotIds: [],
  };
  state().analyses.set(id, analysis);
  return analysis;
}

export function getDemoAnalysis(id: string) {
  const analysis = state().analyses.get(id);
  if (!analysis) throw new ApiFault("ANALYSIS_NOT_FOUND", "Scan not found.", 404);
  return analysis;
}

export function listDemoUnfinishedAnalyses() {
  const visible = new Set(["queued", "processing", "needs_review", "failed"]);
  return [...state().analyses.values()]
    .filter((analysis) => visible.has(analysis.status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 5)
    .map((analysis) => ({
      id: analysis.id,
      status: analysis.status,
      candidateCount: analysis.candidates.length,
      updatedAt: analysis.updatedAt,
    }));
}

export function setDemoAnalysis(
  id: string,
  patch: Partial<Pick<DemoAnalysis, "status" | "candidates" | "errorCode">>,
) {
  const current = getDemoAnalysis(id);
  const next = { ...current, ...patch, updatedAt: now() };
  state().analyses.set(id, next);
  return next;
}

const conceptByName: Record<string, string> = {
  tomatoes: "tomato",
  tomato: "tomato",
  eggs: "eggs",
  egg: "eggs",
  broccoli: "broccoli",
  onions: "onion",
  onion: "onion",
  rice: "rice",
  "black beans": "black-beans",
  milk: "milk",
  chicken: "chicken",
};

export function proposalsToDemoCandidates(
  analysisId: string,
  proposals: Omit<
    AnalysisCandidate,
    "id" | "analysisId" | "suggestedConceptId" | "accepted"
  >[],
) {
  return proposals.map((proposal) => ({
    ...proposal,
    id: crypto.randomUUID(),
    analysisId,
    suggestedConceptId:
      conceptByName[proposal.suggestedName.toLowerCase()] ?? null,
    accepted: true,
  } satisfies AnalysisCandidate));
}

export function applyDemoAnalysis(
  id: string,
  candidates: AnalysisCandidate[],
) {
  const analysis = getDemoAnalysis(id);
  if (analysis.status === "applied") {
    return analysis.appliedLotIds
      .map((lotId) => state().lots.get(lotId))
      .filter((item): item is InventoryLot => Boolean(item));
  }
  if (analysis.status !== "needs_review") {
    throw new ApiFault(
      "ANALYSIS_NOT_REVIEWABLE",
      "This scan is not ready to apply.",
      409,
    );
  }

  const timestamp = now();
  const lots = candidates
    .filter((candidate) => candidate.accepted)
    .map((candidate) => {
      const newLot: InventoryLot = {
        id: crypto.randomUUID(),
        householdId: DEMO_HOUSEHOLD_ID,
        foodConceptId: candidate.suggestedConceptId,
        name: candidate.suggestedName,
        category: candidate.category,
        quantityStatus: candidate.quantityStatus,
        quantity: candidate.quantity,
        unit: candidate.unit,
        form: candidate.form,
        location: candidate.location,
        dateLabelType: null,
        dateLabel: null,
        status: "active",
        version: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state().lots.set(newLot.id, newLot);
      recordEvent(newLot.id, "analysis_add");
      return newLot;
    });
  state().analyses.set(id, {
    ...analysis,
    status: "applied",
    candidates,
    appliedLotIds: lots.map((item) => item.id),
    updatedAt: timestamp,
  });
  return lots;
}

export function createDemoCookSession(recipeId: string) {
  const id = crypto.randomUUID();
  const createdAt = now();
  state().cookSessions.set(id, { recipeId, createdAt, reconciled: false });
  return { cookSessionId: id, recipeId, createdAt };
}

export function requireDemoCookSession(id: string) {
  const session = state().cookSessions.get(id);
  if (!session) {
    throw new ApiFault(
      "COOK_SESSION_NOT_FOUND",
      "This cooking session no longer exists.",
      404,
    );
  }
  return session;
}
