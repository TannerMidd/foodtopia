import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabasePublicConfig } from "./config";
import type { Database } from "@/types/database";

type ServerSupabaseClient = ReturnType<typeof createServerClient<Database>>;

/**
 * Creates a fresh user-scoped client for the current request. Never cache this
 * object across requests. Authentication decisions should use auth.getUser()
 * (or verified claims), never unverified auth.getSession() data.
 */
export async function createServerSupabaseClient(): Promise<ServerSupabaseClient> {
  const { url, publishableKey } = getSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write response cookies. A request proxy
          // must refresh sessions before rendering; Route Handlers and Server
          // Functions can write here. Supabase's SSR guidance intentionally
          // ignores this write-only failure because getAll still supplies the
          // request session; a proxy is responsible for durable refreshes.
        }
      },
    },
  });
}
