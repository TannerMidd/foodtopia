import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

import { isDemoMode } from "@/lib/env";

export class ApiFault extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiFault";
  }
}

const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const correlationId = (request?: Request) => {
  const supplied = request?.headers.get("x-correlation-id")?.trim();
  return supplied && SAFE_CORRELATION_ID.test(supplied)
    ? supplied
    : crypto.randomUUID();
};

export function json<T>(data: T, init?: ResponseInit) {
  const response = NextResponse.json(data, init);
  response.headers.set("cache-control", "no-store");
  if (isDemoMode) {
    response.headers.set("x-foodtopia-mode", "demo");
  }
  return response;
}

export async function parseJson<T>(request: Request, schema: ZodType<T>) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiFault("INVALID_JSON", "The request body is not valid JSON.", 400);
  }
  return schema.parse(body);
}

export function errorResponse(error: unknown, id: string) {
  if (error instanceof ApiFault) {
    return json(
      {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        correlationId: id,
        ...(error.details === undefined ? {} : { current: error.details }),
      },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return json(
      {
        code: "VALIDATION_ERROR",
        message: "Some submitted fields are invalid.",
        retryable: false,
        correlationId: id,
      },
      { status: 422 },
    );
  }

  const safeError = error instanceof Error
    ? { name: error.name.slice(0, 80) }
    : { name: "UnknownError" };
  console.error("Unhandled API error", { correlationId: id, ...safeError });
  return json(
    {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
      retryable: true,
      correlationId: id,
    },
    { status: 500 },
  );
}
