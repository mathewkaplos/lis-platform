# Implementation Proposal: FEAT-036 — HL7 v2 inbound/outbound via ACL
Status: IMPLEMENTED (merged PR #460, a8f316f7f15a8427ec731d8701cf2ed02806d007, closed issue #45)
ADR: adr-0034 (apps/interop placement), adr-0035 (auth bridge into ADR-0026)   Date: 2026-08-10   Backlog ID: FEAT-036

## 1. Goal
Build the anti-corruption layer (ACL) KB-30 describes for HL7 v2.x messaging: accept an inbound
**ORM** (order) message from an external EHR/HIS and create a real `Order`/`OrderedTest` through
this repo's existing order-creation path, and generate an outbound **ORU** (result) message from a
verified `Observation`. This satisfies both acceptance criteria on issue #45 without HL7's
segment/field idiosyncrasies ever touching the canonical domain model directly — matching KB-30's
explicit design ("HL7 stays at the edge; the core model never learns HL7's structure").

## 2. Affected files
- New module for the ACL mapper/translation logic and message profile config — exact location is
  §10 Q1 below (a new `apps/interop` app vs. a module inside `apps/api`).
- Extend `packages/domain` with an HL7-facing internal shape (parallel to `raw-result.ts`'s existing
  pattern) if the ACL's translated output needs a schema distinct from `orderCreateSchema`/
  `ObservationWriteService`'s existing input shape.
- Likely new migration for a message audit/log table (inbound + outbound HL7 messages, per KB-30's
  explicit "every message is retained and audited" requirement) — modeled on `outbox_event`'s own
  tenant-scoped/RLS'd shape, not reusing that table directly (different retention/audit purpose).
- No changes expected to `order`/`observation`/`orderedTest` table schemas themselves — the ACL
  translates into the same shapes those tables, and their existing write paths, already accept.

## 3. Architecture consulted
- KB-30 (HL7 v2 Integration) — the canonical architecture this feature implements.
- KB-07 (Domain-Driven Design) — the anti-corruption-layer pattern itself.
- KB-11 (Audit Logging) — message-level audit requirement.
- KB-29 (Analyzer Integration) — closest existing ACL precedent in this repo (external-format →
  common internal shape → existing write path).
- ADR-0026 (gateway machine-to-machine auth via Keycloak client-credentials) — precedent for any
  future machine caller, referenced but not directly applicable to a raw MLLP/TCP listener (§10 Q3).
- ADR-0027 (shared `ObservationWriteService`, explicitly scoped in its own Context section to cover
  "any later one — HL7 inbound") — the write path this ACL's inbound side should reuse for anything
  that isn't order creation.
- ADR-0028 (transactional outbox / polling relay) — precedent for reliable async processing if
  outbound ORU generation is triggered off the `Observation` verification event rather than
  synchronously.
- EPIC-007 (Interoperability & Portals) — this feature's parent epic; its own listed dependency on
  EPIC-006 is addressed in §10 Q4.

## 4. Skills loaded
- `engineering/api-design` — endpoint/DTO/audit/capability conventions if any new HTTP-facing route
  is added (e.g. an admin-facing profile-config endpoint, or an HTTP-fronted MLLP bridge per §10 Q1).
- `domain/analyzer-integration` — the closest real precedent in this repo for "external
  wire format → common shape → existing write path," including its idempotency-key and
  shared-derivation-function conventions (entry #2), and its explicit auth-pattern precedent
  (entry #4: new machine caller = its own client/role/capability, never folded into an existing one).
- `engineering/database-design` — for the new message-audit table's RLS policy from its first
  migration (Constitution Law #4).
- `domain/hl7-v2` — **does not exist yet.** FEAT-027's own proposal explicitly declined to draft it
  speculatively ("not drafted speculatively — see `domain/analyzer-integration` Skill entry note on
  this"). Authoring it is in scope for this feature, populated with what this feature's actual
  research and implementation find — the same way `domain/analyzer-integration` was born from
  FEAT-026/027, not written ahead of real findings.

## 5. Assumptions & autonomous decisions
- Inbound ORM → order creation reuses the existing order-creation logic (mirroring
  `OrderController.create()`'s validation: patient must resolve, panel/test ids must be visible,
  panels expand to member tests) rather than a second, independent insert path — same reasoning as
  ADR-0027's "one write path" principle, extended to order creation.
- Outbound ORU generation is a **read/query** operation over an already-verified `Observation`, not
  a write — its closest existing analog is report-data assembly (`report`/`report-template`
  modules' snapshot-and-render pattern), not `ObservationWriteService`.
- Every inbound and outbound HL7 message is retained and audited (KB-30's explicit requirement,
  Constitution Law #5) — assumed non-negotiable, not treated as a follow-up.
- Per-partner versioned message profiles (KB-30's own design decision) are real, but this feature
  ships exactly **one** profile for v1, matching FEAT-026/027's "no second real partner exists yet"
  precedent — multi-profile infrastructure is not built ahead of a second, real partner.
- HL7 ACK semantics (KB-30: "MLLP ACKs, sequence handling, retries") are implemented for the inbound
  side at minimum (an ORM sender needs an ACK to know its message landed); outbound ORU delivery
  retry/ACK-handling depth is scoped to whatever the chosen transport (§10 Q1/Q3) actually requires,
  not built as a separate speculative reliability layer.

## 6. Risks
- **No HL7 v2 parsing/MLLP-framing precedent or dependency exists in this repo.** Unlike the
  gateway's plain-file FIFO queue (deliberately dependency-free because a FIFO's correctness bar is
  low), HL7 v2's escape-sequence/repetition-field/encoding-character rules have real interoperability
  correctness stakes if hand-rolled incorrectly — see §10 Q2.
- **EPIC-007 formally depends on EPIC-006**, which is code-complete but not yet demoed to the
  design-partner lab (its own stated Definition of Done). Whether that blocks *starting* FEAT-036
  itself, versus only blocking EPIC-007's own closure, is a process reading worth confirming — see
  §10 Q4.
- **Patient-identity reconciliation** across an inbound PID segment and this repo's own `patient`
  table has no existing mapping logic anywhere in the codebase — a real risk of mis-matching or
  duplicate-creating a patient if handled naively. KB-30 itself lists this as an open question, not
  a solved one — see §10 Q5.
- **Transport shape mismatch**: real EHR/HIS partners overwhelmingly speak MLLP-over-TCP — a
  long-lived socket listener, architecturally unlike every existing `apps/api` NestJS HTTP route or
  `apps/gateway`'s own HTTP-forwarding client. Where this listener lives has real deployment
  consequences (new docker-compose service, new exposed port, TLS termination) not yet decided —
  see §10 Q1.

## 7. Acceptance criteria
(from issue #45, verbatim)
- [x] An inbound HL7 order message correctly creates an order via the anti-corruption layer --
      `OrmInboundService` (real MLLP transport, `node-hl7-server`) + `OrmMapperService` +
      `InteropOrderCorrelationService`/`OrderCreationService` (`apps/api`). Proven end-to-end: a
      real MLLP client round-trip returns the correct AA/AR/AE ACK; `interop-order.e2e-spec.ts`
      proves correlation/write/unmatched-handling against live Postgres.
- [x] An outbound ORU result message is correctly generated from a verified Observation --
      `InteropOruDataService` (`apps/api`, read-only) + `buildOru`/`OruGeneratorService`
      (`apps/interop`). Proven: `interop-oru-data.e2e-spec.ts` builds a real verified Observation
      through the actual draft/finalize/verify HTTP flow and confirms the real LOINC code/value/
      unit/range/flags; `oru-builder.spec.ts` parses the built message back with the real library
      and confirms OBX-3/5/6/7/8 (KB-30's own mapping), including multi-flag repetition (`H~D`).
      **Delivery to a real partner is explicitly out of scope for this criterion** (KB-30's own
      "Interface engine: build vs. buy" open question; no second real HL7 partner is confirmed yet
      to design an outbound connection-management/retry story against) — "generated," not "sent."

## 8. Testing plan
- Unit tests for the ACL mapper in both directions (HL7 segment ↔ domain shape), against small,
  hand-authored illustrative ORM/ORU fixtures — no confirmed design-partner interface spec exists
  yet, so tests target profile-agnostic correctness via one synthetic profile, mirroring FEAT-026's
  own synthetic-driver precedent for an unconfirmed real integration partner.
- Integration test (real Postgres) confirming an inbound ORM produces the same `order`/`orderedTest`
  rows the existing `OrderController.create()` path would produce for equivalent input.
- Test confirming outbound ORU correctly maps a real verified `Observation`'s coded value (analyte
  code, typed value, unit, reference range, flag) into OBX-3/5/6/7/8 per KB-30's explicit mapping —
  not a string blob.
- RLS isolation test for the new message-audit table.
- Audit-event assertions for both inbound and outbound message handling (Constitution Law #5).
- Manual test: boot the real compiled server (per `api-design` Skill entry #10 — an e2e-only pass is
  not sufficient proof) and exercise both directions against a real send/receive, not just the test
  harness.

## 9. Rollback plan
Entirely additive: new module(s), new table(s), no changes to existing `order`/`observation`
read/write paths beyond reusing their existing service methods. Rollback is "don't register the new
module / don't expose the listener," no destructive migration `down` needed since no existing table
is altered.

## 10. Questions requiring human approval — RESOLVED 2026-08-10

1. **Where does the ACL/listener live?** **RESOLVED: new `apps/interop` app**, mirroring
   `apps/gateway`'s existing precedent for a separate small Node process handling a different
   transport shape (MLLP's long-lived TCP listener vs. request/response HTTP routes). Needs a new
   docker-compose service and exposed port. **Needs an ADR** (same class of decision as ADR-0026/27/28
   — shapes every future interop process, not just this one).

2. **HL7 parsing/MLLP framing: hand-roll vs. adopt a library?** **RESOLVED: adopt a small, focused
   open-source HL7 v2 parsing library.** Deliberate exception to this repo's general
   dependency-free default (the gateway's plain-file queue, ADR-0028's rejected broker) — HL7's
   escape/repetition/encoding rules are a real correctness surface, unlike those simpler cases.
   **Library chosen during implementation: `node-hl7-server` + `node-hl7-client`** (MIT, TypeScript-
   native, Node ≥22, actively maintained — verified via real npm registry/GitHub data, not assumed
   from memory, since this is a new-dependency decision). Handles MLLP framing (including TCP
   fragmentation) and segment parsing/building both; replaced Task A's own hand-rolled `net.Server`
   MLLP skeleton entirely rather than layering a parser on top of it.

3. **Machine authentication for the inbound listener.** **RESOLVED: HTTP/TLS bridge into
   ADR-0026.** `apps/interop` terminates the MLLP socket, then calls `apps/api`'s existing endpoints
   using the same Keycloak client-credentials pattern the gateway already uses — reuses proven auth
   infra rather than inventing mutual-TLS or a new shared-secret scheme. **Needs its own ADR**
   (extends ADR-0026's own precedent to a second machine-caller shape).

4. **Does EPIC-007's formal dependency on EPIC-006 block starting FEAT-036 now?** **RESOLVED: start
   now.** FEAT-036's own real, listed dependency (FEAT-028) is already shipped; EPIC-007 can't
   *close* until EPIC-006 does, but that's an epic-level closure gate, not a code blocker on this
   specific feature.

5. **Patient-identity reconciliation for an inbound PID segment.** **RESOLVED: MRN-only exact
   match.** Reject/queue for manual review on no-match rather than fuzzy demographic matching or
   auto-creating a patient — matches this repo's existing default-deny bias (ADR-0031's
   auto-verification gates, RLS's structural deny). Clinical-safety-adjacent call, confirmed
   explicitly rather than assumed.

**Follow-up before implementation starts:** questions 1 and 3 above are each a real, load-bearing
architectural decision in the same class as ADR-0026/0027/0028 — two ADRs should be drafted
(`apps/interop` as a new process/deployable; the MLLP→ADR-0026 auth bridge) before or during
`/develop`, not skipped because the placement/auth *choice* itself is now resolved here.
