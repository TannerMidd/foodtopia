import type { Metadata } from "next";
import { RecipeSuggestions } from "@/components/recipe-suggestions";

export const metadata: Metadata = { title: "Recipes" };

export default function RecipesPage() {
  return <RecipeSuggestions />;
}
