# Implementation Proposal: FEAT-013 Accessioning, labels & reception
Status: TASK-045 IMPLEMENTED — merged PR #297 (`792e373`), closing #104. TASK-047 IMPLEMENTED —
merged PR #300 (`8081c2f`), closing #106. TASK-046/048 remain open and will be specified as
revisions to this same file once their own real output exists, same precedent as FEAT-011/FEAT-012.
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
