import "server-only";

const value = (name: string) => process.env[name]?.trim() || null;

export const serverEnv = {
  // Nullable on purpose: origin checks must fail loudly instead of silently
  // comparing against a guessed localhost fallback on real deployments.
  appUrl: value("NEXT_PUBLIC_APP_URL"),
  supabaseUrl: value("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey:
    value("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ??
    value("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: value("SUPABASE_SERVICE_ROLE_KEY"),
  openaiApiKey: value("OPENAI_API_KEY"),
  openaiVisionModel: value("OPENAI_VISION_MODEL") ?? "gpt-5.6-terra",
  openaiRecipeModel: value("OPENAI_RECIPE_MODEL") ?? "gpt-5.6-luna",
  openrouterApiKey: value("OPENROUTER_API_KEY"),
  openrouterVisionModel: value("OPENROUTER_VISION_MODEL"),
  openrouterRecipeModel: value("OPENROUTER_RECIPE_MODEL"),
  inngestEventKey: value("INNGEST_EVENT_KEY"),
  inngestSigningKey: value("INNGEST_SIGNING_KEY"),
};

export const hasSupabaseConfig = Boolean(
  serverEnv.supabaseUrl &&
    serverEnv.supabaseAnonKey &&
    serverEnv.supabaseServiceRoleKey,
);

const explicitlyRequestedDemo = value("FOODTOPIA_DEMO_MODE") === "true";
const hostedProduction = value("VERCEL_ENV") === "production";

/** Demo data is convenient locally and in previews, but production fails closed. */
export const isDemoMode =
  !hostedProduction &&
  (explicitlyRequestedDemo ||
    (process.env.NODE_ENV === "development" && !hasSupabaseConfig));
