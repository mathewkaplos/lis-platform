# Implementation Proposal: FEAT-013 Accessioning, labels & reception
Status: APPROVED — both §10 questions resolved 2026-08-05 (SEQUENCE-based generator; YYMMDD-NNNNNN
format). Implementation begins now.
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
