import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ApiFault } from "@/server/http";

type UserClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export async function getCurrentHousehold(
  client: UserClient,
  session: { householdId: string; role: "owner" | "member" },
) {
  const { data, error } = await client
    .from("households")
    .select("id, name")
    .eq("id", session.householdId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new ApiFault(
      "HOUSEHOLD_NOT_FOUND",
      "The current household could not be found.",
      404,
    );
  }
  return {
    householdId: data.id,
    name: data.name,
    role: session.role,
  };
}

const deletionManifestSchema = z.object({
  householdId: z.uuid(),
  bucketId: z.literal("raw-images"),
  objectPaths: z.array(z.string()),
  status: z.literal("deletion_pending"),
  finalizeAfter: z.iso.datetime(),
  replayed: z.boolean(),
});

const HOUSEHOLD_DELETE_NOT_OWNER = new ApiFault(
  "HOUSEHOLD_DELETE_NOT_OWNER",
  "Only the household owner can complete the household deletion.",
  403,
);

export async function deleteCurrentHousehold(
  client: UserClient,
  expectedHouseholdId: string | null,
) {
  const { data, error } = await client.rpc("request_household_deletion");
  if (error) {
    if ((error as { code?: unknown }).code === "42501") {
      throw HOUSEHOLD_DELETE_NOT_OWNER;
    }
    throw error;
  }
  const manifest = deletionManifestSchema.parse(data);
  if (expectedHouseholdId && manifest.householdId !== expectedHouseholdId) {
    throw new ApiFault(
      "HOUSEHOLD_DELETE_SCOPE_INVALID",
      "The household deletion scope could not be verified.",
      500,
    );
  }
  const prefix = `${manifest.householdId}/`;
  if (manifest.objectPaths.some((path) => !path.startsWith(prefix))) {
    throw new ApiFault(
      "HOUSEHOLD_DELETE_PATH_INVALID",
      "The household photo-deletion manifest could not be verified.",
      500,
    );
  }

  const admin = createAdminSupabaseClient();
  const finalizeAfter = manifest.finalizeAfter;
  if (manifest.objectPaths.length > 0) {
    const { error: removeError } = await admin.storage
      .from(manifest.bucketId)
      .remove(manifest.objectPaths);
    if (removeError) {
      throw new ApiFault(
        "HOUSEHOLD_STORAGE_DELETE_FAILED",
        "The household is quarantined, but its private photos could not all be removed. Retry later.",
        503,
        true,
      );
    }
  }

  if (Date.now() < new Date(finalizeAfter).valueOf()) {
    return {
      householdId: manifest.householdId,
      status: "deletion_pending" as const,
      finalizeAfter,
    };
  }

  // The service-only finalizer independently scans the bucket prefix and
  // enforces signed-upload-token expiry before deleting relational data.
  const { data: finalized, error: finalizeError } = await admin.rpc(
    "finalize_household_deletion",
    { p_household_id: manifest.householdId },
  );
  if (finalizeError) {
    const finalizeCode = (finalizeError as { code?: string }).code;
    if (finalizeCode === "55000") {
      return {
        householdId: manifest.householdId,
        status: "deletion_pending" as const,
        finalizeAfter,
      };
    }
    // The finalizer refuses when deletion was not owner-requested (e.g. a
    // member raced an idempotent retry after quarantine). Surface that as an
    // actionable owner-required fault instead of a retryable failure.
    if (finalizeCode === "42501") {
      throw HOUSEHOLD_DELETE_NOT_OWNER;
    }
    throw finalizeError;
  }
  const result = z
    .object({
      householdId: z.uuid(),
      deleted: z.boolean(),
      replayed: z.boolean(),
    })
    .parse(finalized);
  if (!result.deleted) {
    throw new ApiFault(
      "HOUSEHOLD_DELETE_INCOMPLETE",
      "The household deletion has not finished. Retry shortly.",
      503,
      true,
    );
  }
  return { householdId: result.householdId, deleted: true as const };
}

