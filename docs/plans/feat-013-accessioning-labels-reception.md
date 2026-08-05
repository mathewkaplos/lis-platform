# Implementation Proposal: FEAT-013 Accessioning, labels & reception
Status: TASK-045 IMPLEMENTED — merged PR #297 (`792e373`), closing #104. TASK-047 IMPLEMENTED —
merged PR #300 (`8081c2f`), closing #106. TASK-046 IMPLEMENTED (pending merge) — implementation
complete and verified 2026-08-05, PR not yet opened. TASK-048 remains open, to be specified as its
own revision once TASK-046 merges, same precedent as FEAT-011/FEAT-012.
ADR: none — §10 Q1's resolution (a SEQUENCE-based generator, diverging from `engineering/api-design`
entry #9) is written up as a new Skill entry (§10), not an ADR: it's a documented technique choice
with a stated rationale and a real precedent already in this schema (`audit_event.sequence`), not a
cross-cutting architectural decision of ADR weight.
Date: 2026-08-05    Backlog ID: FEAT-013 (#22) / TASK-045 (#104)

## 1. Goal

FEAT-012 (Order entry) is fully closed — all three tasks merged, the feature and its last task
closed via comment 2026-08-04. EPIC-003 (Pre-Analytical Workflow) names FEAT-013 as its one
remaining feature. FEAT-013's own stated dependency, FEAT-012, is satisfied (`order`/`ordered_test`
now have real create/search/cancel behavior for TASK-047's reception flow to build against).

FEAT-013 lists four tasks: TASK-045 (accession numbering), TASK-046 (label rendering, depends on
TASK-045), TASK-047 (reception screen, depends on TASK-045), TASK-048 (collection queue screen,
depends on TASK-047). **This proposal's approvable scope is TASK-045 only** — the same
scope-narrowing precedent every prior proposal in this repo has used (FEAT-010 §1, FEAT-011's four
revisions, FEAT-012's three). TASK-046/047/048 will be specified as revisions to this same file once
TASK-045's real output (the generator's exact shape and return type) exists.

**Real, load-bearing finding from this proposal's own research, not present in TASK-045's issue
text:** `packages/db/src/schema/specimen.ts` already exists (created by TASK-023/FEAT-006,
migration `0009_order_specimen.sql`) with `accessionNumber: text("accession_number").notNull()` and
a `ux_specimen_tenant_accession` unique index on `(tenant_id, accession_number)` — but **no code
anywhere in this repo has ever inserted into `specimen`** (grepped `\bspecimen\b` across
`apps/api/src`, `apps/web`, `packages/domain/src`: zero hits). This is the same "table exists,
unused" pattern already found twice before (`order`/`ordered_test` before TASK-042, the catalog
tables before TASK-043) — TASK-045 is the first task to give this table's identifier column real
behavior, but not the first task to write a `specimen` row at all: per KB-03
(`03-business-workflows.md:112`, "Receive & Accession. Lab receipt confirms condition and assigns
the accession identifier"), the actual `specimen` row insert belongs to **TASK-047** (reception),
not this task. TASK-045's own issue text ("Expected output: Accession numbering service") already
reflects this — it is scoped to the generation mechanism itself, callable by TASK-047 (and by
TASK-046 for label-format testing) once it exists, not to specimen-row creation.

**Real, load-bearing finding #2:** `apps/api/src/patient/patient.controller.ts`'s own `generateMrn`
comment (written during TASK-039, before this feature was ever scoped in detail) already
anticipated this task by name: *"not TASK-045's own 'collision-safe under concurrent analyzer
writes' mechanism, since patient registration is human-initiated and low-frequency, not a
high-throughput automated feed."* This is a real, pre-existing signal that TASK-045 is expected to
diverge from `engineering/api-design` Skill entry #9's documented convention
(retry-on-unique-violation for server-generated identifiers) rather than simply reuse it — see §6/§10
for why, and why this is raised as an open question rather than assumed.

## 2. Affected files

- `db/migrations/0014_accession_sequence.sql` (new, **hand-written**, not `drizzle-kit generate`
  output — a free-standing Postgres `SEQUENCE` has no equivalent in drizzle's schema-builder
  vocabulary, matching `database-design` Skill entry #5's exact precedent for hand-written
  migrations needing a manually reconciled snapshot). Creates `accession_number_seq` (plain,
  global — not per-tenant, matching `audit_event.sequence`'s own precedent that a single global
  counter is sufficient for per-tenant-scoped uniqueness since the DB-level uniqueness constraint is
  `(tenant_id, accession_number)`, not the sequence itself) and grants it to `lis_app`
  (`GRANT USAGE, SELECT ON SEQUENCE "accession_number_seq" TO "lis_app"` — the exact same grant
  `0010_audit_event.sql` needed for `audit_event_sequence_seq`, confirmed necessary there by
  reproducing a real `permission denied for sequence` failure; applied proactively here rather than
  rediscovered).
- `packages/db/src/accession.ts` (new) — `generateAccessionNumber(db: DbOrTx): Promise<string>`,
  co-located with schema and exported the same way `writeAuditEvent`/`verifyAuditChain` already are
  (`packages/db/src/audit.ts` is the direct precedent: a shared, cross-cutting write-helper with no
  controller of its own at introduction, consumed later by whichever endpoint needs it). Runs
  `SELECT nextval('accession_number_seq')` inside the caller's own transaction and formats the
  result per §5.
- `packages/db/src/index.ts` — `export { generateAccessionNumber } from "./accession"`.
- `apps/api/test/accession.e2e-spec.ts` (new) — real-Postgres concurrency test (§8); no HTTP
  endpoint exists yet to test through, so this imports `generateAccessionNumber` directly from
  `@lis/db`, matching `rls-isolation-check.ts`'s own precedent of exercising `packages/db`-level
  code directly against a real database rather than only through `apps/api`'s HTTP surface. Placed
  under `apps/api/test/` (not a new `packages/db`-level test runner) specifically so it runs
  automatically under CI's existing `pnpm --filter api test:e2e` step — `packages/db` has no vitest
  suite of its own today (only standalone `tsx` scripts), and this repo has hit the "new code isn't
  actually wired into CI" gap multiple times before (`@lis/domain`'s build step, `@lis/sdk`'s import,
  `#292`'s still-open OpenAPI-drift gap) — not adding a fifth instance of it here.

No controller, no domain Zod schema, no new capability — this task exposes no HTTP surface. Those
belong to TASK-047 (the actual specimen-creation endpoint), which will import
`generateAccessionNumber` from `@lis/db` the same way `order.controller.ts` already imports
`writeAuditEvent`.

## 3. Architecture consulted

- **TASK-045 issue (#104) AC**: "Concurrent requests never produce a duplicate accession number."
  Dependency: `TASK-042` (order create/cancel) — merged. Expected output: "Accession numbering
  service."
- **FEAT-013 issue (#22) AC** (the three not owned by this task, cited for context only): "A label
  prints correctly... on the design partner's actual printer" (TASK-046); "Specimen rejection
  requires a coded reason and is fully audited" (TASK-047); "Collection queue correctly lists
  pending collections..." (TASK-048). This task owns none of these directly but its output is a
  hard dependency for the first two.
- **KB-22 Sample Management** (read in full) — "Accessioning assigns the accession identifier —
  unique within the tenant — that becomes the lab's primary handle on the specimen and the basis of
  its barcode. At accessioning, the specimen is linked to the OrderedTests it will fulfil." Confirms
  the identifier is assigned once, at accessioning, not provisionally re-assigned later.
- **KB-03 Business Workflows** (`03-business-workflows.md:77,112`) — canonical lifecycle
  `collected → received → accessioned → in_process → completed → archived/disposed`; step 3,
  "Receive & Accession," is explicitly where "Lab receipt confirms condition and assigns the
  accession identifier" — the real reason specimen-row creation belongs to TASK-047, not this task
  (§1).
- **KB-24 Barcoding** (read in full) — "Identifier: Accession-based... Opaque, privacy-friendly,
  stable handle" and "Label PHI: Minimise PHI... lean on the opaque accession ID rather than print
  patient identifiers." Directly shapes §5's format choice (no patient-derived component) and §10's
  question (length/legibility trade-off for Code 128, TASK-046's own concern).
- **`packages/db/src/schema/specimen.ts`** (read in full, TASK-023) — `accessionNumber: text
  NOT NULL`, `ux_specimen_tenant_accession` unique on `(tenant_id, accession_number)`; confirmed via
  grep that no code has ever written to this table (§1).
- **`packages/db/src/schema/audit.ts` / `db/migrations/0010_audit_event.sql`** (read in full) — the
  direct precedent for both the hand-written-sequence-migration mechanics (§2) and the
  `GRANT USAGE, SELECT ON SEQUENCE` gotcha, already hit once for `audit_event_sequence_seq` and
  proactively applied here rather than rediscovered.
- **`apps/api/src/patient/patient.controller.ts`** (`generateMrn`, read in full) — the
  retry-on-unique-violation precedent this task deliberately does not reuse, and the comment that
  already named this task by number (§1 finding #2).
- **`engineering/api-design` Skill** — entry #9 (server-generated identifiers use
  retry-on-unique-violation) is the convention this task diverges from; entry #10 (boot the real
  compiled server before trusting an endpoint) not directly applicable (no endpoint here); entries
  #11/#12 (real bugs found via TASK-042) re-checked, neither applies (no action sub-resource, no new
  CHECK constraint on an existing populated table introduced by this task).
- **`database-design` Skill** — entry #2 (forward references — not applicable, `specimen` already
  exists with no forward-reference gap); entry #5 (hand-written migrations need a manually
  reconciled snapshot) directly governs §2's migration; entry #4 (grep every insert call site on a
  table gaining a new constraint) re-checked — this task adds no new constraint to an
  already-populated table (`specimen` has zero real rows in any environment).

