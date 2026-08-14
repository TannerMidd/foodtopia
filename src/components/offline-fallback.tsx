"use client";

import Link from "next/link";
import { ArrowRight, CloudOff } from "lucide-react";
import { InventoryScreen } from "./inventory-screen";

export function OfflineFallback() {
  return (
    <>
      <div className="mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-3xl items-start gap-3 rounded-2xl border border-[#e9d593] bg-[#fff8dc] p-4 text-[#66531b]" role="status">
        <CloudOff className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold">Device-only offline inventory</p>
          <p className="mt-1 text-xs leading-5">This static fallback contains no server or household payload. Items below come only from this device’s IndexedDB snapshot; edits join the ordered outbox.</p>
          <Link href="/" className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-bold">Try the app again <ArrowRight className="size-4" aria-hidden="true" /></Link>
        </div>
      </div>
      <InventoryScreen />
    </>
  );
}
