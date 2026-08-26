import {
  shoppingListAddRequestSchema,
  shoppingListAddResponseSchema,
  shoppingListResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  addDemoShoppingListItems,
  listDemoShoppingListItems,
} from "@/server/demo/store";
import { correlationId, errorResponse, json, parseJson } from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import {
  addShoppingListItems,
  listShoppingListItems,
} from "@/server/repositories/shopping-list";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    if (isDemoMode) {
      return json(
        shoppingListResponseSchema.parse({ items: listDemoShoppingListItems() }),
      );
    }
    const session = await requireHouseholdSession();
    const items = await listShoppingListItems(
      createAdminSupabaseClient(),
      session.householdId,
    );
    return json(shoppingListResponseSchema.parse({ items }));
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "SHOPPING_LIST_FAILED",
        message: "The shared shopping list could not be loaded.",
      }),
      id,
    );
  }
}

export async function POST(request: Request) {
  const id = correlationId(request);
  try {
    const input = await parseJson(request, shoppingListAddRequestSchema);
    if (isDemoMode) {
      const { added, replayedNames } = addDemoShoppingListItems(input.items);
      return json(
        shoppingListAddResponseSchema.parse({
          items: listDemoShoppingListItems(),
          added,
          replayedNames,
        }),
      );
    }
    const session = await requireHouseholdSession();
    const result = await addShoppingListItems(createAdminSupabaseClient(), {
      householdId: session.householdId,
      userId: session.userId,
      items: input.items.map((item) => ({
        name: item.name,
        category: item.category,
        foodConceptId: item.foodConceptId,
        quantityText: item.quantityText,
      })),
    });
    return json(
      shoppingListAddResponseSchema.parse({
        items: result.items,
        added: result.added,
        replayedNames: result.replayedNames,
      }),
      { status: result.added === 0 ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "SHOPPING_LIST_ADD_FAILED",
        message: "The items could not be added to the shared list.",
      }),
      id,
    );
  }
}
