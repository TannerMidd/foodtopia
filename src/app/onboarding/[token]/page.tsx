import { OnboardingScreen } from "@/components/auth-screens";

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <OnboardingScreen token={token} />;
}
