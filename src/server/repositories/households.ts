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

export async function deleteCurrentHousehold(
  client: UserClient,
  expectedHouseholdId: string | null,
) {
  const { data, error } = await client.rpc("request_household_deletion");
  if (error) throw error;
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
    if ((finalizeError as { code?: string }).code === "55000") {
      return {
        householdId: manifest.householdId,
        status: "deletion_pending" as const,
        finalizeAfter,
      };
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
    if (assets && assets.length > 0) {
      const { error: removeError } = await admin.storage
        .from("raw-images")
        .remove(
          assets.map((asset: { object_path: string }) => asset.object_path),
        );
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
