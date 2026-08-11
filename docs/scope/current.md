# Status — 2026-08-11 (session 33)

Last commit on main: `84a725a` (`lis-platform`, FEAT-046's squash-merge) / `654a892`
(`lis-engineering`) — this breadcrumb refresh itself lands as a further `lis-platform` commit on
top of that, so this line will already be one commit behind by construction — check
`git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## M10 (EPIC-009, Commercial Readiness) kicked off this session — three features shipped, completing the milestone's own literal exit criterion

M9 was fully code-complete going in (session 32), blocked only on a human staging demo. This
session picked M10 as the next independently-startable milestone (per session 32's own
carried-forward note) and shipped FEAT-045, FEAT-049, and FEAT-046 in full — plan → approve →
implement → test → PR → CI → merge, each with real Postgres/Keycloak-backed tests throughout —
completing M10's own stated exit criterion ("a second tenant self-onboards, runs isolated in its
region, and is billed") before the milestone's other two features were even started. A fourth
feature, FEAT-047, was planned and approved but deliberately **not** built this session (human
chose to stop after `/plan`) — its proposal + ADR-0042 are ready for `/develop` to pick up cold in
a future session.

### FEAT-045 (Tenancy tiers, schema/DB isolation) — merged PR #487, issue #54 closed, ADR-0038/ADR-0039

Global `tenant` registry table + `TenantResolverService`; `TenantContextInterceptor` binds
`search_path` for a `dedicated_schema` tenant (same transaction-scoped `set_config` mechanism
ADR-0010 already established for `app.tenant_id`). `dedicated_db` (tier 3) is a real enum value
with no working routing path — fails closed, deferred. Closed issue #145 (RLS-exemption ADR,
flagged across multiple prior sessions) via ADR-0038's `-- RLS-exempt per ADR-NNNN` marker
convention, now recognized by the Constitution gate's own diff-based check — confirmed live: the
marker convention already existed unwittingly in ADR-0004's own migration comments, no retrofit
needed. `rls-multi-tenancy` Skill entries #7/#8 (lis_app can't provision its own schema; proving
cross-schema isolation needs a rogue tenant *inside* one schema, not just proof two schemas don't
share rows — the check's own first draft was a tautology, caught by its own deliberate-break test).

### FEAT-049 (Self-service onboarding) — merged PR #488, issue #58 closed, ADR-0040

The one deliberately public, unauthenticated route in this codebase (`POST /onboarding/signup`).
New `lis-onboarding` Keycloak service-account client (`manage-users` + `view-realm` — corrected
mid-implementation, `manage-users` alone 403s on the role-lookup a role assignment needs).
`unmanagedAttributePolicy: "ENABLED"` promoted into `lis-realm.json`'s own committed `components`
block, closing `authentication` Skill entry #14's long-flagged gap (no longer a live-only fix that
doesn't survive a Keycloak container recreate). `seedStarterCatalog` re-runs the existing seed SQL
files verbatim with the tenant literal substituted, rather than a hand-ported reimplementation.
Real findings: a live-created Keycloak user needs `email`/`firstName`/`lastName` set at creation
time or login fails "Account is not fully set up"; `apps/web/proxy.ts`'s matcher needed an explicit
`/signup` path entry — a `(public)` route group is invisible to middleware path matching, same
"parens don't affect the URL" fact `frontend-design` entry #9 already established for Next's
router, just for middleware instead of routing this time.

### FEAT-046 (Billing & payments) — merged PR #490, issue #55 closed, ADR-0041

Completes M10's own exit criterion. Real tension surfaced and resolved: issue #55's own named
Stitch prompts describe a fuller invoicing/AR/refunds suite than KB-35/36's canonical "never
rebuild the ERP" architecture permits — ADR-0041 reads KB-36's own diagram literally (invoice +
payment-status tracking is in scope; a ledger/AR subledger/insurance adjudication never is).
`invoice`/`invoiceLineItem`/`payment` snapshot billing code/price at generation time; a test with
no price configured cannot be invoiced (400, never a silent $0). `StubMobileMoneyProvider` is the
only shipped provider, mirroring FEAT-041's own stub-provider precedent. Deferred Invoice
List/Outstanding Balances/Refunds (Stitch §17.1/17.5/17.6) filed as issue #489, not built. **Two
real, general (not billing-specific) findings, now in a new `engineering/billing` Skill:**
(1) `stableStringify` (`packages/db/src/audit.ts`) silently discards a raw JS `Date`'s value
(`Object.keys` on a `Date` returns `[]`), breaking the audit hash chain the moment this feature's
first `invoice.generate` call ran alongside `capability-check.e2e-spec.ts`'s own aggregate
chain-validity check — root-caused by querying the actual broken row directly, fixed via explicit
ISO-string DTO mappers matching every other controller's existing (previously unwritten)
convention. (2) A `@Param()`/`@Body()` typed as a bare inline object rather than a `createZodDto`
class silently produces no OpenAPI path-parameter documentation — found by diffing the regenerated
SDK schema against `order.controller.ts`'s own correctly-documented route, not by any
typecheck/lint/test failure.

### FEAT-049's own process gap, fixed at the source

`engineering/api-design` entry #8 (`ZodValidationPipe` can't see a DTO type under this repo's
vitest harness) recurred from scratch in FEAT-049's onboarding controller — root-caused to that
feature's own Implementation Proposal never listing `api-design` in its Skills-loaded section
despite adding a new `apps/api` route. Fixed at the process level, not just the code: the `plan`
Skill's own checklist now requires `api-design` for any new route, the same way it already requires
`frontend-design` for any new page — FEAT-046 and FEAT-047's own proposals both loaded it correctly
from the start afterward, no repeat.

### FEAT-047 (Visual report designer v1) — planned and approved, not built this session

Same KB-vision-vs-literal-AC tension pattern as FEAT-046: KB-13 describes a full node
catalog/visual logic builder/live dual-mode preview/version diff; ADR-0042 scopes v1 to a
structured section/field canvas over FEAT-032's already-shipped template-engine API instead — the
same narrowing discipline FEAT-032's own proposal already applied to KB-12 for itself. Proposal
(`docs/plans/feat-047-visual-report-designer-v1.md`, Status: APPROVED) and ADR-0042 (accepted) are
both ready; **no code exists yet** — the human explicitly chose to stop here rather than continue
into `/develop`, after three full features already shipped this session.

### `/close` cycle

Per `~/work/lis-engineering/session-close-reports/2026-08-11-1011-pre.md`'s four pending items, all
addressed this round:
1. **Breadcrumb refresh** — this file.
2. **FEAT-047 proposal committed** to `lis-platform` (was sitting untracked — its own ADR-0042 was
   already live in `lis-engineering`, the proposal file itself had not been pushed).
3. **`gh pr create`/`gh pr merge` REST-fallback documentation** — AGENTS.md gained the two missing
   REST substitutes beside its existing CI-polling one, closing a gap this session hit twice live
   (PR #488's create, PR #490's merge) with no documented command to reach for either time.
4. **Manual verification items** — [to be resolved in the same pass as the above; see this file's
   own git history if this note wasn't yet updated to reflect their actual resolution].

## Carried into next session

- **M10 (EPIC-009) is now 3/6 features complete** (FEAT-045/049/046), including its own literal
  exit criterion. Remaining: FEAT-047 (proposal ready, not built — pick up via `/develop` directly,
  no re-planning needed), FEAT-048 (i18n, Medium, dependency-unblocked), FEAT-050 (DR/backup
  rehearsal & scale hardening, Critical, dependency-unblocked but likely needs real staging/droplet
  credentials this environment may not have — flagged, not confirmed, before attempting).
- Issue #489 (FEAT-046's own deferred Invoice List/Outstanding Balances/Refunds) is new this
  session, open, unstarted.
- **Issue #292 (no CI check for OpenAPI/SDK schema drift) looks stale, not confirmed closed.**
  `build-and-test` demonstrably caught real OpenAPI/SDK drift live this session (FEAT-049's
  onboarding route), which is exactly what #292 claims doesn't happen — worth a real check next
  session (read the actual CI step, not just this note) before closing it, not assumed from this
  breadcrumb alone.
- Issue #430 (rls-isolation-check.ts fixture-coverage gap) grew by three more tables this session
  (`invoice`/`invoiceLineItem`/`payment` join the existing 7) — same known, already-tracked root
  cause, not a new issue; each new feature's own dedicated e2e test still independently proves
  isolation on its own tables regardless.
- Issue #145 (RLS-exemption ADR) is now **closed** — see FEAT-045 above. Remove from any future
  "still open" carry-forward list.
- M6's own remaining item (FEAT-027) is still blocked on the design partner naming their actual
  instrument, unchanged.
- Issue #440 (specimen exhaustion/expiry tracking) remains open, unstarted, unchanged.
- Issue #427 (backfill missing M1-M5 retrospectives), #267 (pnpm-workspace config ignored in CI)
  both remain open, untouched since filed.
- The real Tailscale/OpenTofu edge-node provisioning for `apps/gateway` still needs a human's
  `tofu apply`.
- Manual verification still owed by a human (carried/new this session — see the pre-close report
  for full detail): FEAT-049's `/signup` UX + confirming `lis-onboarding`'s dev secret gets rotated
  before any real deploy; FEAT-046's take-payment UX + confirming the placeholder billing
  metadata reads unambiguously as placeholder; FEAT-045's Constitution-gate marker-recognition
  logic, worth a human read beyond its own automated deliberate-break test. Still not done by a
  human (carried from session 28/29): a live technologist pass on FEAT-024's notes-textarea/
  grade-button spacing, and a live pass confirming FEAT-022's SLA amber/red badges read clearly at
  a glance.
