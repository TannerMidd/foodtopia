import {
  inviteCreateRequestSchema,
  inviteCreateResponseSchema,
} from "@/contracts/api";
import { randomBytes } from "node:crypto";

import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import { enforceRateLimit } from "@/server/repositories/rate-limit";
import { recordProductEvent } from "@/server/repositories/telemetry";

function invitationOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  let origin: URL;
  try {
    origin = new URL(configured || request.url);
  } catch {
    throw new ApiFault(
      "APP_ORIGIN_INVALID",
      "Invitation delivery is not configured.",
      503,
      true,
    );
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    (process.env.NODE_ENV === "production" && origin.protocol !== "https:")
  ) {
    throw new ApiFault(
      "APP_ORIGIN_INVALID",
      "Invitation delivery requires a secure application URL.",
      503,
      true,
    );
  }
  return origin.origin;
}

export async function POST(request: Request) {
  const correlation = correlationId(request);
  try {
    const { email } = await parseJson(request, inviteCreateRequestSchema);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (!isDemoMode) {
      const session = await requireHouseholdSession();
      const client = await createServerSupabaseClient();
      await enforceRateLimit(client, "invite_create", 20, 24 * 60 * 60);
      const normalizedEmail = email.trim().toLowerCase();
      const rawToken = randomBytes(32).toString("base64url");
      const { data: inviteId, error: createError } = await client.rpc(
        "create_household_invite",
        {
          p_email: normalizedEmail,
          p_token: rawToken,
          p_expires_at: expiresAt.toISOString(),
        },
      );
      if (createError) throw createError;

      const nextPath = `/invite/${encodeURIComponent(rawToken)}`;
      const callback = new URL("/auth/callback", invitationOrigin(request));
      callback.searchParams.set("next", nextPath);
      const redirectTo = callback.toString();
      const admin = createAdminSupabaseClient();
      const { error: deliveryError } = await admin.auth.admin.inviteUserByEmail(
        normalizedEmail,
        { redirectTo },
      );
      if (deliveryError) {
        await client.rpc("revoke_household_invite", {
          p_invite_id: inviteId,
        });
        throw new ApiFault(
          "INVITE_DELIVERY_FAILED",
          "The household invite could not be delivered. Existing accounts may need a beta-operator resend.",
          502,
          true,
        );
      }
      await recordProductEvent({
        householdId: session.householdId,
        userId: session.userId,
        eventName: "invite_created",
        idempotencyKey: `invite-created:${String(inviteId)}`,
      });
      return json(
        inviteCreateResponseSchema.parse({
          inviteId,
          email: normalizedEmail,
          expiresAt: expiresAt.toISOString(),
          delivery: "queued",
        }),
        { status: 201 },
      );
    }
    return json(
      inviteCreateResponseSchema.parse({
        inviteId: crypto.randomUUID(),
        email: email.trim().toLowerCase(),
        expiresAt: expiresAt.toISOString(),
        delivery: "demo",
      }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "HOUSEHOLD_INVITE_FAILED",
        message: "The household invite could not be created.",
      }),
      correlation,
    );
  }
}
