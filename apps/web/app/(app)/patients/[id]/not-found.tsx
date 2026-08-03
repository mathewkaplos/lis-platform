import Link from 'next/link';
import { Button } from '@lis/ui';

// TASK-041 (FEAT-011): the profile page's real "not found" error state,
// triggered by page.tsx's notFound() call. A cross-tenant id and a
// genuinely nonexistent id both land here (engineering/api-design Skill
// entry #7) -- deliberately not distinguished, since RLS makes them
// structurally indistinguishable at the API layer.
export default function PatientNotFound() {
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <h1 className="text-lg font-semibold text-foreground">Patient not found</h1>
      <p className="text-sm text-text-secondary">
        This patient doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Button asChild>
        <Link href="/patients">Back to search</Link>
      </Button>
    </div>
  );
}
