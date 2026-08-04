export default function OrdersLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6" aria-busy="true" aria-live="polite">
      <div className="h-7 w-32 animate-pulse rounded-md bg-accent" />
      <div className="h-24 animate-pulse rounded-md bg-accent" />
      <div className="h-64 animate-pulse rounded-md bg-accent" />
      <span className="sr-only">Loading orders…</span>
    </div>
  );
}