## 4. Skills loaded

- `engineering/api-design` — in full, see §3. Entry #9 is the specific convention this proposal
  weighs diverging from (§6/§10).
- `database-design` — in full, see §3. Entry #5 directly shapes §2's hand-written-migration
  mechanics.
- `rls-multi-tenancy` — re-checked; not directly implicated (this task adds no new tenant-scoped
  table or RLS policy — `specimen`'s own RLS policy already exists from TASK-023). The sequence
  object itself is global, not tenant-scoped, matching `audit_event.sequence`'s own precedent that a
  global counter is compatible with per-tenant data isolation as long as the *uniqueness constraint*
  consumers rely on (`ux_specimen_tenant_accession`) remains tenant-scoped.
- `testing` — re-checked; its "verify against the real harness, not a mock" standard shapes §8's
  insistence on a real concurrency test against real Postgres, not a mocked/simulated race.
- `engineering/barcode-printing`, `domain/specimen-lifecycle` — **do not exist yet.** Both are named
  as "Required Skills" by FEAT-013's own issue (#22). Not drafted as part of this proposal: neither
  is load-bearing for TASK-045's own narrow scope (a numbering mechanism, not label rendering or
  broader specimen-lifecycle modeling), and this repo's own established precedent
  (`engineering/api-design`/`domain/patient-identity` before FEAT-011) is to draft a named-but-missing
  Skill from real task decisions once they exist, not speculatively ahead of them. Flagged here so
  TASK-046's revision (which genuinely needs `barcode-printing`) doesn't silently skip drafting it.

## 5. Assumptions & autonomous decisions

- **A single global `SEQUENCE`, not a per-tenant one.** Postgres has no native per-tenant sequence
  primitive without creating one sequence per tenant row (impractical — tenants are created
  dynamically, not part of a fixed schema). A single global sequence's `nextval()` is lock-free and
  never blocks under concurrent callers regardless of tenant, and per-tenant *uniqueness* is already
  guaranteed by the stricter global uniqueness this produces (a global-unique value is trivially also
  tenant-unique) plus the existing `ux_specimen_tenant_accession` constraint as a backstop. Exactly
  `audit_event.sequence`'s own already-shipped precedent and reasoning, reused directly, not
  reinvented.
- **The sequence does not reset daily/yearly.** A continuously-increasing counter avoids an entire
  class of day-boundary coordination bugs (what happens to a request straddling midnight; whether
  "reset" itself needs to be transactionally safe under concurrency) for a benefit — a small number
  restarting at 1 each day — that no KB document requires and no task's AC asks for. Matches this
  repo's stated aversion to building ahead of a real, observed need. A date *prefix* (§10) can still
  give day-legibility without the sequence itself resetting.
- **No new capability, no controller, no domain Zod schema in this task.** TASK-045's own issue
  names no HTTP endpoint, and none is needed to satisfy its literal AC (a concurrency property of the
  generator function itself, testable directly per §8). Adding one now would be inventing scope
  TASK-047 (which does need a real create-specimen endpoint, its own capability, and a
  `specimen`/`specimenSchema` domain type) is better positioned to define correctly, once its own
  real request/response shape exists — same "don't build the consumer ahead of a real need" pattern
  already applied by TASK-042 to `order.priority` in reverse (added early, but only because leaving
  it out would make a stated AC unmeetable) — here, no AC requires an endpoint.
- **`generateAccessionNumber` takes the caller's transaction (`DbOrTx`), not a fresh connection.**
  Matches `writeAuditEvent`'s exact signature convention — whoever calls this (TASK-047's future
  specimen-insert path) will want the sequence read and the specimen row insert to succeed or fail
  together as one unit, not as two separately-committed operations.

## 6. Risks

- **This is a deliberate divergence from `engineering/api-design` Skill entry #9's documented
  convention** (retry-on-unique-violation for server-generated identifiers). The divergence has a
  real, specific justification — `nextval()` is O(1) and lock-free under Postgres's internal
  sequence implementation regardless of concurrent caller count, where retry-on-violation degrades
  (more retries, more wasted round-trips) as concurrent write volume rises, and KB-29's own framing
  of analyzer integration implies specimen-adjacent writes may eventually come from automated,
  higher-throughput sources, not just a single human at a screen — but it is still a new
  cross-cutting pattern this repo hasn't used before for an identifier (only for `audit_event`'s
  internal ordering column, never for a caller-visible business identifier). Raised as §10 Q1 rather
  than silently decided, per Rule #0 ("if a load-bearing decision is missing... STOP and ask") and
  because it's the kind of decision `database-design` Skill entry #1 says to state explicitly rather
  than assume.
