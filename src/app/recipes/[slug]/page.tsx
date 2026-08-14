import type { Metadata } from "next";
import { RecipeDetail } from "@/components/recipe-detail";

export const metadata: Metadata = { title: "Recipe" };

export default async function RecipePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <RecipeDetail slug={slug} />;
}
