import type { Metadata } from "next";

import { PendingAccountScreen } from "@/components/auth-screens";
import { normalizeInternalPath } from "@/lib/internal-path";

export const metadata: Metadata = { title: "Account not enabled" };

export default async function PendingPage({
  searchParams,
}: PageProps<"/pending">) {
  const query = await searchParams;
  return <PendingAccountScreen nextPath={normalizeInternalPath(query.next)} />;
}
