import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70dvh] w-full max-w-[26rem] items-center px-6 py-12">
      <div className="w-full">
        <p className="ml">not found</p>
        <h1 className="hd mt-3 text-[26px]">Nothing simmering here.</h1>
        <p className="bd mt-2.5">This page may have moved or expired.</p>
        <Link
          href="/"
          className="glow mt-7 inline-flex min-h-12 items-center rounded-lg px-6 text-[15px] font-semibold"
        >
          Back to today
        </Link>
      </div>
    </main>
  );
}
