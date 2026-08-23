import { type NextRequest, NextResponse } from "next/server";

import { normalizeInternalPath } from "@/lib/internal-path";
import { createAuthCallbackSupabaseClient } from "@/lib/supabase/server";

const MAX_AUTH_CODE_LENGTH = 4_096;
const MAX_TOKEN_HASH_LENGTH = 4_096;
const SAFE_ERROR_CODE = /^[a-z0-9_]{1,80}$/i;
const TOKEN_HASH_LINK_TYPES = ["email", "signup", "invite", "magiclink"] as const;

type TokenHashLinkType = (typeof TOKEN_HASH_LINK_TYPES)[number];
type AuthMechanism = "code" | "token_hash" | "invalid";

export const dynamic = "force-dynamic";

function preventCaching(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function signInError(request: NextRequest) {
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("authError", "invalid_link");
  return preventCaching(NextResponse.redirect(url));
}

function emailConfirmed(request: NextRequest) {
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("emailConfirmed", "1");
  return preventCaching(NextResponse.redirect(url));
}

function tokenHashLinkType(value: string | undefined): TokenHashLinkType | null {
  return TOKEN_HASH_LINK_TYPES.find((candidate) => candidate === value) ?? null;
}

function providerErrorDetails(error: unknown) {
  if (typeof error !== "object" || error === null) return {};
  const candidate = error as { code?: unknown; status?: unknown };
  const code = typeof candidate.code === "string" && SAFE_ERROR_CODE.test(candidate.code)
    ? candidate.code
    : undefined;
  const status = typeof candidate.status === "number" &&
      Number.isInteger(candidate.status) &&
      candidate.status >= 400 &&
      candidate.status <= 599
    ? candidate.status
    : undefined;
  return {
    ...(code === undefined ? {} : { code }),
    ...(status === undefined ? {} : { status }),
  };
}

function reportAuthFailure({
  mechanism,
  verificationType,
  phase,
  error,
}: {
  mechanism: AuthMechanism;
  verificationType: TokenHashLinkType | "unsupported" | null;
  phase: "validation" | "exchange" | "exception";
  error?: unknown;
}) {
  console.error("Auth callback failed", {
    mechanism,
    verificationType,
    phase,
    ...providerErrorDetails(error),
  });
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const codes = requestUrl.searchParams.getAll("code");
  const tokenHashes = requestUrl.searchParams.getAll("token_hash");
  const linkTypes = requestUrl.searchParams.getAll("type");
  const code = codes[0];
  const tokenHash = tokenHashes[0];
  const requestedLinkType = linkTypes[0];
  const supportedLinkType = tokenHashLinkType(requestedLinkType);
  const nextPath = normalizeInternalPath(requestUrl.searchParams.get("next"));

  const hasValidCode = Boolean(
    codes.length === 1 &&
      tokenHashes.length === 0 &&
      linkTypes.length === 0 &&
      code &&
      code.length <= MAX_AUTH_CODE_LENGTH,
  );
  const hasValidTokenHash = Boolean(
    codes.length === 0 &&
      tokenHashes.length === 1 &&
      linkTypes.length === 1 &&
      tokenHash &&
      tokenHash.length <= MAX_TOKEN_HASH_LENGTH &&
      supportedLinkType,
  );

  // A callback must use exactly one exchange mechanism. Reject ambiguous
  // requests so a supplied token hash can never silently override PKCE.
  if (hasValidCode === hasValidTokenHash) {
    reportAuthFailure({
      mechanism: "invalid",
      verificationType: supportedLinkType ?? (requestedLinkType ? "unsupported" : null),
      phase: "validation",
    });
    return signInError(request);
  }

  const completionUrl = new URL("/auth/complete", request.url);
  completionUrl.searchParams.set("next", nextPath);
  const response = preventCaching(NextResponse.redirect(completionUrl));

  try {
    const supabase = createAuthCallbackSupabaseClient(request, response);
    const mechanism: Exclude<AuthMechanism, "invalid"> = hasValidCode ? "code" : "token_hash";
    const { error } = hasValidCode
      ? await supabase.auth.exchangeCodeForSession(code!)
      : await supabase.auth.verifyOtp({
          token_hash: tokenHash!,
          type: supportedLinkType!,
        });
    if (error) {
      // The default hosted Supabase confirmation email verifies the address
      // before redirecting here. If the link opens in another browser, that
      // browser cannot finish the optional PKCE session exchange because it
      // does not have the original verifier. Confirmation still succeeded,
      // so send the user to the normal password sign-in instead of presenting
      // a broken-link error.
      if (
        hasValidCode &&
        providerErrorDetails(error).code === "pkce_code_verifier_not_found"
      ) {
        return emailConfirmed(request);
      }
      reportAuthFailure({
        mechanism,
        verificationType: supportedLinkType,
        phase: "exchange",
        error,
      });
      return signInError(request);
    }
    return response;
  } catch (error) {
    reportAuthFailure({
      mechanism: hasValidCode ? "code" : "token_hash",
      verificationType: supportedLinkType,
      phase: "exception",
      error,
    });
    return signInError(request);
  }
}
