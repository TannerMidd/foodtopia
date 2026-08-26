import {
  shoppingListItemResponseSchema,
  shoppingListUpdateRequestSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  removeDemoShoppingListItem,
  updateDemoShoppingListItem,
} from "@/server/demo/store";
import { ApiFault, correlationId, errorResponse, json, parseJson } from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import {
  removeShoppingListItem,
  updateShoppingListItem,
} from "@/server/repositories/shopping-list";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const id = correlationId(request);
  try {
    const input = await parseJson(request, shoppingListUpdateRequestSchema);
    const { itemId } = await params;
    if (!UUID_PATTERN.test(itemId)) {
      throw new ApiFault(
        "SHOPPING_ITEM_NOT_FOUND",
        "That shopping item is no longer on the shared list.",
        404,
      );
    }
    if (isDemoMode) {
      const item = updateDemoShoppingListItem(itemId, input.done);
      return json(shoppingListItemResponseSchema.parse({ item }));
    }
    const session = await requireHouseholdSession();
    const item = await updateShoppingListItem(createAdminSupabaseClient(), {
      householdId: session.householdId,
      itemId,
      done: input.done,
    });
    return json(shoppingListItemResponseSchema.parse({ item }));
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "SHOPPING_LIST_UPDATE_FAILED",
        message: "The shopping item could not be updated.",
      }),
      id,
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const id = correlationId(request);
  try {
    const { itemId } = await params;
    if (!UUID_PATTERN.test(itemId)) {
      throw new ApiFault(
        "SHOPPING_ITEM_NOT_FOUND",
        "That shopping item is no longer on the shared list.",
        404,
      );
    }
    if (isDemoMode) {
      removeDemoShoppingListItem(itemId);
    } else {
      const session = await requireHouseholdSession();
      await removeShoppingListItem(createAdminSupabaseClient(), {
        householdId: session.householdId,
        itemId,
      });
    }
    return json({ removed: true });
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "SHOPPING_LIST_REMOVE_FAILED",
        message: "The shopping item could not be removed.",
      }),
      id,
    );
  }
}
