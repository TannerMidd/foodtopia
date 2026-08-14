import type { Metadata } from "next";
import { OfflineFallback } from "@/components/offline-fallback";

export const metadata: Metadata = { title: "Offline inventory" };

export default function OfflinePage() {
  return <OfflineFallback />;
}
