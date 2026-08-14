import type { Metadata } from "next";
import { InventoryScreen } from "@/components/inventory-screen";

export const metadata: Metadata = { title: "Inventory" };

export default function InventoryPage() {
  return <InventoryScreen />;
}
