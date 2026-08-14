import Link from "next/link";
import { ArrowLeft, Soup } from "lucide-react";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70dvh] w-full max-w-lg items-center px-5 py-12 text-center">
      <section className="w-full rounded-[2rem] border border-[var(--line)] bg-[var(--card)] p-8 shadow-[var(--shadow)]">
        <Soup className="mx-auto mb-5 size-12 text-[var(--leaf)]" aria-hidden="true" />
        <h1 className="text-2xl font-bold">Nothing simmering here</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">This page may have moved or expired.</p>
        <Link href="/" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--leaf)] px-5 font-semibold text-white">
          <ArrowLeft className="size-4" aria-hidden="true" /> Home
        </Link>
      </section>
    </main>
  );
}
