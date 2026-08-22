"use client";

import Link from "next/link";
import { InventoryScreen } from "./inventory-screen";

export function OfflineFallback() {
  return (
    <>
      <div className="mx-auto w-full max-w-[60rem] px-5 pt-5 sm:px-8" role="status">
        <p className="ml">device-only offline kitchen</p>
        <p className="bd mt-2.5 max-w-[34rem] text-[12px] text-[var(--ink-6)]">
          This static fallback carries no server or household payload. Everything below comes from
          this device&rsquo;s own snapshot; edits join the ordered outbox.{" "}
          <Link href="/" className="border-b border-[var(--edge-strong)] text-[var(--ink-3)]">
            try the app again
          </Link>
        </p>
      </div>
      <InventoryScreen />
    </>
  );
}
