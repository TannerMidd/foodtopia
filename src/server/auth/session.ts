import "server-only";

import { cache } from "react";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type HouseholdSession = Readonly<{
  userId: string;
  householdId: string;
  role: "owner" | "member";
}>;

export class HouseholdSessionError extends Error {
  readonly code:
    | "authentication_required"
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
export const requireHouseholdSession = cache(
  async (): Promise<HouseholdSession> => {
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

    const { data: membership, error: membershipError } = await supabase
      .from("household_members")
      .select("household_id, role")
      .eq("user_id", user.id)
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

    return Object.freeze({ userId: user.id, householdId, role });
  },
);
