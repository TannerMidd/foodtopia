import type { Metadata } from "next";
import { AnalysisReview } from "@/components/analysis-review";

export const metadata: Metadata = { title: "Review detected food" };

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AnalysisReview analysisId={id} />;
}
