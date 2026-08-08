export default function ChartLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6" aria-busy="true" aria-live="polite">
      <div className="h-6 w-64 animate-pulse rounded-md bg-accent" />
      <div className="h-80 w-full animate-pulse rounded-md bg-accent" />
      <span className="sr-only">Loading chart…</span>
    </div>
  );
}
