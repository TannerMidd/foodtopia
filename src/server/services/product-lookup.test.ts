import { describe, expect, it, vi } from "vitest";

import {
  BarcodeLookupUnavailableError,
  lookupBarcodeProduct,
} from "@/server/services/product-lookup";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("lookupBarcodeProduct", () => {
  it("maps a found product to display fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 1,
        code: "3017620422003",
        product: {
          product_name: "Nutella pâte à tartiner",
          product_name_en: "Nutella",
          brands: "Nutella, Ferrero",
          quantity: "400 g",
          image_front_small_url:
            "https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.200.jpg",
        },
      }),
    );

    const result = await lookupBarcodeProduct("3017620422003", fetchImpl);

    expect(result).toEqual({
      barcode: "3017620422003",
      found: true,
      name: "Nutella",
      brands: "Nutella",
      quantityLabel: "400 g",
      imageUrl:
        "https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.200.jpg",
    });
    const requestUrl = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(requestUrl.pathname).toContain("/api/v2/product/3017620422003.json");
    expect(requestUrl.searchParams.get("fields")).toContain("product_name");
  });

  it("treats a not-listed barcode as unknown instead of an error", async () => {
    const result = await lookupBarcodeProduct(
      "0000000000000",
      vi.fn().mockResolvedValue(jsonResponse({ status: 0 })),
    );
    expect(result.found).toBe(false);
    expect(result.name).toBeNull();
  });

  it("keeps digits-only codes from noisy scanner text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 0 }));
    await lookupBarcodeProduct(" 3017620422003\n", fetchImpl);
    expect(new URL(fetchImpl.mock.calls[0][0] as string).pathname).toContain(
      "/3017620422003.json",
    );
  });

  it("falls back to the base name when no English name exists", async () => {
    const result = await lookupBarcodeProduct(
      "3017620422003",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: 1,
          product: { product_name: "Pâte à tartiner" },
        }),
      ),
    );
    expect(result.name).toBe("Pâte à tartiner");
  });

  it("rejects non-https image URLs", async () => {
    const result = await lookupBarcodeProduct(
      "3017620422003",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: 1,
          product: {
            product_name_en: "Suspicious",
            image_front_small_url: "http://images.example.test/x.jpg",
          },
        }),
      ),
    );
    expect(result.imageUrl).toBeNull();
  });

  it("raises an unavailable fault on network failure", async () => {
    await expect(
      lookupBarcodeProduct(
        "3017620422003",
        vi.fn().mockRejectedValue(new Error("dns failure")),
      ),
    ).rejects.toBeInstanceOf(BarcodeLookupUnavailableError);
  });

  it("raises an unavailable fault on non-JSON responses", async () => {
    await expect(
      lookupBarcodeProduct(
        "3017620422003",
        vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })),
      ),
    ).rejects.toBeInstanceOf(BarcodeLookupUnavailableError);
  });
});
