export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[60rem] px-5 pt-7 sm:px-8 md:pt-9" aria-label="Loading page">
      <div className="skeleton h-3 w-28 rounded-full" />
      <div className="skeleton mt-5 h-8 w-80 max-w-full rounded-[16px]" />
      <div className="skeleton mt-10 h-14 rounded-[20px]" />
      <div className="skeleton mt-3 h-14 rounded-[20px]" />
      <div className="skeleton mt-3 h-14 rounded-[20px]" />
    </div>
  );
}
