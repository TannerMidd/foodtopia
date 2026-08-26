import "server-only";

import {
  shoppingListItemSchema,
  type ShoppingListItem,
} from "@/contracts/api";
import { ApiFault } from "@/server/http";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

type ShoppingListRow = {
  id: string;
  name: string;
  category: string;
  food_concept_id: string | null;
  quantity_text: string | null;
  done: boolean;
  added_by: string;
  created_at: string;
};

const projection = `
  id,
  name,
  category,
  food_concept_id,
  quantity_text,
  done,
  added_by,
  created_at
`;

async function resolveDisplayNames(admin: AdminClient, userIds: string[]) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map<string, string>();
  const { data, error } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", unique);
  if (error) throw error;
  const names = new Map<string, string>();
  for (const row of data ?? []) {
    if (
      row &&
      typeof row === "object" &&
      typeof row.id === "string" &&
      typeof row.display_name === "string" &&
      row.display_name.length > 0
    ) {
      names.set(row.id, row.display_name);
    }
  }
  return names;
}

function mapItem(value: unknown, displayName: string): ShoppingListItem {
  const row = value as ShoppingListRow;
  return shoppingListItemSchema.parse({
    id: row.id,
    name: row.name,
    category: row.category,
    foodConceptId: row.food_concept_id,
    quantityText: row.quantity_text,
    done: row.done,
    addedByName: displayName,
    createdAt: new Date(row.created_at).toISOString(),
  });
}

export async function listShoppingListItems(
  admin: AdminClient,
  householdId: string,
): Promise<ShoppingListItem[]> {
  // Open items first in creation order, then completed items most recent last:
  // the unchecked remainder of the trip is what a shopper scans top to bottom.
  const { data, error } = await admin
    .from("shopping_list_items")
    .select(projection)
    .eq("household_id", householdId)
    .order("done", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  const rows = (data ?? []) as ShoppingListRow[];
  const names = await resolveDisplayNames(admin, rows.map((row) => row.added_by));
  return rows.map((row) => mapItem(row, names.get(row.added_by) ?? "A household member"));
}

export type ShoppingListAddInput = {
  householdId: string;
  userId: string;
  items: {
    name: string;
    category: string;
    foodConceptId: string | null;
    quantityText: string | null;
  }[];
};

export async function addShoppingListItems(
  admin: AdminClient,
  input: ShoppingListAddInput,
): Promise<{
  items: ShoppingListItem[];
  added: number;
  replayedNames: string[];
}> {
  // Deduplicate against open entries case-insensitively so an offline replay or
  // a second tap cannot create "eggs" twice; completed items may be re-added.
  const existing = await admin
    .from("shopping_list_items")
    .select("name, done")
    .eq("household_id", input.householdId)
    .limit(100);
  if (existing.error) throw existing.error;
  const existingRows = (existing.data ?? []) as { name: string; done: boolean }[];
  const openNames = new Set(
    existingRows
      .filter((row) => !row.done)
      .map((row) => row.name.trim().toLowerCase()),
  );
  const fresh = input.items.filter((item) => {
    const key = item.name.trim().toLowerCase();
    if (openNames.has(key)) return false;
    openNames.add(key);
    return true;
  });
  const replayedNames = input.items
    .filter((item) => !fresh.includes(item))
    .map((item) => item.name);
  // ponytail: application cap can overshoot only at the 100-row concurrent
  // boundary; move this check into a locked RPC if beta traffic ever reaches it.
  if (existingRows.length + fresh.length > 100) {
    throw new ApiFault(
      "SHOPPING_LIST_FULL",
      "Remove completed shopping items before adding more.",
      409,
    );
  }

  const insertedNames = new Set<string>();
  const concurrentReplays: string[] = [];
  // At most 16 rows per request. Inserting independently lets a concurrent
  // duplicate become an idempotent replay without discarding unrelated items
  // from the same batch.
  for (const item of fresh) {
    const inserted = await admin
      .from("shopping_list_items")
      .insert({
        household_id: input.householdId,
        name: item.name,
        category: item.category,
        food_concept_id: item.foodConceptId,
        quantity_text: item.quantityText,
        done: false,
        added_by: input.userId,
      })
      .select(projection)
      .single();
    if (inserted.error) {
      if (inserted.error.code === "23505") {
        concurrentReplays.push(item.name);
        continue;
      }
      throw inserted.error;
    }
    insertedNames.add((inserted.data as ShoppingListRow).name);
  }

  const items = await listShoppingListItems(admin, input.householdId);
  return {
    items,
    added: insertedNames.size,
    replayedNames: [...replayedNames, ...concurrentReplays],
  };
}

export async function updateShoppingListItem(
  admin: AdminClient,
  input: { householdId: string; itemId: string; done: boolean },
): Promise<ShoppingListItem> {
  const updated = await admin
    .from("shopping_list_items")
    .update({ done: input.done })
    .eq("household_id", input.householdId)
    .eq("id", input.itemId)
    .select(projection)
    .maybeSingle();
  if (updated.error) throw updated.error;
  if (!updated.data) {
    throw new ApiFault(
      "SHOPPING_ITEM_NOT_FOUND",
      "That shopping item is no longer on the shared list.",
      404,
    );
  }
  const row = updated.data as ShoppingListRow;
  const names = await resolveDisplayNames(admin, [row.added_by]);
  return mapItem(row, names.get(row.added_by) ?? "A household member");
}

export async function removeShoppingListItem(
  admin: AdminClient,
  input: { householdId: string; itemId: string },
): Promise<void> {
  const removed = await admin
    .from("shopping_list_items")
    .delete()
    .eq("household_id", input.householdId)
    .eq("id", input.itemId)
    .select("id");
  if (removed.error) throw removed.error;
  if (((removed.data ?? []) as { id: string }[]).length === 0) {
    throw new ApiFault(
      "SHOPPING_ITEM_NOT_FOUND",
      "That shopping item is no longer on the shared list.",
      404,
    );
  }
}
