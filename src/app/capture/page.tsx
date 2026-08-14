import type { Metadata } from "next";
import { CaptureFlow } from "@/components/capture-flow";

export const metadata: Metadata = { title: "Add food" };

export default function CapturePage() {
  return <CaptureFlow />;
}
