import { z } from "zod";

import type { AnalysisCandidate } from "@/contracts/domain";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ApiFault } from "@/server/http";

import { mapAnalysis } from "./mappers";

type UserClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;
type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

const adminClient = (): AdminClient => createAdminSupabaseClient();

const assetSchema = z.object({
  id: z.uuid(),
  analysis_id: z.uuid(),
  household_id: z.uuid(),
  image_index: z.number().int().min(0).max(2),
  object_path: z.string().min(1),
  original_filename: z.string().min(1),
  content_type: z.literal("image/jpeg"),
  byte_size: z.number().int().positive().max(5_000_000),
  status: z.string(),
});

export type RawImageAsset = z.infer<typeof assetSchema>;

const analysisColumns =
  "id, household_id, status, error_code, created_at, updated_at, version";
const candidateColumns =
  "id, analysis_id, raw_label, suggested_food_concept_id, suggested_name, category, quantity_status, quantity, unit, form, location, image_indexes, uncertainty_reason, review_status, accepted";
const assetColumns =
  "id, analysis_id, household_id, image_index, object_path, original_filename, content_type, byte_size, status";

function storageMetadata(value: unknown) {
  const info = value as {
    size?: unknown;
    contentType?: unknown;
    metadata?: { size?: unknown; mimetype?: unknown };
  };
  const size = Number(info.size ?? info.metadata?.size);
  const contentType = info.contentType ?? info.metadata?.mimetype;
  return {
    size: Number.isFinite(size) ? size : null,
    contentType: typeof contentType === "string" ? contentType.toLowerCase() : null,
  };
}

export async function getProductionAnalysis(
  client: UserClient | AdminClient,
  analysisId: string,
  householdId: string,
) {
  const [{ data: analysis, error: analysisError }, { data: candidates, error: candidateError }] =
    await Promise.all([
      client
        .from("analyses")
        .select(analysisColumns)
        .eq("id", analysisId)
        .eq("household_id", householdId)
        .maybeSingle(),
      client
        .from("analysis_candidates")
        .select(candidateColumns)
        .eq("analysis_id", analysisId)
        .eq("household_id", householdId)
        .order("ordinal", { ascending: true }),
    ]);
  if (analysisError) throw analysisError;
  if (candidateError) throw candidateError;
  if (!analysis) {
    throw new ApiFault("ANALYSIS_NOT_FOUND", "The scan was not found.", 404);
  }
  return mapAnalysis(analysis, candidates ?? []);
}

export async function listUnfinishedProductionAnalyses(
  client: UserClient,
  householdId: string,
) {
  const { data: analyses, error } = await client
    .from("analyses")
    .select("id, status, updated_at")
    .eq("household_id", householdId)
    .in("status", ["queued", "processing", "needs_review", "failed"])
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  const ids = (analyses ?? []).map((analysis) => analysis.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: candidates, error: candidateError } = await client
      .from("analysis_candidates")
      .select("analysis_id")
      .eq("household_id", householdId)
      .in("analysis_id", ids);
    if (candidateError) throw candidateError;
    for (const candidate of candidates ?? []) {
      counts.set(
        candidate.analysis_id,
        (counts.get(candidate.analysis_id) ?? 0) + 1,
      );
    }
  }
  return (analyses ?? []).map((analysis) => ({
    id: analysis.id,
    status: analysis.status,
    candidateCount: counts.get(analysis.id) ?? 0,
    updatedAt: analysis.updated_at,
  }));
}

