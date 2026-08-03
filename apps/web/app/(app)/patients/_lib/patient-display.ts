// TASK-041 (FEAT-011): shared display helpers for the search + profile
// screens. `birthDate` is nullable (domain/patient-identity Skill entry #3,
// null = genuinely unknown) -- age always shows "Unknown" for a null date,
// never a misleading computed default.
export const SEX_LABEL: Record<string, string> = {
  M: 'Male',
  F: 'Female',
  U: 'Unknown',
};

export function ageOf(birthDate: string | null): string {
  if (!birthDate) return 'Unknown';
  const dob = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hadBirthdayThisYear =
    now.getMonth() > dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return String(age);
}
