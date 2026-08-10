export default function ClinicianPatientResultsLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6" aria-busy="true" aria-live="polite">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-24 animate-pulse rounded-md bg-accent" />
        <div className="h-24 animate-pulse rounded-md bg-accent" />
        <div className="h-24 animate-pulse rounded-md bg-accent" />
      </div>
      <div className="h-64 w-full animate-pulse rounded-md bg-accent" />
      <span className="sr-only">Loading results…</span>
    </div>
  );
}
