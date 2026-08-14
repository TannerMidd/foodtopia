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

export async function requestAdminPasswordLogin(
  username: string,
  password: string,
) {
  const response = await fetch("/api/v1/auth/admin-login", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error("Invalid username or password.");
  }
}

export async function signOut() {
  const supabase = getClient();
  if (supabase) await supabase.auth.signOut();
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
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("foodtopia-")).map((key) => caches.delete(key)));
    }
  } catch {
    // Some installed/mobile contexts expose CacheStorage but deny access.
    // Session establishment must not depend on cache cleanup succeeding.
  }
}
