import "server-only";

import type { NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { ApiFault } from "@/server/http";

/**
 * State-changing browser endpoints accept only same-origin requests whose
 * origin equals the configured application URL. This complements cookie
 * authentication against cross-site form posts.
 */
export function assertSameOrigin(request: NextRequest) {
  const rawAppUrl = serverEnv.appUrl;
  let expectedOrigin: string | null = null;
  if (rawAppUrl) {
    try {
      const configured = new URL(rawAppUrl);
      if (
        configured.protocol === "https:" ||
        configured.hostname === "localhost"
      ) {
        expectedOrigin = configured.origin;
      }
    } catch {
      // Fall through: an unparseable app URL must disable mutations loudly.
    }
  }
  if (!expectedOrigin) {
    throw new ApiFault(
      "AUTH_CONFIGURATION_ERROR",
      "NEXT_PUBLIC_APP_URL is missing or invalid; authenticated requests are rejected.",
      503,
      true,
    );
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    console.warn("Same-origin check rejected a request without an Origin header", {
      path: request.nextUrl.pathname,
    });
  }
  if (!origin || origin !== expectedOrigin) {
    throw new ApiFault(
      "INVALID_ORIGIN",
      "The request could not be accepted.",
      403,
    );
  }
}
