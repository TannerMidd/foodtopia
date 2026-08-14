"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicConfig } from "./config";
import type { Database } from "@/types/database";

type BrowserSupabaseClient = ReturnType<typeof createBrowserClient<Database>>;

let browserClient: BrowserSupabaseClient | undefined;

/**
 * Returns one cookie-aware Supabase client per browser tab/module runtime.
 * This client has only the public publishable key; RLS remains authoritative.
 */
export function createBrowserSupabaseClient(): BrowserSupabaseClient {
  if (browserClient) {
    return browserClient;
  }

  const { url, publishableKey } = getSupabasePublicConfig();
  browserClient = createBrowserClient<Database>(url, publishableKey, {
    isSingleton: true,
  });
  return browserClient;
}
