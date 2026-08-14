export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6" aria-label="Loading page">
      <div className="skeleton mb-7 h-9 w-48 rounded-2xl" />
      <div className="skeleton mb-4 h-44 rounded-[2rem]" />
      <div className="grid grid-cols-2 gap-3">
        <div className="skeleton h-28 rounded-3xl" />
        <div className="skeleton h-28 rounded-3xl" />
      </div>
    </div>
  );
}
