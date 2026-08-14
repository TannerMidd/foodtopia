import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "./config";
import type { Database } from "@/types/database";

type AdminSupabaseClient = ReturnType<typeof createClient<Database>>;

let adminClient: AdminSupabaseClient | undefined;

function getServiceRoleKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value || value.length < 20) {
    throw new Error(
      "Supabase admin access is not configured: SUPABASE_SERVICE_ROLE_KEY is required.",
    );
  }

  const { publishableKey } = getSupabasePublicConfig();
  if (value === publishableKey) {
    throw new Error(
      "Supabase admin access is misconfigured: the service-role key must differ from the public key.",
    );
  }
  return value;
}

/**
 * Returns a server-only service-role client for trusted workers and carefully
 * authorized DAL operations. It bypasses RLS, so callers must first derive the
 * tenant with requireHouseholdSession; never pass this client to UI code.
 */
export function createAdminSupabaseClient(): AdminSupabaseClient {
  if (adminClient) {
    return adminClient;
  }

  const { url } = getSupabasePublicConfig();
  adminClient = createClient<Database>(url, getServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return adminClient;
}
