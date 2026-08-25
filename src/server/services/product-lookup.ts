import { z } from "zod";

/**
 * Open Food Facts product lookup for scan-to-add.
 *
 * The database is open data (ODbL). This module only reads and relays a few
 * display fields to the household that requested them; nothing is persisted
 * server-side, so the share-alike obligation is not triggered by this route.
 * Requests are deliberately narrow (`fields=`) and identify the deployment,
 * per the API usage guidance. Lookups never mutate inventory — the result is
 * a draft name the household confirms through the normal add flow.
 */
const OPEN_FOOD_FACTS_ORIGIN = "https://world.openfoodfacts.org";
const LOOKUP_TIMEOUT_MS = 8_000;
const USER_AGENT = "Foodtopia/0.1 (beta; https://github.com/TannerMidd/foodtopia)";

export type BarcodeProduct = Readonly<{
  barcode: string;
  found: boolean;
  name: string | null;
  brands: string | null;
  quantityLabel: string | null;
  imageUrl: string | null;
}>;

const openFoodFactsProductSchema = z
  .object({
    product_name: z.string().trim().optional(),
    product_name_en: z.string().trim().optional(),
    brands: z.string().trim().optional(),
    quantity: z.string().trim().max(120).optional(),
    image_front_small_url: z.string().trim().optional(),
  })
  .transform((product) => ({
    name: (product.product_name_en || product.product_name || "").trim() || null,
    brands: (product.brands ?? "").split(",")[0].trim() || null,
    quantityLabel: (product.quantity ?? "").trim().slice(0, 60) || null,
    imageUrl: product.image_front_small_url?.startsWith("https://")
      ? product.image_front_small_url
      : null,
  }));

const openFoodFactsResponseSchema = z.object({
  status: z.number().int(),
  code: z.string().optional(),
  product: openFoodFactsProductSchema.nullish(),
});

export class BarcodeLookupUnavailableError extends Error {
  constructor(
    message = "The barcode product database could not be reached.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BarcodeLookupUnavailableError";
    this.code = "PRODUCT_DB_UNAVAILABLE";
    this.statusCode = 503;
  }

  readonly code: string;
  readonly statusCode: number;
}

function cleanBarcodeText(value: string): string {
  return value.replace(/\D/g, "");
}

export async function lookupBarcodeProduct(
  barcodeInput: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BarcodeProduct> {
  const barcode = cleanBarcodeText(barcodeInput);
  const url =
    `${OPEN_FOOD_FACTS_ORIGIN}/api/v2/product/${encodeURIComponent(barcode)}.json` +
    "?fields=product_name,product_name_en,brands,quantity,image_front_small_url";

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new BarcodeLookupUnavailableError(undefined, { cause: error });
  }

  if (!response.ok) {
    throw new BarcodeLookupUnavailableError(
      `The barcode product database responded with ${response.status}.`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new BarcodeLookupUnavailableError(
      "The barcode product database returned an unreadable response.",
      { cause: error },
    );
  }

  const parsed = openFoodFactsResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.status !== 1 || !parsed.data.product) {
    // Unknown stays unknown: an unlisted barcode is not an error.
    return {
      barcode,
      found: false,
      name: null,
      brands: null,
      quantityLabel: null,
      imageUrl: null,
    };
  }

  return { barcode, found: true, ...parsed.data.product };
}
