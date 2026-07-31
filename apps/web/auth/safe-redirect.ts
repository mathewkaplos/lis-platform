/**
 * The `rd` query param on /api/auth/login is attacker-influenceable (any
 * unauthenticated visitor can set it). Restrict it to a same-app relative
 * path, never an absolute/protocol-relative URL -- otherwise a crafted
 * /api/auth/login?rd=https://evil.example link would send an authenticated
 * user's post-login redirect off-site (open redirect).
 */
export function sanitizeRedirectPath(candidate: string | null): string {
  if (!candidate) {
    return '/';
  }
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return '/';
  }
  return candidate;
}
