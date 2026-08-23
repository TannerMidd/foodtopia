import type { Metadata } from "next";
import { SettingsScreen } from "@/components/settings-screen";
import { isDemoMode } from "@/lib/env";
import { requireAdminSession } from "@/server/auth/admin-user";

export const metadata: Metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let isAdmin = false;
  if (!isDemoMode) {
    try {
      await requireAdminSession();
      isAdmin = true;
    } catch {
      // Settings remains available to every enabled account. A failed or
      // unauthorized admin check only hides the operational entry point.
    }
  }
  return <SettingsScreen isAdmin={isAdmin} />;
}
