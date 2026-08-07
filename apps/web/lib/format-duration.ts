/**
 * TASK-062 (FEAT-017 revision, §10 Q3, approved): plain formatted duration
 * text only, no color-coding -- matches TASK-061's own "computed
 * elapsed-time only, no stored SLA" decision (docs/plans/
 * feat-017-minimal-worklist.md).
 */
export function formatDuration(ageMinutes: number): string {
  if (ageMinutes < 60) return `${ageMinutes}m`;
  const hours = Math.floor(ageMinutes / 60);
  const minutes = ageMinutes % 60;
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