export async function createProductionAnalysis(
  client: UserClient,
  session: { householdId: string; userId: string },
  files: { name: string; contentType: "image/jpeg"; size: number }[],
) {
  const analysisId = crypto.randomUUID();
  const requestedAssets = files.map((file, imageIndex) => ({
    id: crypto.randomUUID(),
    imageIndex,
    originalFilename: file.name,
    contentType: file.contentType,
    byteSize: file.size,
    checksumSha256: null,
  }));
  const { data, error } = await client.rpc("create_analysis", {
    p_analysis_id: analysisId,
    p_assets: requestedAssets,
    p_idempotency_key: analysisId,
  });
  if (error) throw error;

  const responseSchema = z.object({
    analysisId: z.uuid(),
    assets: z
      .array(
        z.object({
          assetId: z.uuid(),
          imageIndex: z.number().int(),
          objectPath: z.string().min(1),
          contentType: z.literal("image/jpeg"),
          byteSize: z.number().int().positive().max(5_000_000),
        }),
      )
      .min(1)
      .max(3),
  });
  const created = responseSchema.parse(data);
  if (created.analysisId !== analysisId || created.assets.length !== files.length) {
    throw new ApiFault(
      "ANALYSIS_CREATE_INVALID",
      "The private upload descriptors could not be verified.",
      502,
      true,
    );
  }

  try {
    const signed = await Promise.all(
      created.assets.map(async (asset) => {
        const expectedPrefix = `${session.householdId}/${session.userId}/${analysisId}/`;
        if (!asset.objectPath.startsWith(expectedPrefix)) {
          throw new ApiFault(
            "UPLOAD_PATH_INVALID",
            "The private upload path could not be verified.",
            502,
            true,
          );
        }
        const { data: signedUpload, error: signedError } = await client.storage
          .from("raw-images")
          .createSignedUploadUrl(asset.objectPath, { upsert: false });
        if (signedError) throw signedError;
        return {
          assetId: asset.assetId,
          objectPath: asset.objectPath,
          token: signedUpload.token,
          signedUrl: signedUpload.signedUrl,
        };
      }),
    );
    return { analysisId, uploadMode: "signed" as const, uploads: signed };
  } catch (signingError) {
    // Relational descriptors must not linger when upload authorization could
    // not be issued. The cancel RPC also makes any partial object purgeable.
    await client.rpc("cancel_analysis", { p_analysis_id: analysisId });
    throw signingError;
  }
}

