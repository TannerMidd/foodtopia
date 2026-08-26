import type { RecipeAssessment } from "@/contracts/domain";
import {
  getOfflineDb,
  type CookSessionRecord,
} from "@/lib/offline/db";

/**
 * Durable replacement for the former sessionStorage cache. The assessment and
 * the server cook session id survive tab closes and restarts, so a cooking
 * tablet can pick the recipe back up where it left off. Rows are cleared with
 * every household rebind in lib/offline/db.ts, keeping tenants isolated.
 */

export async function saveRecipeAssessment(assessment: RecipeAssessment) {
  try {
    const db = getOfflineDb();
    const existing = await db.cookSessions.get(assessment.recipe.slug);
    const record: CookSessionRecord = {
      slug: assessment.recipe.slug,
      assessment,
      sessionId: existing?.sessionId ?? null,
      savedAt: new Date().toISOString(),
    };
    await db.cookSessions.put(record);
  } catch {
    // A blocked or unavailable store should not block recipe navigation; the
    // detail screen still renders and only offline durability is lost.
  }
}

export async function loadRecipeAssessment(slug: string): Promise<RecipeAssessment | null> {
  try {
    return (await getOfflineDb().cookSessions.get(slug))?.assessment ?? null;
  } catch {
    return null;
  }
}

export async function saveCookSession(slug: string, sessionId: string) {
  const db = getOfflineDb();
  const existing = await db.cookSessions.get(slug);
  if (!existing) return;
  await db.cookSessions.put({ ...existing, sessionId, savedAt: new Date().toISOString() });
}

export async function loadCookSession(slug: string): Promise<string | null> {
  try {
    return (await getOfflineDb().cookSessions.get(slug))?.sessionId ?? null;
  } catch {
    return null;
  }
}

/** Called once reconciliation settles so a finished session cannot be replayed. */
export async function clearCookingContext(slug: string) {
  try {
    await getOfflineDb().cookSessions.delete(slug);
  } catch {
    // Best-effort cleanup only.
  }
}
