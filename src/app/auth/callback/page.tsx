import type { Metadata } from "next";
import { AuthCallback } from "@/components/auth-screens";
import { normalizeInternalPath } from "@/lib/internal-path";

export const metadata: Metadata = { title: "Finishing sign in" };

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  const { code = "", next } = await searchParams;
  return <AuthCallback code={code} nextPath={normalizeInternalPath(next)} />;
}
