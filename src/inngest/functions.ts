import { NonRetriableError } from "inngest";

import { inngest } from "@/inngest/client";
import { ModelRefusalError } from "@/server/ai/contracts";
import {
  processAnalysis,
  purgeExpiredRawImages,
} from "@/server/services/analysis";
import {
  ANALYSIS_RECOVERY_CRON,
  buildAnalysisRecoveryEvents,
  failTerminallyStaleAnalyses,
  listStaleAnalysisJobs,
  planAnalysisRecovery,
} from "@/server/services/analysis-recovery";
import { RAW_IMAGE_PURGE_CRON } from "@/server/services/raw-image-retention";
import {
  purgeExpiredRecipeProposals,
  RECIPE_PROPOSAL_PURGE_CRON,
} from "@/server/services/recipe-proposal-retention";

export const analyzeFoodBatch = inngest.createFunction(
  {
    id: "analyze-food-batch",
    retries: 3,
    concurrency: { limit: 5 },
    triggers: [{ event: "foodtopia/analysis.requested" }],
  },
  async ({ event, step }) =>
    step.run("analyze-images", async () => {
      try {
        return await processAnalysis(
          String(event.data.analysisId),
          String(event.data.householdId),
        );
      } catch (error) {
        if (error instanceof ModelRefusalError) {
          throw new NonRetriableError(error.message, { cause: error });
        }
        throw error;
      }
    }),
);

export const purgeRawImages = inngest.createFunction(
  {
    id: "purge-raw-images",
    retries: 3,
    triggers: [{ cron: RAW_IMAGE_PURGE_CRON }],
  },
  async ({ step }) =>
    step.run("purge-expired-objects", () => purgeExpiredRawImages()),
);

export const purgeRecipeProposals = inngest.createFunction(
  {
    id: "purge-expired-recipe-proposals",
    retries: 3,
    triggers: [{ cron: RECIPE_PROPOSAL_PURGE_CRON }],
  },
  async ({ step }) =>
    step.run("purge-expired-recipe-proposals", () =>
      purgeExpiredRecipeProposals(),
    ),
);

export const recoverAnalysisJobs = inngest.createFunction(
  {
    id: "recover-stale-analysis-jobs",
    retries: 3,
    triggers: [{ cron: ANALYSIS_RECOVERY_CRON }],
  },
  async ({ step }) => {
    const scan = await step.run("find-stale-analysis-jobs", () =>
      listStaleAnalysisJobs(),
    );
    const plan = planAnalysisRecovery(scan.jobs, scan.observedAt);
    const terminal = await step.run("fail-terminal-analysis-jobs", () =>
      failTerminallyStaleAnalyses(plan.fail, scan.observedAt),
    );
    const events = buildAnalysisRecoveryEvents(
      plan.redispatch,
      scan.observedAt,
    );
    if (events.length > 0) {
      await step.sendEvent("redispatch-stale-analysis-jobs", events);
    }
    return { dispatched: events.length, failed: terminal.failed };
  },
);

export const inngestFunctions = [
  analyzeFoodBatch,
  purgeRawImages,
  purgeRecipeProposals,
  recoverAnalysisJobs,
];
