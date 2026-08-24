import type { SessionPayload } from './session';

/**
 * TASK-057 (FEAT-015 revision §2/§10 Q3): this repo's first frontend
 * role-visibility check -- every write path built so far (`enter_result`)
 * was granted to both seeded roles, so no screen has ever needed to branch
 * UI by role before now (`verify` is pathologist-only, TASK-055).
 *
 * Deliberately narrow: checks `session.roles.includes('pathologist')` directly,
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
export function hasPathologistRole(session: SessionPayload | undefined): boolean {
  return Boolean(session && Array.isArray(session.roles) && session.roles.includes('pathologist'));
}

/**
 * TASK-070 (FEAT-020, ADR-0019 Decision 3): the `qa` realm role added
 * alongside the new `resolve_qc` capability. Same fail-closed shape and same
 * "UI-visibility convenience only" caveat as `hasPathologistRole` above --
 * `apps/api`'s own `CapabilityGuard`/`resolve_qc` grant is the real
 * enforcement point (`qc-rule-violation.controller.ts`); this only decides
 * whether the Resolve button renders at all.
 */
export function hasQaRole(session: SessionPayload | undefined): boolean {
  return Boolean(session && Array.isArray(session.roles) && session.roles.includes('qa'));
}

/**
 * FEAT-022 Part 2 (worklist bulk-select/assign/cancel UI): gates the
 * bulk-select checkboxes and bulk-action bar entirely. `manage_orders`
 * (`apps/api/src/auth/capabilities.ts`) -- the real capability guarding both
 * `POST /v1/worklist/bulk-assign`/`bulk-cancel` -- is granted only to
 * `technologist`, not `pathologist`. Same fail-closed shape and same
 * "UI-visibility convenience only" caveat as `hasPathologistRole`/`hasQaRole`
 * above -- `apps/api`'s own `CapabilityGuard` is the real enforcement point;
 * this only decides whether the bulk controls render at all.
 */
export function hasTechnologistRole(session: SessionPayload | undefined): boolean {
  return Boolean(session && Array.isArray(session.roles) && session.roles.includes('technologist'));
}

/**
 * FEAT-066 (ADR-0053, docs/plans/feat-066-patient-contact-referring-facility.md):
 * gates the "add referring facility" form. `manage_patients`
 * (`apps/api/src/auth/capabilities.ts`) -- the real capability guarding
 * `POST /v1/referring-facilities` (reused, not a new capability) -- is
 * granted to both `technologist` and `pathologist`. Same fail-closed shape and
 * same "UI-visibility convenience only" caveat as the checks above.
 */
export function hasPatientManagementRole(session: SessionPayload | undefined): boolean {
  return Boolean(
    session &&
      Array.isArray(session.roles) &&
      (session.roles.includes('technologist') ||
        session.roles.includes('pathologist') ||
        // Issue #701: 'reception' also carries manage_patients.
        session.roles.includes('reception') ||
        // Pilot-readiness audit fix: lab_admin (#701) now carries
        // manage_patients too -- capabilities.ts's own header comment on
        // that grant explains why (referring-facility CRUD, the concrete
        // gap this fixes, rides on manage_patients).
        session.roles.includes('lab_admin')),
  );
}

/**
 * Issue #624: gates the "Screen" action on the case detail page. `manage_specimens`
 * (`apps/api/src/auth/capabilities.ts`) -- the real capability guarding `POST /v1/cases/:id/screen`
 * -- is granted to both `technologist` and `pathologist`, identical to `manage_patients`'s own grant
 * (confirmed directly). A separate helper rather than reusing `hasPatientManagementRole` under the
 * wrong name -- matches this file's own convention of one narrowly-named helper per real
 * capability, even when two capabilities happen to share a role set. Same fail-closed shape and
 * same "UI-visibility convenience only" caveat as every other helper above.
 */
export function hasSpecimenManagementRole(session: SessionPayload | undefined): boolean {
  return Boolean(
    session &&
      Array.isArray(session.roles) &&
      (session.roles.includes('technologist') || session.roles.includes('pathologist')),
  );
}

/**
 * Issue #489 (§17.1 only, docs/plans/task-489-invoice-list.md): gates the
 * new invoice list page/entry point. `manage_billing`
 * (`apps/api/src/auth/capabilities.ts`) -- the real capability guarding
 * `GET /v1/invoices` -- is granted to both `technologist` and `pathologist`,
 * identical to `manage_specimens`'s own grant (confirmed directly). A
 * separate helper rather than reusing `hasSpecimenManagementRole` under the
 * wrong name -- matches this file's own one-helper-per-capability
 * convention, even when two capabilities happen to share a role set. Same
 * fail-closed shape and same "UI-visibility convenience only" caveat as
 * every other helper above.
 */
export function hasBillingRole(session: SessionPayload | undefined): boolean {
  return Boolean(
    session &&
      Array.isArray(session.roles) &&
      (session.roles.includes('technologist') ||
        session.roles.includes('pathologist') ||
        // Issue #701: 'cashier' also carries manage_billing.
        session.roles.includes('cashier') ||
        // Pilot-readiness audit fix: lab_admin now carries manage_billing
        // too -- confirmed live, the org-signup owner got an uncaught 500
        // trying to view invoices before this.
        session.roles.includes('lab_admin')),
  );
}

/**
 * Pilot-readiness audit fix (P0): gates the "add a test"/"add a reference
 * range" forms. `manage_catalog` (`apps/api/src/auth/capabilities.ts`) --
 * the real capability guarding `POST /v1/test-definitions` and
 * `POST /v1/reference-ranges` -- is granted to `qa` and, as of this fix,
 * `lab_admin` too. Deliberately its own helper, not folded into
 * `hasQaRole()` -- `manage_report_templates`/`resolve_qc` (both still
 * `qa`-only, `hasQaRole()`'s other real callers) must NOT widen to
 * `lab_admin` just because this one capability did.
 */
export function hasCatalogManagementRole(session: SessionPayload | undefined): boolean {
  return Boolean(
    session &&
      Array.isArray(session.roles) &&
      (session.roles.includes('qa') || session.roles.includes('lab_admin')),
  );
}

/**
 * Issue #703 (EPIC #697): gates the "Users" nav entry / admin screen.
 * `manage_users` (`apps/api/src/auth/capabilities.ts`) -- the real
 * capability guarding every `/v1/users` route -- is granted only to
 * `lab_admin` (#701). Same fail-closed shape and same "UI-visibility
 * convenience only" caveat as every other helper above.
 */
export function hasLabAdminRole(session: SessionPayload | undefined): boolean {
  return Boolean(session && Array.isArray(session.roles) && session.roles.includes('lab_admin'));
}
