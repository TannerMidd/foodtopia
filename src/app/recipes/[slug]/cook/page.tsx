import type { Metadata } from "next";
import { CookingScreen } from "@/components/cooking-screen";

export const metadata: Metadata = { title: "Cooking" };

export default async function CookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CookingScreen slug={slug} />;
}