- **The literal accession-number string format has no existing convention anywhere in this repo or
  the KB** (`24-barcoding.md`'s own "Open questions" section names "Standard symbology per artifact
  type" but not the identifier's literal text format). Raised as §10 Q2 — the choice affects
  TASK-046's Code 128 barcode payload length and TASK-047/048's on-screen legibility, both real
  downstream consumers that don't exist yet to validate against.
- **`GRANT USAGE, SELECT ON SEQUENCE` is easy to forget** (§2) — `0010_audit_event.sql`'s own header
  comment documents that this exact class of gap was only caught by reproducing a live permission
  failure, not by `drizzle-kit generate` or any static check. Applied proactively here; §8's testing
  plan explicitly re-verifies it by running a real insert as `lis_app`, not just as the migration
  role, so the same class of gap can't recur silently a second time.
- **No real specimen row exists yet to attach a generated accession number to** — this task's own
  concurrency test (§8) proves the generator's collision-safety in isolation, not end-to-end through
  an actual specimen-creation write path. That end-to-end proof is TASK-047's own testing
  responsibility once its endpoint exists; flagged here so it isn't mistaken for already covered.

## 7. Acceptance criteria

TASK-045's literal AC (the only AC this proposal covers):
- [ ] Concurrent requests never produce a duplicate accession number. Judged by: a real-Postgres
  concurrency test (§8) firing many simultaneous calls to `generateAccessionNumber` and asserting
  every returned value is unique — not inferred from the sequence's theoretical guarantees alone.

## 8. Testing plan

1. `pnpm --filter @lis/db typecheck`/build with the new `accession.ts` module.
2. `pnpm db:reset`, confirming `0014_accession_sequence.sql` applies cleanly on top of the existing
   13 migrations, and that a fresh `drizzle-kit generate` afterward produces no further diff
   (`database-design` entry #5's own required check for any hand-written migration).
3. A real e2e spec (`apps/api/test/accession.e2e-spec.ts`), real Postgres, connecting as the actual
   `lis_app` role (not a superuser/migration role) to independently re-verify the `GRANT USAGE,
   SELECT` actually took effect, not assumed from the migration text:
   - a single call returns a syntactically well-formed accession number matching the format decided
     in §10 Q2;
   - **200 concurrent calls** (`Promise.all`, each its own transaction/connection from the existing
     test pool) return 200 distinct values — the literal AC, proven directly;
   - two sequential calls return strictly increasing sequence components (sanity check on the
     underlying `nextval()` behavior, not just uniqueness).
4. The full existing `apps/api` e2e suite re-run and confirmed still green — no regression from the
   new migration (a new sequence object touches no existing table's data or constraints).
5. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

Additive throughout: a new standalone sequence object (not a column on any existing table — dropping
it affects nothing else), a new `packages/db` module, and a new e2e spec. Rollback is reverting the
PR: `packages/db/src/accession.ts` deleted, the export removed from `packages/db/src/index.ts`, and
a down-migration (`DROP SEQUENCE IF EXISTS accession_number_seq`) — `0014_accession_sequence.sql`
itself is never edited after merge, per AGENTS.md's migration rule. No production data or deployed
feature depends on this yet (`specimen` has zero real rows in any persistent environment).

## 10. Questions requiring human approval

1. **RESOLVED 2026-08-05 — use a Postgres `SEQUENCE` (`nextval()`).** Diverges from
   `engineering/api-design` entry #9's documented retry-on-unique-violation convention for
   server-generated identifiers, deliberately: `nextval()` is lock-free and doesn't degrade under
   concurrent callers, where retry-on-violation (MRN's own pattern) is fine for human-initiated,
   low-frequency writes but is exactly what this task's own dependency comment
   (`patient.controller.ts`, `generateMrn`) already flagged as insufficient for "concurrent analyzer
   writes." Written up as a new `engineering/api-design` Skill entry #13 during implementation (§9
   of the parent feature's Definition of Done) — a second server-generated-identifier pattern, used
   when retry-on-violation's throughput assumptions don't hold, not a silent one-off exception to
   entry #9.
2. **RESOLVED 2026-08-05 — format is `YYMMDD-NNNNNN`.** UTC date the number was generated + the
   global sequence value zero-padded to 6 digits, e.g. `260805-000123`. Human-legible at a glance
   (roughly when a specimen was accessioned), short enough for Code 128 (TASK-046), and requires no
   coordination beyond §5's already-decided non-resetting global sequence (the date is a cosmetic
   prefix, not derived from or gating the sequence itself). If a single UTC day's real volume ever
   exceeds 999,999 specimens (not a realistic concern at this milestone's scale), the zero-padding
   width is the only thing that would need revisiting — noted here, not built ahead of that need.

**Both questions resolved — see Status header. Implementation begins now.**

---

# Revision: TASK-047 — Reception screen: scan-to-receive, coded rejection
Status: IMPLEMENTED — merged PR #300 (`8081c2f`), closing #106. All three questions (§10) resolved
via the native options-prompt 2026-08-05; implementation complete and fully verified the same
session (§11), including a follow-up manual-verification pass (dark mode, keyboard-only
navigation) during this session's own `/close`.
Date: 2026-08-05    Backlog ID: FEAT-013 (#22) / TASK-047 (#106)

## 1. Goal

TASK-045 (accession-number generation) merged (PR #297) and is directly consumable. TASK-045's own
proposal §1 already established, from real research, that **this task — not TASK-045 — owns the
first actual `specimen` row insert in this repo**: `packages/db/src/schema/specimen.ts` (TASK-023)
has carried a `NOT NULL accessionNumber` column and full RLS coverage since FEAT-006 with zero
writers. TASK-047 gives that table its first real behavior.

TASK-047's own issue (#106) AC is narrow and literal: "Rejection requires a coded reason and is
fully audited." Its dependency is TASK-045 only (merged). Its expected output is "Sample reception
screen."

**Real, load-bearing finding from this proposal's own research, not present in TASK-047's issue
text:** FEAT-013 lists exactly four tasks (TASK-045/046/047/048) and none of them is "record
collection." KB-03's canonical Specimen state machine (`03-business-workflows.md:76-79`) names
`collected → received → accessioned → in_process → ...` as three distinct pre-analytical states
before analysis, and KB-24's scan-event table (`24-barcoding.md:49-57`) lists "Collection,"
"Receipt," and "Accessioning" as three separate scan-driven steps — but with no task in this feature
(or any prior one) that creates a specimen row at collection time, **TASK-047 is necessarily the
point where collection, receipt, and accessioning are all first represented in this system**, in one
combined action. This is a real, deliberate narrowing against the full KB-22/23/24 model (custody
event streams, scan-driven location tracking, a separate bedside PPID collection step) — the same
class of "deliberately narrower than the full model" scoping every prior feature in this repo has
used (FEAT-011 §1, FEAT-012 §1) — not an oversight. Full custody-event tracking (KB-23) and a
dedicated collection/PPID step (KB-24, KB-41 mobile) are real future work, not this task's AC.

**Real, load-bearing finding #2 — resolves an apparent schema contradiction, not silently assumed:**
`specimen.accessionNumber` is `NOT NULL` (`specimen.ts:26`), yet the same file's own header comment
states `rejected` is "reachable from receipt" — i.e. from the `received` state, which by definition
already has a non-null `accessionNumber`. Read together, the schema's own design already answers
the question KB-03's stage title ("**Receive & Accession**," one combined name, not two) suggests:
**an accession number is assigned unconditionally at receipt, before condition is judged** — rejection
is a possible *outcome* of an already-accessioned specimen, not a state that exists prior to
accessioning. §5 designs TASK-047's single create action directly from this evidence, not as an open
question.

## 2. Affected files

- `packages/domain/src/specimen.ts` (new) — `specimenTypeSchema` (`z.string().min(1)` — no catalog-
  driven container/volume vocabulary exists yet, KB-22's own "Specimen-requirement resolution" open
  question, `22-sample-management.md:121`; not invented here), `specimenRejectionReasonSchema`
  (`z.enum([...])`, the exact seven values already CHECK-constrained in `specimen.ts:41-44`:
  `haemolysed`, `clotted`, `insufficient_volume`, `mislabelled`, `wrong_container`,
  `improper_temperature`, `expired` — matching this repo's established discipline that a Zod schema
  must mirror an existing DB CHECK, never invent a parallel list), `specimenCreateSchema`
  (`orderId`, `specimenType`, `orderedTestIds` optional, `collectedAt` optional,
  `collectionContext` optional, `rejectionReason` optional — presence/absence is the accept/reject
  branch, §5), `specimenSchema` (response shape), following `packages/domain/src/order.ts`'s exact
  pattern (single source of truth for both `ZodValidationPipe` and OpenAPI generation,
  `engineering/api-design` entry #1).
- `packages/domain/src/index.ts` — new exports, matching the existing `order`/`patient` barrel
  pattern.
- `apps/api/src/specimen/specimen.controller.ts` (new), `specimen.module.ts` (new) — `SpecimenController`
  at `/v1/specimens` per ADR-0013 §3. One creation endpoint (§5) plus a search/get-by-id pair
  matching `OrderController`'s own shape (`PatientController`/`OrderController` are the direct
  precedent for every guard/interceptor/DTO-instantiation convention below).
- `apps/api/src/auth/capabilities.ts` — new `manage_specimens` capability (`Capability` union,
  `ROLE_CAPABILITIES`), granted to both `technologist` and `verifier`, identical reasoning to
  `manage_patients`/`manage_orders` (`capabilities.ts:1-19`): no dedicated reception/accessioning
  role exists in Keycloak yet, and inventing one is a separate infra decision, not this task's scope.
- `apps/api/src/app.module.ts` — register `SpecimenModule`, matching `OrderModule`'s own registration.
- `apps/api/test/specimen.e2e-spec.ts` (new) — real-Postgres e2e suite, `order.e2e-spec.ts`'s own
  structure as the direct template (§8).
- `apps/web/app/(app)/reception/page.tsx` (new), `apps/web/app/(app)/reception/_actions.ts` (new) —
  Server Component + Server Action, `apps/web/app/(app)/orders/new`'s own structure as the direct
  template (a single-object create form, not a list/detail pair). New "Reception" sidebar entry,
  matching how "Orders"/"Patients" each gained one (FEAT-011/012).
- **No new migration.** `specimen`/`specimen_fulfillment` (TASK-023) already carry full RLS coverage
  and every CHECK constraint this task needs — confirmed by reading `specimen.ts` in full (§1). This
  is the first task in this repo to write application code against a table whose migration predates
  it by multiple features, a lower-risk shape than every prior task in this feature.
- **No Keycloak/infra change.** `manage_specimens` is resolved entirely in `capabilities.ts` against
  the two realm roles that already exist — identical to how `manage_orders` needed none (FEAT-012
  §2).

## 3. Architecture consulted

- **TASK-047 issue (#106) AC**: "Rejection requires a coded reason and is fully audited." Dependency:
  TASK-045 (merged). Expected output: "Sample reception screen."
- **KB-22 Sample Management** (read in full, `22-sample-management.md`) — Specimen state machine;
  "Accessioning assigns the accession identifier... At accessioning, the specimen is linked to the
  OrderedTests it will fulfil" (line 36-38, directly shapes §5's single combined action); coded
  rejection reasons and their rationale (line 61-66, already implemented as `specimen.ts`'s CHECK
  constraint — this task is the first to actually exercise it); specimen↔test M:N fulfilment model
  (line 40-44, `specimenFulfillment` table, already exists from TASK-023).
- **KB-23 Specimen Tracking** (read in full, `23-specimen-tracking.md`) — append-only custody event
  stream, scan-driven location hierarchy (lines 24-53). **Explicitly out of scope for this task** —
  no custody-event table exists, and TASK-047's own AC does not require location/chain-of-custody
  tracking. Flagged as real future work (§6), not silently dropped.
- **KB-24 Barcoding** (read in full, `24-barcoding.md`) — scan-event table (lines 49-57: Collection /
  Receipt / Accessioning as three distinct scans); directly informs §1 finding #1 (this task
  necessarily combines what the full model treats as three steps) and §5's "no physical scanner
  hardware assumed" decision (§10 Q1).
- **KB-03 Business Workflows** (`03-business-workflows.md:76-79,100-103`) — canonical Specimen state
  machine and stage-3 narrative ("Receive & Accession... assigns the accession identifier... If
  condition is unacceptable... rejected with a coded reason"), the direct source for §1 finding #2.
- **`packages/db/src/schema/specimen.ts`** (read in full, TASK-023) — `accessionNumber NOT NULL`,
  `status` CHECK (`ck_specimen_status`, 8 values), `rejectionReason` CHECK
  (`ck_specimen_rejection_reason`, 7 values), `specimenFulfillment` M:N join table, both RLS-enabled.
  Grepped for existing writers: none (confirmed by TASK-045's own proposal §1, re-confirmed here).
- **`packages/db/src/accession.ts`** (read in full, TASK-045) — `generateAccessionNumber(db: DbOrTx):
  Promise<string>`, takes the caller's transaction per its own header comment ("so a caller... can
  generate the number and insert the specimen row as one unit") — this task is that caller.
- **`packages/domain/src/order.ts`** (read in full) — `orderedTestStatusSchema` already includes
  `received` and `rejected` (line 22-29, written during TASK-042 "reserved for FEAT-013+") — this
  task is the first to actually write those two values.
- **`apps/api/src/order/order.controller.ts`** (read in full) — direct precedent for: DTO
  instantiation via explicit `new ZodValidationPipe(schema)` at each `@Body()`/`@Query()`/`@Param()`
  (entry #8, vitest esbuild `design:paramtypes` gap); RLS-invisibility-as-404 pattern (line 319,
  entry #7); the `{resourceId, before, after}` audited-response shape; batch-resolving a display
  projection in one extra query rather than N+1 (`search()`'s patient-resolution, directly reused
  here for order/patient display fields on the reception screen).
- **`apps/api/src/auth/capabilities.ts`** (read in full) — `manage_patients`/`manage_orders` grant
  precedent directly reused for `manage_specimens` (§2).
- **`engineering/api-design` Skill** — entries #1 (single Zod source of truth), #7 (RLS-as-404),
  #8 (explicit ZodValidationPipe instantiation), #9 (TASK-045's own divergence, not re-litigated
  here — this task only *calls* `generateAccessionNumber`, it does not generate identifiers itself),
  #13 (the new SEQUENCE-based-identifier entry TASK-045 wrote) all re-checked and applicable.
- **`database-design` Skill** — entry #4 (grep every insert site before trusting a new constraint) —
  re-run for this task: `specimen`/`specimen_fulfillment` have zero existing rows in any environment,
  so no pre-existing-data conflict is possible.
- **`rls-multi-tenancy` Skill** — re-checked; `specimen`/`specimen_fulfillment`'s RLS policies already
  exist (TASK-023) and require no change; this task's own e2e suite (§8) adds a cross-tenant
  RLS-invisibility test, matching `order`/`patient`'s own precedent, since this is the first real
  write path through those policies.

## 4. Skills loaded

- `engineering/api-design` — in full, see §3.
- `database-design` — in full, see §3. No migration needed (§2), but entry #4's insert-site check
  still applies and was re-run.
- `rls-multi-tenancy` — re-checked, see §3.
- `testing` — re-checked; shapes §8's insistence on a real-Postgres e2e suite plus a real
  headless-browser check (`web-verify` Skill), not a mocked reception flow.
- `engineering/barcode-printing` — **still does not exist.** Named as "Required" by FEAT-013's own
  issue (#22). Not drafted as part of this proposal: TASK-047's own scope (§5, §10 Q1) deliberately
  assumes no physical scanner/printer hardware, so nothing in this task is actually load-bearing for
  that Skill's content. Genuinely needed for TASK-046 (label rendering + print pipeline) — flagged
  again so TASK-046's own revision doesn't silently skip drafting it, same flag TASK-045's proposal
  already carried forward once.
- `domain/specimen-lifecycle` — **still does not exist**, also named as "Required" by issue #22.
  **This task is the first one with real, load-bearing decisions to draft it from** (§1's
  three-scans-into-one finding, §5's accession-at-receipt design, the deliberate KB-23
  custody-tracking exclusion) — drafting it is listed as autonomous prep in this revision's own
  cover message, not deferred a second time.

## 5. Assumptions & autonomous decisions

- **One combined create action, not three separate collect/receive/accession steps.** Per §1 finding
  #1/#2: `POST /v1/specimens` always calls `generateAccessionNumber` (satisfying the `NOT NULL`
  constraint unconditionally, matching the schema's own evidenced design) and, depending on whether
  `rejectionReason` is present in the request body, sets `status: 'accessioned'` (absent — the
  specimen is also immediately linked to its fulfilled `OrderedTest`(s) via `specimenFulfillment`
  rows, matching KB-22's "at accessioning, linked to the OrderedTests it will fulfil") or
  `status: 'rejected'` with the coded reason (present). `receivedAt` is always set to now;
  `collectedAt` is accepted optionally in the request body (if the physical collection time is known
  and worth recording) but is never required or defaulted — matching `specimen.ts`'s own nullable
  column. The literal intermediate `'received'` state (schema-valid, KB-03-named) is never written by
  this task — nothing in this feature consumes it as a distinct state from `'accessioned'`, and
  inventing a second follow-up "accession" action with no AC requiring it would be building ahead of
  a real need (same discipline TASK-045 §5 already applied to daily sequence resets). Raised as §10
  Q3 rather than silently decided, since it's a real, visible divergence from KB-03's literal
  four-state list.
- **`orderedTest.status` transitions with the specimen.** On accept: every `orderedTestId` the new
  specimen fulfills transitions `'ordered' → 'received'` (skipping the schema-valid `'collected'`
  state for the same reason as above). On reject: transitions to `'rejected'`. The
  `'rejected' → (recollect → 'ordered')` loop KB-03 names is **not built** — no recollection
  endpoint exists in this task or feature; a rejected `orderedTest` stays `'rejected'` until a future
  task adds recollection. Flagged as a real, deliberate scope gap (§6), not an oversight.
- **One specimen per reception submission, fulfilling every currently-`'ordered'` `orderedTest` on
  the selected order by default**, with an optional `orderedTestIds` override for the (real, but
  not catalog-verifiable yet) case where an order needs more than one tube. This is a genuine
  narrowing against KB-22's full M:N model (line 40-44: "some tests require multiple specimens") —
  the catalog has no container/volume-per-test data to auto-split against (KB-22's own "Specimen-
  requirement resolution" open question, `22-sample-management.md:121`, still unresolved anywhere in
  this repo), so auto-splitting would be invented, not derived. The `orderedTestIds` override exists
  so a receiving user can still model a multi-tube order manually, one submission per tube.
- **`specimenType` is free text (`z.string().min(1)`), not a fixed enum.** `specimen.ts`'s own column
  is plain `text`, not CHECK-constrained (unlike `status`/`rejectionReason`) — mirroring that at the
  domain layer is the same "don't invent a stricter constraint than the schema already chose"
  discipline `database-design` entry #1 states. A curated specimen-type vocabulary is real future
  work once the catalog actually drives container/volume requirements (KB-22's open question, again).
- **No barcode/scanner hardware assumed.** "Scan-to-receive" is implemented as a single text input
  (order lookup) that accepts a pasted/scanned/typed identifier identically — a keyboard-wedge
  barcode scanner emits keystrokes into a focused text field, so no scanner-specific integration code
  is needed either way. What that identifier resolves *to* (an Order id vs. a broader search) is
  raised as §10 Q1, not assumed.

## 6. Risks

- **This task deliberately does not build KB-23's custody-event tracking, KB-24's bedside PPID
  collection step, or KB-03's `rejected → recollect → ordered` loop.** Each is real, described in
  detail in its own KB document, and genuinely absent from this task's own AC (§1). Flagged explicitly
  so it is not mistaken for an oversight when a future feature needs one of them.
- **`specimenType` has no catalog-driven validation** (§5) — a receiving user can type anything.
  Acceptable for this task's own AC (which does not mention specimen-type correctness), but a real
  latent data-quality gap until KB-22's "Specimen-requirement resolution" question is answered.
- **`orderedTest.status` skips the schema-valid `'collected'` state** (§5) — anything that later
  queries specifically for `'collected'` (as opposed to `'ordered'` or `'received'`) will find it
  never occurs via this code path. No current code makes that query (confirmed by grep), but this is
  worth knowing before TASK-048 (collection queue) is scoped, since "pending collection" may need to
  mean "still `'ordered'`," not "`'collected'` but not yet `'received'`."
- **TASK-048 (Collection queue, #107) depends on TASK-047** per its own issue text, but its own AC
  ("lists pending collections with priority and required tubes") needs "required tubes" data this
  task does not produce (no catalog-driven specimen-type requirement exists, per §5). Flagged here,
  not solved here — TASK-048's own revision will need to either resolve that gap or narrow its own
  scope around it, the same way this task narrowed around KB-22/23's fuller model.
- **A rejected specimen still consumes a real accession number** (§1 finding #2, `NOT NULL`
  constraint) — this is schema-forced, not a design choice this task could avoid, but worth stating
  plainly: the accession sequence is not "reserved for accepted specimens only," so a lab with a high
  rejection rate will see non-contiguous-looking accession numbers on accepted specimens. No AC is
  affected (TASK-045's own AC was collision-safety, not contiguity), but worth knowing.

## 7. Acceptance criteria

TASK-047's literal AC (the only AC this proposal covers):
- [ ] Specimen rejection requires a coded reason. Judged by: `POST /v1/specimens` with a
  `rejectionReason` outside the seven CHECK-constrained values returns `400` (Zod validation); a
  request with a valid coded reason succeeds and sets `status: 'rejected'`.
- [ ] Specimen rejection is fully audited. Judged by: every `POST /v1/specimens` call (accept or
  reject) writes an `audit_event` row (`@Audit({ action: 'specimen.receive', resourceType:
  'specimen' })`), verified by a real e2e assertion against the audit table, not inferred from the
  decorator's presence alone (matching this repo's own established audit-verification standard).

## 8. Testing plan

1. `pnpm --filter @lis/domain typecheck`/build with the new `specimen.ts` domain module;
   `pnpm --filter api typecheck`/build with the new controller/module.
2. A real e2e spec (`apps/api/test/specimen.e2e-spec.ts`), `order.e2e-spec.ts`'s structure as the
   direct template, real Postgres, real Keycloak-issued tokens:
   - accept path: valid `orderId` + `specimenType`, no `rejectionReason` → `201`, response has a
     well-formed accession number (TASK-045's format), `status: 'accessioned'`; a follow-up query
     confirms `specimenFulfillment` rows exist for every fulfilled `orderedTestId` and each
     transitioned to `'received'`;
   - reject path: same request plus a valid coded `rejectionReason` → `201`, `status: 'rejected'`,
     `rejectionReason` echoed, accession number still present (§1 finding #2); fulfilled
     `orderedTest`(s) transition to `'rejected'`;
   - invalid `rejectionReason` (not in the seven-value list, or a free-text string) → `400`, no
     specimen row written;
   - unknown/cross-tenant `orderId` → `400`/`404` per `order.controller.ts`'s own established
     pattern (RLS makes it structurally invisible, not a leaked-existence signal);
   - both accept and reject paths independently confirmed to write a real `audit_event` row (§7);
   - missing `manage_specimens` capability → `403` (`CapabilityGuard`, matching every existing
     guarded endpoint's own test).
3. The full existing `apps/api` e2e suite re-run and confirmed still green — this task adds no
   migration and touches no existing table's constraints, so no regression is expected, but this
   repo's own standing rule (verify, don't assume) applies regardless.
4. Real headless-Chromium browser check (`web-verify` Skill, this sandbox's own missing-`libnss3.so`
   workaround): look up a real order, submit an accept → confirm accession number displayed; submit a
   reject with a coded reason on a second order → confirm rejected state displayed; attempt a
   free-text rejection reason client-side → confirm it's blocked/coerced to the coded list, not sent
   as free text.
5. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

Additive throughout: new `packages/domain`/`apps/api`/`apps/web` code, one new capability string, no
migration. Rollback is reverting the PR — `specimen`/`specimen_fulfillment` (TASK-023) are
unaffected structurally (this task only starts writing to already-existing, already-RLS'd tables);
`manage_specimens`'s removal from `capabilities.ts` un-grants it with no Keycloak-side change needed.
No production data depends on this yet (`specimen` has zero real rows in any persistent environment,
confirmed in TASK-045's own proposal and re-confirmed here).

## 10. Questions requiring human approval

1. **RESOLVED 2026-08-05 — Order UUID + fallback search.** The reception screen's lookup field
   accepts a scanned/pasted/typed Order UUID and falls back to reusing the existing `/orders` search
   (`GET /v1/orders`) if the input doesn't parse as a UUID or isn't found — so a receiving user with
   no scanner at all can still find the right order by patient/date/status, exactly as the existing
   Orders screen already allows.
2. **RESOLVED 2026-08-05 — `manage_specimens`, granted to both `technologist` and `verifier`.** Same
   reasoning and precedent as `manage_patients`/`manage_orders` (§2/§3): no dedicated
   reception/accessioning role exists in Keycloak yet; narrowing later is a small follow-up.
3. **RESOLVED 2026-08-05 — combined collect+receive+accession in one action.** `POST /v1/specimens`
   goes straight to `'accessioned'` (or `'rejected'`), skipping the schema-valid `'received'`
   specimen state and `'collected'` `orderedTest` state — matches KB-03's own combined "Receive &
   Accession" stage name and the `NOT NULL accessionNumber` evidence (§1 finding #2); nothing
   downstream reads or writes those intermediate states today.

**All three questions resolved — implementation begins now.**

## 11. Real bugs found and fixed during implementation

- **No join precedent existed anywhere in this repo** (`order.controller.ts`'s own `search()`
  resolves multi-table data via separate queries + an in-memory `Map`, never `.innerJoin()`).
  `search()`'s first draft used `.innerJoin()` to resolve `specimenFulfillment` → `orderedTest` in
  one query; rewritten to the same separate-queries-plus-map shape as every other controller
  before it shipped, rather than introduce a first, untested join-result-key convention
  (drizzle keys joined rows by the imported table variable name, not the SQL table name — never
  actually exercised in this codebase, so not worth being the first call site to rely on it).
- **`nest build`/`tsc` silently produced an empty `dist/`** (exit 0, no output) when starting the
  real compiled `apps/api` server for browser verification — the exact WSL2 incremental-build-cache
  symptom sessions 10/13 both hit and left as "not chased further." Traced this time: a stale
  `apps/api/tsconfig.build.tsbuildinfo` combined with `nest-cli.json`'s `deleteOutDir: true`.
  Fixed by deleting the buildinfo file before rebuilding. Written up as `engineering/docker-pnpm-
  monorepo-deploy` Skill entry #24 — the first session to leave a concrete fix instead of just the
  symptom.
- No other real bugs. Every AC (§7) verified directly: 11 new e2e tests (accept default-fulfil-all,
  accept explicit subset, reject with coded reason + accession number still assigned, invalid
  rejection reason 400, unknown orderId 400, cross-order orderedTestIds 400, zero-eligible-tests
  400, missing-capability 403, search()/getById() fulfilled-ids, cross-tenant 404, nonexistent-id
  404) plus the full existing 59-test suite, all green; repo-wide `typecheck`/`lint`/`build` (both
  `apps/api` and `apps/web`) green; a real headless-Chromium session (`web-verify` Skill, this
  sandbox's own missing-`libnss3.so` workaround) drove the actual UI end-to-end against real
  Keycloak/Postgres/the compiled `apps/api` server: patient → order → "Receive at reception" →
  accept (real accession number assigned, e.g. `260805-000625`) and, on a second order, reject
  (coded reason `haemolysed`, accession number still assigned per §1 finding #2) — plus the
  "nothing to receive" and lookup-not-found fallback states — all screenshotted, styled correctly,
  zero console/page errors. `apps/api/openapi.json` and `packages/sdk/src/schema.ts` regenerated
  (the recurring drift class `#292` tracks) so `apps/web` calls the new routes fully typed.
- **One minor, deliberate implementation-time simplification versus this revision's own §2/§3
  text**: `search()`/`getById()` do not resolve an order/patient display projection onto the
  specimen response (§3 had cited `order.controller.ts`'s own patient-batch-resolution as
  precedent) — dropped as unnecessary once actually building the reception screen, since the
  screen already has the order's patient identity from the existing `GET /v1/orders/:id` call
  before a specimen is ever created; nothing in TASK-047's own AC needs it duplicated onto the
  specimen resource itself. Noted here as a real, small divergence from the written proposal, not
  a silent one.

---

# Revision: TASK-046 — Label rendering (Code128+DataMatrix) + print pipeline
Status: IMPLEMENTED (pending merge) — all four questions (§10) resolved via the native
options-prompt 2026-08-05; implementation complete and fully verified the same session (§11).
Merge PR/SHA to be recorded on close-out.
Date: 2026-08-05    Backlog ID: FEAT-013 (#22) / TASK-046 (#105)

## 1. Goal

TASK-045 (accession-number generation) and TASK-047 (reception: the first real `specimen` writer)
are both merged. Every specimen now carries a non-null `accessionNumber` (TASK-045's format,
`YYMMDD-NNNNNN`) the moment it's created via `POST /v1/specimens` (TASK-047). TASK-046's own issue
(#105) AC is narrow and literal: "A label prints correctly on the design partner's actual printer."
Its dependency is TASK-045 only (merged). Its expected output: "Label template + print pipeline."
FEAT-013's own parent AC additionally specifies the two symbologies: "Code128 + DataMatrix."

**This is the first physical-output feature in this repo** — every prior task produced only
structured data and screens; nothing before this has needed to render an image, embed it in a
print-formatted view, or reason about a browser print pipeline at all. There is no internal
precedent to reuse the way TASK-047 reused `order.controller.ts`'s shape — this proposal's design
choices are new, not adapted, and are flagged as open questions accordingly (§10) rather than
silently decided the way a task with real precedent would be.

**Real, load-bearing constraint found during this proposal's own research, not present in
TASK-046's issue text:** there is no physical label printer, printer driver, or printer SDK
available in this sandbox — confirmed by the complete absence of any printer-related dependency,
script, or infra config anywhere in this repo. The literal AC ("prints correctly on the design
partner's actual printer") is therefore **not verifiable end-to-end in this environment**, the same
class of hardware-verification gap session 14's own risk note already anticipated for this task.
What this proposal scopes to instead: everything software-verifiable — correct barcode content,
a correctly styled print-formatted view, and a real, audited print *action* — with the final
physical-print AC line explicitly left open pending a design-partner demo, not silently claimed.

## 2. Affected files

- `apps/api/package.json` — new dependency `bwip-js` (§5 Q4). Confirmed via Context7
  (`/metafloor/bwip-js`, source reputation High) to support both required symbologies (`bcid:
  'code128'` and `bcid: 'datamatrix'`) through one pure-JS API (`bwipjs.toSVG(options)`), with no
  native/canvas build step — this repo has hit real native-dependency/WSL2 build pain twice already
  (`engineering/docker-pnpm-monorepo-deploy` entries #23/#24), so a pure-JS renderer avoids adding a
  third instance of that failure class.
- `packages/domain/src/specimen.ts` — new `specimenLabelSchema` (`accessionNumber`, `specimenType`,
  `receivedAt`, `code128Svg`, `dataMatrixSvg`), following the same single-Zod-source-of-truth
  pattern as `specimenSchema` (`engineering/api-design` entry #1). No new CHECK-mirroring needed —
  every field already exists on `specimen` except the two rendered SVG strings.
- `apps/api/src/specimen/label-render.ts` (new) — `renderSpecimenLabel(specimen): { code128Svg,
  dataMatrixSvg }`, the only file in this task that imports `bwip-js`. Both symbologies encode the
  **same payload — the accession number alone**, matching KB-24's own identifier decision
  ("Accession-based... opaque, privacy-friendly, stable handle") and its "minimise PHI" default; no
  patient identifier, order id, or test name is encoded into either barcode. Lives under
  `apps/api/src/specimen/`, not `packages/db`, because it's presentation/rendering logic, not
  data-layer code — `packages/db` holds only schema and DB-adjacent writers (`accession.ts`,
  `audit.ts`), never rendering.
- `apps/api/src/specimen/specimen.controller.ts` — two new routes on the existing controller:
  - `GET /v1/specimens/:id/label` — renders and returns `specimenLabelSchema` (accession number,
    specimen type, `receivedAt`, both barcode SVGs as inline strings). **Not audited** — a pure read
    with no side effect, matching `engineering/api-design` entry #6 ("only mutating,
    operationally significant actions are audited... no existing GET route carries `@Audit()`").
    This lets a receiving user preview a label (e.g. to check it looks right) without that preview
    itself being logged as a print.
  - `POST /v1/specimens/:id/print` — action sub-resource on the existing resource, matching
    `order.controller.ts`'s own `POST /:id/cancel` precedent exactly: slash syntax (entry #11, not
    KB-08's literal colon-suffix, which is confirmed broken under this repo's real Fastify adapter),
    same `manage_specimens` capability gate TASK-047 already uses (no new capability), audited via
    `@Audit({ action: 'specimen.label_print', resourceType: 'specimen' })` — reusing the existing
    `audit_event` mechanism directly (TASK-025) rather than inventing a parallel print-log table.
    "Who printed what and when" (KB-24's own literal requirement) is answered by querying
    `audit_event` for `action = 'specimen.label_print'`, `resource_id = <specimen id>` — no new
    table needed. Mutates nothing on the `specimen` row itself (§5); its only effect is the audit
    write. Returns the same `specimenLabelSchema` payload as `GET .../label` so the frontend can
    call it once, immediately before invoking the browser's print dialog, without a second render
    round-trip.
- `apps/web/app/(app)/specimens/[id]/label/page.tsx` (new, Server Component) — fetches `GET
  /v1/specimens/:id/label`, renders a print-formatted view: both barcode SVGs, accession number and
  specimen type in human-readable text, sized via `@media print` CSS to a small label footprint (no
  patient name/MRN/order id on the page — same PHI-minimization default as the encoded payload).
  Reached only via a link from the reception success state (§2 next item) — no new top-level nav
  entry, matching how order-detail's "Receive at reception" link needed none either.
- `apps/web/app/(app)/specimens/[id]/label/print-button.tsx` (new, client component) — calls a
  Server Action wrapping `POST /v1/specimens/:id/print`, then `window.print()` on success. The
  audit write and the print trigger happen together, not print-then-audit or audit-with-no-print
  confirmation — if the audited call fails, the print dialog never opens.
- `apps/web/app/(app)/specimens/[id]/label/actions.ts` (new) — the Server Action above, following
  `apps/web/app/(app)/reception/actions.ts`'s own shape (a single `'use server'` async function
  calling the typed SDK client).
- `apps/web/app/(app)/reception/reception-form.tsx` — the existing "Specimen received"/"Specimen
  rejected" success card (lines ~40–60) gains a "Print label" link to `/specimens/{id}/label`, using
  the newly-available `state.resourceId` — the natural point in the existing flow where a freshly
  accessioned specimen's id first becomes available client-side. Shown for both accepted and
  rejected outcomes (a rejected specimen still has a real, non-null accession number per TASK-047 §1
  finding #2 and may still need a label for tracking/disposal documentation — KB-22 does not say
  rejected specimens go unlabelled).
- **No new migration.** Every field the label needs (`accessionNumber`, `specimenType`,
  `receivedAt`) already exists on `specimen` (TASK-023/047). No new column for a print counter or
  reprint flag — see §10 Q2 for why that's raised as an open question rather than built by default.
- **No new capability.** Reuses `manage_specimens` (TASK-047) for both new routes.

## 3. Architecture consulted

- **TASK-046 issue (#105) AC**: "A label prints correctly on the design partner's actual printer."
  Dependency: TASK-045 (merged). Expected output: "Label template + print pipeline."
- **FEAT-013 issue (#22) AC** (parent, cited for the symbology requirement not in TASK-046's own
  issue text): "A label prints correctly (Code128 + DataMatrix) on the design partner's actual
  printer."
- **KB-24 Barcoding** (read in full, `24-barcoding.md`) — symbology-to-surface mapping ("1D Code 128
  for tubes and standard containers; 2D Data Matrix... for space-constrained surfaces," lines 30-33,
  directly answers why this task renders both, not one); identifier choice ("Container labels are
  keyed on the accession identifier," line 25, directly shapes §2's single-payload decision); PHI
  minimization ("lean on the opaque accession ID rather than print patient identifiers," lines
  35-39); "Printing is metadata-driven and audited... Reprints are controlled and audited... who
  reprinted what and when is on the record" (lines 41-44, the literal source of §2's audited
  `POST .../print` route and §10 Q2's open question about whether first-print and reprint need to be
  distinguished).
- **KB-22 Sample Management** (re-checked, `22-sample-management.md`) — confirms accessioning (not a
  separate "labeling" state) is where the identifier a label encodes originates; no new specimen
  lifecycle state is implicated by this task (label rendering/printing is not itself a state
  transition, consistent with §5's "mutates nothing on `specimen`" decision).
- **KB-23 Specimen Tracking** (re-checked, `23-specimen-tracking.md`) — the append-only custody-event
  stream this document describes is **explicitly out of scope here**, same as TASK-047's own
  exclusion (`domain/specimen-lifecycle` Skill entry #6): a "printed" custody event is not built;
  `audit_event` (§2) is the only record of a print action this task creates.
- **`packages/db/src/schema/specimen.ts`** (re-read) — confirms `accessionNumber`, `specimenType`,
  `receivedAt` are all already-populated, non-derived columns; no schema change needed.
- **`apps/api/src/order/order.controller.ts`** (`cancel()`, re-read) — the direct precedent for
  `POST /:id/print`'s action-sub-resource shape, capability gate placement, and `@Audit()` wiring.
- **`apps/api/src/specimen/specimen.controller.ts`** (TASK-047, read in full) — direct precedent for
  `ZodValidationPipe` explicit instantiation (entry #8), the `specimenIdParamSchema`/`SpecimenIdParamDto`
  pattern this task's two new routes reuse verbatim (same `:id` param shape as `getById()`).
  RLS-as-404 (entry #7) applies identically: an unknown/cross-tenant specimen id on either new route
  returns `404`, not a leaked existence signal.
  **not** to `GET .../label` (§2) — the general "only mutating actions are audited" rule, re-applied
  here as a positive case, not just cited.
- **`apps/web/app/(app)/reception/`** (TASK-047, read in full: `page.tsx`, `reception-form.tsx`,
  `actions.ts`, `types.ts`) — direct precedent for the Server-Component-fetch + client-form-action
  split this task's new `specimens/[id]/label/` route reuses.
- **Context7 `/metafloor/bwip-js`** (queried live, not assumed from training data per this session's
  own standing rule for library research) — confirmed `bcid: 'code128'`/`bcid: 'datamatrix'`,
  `bwipjs.toSVG(options)` for synchronous, dependency-free SVG string output suitable for embedding
  directly in a JSON response and rendering in HTML with no data-URI conversion needed.
- **`engineering/api-design` Skill** — entries #1 (single Zod source of truth), #6 (only mutating
  actions audited), #7 (RLS-as-404), #8 (explicit `ZodValidationPipe` instantiation), #11 (slash, not
  colon, for action sub-resources) all directly applied, not re-litigated.
- **`domain/specimen-lifecycle` Skill** — entry #7, written during TASK-047, explicitly flagged that
  `engineering/barcode-printing` (still missing) would be needed once this task starts. This
  proposal's own implementation is the real source that Skill should now be drafted from (§4).

## 4. Skills loaded

- `engineering/api-design` — in full, see §3.
- `domain/specimen-lifecycle` — in full, see §3; entry #7 directly anticipated this task.
- `testing` — re-checked; shapes §8's insistence on verifying actual barcode *payload* correctness
  and a real headless-browser check of the rendered print view, not a mocked render.
- `engineering/docker-pnpm-monorepo-deploy` — re-checked; entries #23/#24 (native-dependency and
  WSL2 build pain) directly motivate §2's pure-JS library choice and §10 Q4.
- `engineering/frontend-design` — re-checked; entry #4 (`transpilePackages` needed the first time a
  `packages/ui` primitive renders in a real Next.js page) is not directly implicated (this task adds
  no new `packages/ui` primitive), but its general "the first real render is the actual proof, not a
  component-level check" discipline shapes §8's insistence on a real headless-browser check of the
  print-preview page, not just a typecheck-passes claim.
- `engineering/barcode-printing` — **still does not exist.** Named as "Required" by FEAT-013's own
  issue (#22), flagged twice already (TASK-045 §4, TASK-047 §4) as genuinely needed once this task
  starts. **This proposal's own real decisions (§2's rendering-library choice and its native-
  dependency rationale, §5's payload/audit/print-pipeline design, §10's four open questions) are the
  first real content to draft it from** — listed as autonomous prep in §5 of the cover message for
  this revision, to be written once this proposal is approved and implemented, not deferred a third
  time.

## 5. Assumptions & autonomous decisions

- **Both barcodes encode the accession number alone — no composite/multi-field payload.** KB-24's own
  identifier decision (§3) is unambiguous on this; a GS1-structured payload (`bwip-js`'s
  `gs1datamatrix` mode, which needs parenthesized Application Identifiers) is not used, since no GS1
  compliance requirement is named anywhere in this repo's KB or issues — using plain `datamatrix`
  with a bare accession-number string is the minimal choice that satisfies the literal AC without
  inventing an unrequired standard.
- **Rendering happens server-side (`apps/api`), not client-side.** Keeps `bwip-js` a single
  dependency in one place (not duplicated into `apps/web`), keeps the barcode-rendering payload out
  of the browser bundle, and lets `POST /v1/specimens/:id/print` render-and-audit as one atomic
  server action — matching TASK-047's own "the mutation and its audit write happen in the same
  request" discipline, not a separate client-side render plus a fire-and-forget audit call.
- **No PDF generation, no printer-SDK/ZPL integration.** Neither exists anywhere in this repo, and no
  physical printer is available in this sandbox to build or test against. The "print pipeline" is:
  server renders barcode SVGs → browser renders a print-formatted HTML page → the browser's native
  print dialog → the OS's own print driver → (in the design partner's real environment) a thermal
  label printer installed as a standard OS printer. This is the realistic MVP shape for a web app
  with no dedicated hardware integration yet — raised as §10 Q1 rather than silently assumed, since
  it's a real, first-of-its-kind architectural choice for this repo.
- **The print action mutates nothing on `specimen` itself** — no `printedAt`/`printCount` column is
  added. `audit_event` already records every print with actor/timestamp; a receiving user or auditor
  answers "has this been printed, and how many times" by querying audit history, not a denormalized
  counter on the specimen row. Avoids adding a column this task's own AC doesn't require — raised as
  §10 Q2 in case the human wants a persisted, at-a-glance reprint flag instead.
- **First print and every reprint are audited identically** (`specimen.label_print`, no distinct
  action name or reason code for a reprint). KB-24 says "reprints are controlled and audited" but,
  unlike specimen rejection, names no reprint-reason vocabulary anywhere — inventing one now would be
  building a coded list ahead of a real, KB-stated need, the same discipline `domain/specimen-
  lifecycle` Skill entry #5 already applied to rejection reasons in the other direction (use the
  KB's real list, don't invent one where none exists). Raised as §10 Q2.

## 6. Risks

- **The literal AC ("prints correctly on the design partner's actual printer") cannot be verified
  end-to-end in this sandbox** — no physical printer, driver, or printer SDK is available here. This
  proposal's own testing plan (§8) verifies everything short of that: barcode payload correctness,
  print-preview rendering, and the audited print action firing. The final physical-print
  confirmation is explicitly deferred to a design-partner demo, per session 14's own precedent for
  this exact task, not silently claimed done.
- **`bwip-js` is a new third-party dependency added for the first time to render a clinically-
  adjacent identifier (the accession number) into an image.** Confirmed via live Context7 docs
  (§3) to be pure-JS with a High source-reputation rating and 317 indexed code snippets, but this is
  still the first barcode-rendering dependency in this repo — worth the human's explicit awareness,
  not just a footnote (§10 Q4).
- **No reprint-reason/print-count tracking is built** (§5) — if the design partner's real workflow
  needs "how many times has this label been reprinted" surfaced directly on the specimen (not just
  derivable from an audit-log query), that's a real, small follow-up this proposal doesn't build
  (§10 Q2).
- **The print-preview page's exact physical label dimensions are a guess, not validated against the
  design partner's real label stock or printer** — no label size is specified anywhere in this
  repo's KB or issues. CSS `@media print` sizing will target a plausible small-label footprint (e.g.
  ~1" × 2", the common thermal specimen-label size), but this is explicitly a placeholder pending
  real hardware/paper-stock information, not a confirmed spec.

## 7. Acceptance criteria

TASK-046's literal AC, with the sandbox limitation stated plainly rather than silently reinterpreted:
- [ ] **Not independently verifiable in this sandbox**: "A label prints correctly (Code128 +
  DataMatrix) on the design partner's actual printer." No physical printer exists here (§1/§6).
  What this proposal verifies instead, as the closest software-provable substitute:
  - [ ] `GET /v1/specimens/:id/label` returns both a Code128 and a DataMatrix rendering whose
    encoded payload is the specimen's own `accessionNumber`, judged by asserting the exact
    `text` value passed into `bwip-js` at render time matches the row's `accessionNumber`, plus a
    basic well-formed-SVG shape check on both returned strings.
  - [ ] `POST /v1/specimens/:id/print` writes a real `audit_event` row (`action:
    'specimen.label_print'`), verified by a real e2e assertion against the audit table (matching
    this repo's own established audit-verification standard, not inferred from the decorator's
    presence alone).
  - [ ] The print-preview page renders correctly (both barcodes visible, correct accession
    number/specimen type text, no patient-identifying fields present), verified by a real
    headless-Chromium check (`web-verify` Skill), including dark mode and keyboard-only navigation
    to the "Print" button, matching TASK-047's own verification depth.

## 8. Testing plan

1. `pnpm --filter @lis/domain typecheck`/build with the new `specimenLabelSchema`; `pnpm --filter
   api typecheck`/build with the new `label-render.ts` and controller routes.
2. A real e2e spec extension (`apps/api/test/specimen.e2e-spec.ts`), real Postgres, real
   Keycloak-issued tokens:
   - `GET .../label` on an existing accessioned specimen → `200`, both SVG fields present and
     non-empty, `accessionNumber`/`specimenType`/`receivedAt` match the specimen row;
   - `GET .../label` on an unknown/cross-tenant id → `404` (RLS-as-404, entry #7);
   - `POST .../print` → `200`, same payload shape as `GET .../label`, and a follow-up query
     confirms a new `audit_event` row (`action: 'specimen.label_print'`, correct `resource_id`,
     correct `actor`/`tenant_id`);
   - `POST .../print` with a token lacking `manage_specimens` → `403`, matching every other guarded
     route's own test;
   - `POST .../print` called twice on the same specimen → two independent `audit_event` rows, no
     rejection/conflict on the second call (§5: reprints are allowed, just also audited).
3. The full existing `apps/api` e2e suite re-run and confirmed still green — this task adds no
   migration and touches no existing table's constraints or data.
4. Real headless-Chromium browser check (`web-verify` Skill, this sandbox's own missing-
   `libnss3.so` workaround): receive a specimen at `/reception` → follow the new "Print label" link
   → confirm both barcodes render visibly, accession number and specimen type are correct and no
   patient name/MRN/order id appears anywhere on the page → click "Print" → confirm the print
   action succeeds (a real `window.print()` call can be intercepted/confirmed in headless Playwright
   even though no physical page is produced) and a new audit row exists afterward. Repeat for a
   rejected specimen's label. Confirm dark mode and keyboard-only navigation to the "Print" button,
   matching TASK-047's own verification depth (§7 of that revision).
5. `pnpm typecheck`/`pnpm lint` at the repo root.
6. **Explicitly not attempted**: printing to a real physical thermal printer. No such device exists
   in this sandbox (§1/§6). Flagged as an open item for a design-partner demo, not silently skipped
   without mention.

## 9. Rollback plan

Additive throughout: one new `apps/api` dependency (`bwip-js`), new `packages/domain`/`apps/api`/
`apps/web` code, two new routes on an existing controller, no migration, no new capability. Rollback
is reverting the PR — `specimen` itself is untouched structurally (no new column), `manage_specimens`
is unchanged (reused, not modified), and no production data or deployed feature depends on this yet
(`specimen` has zero real rows in any persistent environment, per TASK-045/047's own confirmed
state, unchanged since).

## 10. Questions requiring human approval

1. **RESOLVED 2026-08-05 — browser print dialog, no PDF, no printer-SDK/ZPL integration.** Server
   renders barcode SVGs (`bwip-js`); `apps/web` renders a print-formatted HTML page; a "Print"
   button triggers the native print dialog (`window.print()`), handing off to the OS's own print
   driver — the same path a real thermal label printer would receive as a standard OS printer on
   the design partner's machine.
2. **RESOLVED 2026-08-05 — no reprint distinction.** Every print (first or repeat) is audited
   identically as `specimen.label_print`; no `printedAt`/`printCount` column is added to `specimen`.
   KB-24's "reprints are controlled and audited" is satisfied by the existing `manage_specimens`
   capability gate plus the audit write; audit history already answers "who printed what and when"
   without a denormalized counter.
3. **RESOLVED 2026-08-05 — label content is accession number (both symbologies), specimen type, and
   received/accessioned timestamp only.** No patient name, MRN, order id, or test names anywhere on
   the label, per KB-24's PHI-minimization default.
4. **RESOLVED 2026-08-05 — use `bwip-js`.** Confirmed via live Context7 documentation to support
   both required symbologies through one pure-JS dependency with no native/canvas build step,
   avoiding this repo's two prior native-dependency/WSL2 build failures (`docker-pnpm-monorepo-
   deploy` entries #23/#24).

**All four questions resolved — implementation begins now.**

## 11. Real bugs found and fixed during implementation

- **`bwip-js`'s SVG output cannot be verified by string-matching the encoded payload, for either
  symbology** — `includetext: true` renders the human-readable text as vector `<path>` glyph
  outlines, not a literal `<text>` DOM element, and Data Matrix has no text-overlay option at all.
  The e2e test's first draft asserted `svg.includes(accessionNumber)`; it failed for both
  symbologies even though the renderer was working correctly. Fixed by replacing that assertion
  with well-formedness checks in the e2e suite (`specimen.e2e-spec.ts`) plus a new unit-level
  differential test (`apps/api/src/specimen/label-render.spec.ts`): different accession numbers
  produce different SVG output, the same accession number produces identical output twice — real
  proof the renderer's output depends on its input, without a barcode-decode dependency (never
  added, §5/§8). Also found in the same pass: `toSVG()`'s output has a trailing newline after
  `</svg>`, so `.endsWith('</svg>')` needs `.trim()` first. Written up as `engineering/
  barcode-printing` Skill entry #2.
- **Dark mode: the barcode was nearly invisible** — `bwip-js` renders black bars/modules only
  (`label-render.ts` passes no color option), and the label card originally used this repo's normal
  `bg-surface` token (dark in dark mode), producing near-invisible black-on-near-black bars.
  Screenshot-confirmed during this task's own `web-verify` dark-mode pass, not assumed correct from
  the light-mode screenshot alone. Fixed by forcing the label card to an unconditional white/black
  appearance (`bg-white text-black`), independent of the app's dark-mode tokens — also the correct
  design regardless of the bug, since a physical label prints black-on-white no matter the viewer's
  theme. Written up as `engineering/barcode-printing` Skill entry #3.
- **Real, more significant finding: Next.js client-side navigation left the reception page's patient
  data (name, MRN) in the label page's own DOM**, even though the label page's rendered content and
  its own data fetch never touch patient data at all. Root cause: the "Print label" link used
  `next/link`'s `<Link>`, and Next.js App Router's client-side navigation never replaces `document` —
  each visited route's RSC ("flight") payload stays behind as inline `<script>` content, so the
  reception page's own patient-including payload was still present in `document.body.textContent`
  after navigating to the label page. Caught only by a real headless-browser check reading
  `body.textContent` (`web-verify` Skill) — invisible to typecheck/lint/build, to the rendered
  screenshot, and to every other check in this task's own testing plan. Fixed by changing the
  "Print label" link from `<Link>` to a plain `<a>` tag (`reception-form.tsx`), forcing a full page
  navigation — confirmed fixed by re-running the same check against a freshly-created specimen.
  Written up as `engineering/frontend-design` Skill entry #5 (the general Next.js App Router
  mechanism) and `engineering/barcode-printing` entry #6 (this task's own framing, since KB-24
  frames a printed label as literally "leaving the access-controlled system").
- **Sandbox-only friction, not a code bug**: verifying this required repeatedly minting a session
  cookie carrying a real Keycloak access/refresh token pair (`web-verify` Skill's own recipe).
  Reusing one minted cookie across several browser runs interleaved with unrelated password-grant
  logins (creating test fixtures via the API) caused `apps/api` to reject the session's access token
  with real `401`s partway through — matching a gotcha the `web-verify` Skill already documents
  (Keycloak refresh-token rotation invalidating an earlier token once a new login happens for the
  same user). Resolved by minting the cookie immediately before each browser run with zero
  intervening Keycloak calls, per that Skill's own existing guidance — not a new finding, a
  reproduction confirming the documented one.
- No other real bugs. Every AC (§7) verified directly: the full existing 62-test `apps/api` e2e
  suite plus 5 new tests (`GET .../label` payload/404s, `POST .../print` audited once and again on
  reprint, 403 for a missing capability) green; 3 new unit tests (`label-render.spec.ts`) green;
  repo-wide `typecheck`/`lint`/`build` (all four `packages/*` and both `apps/*`) green; the real
  compiled `apps/api` server booted successfully with both new routes mapped (`engineering/
  api-design` entry #10's own discipline, re-applied); a real headless-Chromium session
  (`web-verify` Skill) drove the actual UI end-to-end against real Keycloak/Postgres/the compiled
  `apps/api` server: reception → accept → "Print label" → label page (accession number, specimen
  type, timestamp, both barcodes, zero PHI in the rendered page) → keyboard-only Tab/Enter to both
  the "Print label" link and the "Print" button → a real `window.print()` call confirmed firing —
  in both light and dark mode, zero console/page errors throughout. The one AC line genuinely not
  verifiable here — "prints correctly on the design partner's actual printer" — is explicitly left
  open pending a design-partner demo (§1/§6/§7), not silently claimed done.
