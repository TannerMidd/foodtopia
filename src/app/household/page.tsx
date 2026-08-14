import type { Metadata } from "next";
import { HouseholdScreen } from "@/components/household-screen";

export const metadata: Metadata = { title: "Household" };

export default function HouseholdPage() {
  return <HouseholdScreen />;
}
