import type { Metadata } from "next";
import { InviteScreen } from "@/components/auth-screens";

export const metadata: Metadata = { title: "Household invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteScreen token={token} />;
}
