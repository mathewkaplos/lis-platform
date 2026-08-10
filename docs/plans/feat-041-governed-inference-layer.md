# Implementation Proposal: FEAT-041 Governed Inference Layer
Status: **IMPLEMENTED** — merged PR #474 (`931cb82`), closing #50.
ADR: adr-0037 (accepted)    Date: 2026-08-10    Backlog ID: FEAT-041 (#50)

**Approved 2026-08-10** via the native options-prompt (all three §10 questions accepted as
drafted: in-process module, stub-only provider, no new public route). Repo-wide typecheck/lint
clean; `apps/api` unit suite (17 files/120 tests) and full e2e suite (41 files/370 tests) both
green against a freshly reset DB; new `test/ai-inference.e2e-spec.ts` proves the audit write and
PHI-minimization boundary against real Postgres.

## 1. Goal
M8 (EPIC-007) is fully code-complete; its epic issue stays open only on a human staging demo, not
further code. M9 (EPIC-008, Governed AI) has not started. FEAT-041 is its first feature and the
milestone's own explicit dependency root: FEAT-042 (narrative drafting), FEAT-043 (cumulative
summaries), and FEAT-044 (evaluation harness) all need a working gateway to build against — this
feature builds the gateway, not any AI capability itself.

Literal acceptance criteria (issue #50):
1. All AI model calls route through the gateway with PHI minimization and full audit logging.
2. Provider can be swapped via configuration without touching feature code.

No AI capability consumes this gateway yet — FEAT-042 is the first real consumer, a later feature.
This proposal's scope is the mediating service itself, proven correct on its own terms (PHI
minimization, audit, provider-swap), not wired to any UI or new public route.

## 2. Affected files
- `apps/api/src/ai/inference-gateway.service.ts` (new) — the one entry point,
  `invoke(request: InferenceRequest): Promise<InferenceResult>`, per ADR-0027's "one write/entry
  path" precedent (`OrderCreationService`/`CriticalAcknowledgeService`).
- `apps/api/src/ai/inference-provider.interface.ts` (new) — `InferenceProvider { complete(input):
  Promise<{ output: string; providerId: string }> }`.
- `apps/api/src/ai/providers/stub-provider.ts` (new) — the only shipped implementation: a
  deterministic, canned response (no network call, no external dependency). Proves the interface
  and the config-driven selection mechanism without taking on a real third-party provider decision
  this feature doesn't need to make.
- `apps/api/src/ai/phi-minimization.ts` (new) — pure function: `minimize(input: Record<string,
  unknown>, allowedFields: readonly string[]): Record<string, unknown>`. Deny-by-default: only
  fields named on the caller-supplied allowlist survive; everything else is stripped before it is
  ever assembled into a prompt or written to the audit log. Mirrors ADR-0033's "allowed fields
  stays one flat list" precedent (workflow engine) and the Constitution's established fail-closed
  posture (ADR-0011, ADR-0031).
- `apps/api/src/ai/ai.module.ts` (new) — registers the service, reads `AI_PROVIDER` from config,
  selects the provider implementation (only `'stub'` exists yet; the module's own selection switch
  is what "provider can be swapped via configuration" actually means for this feature — proven by a
  second trivial provider variant in tests, not a second real vendor).
- `apps/api/src/ai/inference-gateway.service.spec.ts` (new) — unit tests: PHI-minimization
  stripping, provider selection via config, audit-write call shape.
