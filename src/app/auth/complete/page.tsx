import type { Metadata } from "next";

import { AuthCompletion } from "@/components/auth-screens";
import { normalizeInternalPath } from "@/lib/internal-path";

export const metadata: Metadata = { title: "Finishing sign in" };

export default async function AuthCompletePage({
  searchParams,
}: PageProps<"/auth/complete">) {
  const query = await searchParams;
  return <AuthCompletion nextPath={normalizeInternalPath(query.next)} />;
}
