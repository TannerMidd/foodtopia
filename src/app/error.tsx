"use client";

import { Button } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[70dvh] w-full max-w-[26rem] items-center px-6 py-12">
      <div className="w-full">
        <p className="ml">something went wrong</p>
        <h1 className="hd mt-3 text-[26px]">That didn&rsquo;t come together.</h1>
        <p className="bd mt-2.5">
          Your offline changes are kept on this device. Try the page again when you&rsquo;re ready.
        </p>
        <Button className="mt-7" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
