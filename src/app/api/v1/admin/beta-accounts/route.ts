import {
  betaAccountsResponseSchema,
  type BetaAccount,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/server/auth/admin-user";
import { correlationId, errorResponse, json } from "@/server/http";
import { asApiError } from "@/server/repositories/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 200;
const MAX_PAGES = 25;

type ProfileRow = {
  id: string;
  status: "pending" | "enabled" | "disabled" | null;
  display_name: string | null;
  enabled_at: string | null;
};

function timestamp(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Beta admissions roster: every Auth account joined with its admission state.
 * Emails are exposed only to the authenticated administrator identity.
 */
export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    if (isDemoMode) {
      return json(
        betaAccountsResponseSchema.parse({
          signupsOpen: true,
          counts: { pending: 0, enabled: 0, disabled: 0 },
          accounts: [],
        }),
      );
    }
    await requireAdminSession();
    const serviceRole = createAdminSupabaseClient();

    const authUsers: Array<{
      id: string;
      email: string;
      createdAt: string;
      lastSignInAt: string | null;
    }> = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data, error } = await serviceRole.auth.admin.listUsers({
        page,
        perPage: PAGE_SIZE,
      });
      if (error) throw error;
      for (const user of data.users) {
        authUsers.push({
          id: user.id,
          email: user.email ?? "",
          createdAt: user.created_at ?? new Date(0).toISOString(),
          lastSignInAt: user.last_sign_in_at ?? null,
        });
      }
      if (data.users.length < PAGE_SIZE) break;
    }

    const { data: profileRows, error: profileError } = await serviceRole
      .from("profiles")
      .select("id,status,display_name,enabled_at");
    if (profileError) throw profileError;
    const profileById = new Map(
      ((profileRows ?? []) as ProfileRow[]).map((row) => [row.id, row]),
    );

    const accounts: BetaAccount[] = authUsers.map((user) => {
      const profile = profileById.get(user.id);
      return {
        userId: user.id,
        email: user.email,
        displayName: profile?.display_name ?? null,
        status: profile?.status ?? "pending",
        createdAt: user.createdAt,
        lastSignInAt: user.lastSignInAt,
        enabledAt: profile?.enabled_at ?? null,
      };
    });

    // Pending signups lead the roster oldest-first so a review backlog cannot
    // hide behind newer requests; enabled and disabled follow newest-first.
    const rank = { pending: 0, enabled: 1, disabled: 2 } as const;
    accounts.sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) {
        return rank[a.status] - rank[b.status];
      }
      if (a.status === "pending") {
        return timestamp(a.createdAt) - timestamp(b.createdAt);
      }
      return timestamp(b.enabledAt ?? b.createdAt) -
        timestamp(a.enabledAt ?? a.createdAt);
    });

    const { data: settings, error: settingsError } = await serviceRole
      .from("beta_signup_settings")
      .select("signups_open")
      .eq("id", 1)
      .maybeSingle();
    if (settingsError) throw settingsError;

    return json(
      betaAccountsResponseSchema.parse({
        signupsOpen: settings?.signups_open ?? false,
        counts: {
          pending: accounts.filter((a) => a.status === "pending").length,
          enabled: accounts.filter((a) => a.status === "enabled").length,
          disabled: accounts.filter((a) => a.status === "disabled").length,
        },
        accounts,
      }),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "BETA_ACCOUNTS_FAILED",
        message: "The beta account roster could not be loaded.",
      }),
      id,
    );
  }
}
