import type { Analysis } from "@/contracts/domain";
import { normalizeFoodLabel, resolveFoodConcept } from "@/domain/normalization";
import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createVisionAnalyzer } from "@/server/ai";
import { ModelRefusalError } from "@/server/ai/contracts";
import {
  getDemoAnalysis,
  proposalsToDemoCandidates,
  setDemoAnalysis,
} from "@/server/demo/store";
import {
  getProductionAnalysis,
  listAnalysisAssets,
  purgeRawAssets,
} from "@/server/repositories/analyses";
import { recordProductEvent } from "@/server/repositories/telemetry";
import { finalizePendingHouseholdDeletions } from "@/server/repositories/households";
import {
  RAW_IMAGE_PURGE_CLAIM_LIMIT,
  RAW_IMAGE_PURGE_MAX_BATCHES,
  RAW_IMAGE_TOMBSTONE_MAX_PAGES,
  RAW_IMAGE_TOMBSTONE_PAGE_SIZE,
  shouldContinuePurgeDrain,
} from "@/server/services/raw-image-retention";
import {
  AiConfigurationError,
  resolveHouseholdAiRuntimeConfig,
  type HouseholdAiRuntimeConfig,
} from "@/server/services/household-ai-settings";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const adminClient = () => createAdminSupabaseClient();

async function resolveProposalConcepts(
  householdId: string,
  proposals: { suggestedName: string; rawLabel: string }[],
) {
  const admin = adminClient();
  const labels = [
    ...new Set(
      proposals.flatMap((proposal) => [
        normalizeFoodLabel(proposal.suggestedName),
        normalizeFoodLabel(proposal.rawLabel),
      ]),
    ),
  ].filter(Boolean);
  const aliases = new Map<string, string>();
  if (labels.length > 0) {
    const { data, error } = await admin
      .from("food_aliases")
      .select("scope, household_id, food_concept_id, normalized_alias")
      .in("normalized_alias", labels)
      .or(`scope.eq.global,household_id.eq.${householdId}`);
    if (error) throw error;
    // Global matches are deterministic; an explicitly confirmed household
    // alias takes precedence when both exist.
    for (const alias of data ?? []) {
      if (alias.scope === "global") {
        aliases.set(alias.normalized_alias, alias.food_concept_id);
      }
    }
    for (const alias of data ?? []) {
      if (alias.scope === "household" && alias.household_id === householdId) {
        aliases.set(alias.normalized_alias, alias.food_concept_id);
      }
    }
  }
  return proposals.map((proposal) =>
    aliases.get(normalizeFoodLabel(proposal.suggestedName)) ??
    aliases.get(normalizeFoodLabel(proposal.rawLabel)) ??
    resolveFoodConcept(proposal.suggestedName)?.id ??
    resolveFoodConcept(proposal.rawLabel)?.id ??
    null,
  );
}

