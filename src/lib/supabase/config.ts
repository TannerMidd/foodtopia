export type SupabasePublicConfig = Readonly<{
  url: string;
  publishableKey: string;
}>;

function validateUrl(value: string | undefined): string {
  if (!value) {
    throw new Error(
      "Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL is required.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL must be a valid URL.",
    );
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
    throw new Error(
      "Supabase is not configured: use HTTPS except for a local Supabase instance.",
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error(
      "Supabase is not configured: the project URL must not contain credentials.",
    );
  }

  return parsed.toString().replace(/\/$/, "");
}

function validatePublishableKey(value: string | undefined): string {
  if (!value || value.trim().length < 20) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return value.trim();
}

/**
 * Reads the only Supabase values that may enter a browser bundle.
 * The service-role secret is intentionally read in admin.ts, a server-only module.
 */
export function getSupabasePublicConfig(): SupabasePublicConfig {
  return {
    url: validateUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    publishableKey: validatePublishableKey(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}
