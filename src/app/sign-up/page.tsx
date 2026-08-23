import type { Metadata } from "next";

import { SignUpScreen } from "@/components/auth-screens";
import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Create account" };

export const dynamic = "force-dynamic";

/**
 * The open-beta invite link lands here. Signup admission itself is enforced by
 * the database before_user_created hook; this surface only reflects the
 * operator's signup window so closed betas show an honest explanation instead
 * of a form that would fail at the email step.
 */
async function readSignupsOpen(): Promise<boolean> {
  if (isDemoMode) return true;
  try {
    const { data } = await createAdminSupabaseClient()
      .from("beta_signup_settings")
      .select("signups_open")
      .eq("id", 1)
      .maybeSingle();
    return data?.signups_open ?? false;
  } catch {
    // Without service access the page cannot know the window state. Show the
    // open form; the database hook remains the authoritative gate.
    return true;
  }
}

export default async function SignUpPage() {
  const signupsOpen = await readSignupsOpen();
  return <SignUpScreen signupsOpen={signupsOpen} />;
}