async function processCloudAnalysis(
  analysisId: string,
  householdId: string,
): Promise<Analysis> {
  const admin = adminClient();
  const { data: telemetryOwner } = await admin
    .from("analyses")
    .select("created_by, created_at")
    .eq("id", analysisId)
    .eq("household_id", householdId)
    .maybeSingle();
  const current = await getProductionAnalysis(admin, analysisId, householdId);
  if (["needs_review", "applied", "cancelled", "expired", "failed"].includes(current.status)) {
    return current;
  }
  if (current.status !== "queued" && current.status !== "processing") {
    throw new Error("Analysis has not been queued for processing.");
  }

  let aiRuntime: HouseholdAiRuntimeConfig;
  try {
    aiRuntime = await resolveHouseholdAiRuntimeConfig(householdId);
  } catch (error) {
    if (!(error instanceof AiConfigurationError)) throw error;
    if (current.status === "queued") {
      const { error: startError } = await admin.rpc(
        "store_analysis_candidates",
        {
          p_analysis_id: analysisId,
          p_from_status: "queued",
          p_to_status: "processing",
          p_candidates: [],
          p_provider: null,
          p_model: null,
          p_prompt_version: "food-batch-v2",
          p_error_code: null,
          p_error_detail: null,
        },
      );
      if (startError) throw startError;
    }
    const { error: configError } = await admin.rpc(
      "store_analysis_candidates",
      {
        p_analysis_id: analysisId,
        p_from_status: "processing",
        p_to_status: "failed",
        p_candidates: [],
        p_provider: null,
        p_model: null,
        p_prompt_version: "food-batch-v2",
        p_error_code: "AI_PROVIDER_NOT_CONFIGURED",
        p_error_detail:
          "The household AI provider or credential is unavailable.",
      },
    );
    if (configError) throw configError;
    await admin
      .from("image_assets")
      .update({ status: "failed" })
      .eq("analysis_id", analysisId)
      .eq("household_id", householdId);
    return getProductionAnalysis(admin, analysisId, householdId);
  }

  if (current.status === "queued") {
    const { error } = await admin.rpc("store_analysis_candidates", {
      p_analysis_id: analysisId,
      p_from_status: "queued",
      p_to_status: "processing",
      p_candidates: [],
      p_provider: aiRuntime.provider,
      p_model: aiRuntime.visionModelId,
      p_prompt_version: "food-batch-v2",
      p_error_code: null,
      p_error_detail: null,
    });
    if (error) throw error;
  }

  const analyzer = createVisionAnalyzer(aiRuntime);
  let finalError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const assets = await listAnalysisAssets(admin, analysisId, householdId);
      if (assets.length < 1 || assets.length > 3) {
        throw new Error("Analysis has an invalid raw-photo set.");
      }
      const images = await Promise.all(
        assets.map(async (asset) => {
          const { data, error } = await admin.storage
            .from("raw-images")
            .download(asset.object_path);
          if (error || !data) {
            throw error ?? new Error("Raw photo is unavailable.");
          }
          const bytes = new Uint8Array(await data.arrayBuffer());
          if (
            bytes.byteLength !== asset.byte_size ||
            bytes.byteLength > 5_000_000
          ) {
            throw new Error(
              "Raw photo size does not match its verified descriptor.",
            );
          }
          return {
            index: asset.image_index,
            mimeType: "image/jpeg" as const,
            bytes,
          };
        }),
      );
      const result = await analyzer.analyze({
        analysisId,
        images,
        fileNames: assets.map((asset) => asset.original_filename),
      });
      if (result.proposals.length === 0) {
        throw new ModelRefusalError("No reviewable foods were proposed.");
      }
      const conceptIds = await resolveProposalConcepts(
        householdId,
        result.proposals,
      );
      const candidates = result.proposals.map((proposal, ordinal) => {
        const hasTrackableQuantity =
          proposal.quantityStatus !== "unknown" &&
          proposal.quantity !== null &&
          proposal.unit !== null;
        return {
          id: crypto.randomUUID(),
          ordinal,
          rawLabel: proposal.rawLabel,
          suggestedConceptId: conceptIds[ordinal],
          suggestedName: proposal.suggestedName,
          category: proposal.category,
          quantityStatus: hasTrackableQuantity
            ? proposal.quantityStatus
            : ("unknown" as const),
          quantity: hasTrackableQuantity ? proposal.quantity : null,
          unit: hasTrackableQuantity ? proposal.unit : null,
          form: proposal.form,
          location: proposal.location,
          dateLabelType: null,
          dateLabel: null,
          imageIndexes: proposal.imageIndexes,
          confidence: null,
          uncertaintyReason: proposal.uncertaintyReason,
        };
      });
      const { error: storeError } = await admin.rpc(
        "store_analysis_candidates",
        {
          p_analysis_id: analysisId,
          p_from_status: "processing",
          p_to_status: "needs_review",
          p_candidates: candidates,
          p_provider: aiRuntime.provider,
          p_model: aiRuntime.visionModelId,
          p_prompt_version: "food-batch-v2",
          p_error_code: null,
          p_error_detail: null,
        },
      );
      if (storeError) throw storeError;
      await admin
        .from("image_assets")
        .update({ status: "processed" })
        .eq("analysis_id", analysisId)
        .eq("household_id", householdId);
      return getProductionAnalysis(admin, analysisId, householdId);
    } catch (error) {
      finalError = error;
      if (error instanceof ModelRefusalError || attempt === 3) break;
      const observed = await getProductionAnalysis(
        admin,
        analysisId,
        householdId,
      );
      if (observed.status !== "processing") return observed;
      await delay(attempt * 250);
    }
  }

  const observed = await getProductionAnalysis(admin, analysisId, householdId);
  if (observed.status !== "processing") return observed;
  const refusal = finalError instanceof ModelRefusalError;
  const { error: failureStoreError } = await admin.rpc(
    "store_analysis_candidates",
    {
      p_analysis_id: analysisId,
      p_from_status: "processing",
      p_to_status: "failed",
      p_candidates: [],
      p_provider: aiRuntime.provider,
      p_model: aiRuntime.visionModelId,
      p_prompt_version: "food-batch-v2",
      p_error_code: refusal ? "VISION_NO_REVIEWABLE_ITEMS" : "VISION_ANALYSIS_FAILED",
      p_error_detail: refusal
        ? "No reviewable food proposals were returned."
        : "Vision analysis failed after three attempts.",
    },
  );
  if (failureStoreError) throw failureStoreError;
  await admin
    .from("image_assets")
    .update({ status: "failed" })
    .eq("analysis_id", analysisId)
    .eq("household_id", householdId);
  if (telemetryOwner?.created_by) {
    await recordProductEvent({
      householdId,
      userId: telemetryOwner.created_by,
      eventName: "analysis_failed",
      source: "worker",
      properties: {
        retryCount: finalError instanceof ModelRefusalError ? 0 : 2,
        durationMs: Math.max(
          0,
          Date.now() - new Date(telemetryOwner.created_at).valueOf(),
        ),
      },
      idempotencyKey: `analysis-failed:${analysisId}`,
    });
  }
  return getProductionAnalysis(admin, analysisId, householdId);
}