/**
 * Uploads nest as `<household>/<user>/<analysis>/<asset>`, so a healthy
 * household never grows pseudo-folders past five path segments. Deeper
 * nesting means something wrote outside the app's scheme and must fail
 * loudly instead of silently leaving objects behind.
 */
const MAX_HOUSEHOLD_STORAGE_DEPTH = 5;

/**
 * Enumerates every Storage object under a household's raw-images prefix using
 * the typed Storage list API (the generated Database type only exposes the
 * public schema). Recurses through folder pseudo-entries (`id === null`) so
 * nested orphaned uploads are found too, mirroring the storage.objects prefix
 * scan performed by finalize_household_deletion.
 */
async function collectRawImageObjects(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  prefix: string,
  depth: number,
  paths: string[],
): Promise<void> {
  if (depth > MAX_HOUSEHOLD_STORAGE_DEPTH) {
    throw new Error(
      `raw-images nesting exceeds ${MAX_HOUSEHOLD_STORAGE_DEPTH} path segments under "${prefix}"`,
    );
  }
  const pageSize = 1000;
  let fetched = 0;
  for (;;) {
    const { data, error } = await admin.storage
      .from("raw-images")
      .list(prefix, {
        limit: pageSize,
        offset: fetched,
        sortBy: { column: "name", order: "asc" },
      });
    if (error) throw error;
    if (!data || data.length === 0) break;
    fetched += data.length;
    for (const entry of data) {
      // Folder pseudo-entries carry no storage id and cannot be removed;
      // descend into them so nested objects stay reachable. Their names are
      // reported with a trailing slash, which must not leak into prefixes or
      // object paths.
      const entryName = entry.name.replace(/\/+$/, "");
      const entryPath = `${prefix}/${entryName}`;
      if (entry.id === null) {
        await collectRawImageObjects(admin, entryPath, depth + 1, paths);
      } else {
        paths.push(entryPath);
      }
    }
    if (data.length < pageSize) break;
  }
}

async function listHouseholdStorageObjects(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  householdId: string,
): Promise<string[]> {
  const paths: string[] = [];
  await collectRawImageObjects(admin, householdId, 1, paths);
  return paths;
}

/** Scheduled worker continuation for households quarantined past token expiry. */
export async function finalizePendingHouseholdDeletions(limit = 25) {
  const admin = createAdminSupabaseClient();
  const cutoff = new Date(Date.now() - 135 * 60 * 1000).toISOString();
  const { data: households, error } = await admin
    .from("households")
    .select("id")
    .not("deletion_requested_at", "is", null)
    .lte("deletion_requested_at", cutoff)
    .limit(limit);
  if (error) throw error;
  let finalized = 0;
  for (const household of households ?? []) {
    const { data: assets, error: assetError } = await admin
      .from("image_assets")
      .select("object_path")
      .eq("household_id", household.id);
    if (assetError) throw assetError;

    // Mirror the request_household_deletion manifest union: relational paths
    // plus every remaining object under the household prefix. Without the
    // prefix scan, one orphaned upload makes finalize_household_deletion raise
    // forever and the quarantined tenant is never erased.
    const objectPaths = [
      ...new Set([
        ...(assets ?? []).map(
          (asset: { object_path: string }) => asset.object_path,
        ),
        ...(await listHouseholdStorageObjects(admin, household.id)),
      ]),
    ];
    if (objectPaths.length > 0) {
      const { error: removeError } = await admin.storage
        .from("raw-images")
        .remove(objectPaths);
      if (removeError) continue;
    }
    const { data: result, error: finalizeError } = await admin.rpc(
      "finalize_household_deletion",
      { p_household_id: household.id },
    );
    if (finalizeError) continue;
    if (
      result &&
      typeof result === "object" &&
      (result as { deleted?: unknown }).deleted === true
    ) {
      finalized += 1;
    }
  }
  return { finalized };
}
