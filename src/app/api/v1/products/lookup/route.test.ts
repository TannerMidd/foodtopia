import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookupBarcodeProduct: vi.fn(),
  requireSession: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isDemoMode: false }));
vi.mock("@/server/auth/session", () => ({
  requireHouseholdSession: mocks.requireSession,
}));
vi.mock("@/server/services/product-lookup", () => ({
  BarcodeLookupUnavailableError: class extends Error {},
  lookupBarcodeProduct: mocks.lookupBarcodeProduct,
}));

function getUrl(barcode: string) {
  return `https://foodtopia.example/api/v1/products/lookup?barcode=${barcode}`;
}

describe("GET /api/v1/products/lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({
      userId: "7f892312-7c71-4e9f-a595-f8300f6d3234",
      householdId: "45ebd76e-773c-43c6-a66a-e941dac40d80",
      role: "member",
    });
    mocks.lookupBarcodeProduct.mockResolvedValue({
      barcode: "3017620422003",
      found: true,
      name: "Nutella",
      brands: "Nutella",
      quantityLabel: "400 g",
      imageUrl: null,
    });
  });

  it("returns the parsed product for a valid barcode behind a session", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request(getUrl("3017620422003")));

    expect(response.status).toBe(200);
    expect(mocks.lookupBarcodeProduct).toHaveBeenCalledWith("3017620422003");
    expect(await response.json()).toMatchObject({ found: true, name: "Nutella" });
  });

  it("rejects malformed barcodes without calling the upstream database", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request(getUrl("nutella")));

    expect(response.status).toBe(422);
    expect(mocks.lookupBarcodeProduct).not.toHaveBeenCalled();
  });

  it("requires a household session in connected mode", async () => {
    mocks.requireSession.mockRejectedValue(
      Object.assign(new Error("Authentication is required."), {
        code: "authentication_required",
        status: 401,
      }),
    );
    const { GET } = await import("./route");
    const response = await GET(new Request(getUrl("3017620422003")));

    expect(response.status).toBe(401);
    expect(JSON.parse(JSON.stringify(await response.json())).code).toBe(
      "AUTHENTICATION_REQUIRED",
    );
  });

  it("maps an unavailable product database to a retryable fault", async () => {
    mocks.lookupBarcodeProduct.mockRejectedValue(
      Object.assign(new Error("The barcode product database could not be reached."), {
        code: "PRODUCT_DB_UNAVAILABLE",
        statusCode: 503,
      }),
    );
    const { GET } = await import("./route");
    const response = await GET(new Request(getUrl("3017620422003")));
    const body = JSON.parse(JSON.stringify(await response.json()));

    expect(response.status).toBe(503);
    expect(body.retryable).toBe(true);
    // Public envelopes use the route-level fallback code, never provider detail.
    expect(body.code).toBe("PRODUCT_LOOKUP_FAILED");
  });
});
