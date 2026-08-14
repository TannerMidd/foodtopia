import { type NextRequest, NextResponse } from "next/server";

import { normalizeInternalPath } from "@/lib/internal-path";
import { createAuthCallbackSupabaseClient } from "@/lib/supabase/server";

const MAX_AUTH_CODE_LENGTH = 4_096;
const MAX_TOKEN_HASH_LENGTH = 4_096;
const ADMIN_LINK_TYPE = "magiclink";

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

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const codes = requestUrl.searchParams.getAll("code");
  const tokenHashes = requestUrl.searchParams.getAll("token_hash");
  const linkTypes = requestUrl.searchParams.getAll("type");
  const code = codes[0];
  const tokenHash = tokenHashes[0];
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
      linkTypes[0] === ADMIN_LINK_TYPE,
  );

  // A callback must use exactly one exchange mechanism. Reject ambiguous
  // requests so a supplied token hash can never silently override PKCE.
  if (hasValidCode === hasValidTokenHash) {
    return signInError(request);
  }

  const completionUrl = new URL("/auth/complete", request.url);
  completionUrl.searchParams.set("next", nextPath);
  const response = preventCaching(NextResponse.redirect(completionUrl));

  try {
    const supabase = createAuthCallbackSupabaseClient(request, response);
    const { error } = hasValidCode
      ? await supabase.auth.exchangeCodeForSession(code!)
      : await supabase.auth.verifyOtp({
          token_hash: tokenHash!,
          type: ADMIN_LINK_TYPE,
        });
    if (error) return signInError(request);
    return response;
  } catch {
    return signInError(request);
  }
}
