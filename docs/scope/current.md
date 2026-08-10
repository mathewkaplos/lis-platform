# Status — 2026-08-10 (session 31)

Last commit on main: `c9f40ca` (`lis-platform`) / `116f467` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already be
one commit behind by construction — check `git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## M8 (EPIC-007, Interoperability & Portals) fully shipped this session — all five features, code-complete

Continued from session 30 (context compacted mid-task, resumed directly per the `SessionStart:compact`
hook, no fresh-session Rule #0 gate). Shipped the entirety of M8 in one session: FEAT-036, FEAT-040,
FEAT-037, FEAT-039, and FEAT-038, each through the full plan → approve → implement → test → PR → CI →
merge → mark-IMPLEMENTED lifecycle, with real Postgres/Keycloak-backed tests throughout.

### FEAT-036 (HL7 v2 inbound/outbound via ACL) — merged PR #460, issue #45 closed, ADR-0034/0035

New `apps/interop` app (central-hosted, matching `apps/api`/`apps/web`'s deploy shape, not
`apps/gateway`'s edge/Tailscale one — corrected mid-ADR after verifying `apps/gateway` has no
docker-compose entry at all). Real MLLP ORM-inbound → ORU-outbound round trip via `node-hl7-server`/
`node-hl7-client`, bridged into `apps/api` via a new `interop_ingest` machine-caller capability
(ADR-0026 precedent) and `OrderCreationService` extracted as the shared "one write path" (ADR-0027) —
reused three more times later this same session.

### FEAT-040 (fine-grained ABAC / relationship authz) — merged PR #462, issue #49 closed

New `care_relationship` table (Postgres-resident, per ADR-0011's own anticipated resolution) +
`clinician-scope.ts` (`isClinicianOnly`/`relatedPatientIds`) scoping `PatientController`'s existing
routes. New `engineering/authz` Skill, reused directly by FEAT-039 and FEAT-038 later this session.

### FEAT-037 (FHIR R4 façade) — merged PR #464, issue #46 closed

`GET /fhir/Observation/:id`, real R4-profile validation via `fhir-tool` (the `fhir` package's
maintained successor — confirmed deprecated via `npm view fhir deprecated` before adopting the
replacement). New `domain/fhir-mapping` Skill.

### FEAT-039 (patient portal) — merged PR #466, issue #48 closed; docs-only IMPLEMENTED marker PR #467

New `patient_portal_account`/`result_release_policy` tables, `GET /v1/portal/results` (own-identity
ABAC + a genuinely new release-policy mechanism), hand-rolled inline-SVG `TrendChart` (this repo's
own established `levey-jennings-chart.tsx` precedent, no charting-library dependency).

- **Real intermittent-error investigation, root-caused not hand-waved**: a "Something went wrong
  loading your results" error appearing after a successful 200 during manual browser verification
  turned out to be a stale reused session-cookie file spanning more than the Keycloak access token's
  5-minute lifespan across separate script invocations — not a bug in the new route. Confirmed by a
  clean re-run with a freshly minted cookie immediately before use.
- **Real, non-hypothetical local-environment finding**: `rls-isolation-check.ts`'s live cross-tenant
  leak check reported `FAIL` on several *pre-existing* tables (not the two new ones) after this
  session's own accumulated e2e runs left genuine cross-tenant test residue in a long-lived local
  Postgres container — traced via direct row count, not assumed a real RLS defect. Documented as
  `engineering/testing` Skill entry #14.

### FEAT-038 (clinician portal) — merged PR #468, issue #47 closed; docs-only IMPLEMENTED marker PR #469

The last M8 feature. A clinician can place an order, view a verified result (bypassing the
patient-portal release delay), and acknowledge a critical with a documented read-back — scoped to
`relatedPatientIds()` only, never the whole tenant. Three new capabilities
(`place_order_own_patient`/`view_related_patient_results`/`acknowledge_critical_own_patient`), each
RBAC+ABAC paired.

- New `POST /v1/patients/:id/care-relationships` (staff-assign) — the one new mechanism this task
  added, since `care_relationship` previously had no way to exist outside a direct DB insert
  (FEAT-040's own deferred scope).
- `CriticalAcknowledgeService` extracted from the existing staff-only controller (ADR-0027, fourth
  reuse this session) — hit and fixed a real NestJS DI circular-import (`critical-notification.
  controller.ts` ↔ the new service, via a shared pure mapper); documented as `engineering/api-design`
  Skill entry #16.
- **Found and fixed a real, pre-existing gap** while building this: `GET /v1/critical-notifications`
  had no ABAC at all — any authenticated caller, `clinician` included, could already see every tenant
  patient's criticals. Scoped it the same way `PatientController` already is.
- Two real Next.js bugs hit and fixed building the new `(clinician)` route group, both now documented
  in `engineering/frontend-design` (entry #9 new; entry #8 recurrence noted, its *third*): a Server
  Component passing function-valued `DataTable` columns to a Client Component (RSC serialization
  failure), and a route group's parentheses not adding a URL prefix — `(clinician)`/`(app)` both
  resolving to `/patients/[id or patientId]/...` crashed the dev server at boot until a literal
  `clinician/` segment folder was added, mirroring `(portal)/portal/...`'s own existing precedent.
- Two Stitch `generate_screen_from_text` calls for the required "§3.8 Doctor Dashboard" screen both
  timed out with no resulting screen (confirmed via `list_screens`); shipped with a hand-composed
  dashboard using existing `packages/ui` primitives instead, noted as a real gap in the PR rather than
  silently dropped.

### `/retro` cycle — `plan` skill missing a mechanical `frontend-design` trigger, logged in `CHANGELOG.md`, merged PR #470

FEAT-038's own proposal never loaded `engineering/frontend-design` despite adding new `apps/web`
surface, and went on to hit two mistakes that Skill already documented by name. `plan/SKILL.md` step 2
now mechanically requires that Skill whenever Affected Files adds a new `apps/web` page/form/component,
regardless of what the feature's GitHub issue names.

### `/close` cycle — Pre-Close Report items addressed, not deferred

Per `~/work/lis-engineering/session-close-reports/2026-08-10-1836-pre.md`'s four pending items, all
four resolved this same session rather than carried forward:

1. **Breadcrumb refresh** — this file.
2. **New Engineering Flow Retrospective finding, approved and applied**: the ADR-0027
   circular-import gotcha above — `engineering/api-design` Skill entry #16.
3. **Dark-mode + keyboard-navigation verification, performed live**: `/clinician` (dashboard,
   per-patient results, order-entry) and `/portal/results` all confirmed rendering correctly under
   `prefers-color-scheme: dark` (zero console errors), and fully operable keyboard-only — tabbed to
   and submitted the dashboard's inline "Acknowledge" form via Enter (confirmed via a real DB row
   flip, not just a UI glance) and toggled the order-entry catalog's panel checkbox via Space
   (confirmed the order summary updated).
4. **First real design look at the Doctor Dashboard, with two real fixes found and shipped** (merged
   PR #471): the MRN column wasn't monospace (every other table in this app already wraps MRN in
   `font-mono`) and the escalation-level indicator was plain colored text where the rest of the app
   uses `Badge variant="destructive"` for the same class of state (`worklist-view.tsx`'s own SLA
   badge) — both fixed, confirmed visually in both themes.

## Carried into next session

- **M8 (EPIC-007) is now code-complete** — all five features (FEAT-036/037/038/039/040) merged and
  closed. The epic issue itself (#7) stays open by its own stated Definition of Done (a staging demo
  to the design-partner lab, not more code) — same pattern as M7's own epic (#6), not something a
  session can close autonomously.
- **Next session:** with M7 and M8 both code-complete (both epics blocked only on a human staging
  demo), check whether a milestone after M8 (per the Execution Plan) has any independently-startable
  issue — not assumed from this file alone, worth a fresh `/orient` milestone check. M6's own
  remaining item (FEAT-027) is still blocked on the design partner naming their actual instrument,
  unchanged.
- Issue #440 (specimen exhaustion/expiry tracking) remains open, unstarted (carried unchanged since
  session 29).
- Issues #427, #430 remain open, both deferred/filed in session 29, untouched since.
- The real Tailscale/OpenTofu edge-node provisioning for `apps/gateway` still needs a human's
  `tofu apply`.
- Still not done by a human (carried from session 28/29): a live technologist pass on FEAT-024's
  notes-textarea/grade-button spacing, and a live pass confirming FEAT-022's SLA amber/red badges
  read clearly at a glance.
