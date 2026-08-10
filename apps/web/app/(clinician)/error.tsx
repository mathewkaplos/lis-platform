'use client';

import { Button } from '@lis/ui';

export default function ClinicianDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm text-danger">{error.message || 'Something went wrong loading the dashboard.'}</p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
