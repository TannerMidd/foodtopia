import { type NextRequest, NextResponse } from "next/server";

import { normalizeInternalPath } from "@/lib/internal-path";
import { createAuthCallbackSupabaseClient } from "@/lib/supabase/server";

const MAX_AUTH_CODE_LENGTH = 4_096;

function signInError(request: NextRequest) {
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("authError", "invalid_link");
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = normalizeInternalPath(requestUrl.searchParams.get("next"));

  if (!code || code.length > MAX_AUTH_CODE_LENGTH) {
    return signInError(request);
  }

  const completionUrl = new URL("/auth/complete", request.url);
  completionUrl.searchParams.set("next", nextPath);
  const response = NextResponse.redirect(completionUrl);

  try {
    const supabase = createAuthCallbackSupabaseClient(request, response);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return signInError(request);
    return response;
  } catch {
    return signInError(request);
  }
}