export async function processAnalysis(
  analysisId: string,
  householdId: string,
): Promise<Analysis> {
  if (!isDemoMode) {
    return processCloudAnalysis(analysisId, householdId);
  }

  const analysis = getDemoAnalysis(analysisId);
  setDemoAnalysis(analysisId, { status: "processing", errorCode: null });
  try {
    const analyzer = createVisionAnalyzer();
    const result = await analyzer.analyze({
      analysisId,
      images: analysis.assetIds.map((_, index) => ({
        index,
        mimeType: "image/jpeg" as const,
        bytes: new Uint8Array(),
      })),
      // Demo mode uses the names only. Production sends uploaded file bytes.
      fileNames: analysis.fileNames,
    });
    return setDemoAnalysis(analysisId, {
      status: "needs_review",
      candidates: proposalsToDemoCandidates(analysisId, result.proposals),
    });
  } catch (error) {
    setDemoAnalysis(analysisId, {
      status: "failed",
      errorCode: "ANALYSIS_FAILED",
    });
    throw error;
  }
}

export async function purgeExpiredRawImages() {
  if (isDemoMode) return { deleted: 0 };
  const startedAt = Date.now();
  const admin = adminClient();
  let deleted = 0;
  let purgeFailure: unknown;
  const telemetry = new Map<string, { householdId: string; userId: string; count: number }>();

  const workerId = `foodtopia-purge-${crypto.randomUUID()}`;
  for (let batch = 1; batch <= RAW_IMAGE_PURGE_MAX_BATCHES; batch += 1) {
    const { data: claims, error: claimError } = await admin.rpc(
      "claim_expired_image_assets",
      { p_worker_id: workerId, p_limit: RAW_IMAGE_PURGE_CLAIM_LIMIT },
    );
    if (claimError) throw claimError;
    const claimedAssets = claims ?? [];
    if (claimedAssets.length === 0) break;

    const grouped = new Map<
      string,
      Awaited<ReturnType<typeof listAnalysisAssets>>
    >();
    for (const claim of claimedAssets) {
      const key = String(claim.household_id);
      const group = grouped.get(key) ?? [];
      group.push({
        id: String(claim.asset_id),
        analysis_id: String(claim.analysis_id),
        household_id: key,
        image_index: 0,
        object_path: String(claim.object_path),
        original_filename: "retained-photo.jpg",
        content_type: "image/jpeg",
        byte_size: 1,
        status: "purge_pending",
      });
      grouped.set(key, group);
    }

    // A failure for one household must not strand the rest of this claimed
    // batch. Failed leases become claimable again after the database timeout.
    for (const [householdId, assets] of grouped) {
      try {
        const purged = await purgeRawAssets(householdId, assets);
        deleted += purged;
        const analysisId = assets[0]?.analysis_id;
        if (analysisId && purged > 0) {
          const { data: owner } = await admin
            .from("analyses")
            .select("created_by")
            .eq("id", analysisId)
            .maybeSingle();
          if (owner?.created_by) {
            telemetry.set(`retained:${analysisId}`, {
              householdId,
              userId: owner.created_by,
              count: purged,
            });
          }
        }
      } catch (error) {
        purgeFailure ??= error;
      }
    }

    if (!shouldContinuePurgeDrain(claimedAssets, batch)) break;
  }

  // Signed upload credentials can outlive the one-hour incomplete descriptor.
  // Re-delete recent tombstone paths after token expiry so a late replay cannot
  // recreate an untracked raw object.
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  for (let page = 0; page < RAW_IMAGE_TOMBSTONE_MAX_PAGES; page += 1) {
    const start = page * RAW_IMAGE_TOMBSTONE_PAGE_SIZE;
    const { data: tombstones, error: tombstoneError } = await admin
      .from("image_assets")
      .select("object_path")
      .eq("status", "deleted")
      .gte("updated_at", sixHoursAgo)
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + RAW_IMAGE_TOMBSTONE_PAGE_SIZE - 1);
    if (tombstoneError) throw tombstoneError;
    if (!tombstones || tombstones.length === 0) break;
    const { error: replayRemoveError } = await admin.storage
      .from("raw-images")
      .remove(tombstones.map((item) => item.object_path));
    if (replayRemoveError) {
      purgeFailure ??= replayRemoveError;
      break;
    }
    if (tombstones.length < RAW_IMAGE_TOMBSTONE_PAGE_SIZE) break;
  }

  for (const [key, event] of telemetry) {
    await recordProductEvent({
      householdId: event.householdId,
      userId: event.userId,
      eventName: "purge_completed",
      source: "worker",
      properties: { itemCount: event.count, durationMs: Date.now() - startedAt },
      idempotencyKey: `purge-completed:${key}`,
    });
  }
  const householdDeletions = await finalizePendingHouseholdDeletions();
  if (purgeFailure) throw purgeFailure;
  return { deleted, householdDeletions: householdDeletions.finalized };
}
