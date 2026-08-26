"use client";

import { useRef, useState } from "react";
import { Barcode, LoaderCircle, ScanLine } from "lucide-react";

import type { BarcodeLookupResponse } from "@/contracts/api";
import { lookupBarcode } from "@/lib/client/api";
import {
  scanImageFileForBarcode,
  type DecodedBarcode,
} from "@/lib/client/scanner";
import { resolveFoodIdentity } from "@/domain/normalization";
import { Button, Modal, StateNotice } from "./ui";

type Phase = "capture" | "decoding" | "lookup" | "found" | "unknown-code";

/**
 * Scan-to-add sheet: one still photo of the barcode is decoded entirely
 * on-device, then resolved into a draft product name through Open Food
 * Facts. The result only pre-fills the add-item form — inventory changes
 * stay behind the normal confirm step, and unknown codes stay unknown.
 */
export function BarcodeScanModal({
  onClose,
  onPick,
  online,
}: {
  onClose: () => void;
  onPick: (name: string) => void;
  online: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("capture");
  const [code, setCode] = useState<DecodedBarcode | null>(null);
  const [product, setProduct] = useState<BarcodeLookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPhase("capture");
    setCode(null);
    setProduct(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleLookup(decoded: DecodedBarcode) {
    setPhase("lookup");
    setError(null);
    try {
      const result = await lookupBarcode(decoded.text);
      if (result.found && result.name) {
        setProduct(result);
        setPhase("found");
      } else {
        setPhase("unknown-code");
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The product lookup could not be completed.",
      );
      setPhase("capture");
    }
  }

  async function onImage(file: File | undefined) {
    if (!file || phase === "decoding") return;
    setPhase("decoding");
    setError(null);
    try {
      const decoded = await scanImageFileForBarcode(file);
      if (!decoded) {
        setError(
          "No readable barcode was found in that photo. Move closer, hold the camera straight, and avoid glare.",
        );
        setPhase("capture");
        return;
      }
      setCode(decoded);
      if (!online) {
        setError(
          `${decoded.text} was read on this device, but product lookup needs a connection. Reconnect and scan again.`,
        );
        setPhase("capture");
        return;
      }
      await handleLookup(decoded);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The barcode could not be read from that photo.",
      );
      setPhase("capture");
    }
  }

  const busy = phase === "decoding" || phase === "lookup";
  const conceptMatch = product?.name ? resolveFoodIdentity(product.name) : null;

  return (
    <Modal
      open
      title="Scan a barcode"
      description="Take one clear photo of the grocery barcode. It is read here on your device."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {phase === "found" && product?.name ? (
        <div className="flex flex-col gap-4">
          <StateNotice title={product.name} tone="success">
            {[product.brands, product.quantityLabel].filter(Boolean).join(" · ") ||
              "Product details came from the open Open Food Facts database."}
            {conceptMatch?.foodConceptId ? (
              <span className="m mt-1 block text-[11px] font-semibold text-[var(--sage)]">
                matches your food list · {conceptMatch.category.toLowerCase()}
              </span>
            ) : null}
          </StateNotice>
          <p className="bd text-[13px] text-[var(--ink-5)]">
            Barcode {product.barcode}. This name fills the form for you to review —
            amount and location stay yours to decide.
          </p>
        </div>
      ) : null}

      {phase === "unknown-code" && code ? (
        <StateNotice title={`Code ${code.text} is not listed`} tone="warning">
          The barcode read fine, but Open Food Facts has no product for it yet.
          You can type the item manually instead.
        </StateNotice>
      ) : null}

      {error && (
        <div className="mt-4">
          <StateNotice title="Check this scan" tone="error">
            {error}
          </StateNotice>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Take or choose a photo of the barcode"
        onChange={(event) => void onImage(event.target.files?.[0])}
      />

      <div className="mt-6">
        {busy ? (
          <div className="flex min-h-[132px] flex-col items-center justify-center gap-3 rounded-xl bg-[var(--ground)] px-6 py-8">
            <LoaderCircle className="size-7 animate-spin text-[var(--accent)]" aria-hidden="true" />
            <span className="m text-[12px] text-[var(--ink-2)]">
              {phase === "decoding" ? "reading the barcode on-device…" : "looking up the product…"}
            </span>
          </div>
        ) : phase === "found" ? (
          <div className="flex items-center justify-end gap-6 pt-2">
            <button
              type="button"
              className="m inline-flex min-h-11 items-center px-3 text-[12px] text-[var(--ink-4)] hover:text-[var(--ink)]"
              onClick={reset}
            >
              scan another
            </button>
            <Button onClick={() => onPick(product?.name ?? "")}>Use this item</Button>
          </div>
        ) : (
          <button
            type="button"
            className="flex w-full flex-col items-center justify-center gap-2.5 rounded-xl bg-[var(--ground)] px-6 py-9 text-[var(--ink-3)] transition hover:bg-[var(--ground-hi)] hover:text-[var(--ink-2)]"
            onClick={() => inputRef.current?.click()}
          >
            <ScanLine className="size-7 text-[var(--sage)]" aria-hidden="true" />
            <span className="m text-[12px]">take a photo of the barcode</span>
          </button>
        )}
      </div>

      {!busy && (
        <p className="bd mt-5 flex items-start gap-2 text-[12px] text-[var(--ink-6)]">
          <Barcode className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Works offline for reading; the product-name lookup itself needs a connection.
          Nothing is uploaded — the photo never leaves your device.
        </p>
      )}
    </Modal>
  );
}
