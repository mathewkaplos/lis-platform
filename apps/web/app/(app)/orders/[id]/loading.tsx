export default function OrderDetailLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6" aria-busy="true" aria-live="polite">
      <div className="mx-auto h-64 w-full max-w-2xl animate-pulse rounded-md bg-accent" />
      <span className="sr-only">Loading order…</span>
    </div>
  );
}
