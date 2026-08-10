export default function ClinicianDashboardLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6" aria-busy="true" aria-live="polite">
      <div className="h-40 w-full animate-pulse rounded-md bg-accent" />
      <div className="h-64 w-full animate-pulse rounded-md bg-accent" />
      <span className="sr-only">Loading your dashboard…</span>
    </div>
  );
}
