import {
  barcodeLookupRequestSchema,
  barcodeLookupResponseSchema,
} from "@/contracts/api";
import { isDemoMode } from "@/lib/env";
import { requireHouseholdSession } from "@/server/auth/session";
import {
  correlationId,
  errorResponse,
  json,
} from "@/server/http";
import { asApiError } from "@/server/repositories/errors";
import { lookupBarcodeProduct } from "@/server/services/product-lookup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/products/lookup?barcode=<digits>
 *
 * Resolves one retail barcode into a draft product name via Open Food Facts.
 * The result never mutates inventory; the household confirms the item through
 * the normal add flow. In connected mode this stays behind the household
 * session boundary; demo mode has no session, and the route only relays
 * public open data, so it fails closed on nothing there.
 */
export async function GET(request: Request) {
  const id = correlationId(request);
  try {
    const input = barcodeLookupRequestSchema.parse({
      barcode: new URL(request.url).searchParams.get("barcode") ?? "",
    });

    if (!isDemoMode) {
      await requireHouseholdSession();
    }

    return json(
      barcodeLookupResponseSchema.parse(
        await lookupBarcodeProduct(input.barcode),
      ),
    );
  } catch (error) {
    return errorResponse(
      asApiError(error, {
        code: "PRODUCT_LOOKUP_FAILED",
        message: "The product could not be looked up right now.",
        status: 503,
        retryable: true,
      }),
      id,
    );
  }
}
