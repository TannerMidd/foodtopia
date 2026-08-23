import type { Metadata } from "next";
import { SignInScreen } from "@/components/auth-screens";
import { normalizeInternalPath } from "@/lib/internal-path";
import { isAdminLoginEnabled } from "@/server/auth/admin-login-config";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const query = await searchParams;
  const nextPath = normalizeInternalPath(query.next);
  const householdDeletion = query.householdDeletion === "pending" ||
    query.householdDeletion === "complete"
    ? query.householdDeletion
    : undefined;
  const authError = query.authError === "invalid_link" ? "invalid_link" : undefined;
  const emailConfirmed = query.emailConfirmed === "1";
  // ?admin=1 reveals the administrator sign-in on demand, even when the env
  // config is absent. The admin-login API itself stays gated and rate-limited.
  const adminReveal = query.admin === "1";
  return (
    <SignInScreen
      nextPath={nextPath}
      householdDeletion={householdDeletion}
      authError={authError}
      emailConfirmed={emailConfirmed}
      adminLoginEnabled={adminReveal || isAdminLoginEnabled()}
    />
  );
}
