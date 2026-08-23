import "server-only";

import { cache } from "react";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type HouseholdSession = Readonly<{
  userId: string;
  householdId: string;
  role: "owner" | "member";
}>;

export type EnabledAccountSession = Readonly<{
  userId: string;
}>;

export class HouseholdSessionError extends Error {
  readonly code:
    | "authentication_required"
    | "account_not_enabled"
    | "household_membership_required"
    | "session_lookup_failed";
  readonly status: 401 | 403 | 503;

  constructor(
    code: HouseholdSessionError["code"],
    message: string,
    status: HouseholdSessionError["status"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HouseholdSessionError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Secure request-time authorization boundary. It verifies the auth user with
 * Supabase Auth, then derives the sole V1 household membership through RLS.
 * There is deliberately no household argument and no claim/cookie role trust.
 */
async function resolveAuthenticatedUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new HouseholdSessionError(
      "authentication_required",
      "Authentication is required.",
      401,
      userError ? { cause: userError } : undefined,
    );
  }

  return { supabase, userId: user.id };
}

/**
 * Open-beta admission boundary. An account exists in Auth as soon as its
 * signup link is used; every application capability additionally requires an
 * administrator-enabled profile. Status is read through RLS from the caller's
 * own row, so a pending account can never promote itself.
 */
async function ensureEnabledProfile(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new HouseholdSessionError(
      "session_lookup_failed",
      "The account status could not be verified.",
      503,
      { cause: profileError },
    );
  }
  if (!profile || profile.status !== "enabled") {
    throw new HouseholdSessionError(
      "account_not_enabled",
      profile?.status === "disabled"
        ? "This account has been disabled by an administrator."
        : "An administrator has not enabled this account yet.",
      403,
    );
  }
}

/** Verifies authentication plus administrator enablement for pre-household flows. */
export const requireEnabledAccount = cache(
  async (): Promise<EnabledAccountSession> => {
    const { supabase, userId } = await resolveAuthenticatedUser();
    await ensureEnabledProfile(supabase, userId);
    return Object.freeze({ userId });
  },
);

export const requireHouseholdSession = cache(
  async (): Promise<HouseholdSession> => {
    const { supabase, userId } = await resolveAuthenticatedUser();
    await ensureEnabledProfile(supabase, userId);

    const { data: membership, error: membershipError } = await supabase
      .from("household_members")
      .select("household_id, role")
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) {
      throw new HouseholdSessionError(
        "session_lookup_failed",
        "The household session could not be verified.",
        503,
        { cause: membershipError },
      );
    }
    if (!membership) {
      throw new HouseholdSessionError(
        "household_membership_required",
        "An active household membership is required.",
        403,
      );
    }

    const householdId = membership.household_id;
    const role = membership.role;
    if (
      typeof householdId !== "string" ||
      (role !== "owner" && role !== "member")
    ) {
      throw new HouseholdSessionError(
        "session_lookup_failed",
        "The household session is malformed.",
        503,
      );
    }

    return Object.freeze({ userId, householdId, role });
  },
);
