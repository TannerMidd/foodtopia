import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeInternalPath } from "@/lib/internal-path";

let client: SupabaseClient | null | undefined;

function getClient() {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createBrowserClient(url, key) : null;
  return client;
}

export async function requestMagicLink(email: string, next = "/") {
  const supabase = getClient();
  if (!supabase) return { demo: true as const };
  const callback = new URL("/auth/callback", window.location.origin);
  callback.searchParams.set("next", normalizeInternalPath(next));
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callback.toString(), shouldCreateUser: true },
  });
  if (error) throw error;
  return { demo: false as const };
}

export async function signOut() {
  const supabase = getClient();
  if (supabase) await supabase.auth.signOut();
}

export async function exchangeAuthCode(code: string) {
  const supabase = getClient();
  if (!supabase) return { demo: true as const };
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
  return { demo: false as const };
}

export async function getAuthenticatedUser() {
  const supabase = getClient();
  if (!supabase) return { demo: true as const, user: null };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { demo: false as const, user: null };
  return { demo: false as const, user: data.user };
}

export async function clearFoodtopiaCaches() {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("foodtopia:")) localStorage.removeItem(key);
    }
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith("foodtopia:")) sessionStorage.removeItem(key);
    }
  } catch {
    // Storage may be disabled; continue clearing any available CacheStorage.
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("foodtopia-")).map((key) => caches.delete(key)));
  }
}
