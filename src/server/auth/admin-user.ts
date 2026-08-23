import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminLoginConfig } from "@/server/auth/admin-login-config";
import { ApiFault } from "@/server/http";

export type AdminSession = Readonly<{
  userId: string;
}>;

/**
 * Single-operator authorization for the beta administration console and its
 * APIs. The signed-in Supabase Auth user's verified email must equal the
 * deployment's configured administrator email; no claim, header, or client
 * input is trusted instead.
 */
export async function requireAdminSession(): Promise<AdminSession> {
  const config = getAdminLoginConfig();
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (
    !config ||
    userError ||
    !user ||
    !user.email ||
    normalizeAdminEmail(user.email) !== normalizeAdminEmail(config.email)
  ) {
    throw new ApiFault(
      "ADMIN_AUTHORIZATION_REQUIRED",
      "Administrator access is required.",
      403,
    );
  }

  return Object.freeze({ userId: user.id });
}

export function normalizeAdminEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}