export async function listAnalysisAssets(
  client: UserClient | AdminClient,
  analysisId: string,
  householdId: string,
): Promise<RawImageAsset[]> {
  const { data, error } = await client
    .from("image_assets")
    .select(assetColumns)
    .eq("analysis_id", analysisId)
    .eq("household_id", householdId)
    .order("image_index", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((value: unknown) => assetSchema.parse(value));
}

export async function verifyCompletedUploads(
  client: UserClient,
  analysisId: string,
  householdId: string,
  assetIds: string[],
) {
  const assets = await listAnalysisAssets(client, analysisId, householdId);
  // Storage SELECT is intentionally unavailable to a pending browser asset.
  // The caller already proved the tenant through the user-scoped relation;
  // use the server-only client solely to inspect the exact canonical paths.
  const storage = adminClient().storage.from("raw-images");
  const expectedIds = [...assets.map((asset) => asset.id)].sort();
  const submittedIds = [...new Set(assetIds)].sort();
  if (
    expectedIds.length !== submittedIds.length ||
    expectedIds.some((id, index) => id !== submittedIds[index])
  ) {
    throw new ApiFault(
      "UPLOAD_SET_MISMATCH",
      "The completed uploads do not match this scan.",
      422,
    );
  }

  await Promise.all(
    assets.map(async (asset) => {
      const { data, error } = await storage.info(asset.object_path);
      if (error || !data) {
        throw new ApiFault(
          "UPLOAD_INCOMPLETE",
          "One or more photos have not finished uploading.",
          409,
          true,
        );
      }
      const metadata = storageMetadata(data);
      if (
        metadata.size !== asset.byte_size ||
        metadata.size > 5_000_000 ||
        metadata.contentType !== "image/jpeg"
      ) {
        throw new ApiFault(
          "UPLOAD_METADATA_MISMATCH",
          "An uploaded photo did not match its declared JPEG size and type.",
          422,
        );
      }
    }),
  );
  return assets;
}

export async function markAnalysisComplete(
  client: UserClient,
  analysisId: string,
  assetIds: string[],
) {
  const { data, error } = await client.rpc("complete_analysis", {
    p_analysis_id: analysisId,
    p_asset_ids: assetIds,
  });
  if (error) throw error;
  return z
    .object({ analysisId: z.uuid(), status: z.string(), replayed: z.boolean() })
    .parse(data);
}

async function markAssetsPurgePending(
  admin: AdminClient,
  householdId: string,
  assets: RawImageAsset[],
) {
  if (assets.length === 0) return;
  const { error } = await admin
    .from("image_assets")
    .update({ status: "purge_pending" })
    .eq("household_id", householdId)
    .in(
      "id",
      assets.map((asset) => asset.id),
    );
  if (error) throw error;
}

/** Delete first from the private bucket, then commit relational tombstones. */
export async function purgeRawAssets(
  householdId: string,
  assets: RawImageAsset[],
) {
  if (assets.length === 0) return 0;
  const admin = adminClient();
  if (assets.some((asset) => asset.household_id !== householdId)) {
    throw new ApiFault(
      "PURGE_SCOPE_INVALID",
      "The raw-photo purge scope could not be verified.",
      500,
    );
  }
  await markAssetsPurgePending(admin, householdId, assets);
  const { error: removeError } = await admin.storage
    .from("raw-images")
    .remove(assets.map((asset) => asset.object_path));
  if (removeError) throw removeError;
  const { data, error } = await admin.rpc("complete_raw_image_purge", {
    p_asset_ids: assets.map((asset) => asset.id),
  });
  if (error) throw error;
  return typeof data === "number" ? data : assets.length;
}

export async function cancelProductionAnalysis(
  client: UserClient,
  analysisId: string,
  householdId: string,
) {
  const assets = await listAnalysisAssets(client, analysisId, householdId);
  const { error } = await client.rpc("cancel_analysis", {
    p_analysis_id: analysisId,
  });
  if (error) throw error;
  await purgeRawAssets(householdId, assets);
  return getProductionAnalysis(client, analysisId, householdId);
}

export async function applyProductionAnalysis(
  client: UserClient,
  analysisId: string,
  householdId: string,
  candidates: AnalysisCandidate[],
) {
  if (
    candidates.some(
      (candidate) =>
        candidate.quantityStatus !== "unknown" && candidate.unit === null,
    )
  ) {
    throw new ApiFault(
      "CANDIDATE_UNIT_REQUIRED",
      "A unit is required when an accepted food has a tracked quantity.",
      422,
    );
  }
  const assets = await listAnalysisAssets(client, analysisId, householdId);
  const { data: analysis, error: analysisError } = await client
    .from("analyses")
    .select("version")
    .eq("id", analysisId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (analysisError) throw analysisError;
  if (!analysis) {
    throw new ApiFault("ANALYSIS_NOT_FOUND", "The scan was not found.", 404);
  }

  const { error } = await client.rpc("apply_analysis_candidates", {
    p_analysis_id: analysisId,
    p_expected_version: analysis.version,
    p_candidates: candidates.map((candidate) => ({
      id: candidate.id,
      rawLabel: candidate.rawLabel,
      suggestedConceptId: candidate.suggestedConceptId,
      suggestedName: candidate.suggestedName,
      category: candidate.category,
      quantityStatus: candidate.quantityStatus,
      quantity: candidate.quantity,
      unit: candidate.unit,
      form: candidate.form,
      location: candidate.location,
      imageIndexes: candidate.imageIndexes,
      uncertaintyReason: candidate.uncertaintyReason,
    })),
  });
  if (error) throw error;
  await purgeRawAssets(householdId, assets);
  return getProductionAnalysis(client, analysisId, householdId);
}
