import { describe, expect, it } from "vitest";

import {
  isRetailBarcodeText,
  pickRetailBarcode,
} from "@/lib/client/barcode-codes";

describe("isRetailBarcodeText", () => {
  it("accepts EAN-8, UPC-A, EAN-13 and ITF-14 digit strings", () => {
    expect(isRetailBarcodeText("30123456")).toBe(true);
    expect(isRetailBarcodeText("012345678901")).toBe(true);
    expect(isRetailBarcodeText("3017620422003")).toBe(true);
    expect(isRetailBarcodeText("00012345678905")).toBe(true);
  });

  it("rejects URLs, free text and implausible lengths", () => {
    expect(isRetailBarcodeText("https://foodtopia.example/add/123")).toBe(false);
    expect(isRetailBarcodeText("nutella jar")).toBe(false);
    expect(isRetailBarcodeText("1234567")).toBe(false);
    expect(isRetailBarcodeText("123456789")).toBe(false);
    expect(isRetailBarcodeText("")).toBe(false);
  });
});

describe("pickRetailBarcode", () => {
  it("prefers an EAN/UPC symbol over a QR payload that also looks numeric", () => {
    const picked = pickRetailBarcode([
      { text: "3017620422003", format: "QRCode" },
      { text: "4006381333931", format: "EAN13" },
    ]);
    expect(picked?.format).toBe("EAN13");
    expect(picked?.text).toBe("4006381333931");
  });

  it("falls back to any symbol whose text is a plausible retail code", () => {
    const picked = pickRetailBarcode([
      { text: "https://example.test/product", format: "QRCode" },
      { text: " 00012345678905\n", format: "Code128" },
    ]);
    expect(picked?.text).toBe("00012345678905");
  });

  it("returns null when nothing decodes to a retail code", () => {
    expect(
      pickRetailBarcode([
        { text: "https://example.test", format: "QRCode" },
        { text: "coupon-42", format: "DataMatrix" },
      ]),
    ).toBeNull();
    expect(pickRetailBarcode([])).toBeNull();
  });
});
