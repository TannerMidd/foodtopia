import type { Metadata } from "next";
import { SignInScreen } from "@/components/auth-screens";
import { normalizeInternalPath } from "@/lib/internal-path";

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
  return (
    <SignInScreen
      nextPath={nextPath}
      householdDeletion={householdDeletion}
      authError={authError}
      emailConfirmed={emailConfirmed}
    />
  );
}
