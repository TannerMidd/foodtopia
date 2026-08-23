import type { Metadata } from "next";

import { SetPasswordScreen } from "@/components/auth-screens";

export const metadata: Metadata = { title: "Choose password" };

export default function SetPasswordPage() {
  return <SetPasswordScreen />;
}
