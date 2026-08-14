import type { NextRequest } from "next/server";
import { z } from "zod";

import { serverEnv } from "@/lib/env";
import { createResponseSupabaseClient } from "@/lib/supabase/server";
import {
  getAdminLoginConfig,
  matchesAdminUsername,
} from "@/server/auth/admin-login-config";
import { consumeAdminLoginRateLimit } from "@/server/auth/admin-login-rate-limit";
import {
  ApiFault,
  correlationId,
  errorResponse,
  json,
  parseJson,
} from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(256),
}).strict();

function invalidCredentials() {
  return new ApiFault(
    "INVALID_CREDENTIALS",
    "Invalid username or password.",
    401,
  );
}

function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  let expectedOrigin: string;
  try {
    const configured = new URL(serverEnv.appUrl);
    if (configured.protocol !== "https:" && configured.hostname !== "localhost") {
      throw new Error("Unsupported application origin");
    }
    expectedOrigin = configured.origin;
  } catch {
    throw new ApiFault(
      "AUTH_CONFIGURATION_ERROR",
      "Administrator sign-in is not configured.",
      503,
      true,
    );
  }
  if (!origin || origin !== expectedOrigin) {
    throw new ApiFault(
      "INVALID_ORIGIN",
      "The sign-in request could not be accepted.",
      403,
    );
  }
}

function rateLimitedResponse(id: string, retryAfterSeconds: number) {
  const response = errorResponse(
    new ApiFault(
      "RATE_LIMITED",
      "Too many sign-in attempts. Try again later.",
      429,
      true,
    ),
    id,
  );
  response.headers.set("retry-after", String(Math.max(retryAfterSeconds, 1)));
  return response;
}

export async function POST(request: NextRequest) {
  const id = correlationId(request);
  try {
    assertSameOrigin(request);
    const retryAfterSeconds = await consumeAdminLoginRateLimit();
    if (retryAfterSeconds !== null) {
      return rateLimitedResponse(id, retryAfterSeconds);
    }
    const input = await parseJson(request, requestSchema);
    const config = getAdminLoginConfig();
    if (!config || !matchesAdminUsername(input.username, config.username)) {
      throw invalidCredentials();
    }

    const response = json({ authenticated: true });
    const supabase = createResponseSupabaseClient(request, response);
    const { error } = await supabase.auth.signInWithPassword({
      email: config.email,
      password: input.password,
    });
    if (error) {
      const status = typeof error === "object" && error !== null &&
        "status" in error && error.status === 429
        ? 429
        : 401;
      if (status === 429) {
        return rateLimitedResponse(id, 60);
      }
      throw invalidCredentials();
    }
    return response;
  } catch (error) {
    return errorResponse(error, id);
  }
}
