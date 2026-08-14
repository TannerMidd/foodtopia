"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[70dvh] w-full max-w-lg items-center px-5 py-12">
      <section className="w-full rounded-[2rem] border border-[var(--line)] bg-[var(--card)] p-7 text-center shadow-[var(--shadow)]">
        <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-[var(--tomato-soft)] text-[var(--tomato)]">
          <AlertTriangle aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">That didn’t come together</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Your offline changes are kept on this device. Try the page again when you’re ready.
        </p>
        <Button className="mt-6 w-full" onClick={reset}>Try again</Button>
      </section>
    </main>
  );
}
