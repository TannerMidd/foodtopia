export const RAW_IMAGE_PURGE_CRON = "*/15 * * * *";
export const RAW_IMAGE_PURGE_CLAIM_LIMIT = 100;
export const RAW_IMAGE_PURGE_MAX_BATCHES = 5;
export const RAW_IMAGE_TOMBSTONE_PAGE_SIZE = 500;
export const RAW_IMAGE_TOMBSTONE_MAX_PAGES = 5;

type PurgeClaim = Readonly<{ analysis_id: unknown }>;

/**
 * A claim limit applies to analyses, while the RPC returns one row per asset.
 * Count distinct analyses before deciding whether another bounded drain batch
 * may contain work.
 */
export function shouldContinuePurgeDrain(
  claims: readonly PurgeClaim[],
  completedBatches: number,
): boolean {
  if (completedBatches >= RAW_IMAGE_PURGE_MAX_BATCHES) return false;
  const analysisIds = new Set(
    claims.map((claim) => String(claim.analysis_id)),
  );
  return analysisIds.size >= RAW_IMAGE_PURGE_CLAIM_LIMIT;
}