- `packages/db` — no schema change. Audit reuses the existing `audit_event` table/`writeAuditEvent`
  (`actorType: 'ai'`, KB-11's own named third actor type) — no new table for this feature's scope
  (evaluation/active-learning data model, if ever needed, is FEAT-044's own explicit job, not this
  one's).
- `~/work/lis-engineering/adr/adr-0037-...md` — already drafted alongside this proposal.
- `~/work/lis-engineering/skills/ai/governed-inference/SKILL.md` (new, near-empty at first) — this
  is the first M9 feature; the Skill gets its first real entries as actual corrections/decisions
  happen during implementation, per this repo's own established convention (Skills document real,
  hard-won lessons, not speculative theory written before any code exists). Seeded with only the
  ADR-0037 pointer and the module's own entry-point shape.

## 3. Architecture consulted
- KB-45 (AI Architecture) — the Governed Inference Layer's own canonical definition: mediates every
  model call, PHI-minimizes, routes by provider, validates output, logs+labels everything;
  advisory-only; human-in-the-loop reuses the existing verification gate (not this feature's own
  concern — no consumer exists yet to verify anything).
- KB-05 (System Architecture) — named this layer as a diagram box; ADR-0037 (this proposal's own
  ADR) explains why that doesn't mean a new deployable *yet*.
- KB-11 (Audit Logging) — `actorType: 'ai'`, "every AI suggestion and its human disposition" (the
  disposition half is a future consumer's job, not this gateway's).
- ADR-0027 (one write path extracted, reused by multiple callers) — the shape
  `InferenceGatewayService` follows.
- ADR-0033 (workflow engine's flat allowed-fields list, not type-scoped) — the precedent
  `phi-minimization.ts`'s allowlist mechanism follows.
- ADR-0011/ADR-0031 (fail-closed defaults) — PHI minimization is deny-by-default, matching this
  repo's established posture for anything safety-adjacent.
- FEAT-033's own Implementation Proposal — the direct precedent for building against what's real
  today rather than a KB's target-state infrastructure that doesn't exist yet (there: OLTP primary,
  not a warehouse; here: an in-process module, not an extracted service).

## 4. Skills loaded
- `ai/governed-inference` — does not exist yet; authored alongside this proposal (see §2), first
  real entries added during implementation.
- `engineering/api-design` (entries #5, #6, #15 — audit/capability ordering, which actions get
  audited, and the `@Audit()` return-shape gotcha; not directly triggered here since this feature
  adds no new HTTP route, but its audit-shape discipline still applies to the direct
  `writeAuditEvent` call this service makes).
- `engineering/database-design` (entry #6 — jsonb `undefined`-key canonicalization; directly
  relevant since this service's audit `after` payload is jsonb through the same `writeAuditEvent`
  path FEAT-041's own predecessor bug (task-459) just hardened).
- `engineering/testing` (entry #1 — real-Postgres integration checks are `tsx` scripts;
  entry #15 — trace actual data before assuming a symptom's cause).

## 5. Assumptions & autonomous decisions
- **No new public HTTP route in this feature.** No consumer exists yet (FEAT-042 is the first),
  and inventing an admin/test-only endpoint just to "prove it works over HTTP" would ship unused
  public surface with no real caller — this repo's own discipline (`AGENTS.md`) is against building
  ahead of actual need. Correctness is proven via unit tests (PHI-minimization, provider selection)
  plus one real-Postgres integration test (`packages/db`-style `tsx` script or an `apps/api` spec
  hitting a real DB, per `engineering/testing` entry #1) confirming a real `invoke()` call writes
  exactly one correctly-shaped `audit_event` row.
- **Only a stub provider ships.** No real model vendor/API key decision is made or needed by this
  feature's own acceptance criteria ("provider can be swapped via configuration" — provable with
  two trivial in-repo implementations, not a live third-party integration). A real provider
  integration is explicitly out of scope, deferred to whichever future feature (most likely
  FEAT-042) first needs a live model response.
- **No new capability/RBAC gate is added.** `InferenceGatewayService` has no HTTP route of its own
  to gate; whichever future feature calls it will apply its own `@RequireCapability`/`@Audit()` on
  *its* route, the same as any other internal service this repo already has (`OrderCreationService`
  is not itself capability-gated; its callers' routes are).
- **The audit `after` payload logs the PHI-minimized input and the provider's output, not the raw
  caller-supplied input.** This is the actual enforcement point for "PHI minimization... and full
  audit logging" being one AC, not two separable ones — the audit trail itself must never become a
  second place PHI leaks through un-minimized.

## 6. Risks
- A future real provider integration (FEAT-042 or later) will need its own new ADR for the actual
  vendor/API choice, data-residency handling, and error/retry behavior — this proposal deliberately
  does not pre-decide any of that, since no real requirement exists yet to decide it against.
- `phi-minimization.ts`'s allowlist is only as safe as every future caller actually using it
  correctly (deny-by-default helps, but a caller could still allowlist something it shouldn't) —
  this is a caller-discipline risk this layer reduces but cannot fully eliminate by itself, worth
  restating in the new Skill once a real caller exists to observe the failure mode against.
- If a real forcing function for extraction *does* appear later (ADR-0037's own stated reversal
  condition), the module needs to already be structured so extraction is a process-boundary change,
  not a redesign — worth a deliberate review at that point, not assumed automatically true just
  because this proposal says it aimed for that.

## 7. Acceptance criteria
- [ ] `InferenceGatewayService.invoke()` is the only path any future AI capability uses to reach a
      model provider — no direct provider calls anywhere else in `apps/api`.
- [ ] PHI minimization is deny-by-default: a field not on the caller's explicit allowlist never
      reaches the provider or the audit log.
- [ ] Every `invoke()` call writes exactly one `audit_event` row, `actorType: 'ai'`, `action:
      'ai_inference.invoke'`, containing the minimized input and the provider's output — proven by
      a real-Postgres test, not asserted from code reading alone.
- [ ] The provider used is selected via configuration (`AI_PROVIDER`); swapping it requires no
      change to any calling code — proven with two provider implementations in tests.
- [ ] No new public HTTP route ships with this feature.

## 8. Testing plan
- Unit: `phi-minimization.spec.ts` — allowlist stripping, nested-field behavior, empty-allowlist
  deny-all case.
- Unit: `inference-gateway.service.spec.ts` — provider selection via config, correct audit-call
  shape (mocked `writeAuditEvent`).
- Integration (real Postgres, per `engineering/testing` entry #1's `tsx`-script convention or an
  `apps/api` spec against a real DB): one real `invoke()` call, then a direct query confirming the
  `audit_event` row's `actorType`, `action`, and `after` payload contain only the minimized fields,
  never the stripped ones.
- No e2e/HTTP test — no route exists.

## 9. Rollback plan
New module, no schema change, no route, no existing caller yet — rollback is a plain revert of the
new files with no data or contract implications for anything else in the system.

## 10. Questions requiring human approval
1. **Approve ADR-0037 (in-process `apps/api/src/ai/` module now; extraction deferred until a real
   forcing function exists) rather than a new `apps/ai` deployable mirroring `apps/interop`?**
2. **Approve shipping only a stub provider in this feature**, with real provider vendor selection
   explicitly deferred to a later feature/ADR (most likely FEAT-042, the first real consumer)?
3. **Approve no new public HTTP route in this feature** (proven via unit + real-Postgres
   integration tests only, since no consumer feature exists yet to expose it through)?
