import { ZodError } from "zod";

import { ApiFault } from "@/server/http";

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  name?: unknown;
};

function errorLike(error: unknown): ErrorLike | null {
  return typeof error === "object" && error !== null ? (error as ErrorLike) : null;
}

/**
 * Converts database, Storage, and session failures into the public API error
 * envelope without exposing provider messages or SQL details.
 */
export function asApiError(
  error: unknown,
  fallback: {
    code: string;
    message: string;
    status?: number;
    retryable?: boolean;
  },
): unknown {
  if (error instanceof ApiFault || error instanceof ZodError) return error;

  const candidate = errorLike(error);
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const status = Number(candidate?.statusCode ?? candidate?.status);

  if (
    code === "authentication_required" || code === "28000" || status === 401
  ) {
    return new ApiFault(
      "AUTHENTICATION_REQUIRED",
      "Authentication is required.",
      401,
    );
  }
  if (code === "account_not_enabled") {
    return new ApiFault(
      "ACCOUNT_NOT_ENABLED",
      typeof candidate?.message === "string"
        ? candidate.message
        : "An administrator has not enabled this account yet.",
      403,
    );
  }
  if (
    code === "household_membership_required" ||
    code === "42501" ||
    status === 403
  ) {
    return new ApiFault(
      "HOUSEHOLD_ACCESS_DENIED",
      "You do not have access to this household resource.",
      403,
    );
  }
  if (code === "P0002" || status === 404) {
    return new ApiFault("RESOURCE_NOT_FOUND", "The requested resource was not found.", 404);
  }
  if (code === "23505") {
    return new ApiFault(
      "CONFLICT",
      "This request conflicts with the current server state.",
      409,
    );
  }
  if (code === "PT429" || status === 429) {
    return new ApiFault(
      "RATE_LIMITED",
      "Too many requests. Try again after the current limit window.",
      429,
      true,
    );
  }
  if (code === "40001") {
    return new ApiFault(
      "VERSION_CONFLICT",
      "This item changed on another device. Refresh before reapplying the change.",
      409,
    );
  }
  if (
    code === "22023" ||
    code === "22P02" ||
    code === "23514" ||
    status === 400
  ) {
    return new ApiFault(
      "INVALID_OPERATION",
      "The request is not valid for the resource's current state.",
      422,
    );
  }
  if (
    code === "session_lookup_failed" ||
    code.startsWith("08") ||
    code === "57014" ||
    status >= 500
  ) {
    return new ApiFault(
      fallback.code,
      fallback.message,
      fallback.status ?? 503,
      true,
    );
  }

  return new ApiFault(
    fallback.code,
    fallback.message,
    fallback.status ?? 500,
    fallback.retryable ?? true,
  );
}

export function providerApiFault(code: string, message: string) {
  return new ApiFault(code, message, 502, true);
}
