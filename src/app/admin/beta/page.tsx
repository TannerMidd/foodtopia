import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminBetaScreen } from "@/components/admin-beta-screen";
import { isDemoMode } from "@/lib/env";
import { requireAdminSession } from "@/server/auth/admin-user";

export const metadata: Metadata = { title: "Beta administration" };

export const dynamic = "force-dynamic";

export default async function AdminBetaPage() {
  if (!isDemoMode) {
    let authorized = false;
    try {
      await requireAdminSession();
      authorized = true;
    } catch {
      authorized = false;
    }
    if (!authorized) {
      // ?admin=1 reveals the administrator password sign-in on demand.
      redirect("/sign-in?next=%2Fadmin%2Fbeta&admin=1");
    }
  }
  return <AdminBetaScreen />;
}
