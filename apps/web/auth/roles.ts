import type { SessionPayload } from './session';

/**
 * TASK-057 (FEAT-015 revision §2/§10 Q3): this repo's first frontend
 * role-visibility check -- every write path built so far (`enter_result`)
 * was granted to both seeded roles, so no screen has ever needed to branch
 * UI by role before now (`verify` is verifier-only, TASK-055).
 *
 * Deliberately narrow: checks `session.roles.includes('verifier')` directly,
 * not a duplicated `apps/api`-style capability map -- this task adds only
 * the one specific check it needs (proposal §5), matching the "don't build
 * ahead of a real need" precedent every prior task in this feature used.
 *
 * Fails closed: a missing/undefined session, or a malformed `roles` (not
 * really an array, despite `SessionPayload`'s own type) hides the control
 * rather than showing it. This is a UI-visibility convenience only, not a
 * security boundary -- `apps/api`'s own `CapabilityGuard`/`verify`
 * capability grant is the real enforcement point (TASK-055); this helper
 * only decides whether to render the affordance at all.
 */
export function hasVerifierRole(session: SessionPayload | undefined): boolean {
  return Boolean(session && Array.isArray(session.roles) && session.roles.includes('verifier'));
}
