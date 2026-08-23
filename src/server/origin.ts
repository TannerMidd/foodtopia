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
      "The application origin is not configured for authenticated requests.",
      503,
      true,
    );
  }
  if (!origin || origin !== expectedOrigin) {
    throw new ApiFault(
      "INVALID_ORIGIN",
      "The request could not be accepted.",
      403,
    );
  }
}
