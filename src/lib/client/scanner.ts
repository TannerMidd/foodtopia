import {
  prepareZXingModule,
  readBarcodes,
} from "zxing-wasm/reader";

import {
  type DecodedBarcode,
  pickRetailBarcode,
} from "@/lib/client/barcode-codes";

export { isRetailBarcodeText, pickRetailBarcode } from "@/lib/client/barcode-codes";
export type { DecodedBarcode } from "@/lib/client/barcode-codes";

/**
 * Symbologies worth decoding for grocery add-item flows: retail EAN/UPC
 * symbols, plus QR / Data Matrix / Code 128 so self-printed household labels
 * can be introduced later with the same decoder. Restricting the format set
 * keeps decode latency low on phone cameras.
 */
const SCANNER_FORMATS = [
  "EAN13",
  "EAN8",
  "UPCA",
  "UPCE",
  "QRCode",
  "DataMatrix",
  "Code128",
] as const;

/**
 * The reader binary is self-hosted from /public so scanning works fully
 * offline after the Serwist precache, and no third-party CDN is contacted.
 * (When bundled by webpack without an emitted asset URL, zxing-wasm would
 * otherwise fall back to fetching its WASM from jsdelivr at runtime.)
 */
function locateWasmFile(path: string): string {
  return `/zxing/${path}`;
}

/**
 * Decodes barcodes from a still photo entirely on-device. This deliberately
 * avoids getUserMedia live scanning: iOS standalone PWAs do not persist
 * camera permission between launches and their stream handling has a history
 * of reliability issues, while the capture input this builds on is already
 * proven in the app's photo flow.
 */
export async function decodeBarcodesFromImage(
  image: Blob,
): Promise<DecodedBarcode[]> {
  await prepareZXingModule({
    fireImmediately: true,
    overrides: { locateFile: locateWasmFile },
  });
  const results = await readBarcodes(image, {
    formats: [...SCANNER_FORMATS],
    tryHarder: true,
    tryRotate: true,
    tryDownscale: true,
  });
  return results
    .filter((result) => result.isValid && result.text.trim().length > 0)
    .map((result) => ({ text: result.text.trim(), format: result.format }));
}

export async function scanImageFileForBarcode(
  file: Blob,
): Promise<DecodedBarcode | null> {
  return pickRetailBarcode(await decodeBarcodesFromImage(file));
}
