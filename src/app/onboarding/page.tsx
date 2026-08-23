import type { Metadata } from "next";

import { OnboardingScreen } from "@/components/auth-screens";

export const metadata: Metadata = { title: "Create your household" };

/**
 * Tokenless onboarding for administrator-enabled open-beta accounts; legacy
 * personal invitations continue through /onboarding/[token].
 */
export default function OnboardingEntryPage() {
  return <OnboardingScreen />;
}
