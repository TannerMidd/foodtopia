import type { Metadata } from "next";
import { ShoppingList } from "@/components/shopping-list";
import { Page, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Shopping List" };

export default function ShoppingPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="the household"
        title="Shopping list."
        description="A shared place for everything the household needs to pick up."
      />
      <ShoppingList />
    </Page>
  );
}
