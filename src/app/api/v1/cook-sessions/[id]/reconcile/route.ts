import { cookReconciliationRequestSchema } from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  applyDemoCommand,
  listDemoInventory,
  requireDemoCookSession,
} from "@/server/demo/store";
import {
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { reconcileProductionCookSession } from "@/server/repositories/cooking";
import { asApiError } from "@/server/repositories/errors";
import { enforceRateLimit } from "@/server/repositories/rate-limit";
import { recordProductEvent } from "@/server/repositories/telemetry";
import { buildDemoCookCommand } from "@/server/services/demo-cook-reconciliation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const correlation = correlationId(request);
  try {
    const input = await parseJson(request, cookReconciliationRequestSchema);
    const { id } = await params;
    if (!isDemoMode) {
      const session = await requireHouseholdSession();
      const client = await createServerSupabaseClient();
      await enforceRateLimit(client, "cook_reconcile", 60, 60 * 60);
      const reconciled = await reconcileProductionCookSession(
        client,
        id,
        input.changes,
      );
      await recordProductEvent({
        householdId: session.householdId,
        userId: session.userId,
        eventName: "cook_reconciled",
        properties: { itemCount: input.changes.length },
        idempotencyKey: `cook-reconciled:${id}`,
      });
      return json(reconciled);
    }
    requireDemoCookSession(id);
    const lots = new Map(listDemoInventory().map((lot) => [lot.id, lot]));
    const results = input.changes.flatMap((change) => {
      const command = buildDemoCookCommand(
        change,
        lots.get(change.lotId),
        crypto.randomUUID(),
      );
      return command ? [applyDemoCommand(command)] : [];
    });
    return json({ cookSessionId: id, applied: results.map((item) => item.lot) });
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "COOK_RECONCILIATION_FAILED",
        message: "The confirmed inventory changes could not be applied.",
      }),
      correlation,
    );
  }
}
