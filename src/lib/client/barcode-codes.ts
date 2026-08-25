/**
 * Pure retail-barcode helpers shared by the scanner and its tests. No
 * platform imports: this file must stay usable under jsdom.
 */

export type DecodedBarcode = Readonly<{
  text: string;
  format: string;
}>;

const RETAIL_EANUPC_FORMATS = new Set(["EAN13", "EAN8", "UPCA", "UPCE"]);

/** Retail codes as scanners report them: 8 (EAN-8/UPC-E), 12–14 digits. */
export function isRetailBarcodeText(text: string): boolean {
  return /^(\d{8}|\d{12,14})$/.test(text.trim());
}

/**
 * Picks the best add-item candidate from a decoded image.
 *
 * Preference order:
 * 1. an EAN/UPC-format symbol whose text is a plausible retail code,
 * 2. any other symbol whose text is a plausible retail code
 *    (Code 128 shelf labels, QR payloads that carry a bare GTIN).
 *
 * Everything else — URLs, coupon payloads, free text — is ignored rather
 * than guessed at.
 */
export function pickRetailBarcode(
  decoded: readonly DecodedBarcode[],
): DecodedBarcode | null {
  const candidates = decoded
    .map((result) => ({ ...result, text: result.text.trim() }))
    .filter((result) => isRetailBarcodeText(result.text));

  return (
    candidates.find((result) => RETAIL_EANUPC_FORMATS.has(result.format)) ??
    candidates[0] ??
    null
  );
}
