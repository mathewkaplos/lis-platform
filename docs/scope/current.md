# Status — 2026-08-10 (session 32)

Last commit on main: `63bb5c5` (`lis-platform`) / `6c54367` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already be
one commit behind by construction — check `git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## M9 (EPIC-008, Governed AI) fully shipped this session — all four features, code-complete

Continued straight into M9 immediately after M8's own close-out (session 31). Shipped a real,
previously-unknown bug fix plus the entirety of M9 in one session: task-459, FEAT-041, FEAT-042,
FEAT-043, FEAT-044, each through the full plan → approve → implement → test → PR → CI → merge →
mark-IMPLEMENTED lifecycle, with real Postgres-backed tests throughout — 8 feature/marker PRs
(#473-#480), plus a further 3 `/retro`/`/close`-driven docs PRs (#482, #484, and this breadcrumb).

### task-459 / ADR-0036 (audit-chain per-tenant write race) — merged PR #473, issue #459 closed

Root-caused during `/orient`, not just reported: `writeAuditEvent`
(`packages/db/src/audit.ts`) had a real TOCTOU race — two concurrent writers for the same tenant
(confirmed live: `SlaBreachDetectorService` and `CriticalNotificationEscalationService`, two
independent `@Interval` background jobs) could both read the same "last row" before either
committed, corrupting the audit hash chain (Constitution Law #5). Fixed with a per-tenant
`pg_advisory_xact_lock`, proven by a new `audit-chain-concurrency-check.ts` that reliably
reproduced the corruption with the fix removed (3/3 runs) and passed cleanly with it in place. A
second, unrelated failure bundled in the same issue (`worklist.e2e-spec.ts`) was confirmed to be
pure local-Postgres residue, not a bug — `engineering/testing` Skill entry #15 documents both root
causes, since they shared an outward symptom but were genuinely different bugs.

### FEAT-041 (Governed Inference Layer) — merged PR #474, issue #50 closed, ADR-0037

M9's own foundation. `InferenceGatewayService` (`apps/api/src/ai/`) is the one path any AI
capability uses to reach a model provider: deny-by-default PHI minimization
(`phi-minimization.ts`), full audit logging (`actorType: 'ai'`, reusing task-459's own
just-hardened writer), config-driven provider swap. Ships in-process (`apps/api` module, not a new
deployable) per ADR-0037 — no present-day forcing function unlike `apps/interop`'s real MLLP
protocol need. Only a stub provider ships; no real LLM vendor decision made or needed yet. New
`ai/governed-inference` Skill (lis-engineering), extended three more times this session.

### FEAT-042 (AI narrative drafting, peripheral film morphology) — merged PR #476, issue #51 closed

First real gateway consumer. A technologist grading a morphology analyte (Anisocytosis,
Poikilocytosis, Polychromasia, Platelet Estimate) can click "Draft with AI" to propose a starter
narrative for `observation.notes`, reusing the existing draft/finalize/verification flow
unchanged. New `TemplateProvider` — deterministic, no real LLM vendor (human decision, not a
default) — 16 real hematology-reporting sentences. New `observation.notesAiOriginated`/
`notesAiDisposition` columns (KB-11's accept/edit/reject disposition, enforced by both a Zod
`.refine()` and a DB CHECK). Found and fixed a real nested-transaction deadlock: calling
`invoke()` from inside `TenantContextInterceptor`'s already-open transaction hung every e2e test
under `DB_POOL_MAX=1` — `engineering/database-design` entry #14's exact documented class, fixed by
splitting into two short transactions. Interactively verified in a real headless browser this
session (light/dark mode, keyboard-only nav) for all 4 analyte rows, not just one — the other 3
were completed as this session's own `/close` manual-verification follow-through.

### FEAT-043 (AI cumulative-trend summaries) — merged PR #478, issue #52 closed

Second gateway consumer, second `TemplateProvider` capability shape: **computed** prose from real
data (counts, date range, numeric trend only when every value parses as finite), never a fixed
lookup — the literal mechanism by which "no unsupported claims" is satisfied by construction. New
`GET .../cumulative-report/:analyteId/summary` on the existing (API-only, no web UI — FEAT-033's
own unchanged precedent) `CumulativeReportController`. No new schema, no disposition tracking (a
live, regenerated-on-every-request narrative over already-verified data, nothing persisted to
accept/edit). Found and fixed before shipping: `CumulativeReportEntry.producedAt` is a
pre-formatted display string, not ISO — an earlier version of the summary function assumed ISO and
silently produced garbage slicing it.

### FEAT-044 (AI evaluation harness) — merged PR #480, issue #53 closed

Last M9 feature, and the smallest — a pure test suite, no production code. New
`apps/api/src/ai/evaluation.spec.ts`: output-safety and grounding invariants (non-empty, bounded
length, names its own subject, no interpolation artifact) across both real capabilities' known-good
inputs, plus known-bad/adversarial cases (NaN/Infinity-parseable values, a 10,000-entry history,
script-like content, an unrecognized capability) that must degrade safely, never crash or produce
unbounded output. Plain Vitest, no new CI step — `TemplateProvider` has no Postgres dependency, so
`engineering/testing` entry #1's tsx-script convention doesn't apply here. All 15 cases passed on
the first attempt.

### `/retro` cycles — two real findings, both fixed

1. After the 8-PR M9 batch, only one `PushNotification` had been sent all session (early, not at
   the true end) — the human's next message asked to continue a feature already merged and closed
   two features earlier. Fixed: new `AGENTS.md` bullet (send a push at the true end of a
   multi-feature autonomous batch, not just an early milestone) — merged PR #482.
2. Handing off that same `AGENTS.md` fix's git steps produced a second finding: the hand-off
   instructions told the human to push directly to `main`, which branch protection rejected
   outright. Fixed: clarified `AGENTS.md`'s existing hand-off note to say explicitly "same
   branch+PR flow, never a direct push" — PR #484.

### `/close` cycle — two rounds, every pending item addressed, not deferred

Per `~/work/lis-engineering/session-close-reports/2026-08-10-2242-pre.md`'s three pending items:

1. **Breadcrumb refresh** — this file (this section itself now updated a second time, below).
2. **AGENTS.md hand-off wording clarification** — drafted, then genuinely merged as PR #484 in a
   second `/close` round (branch-protection required a `git merge origin/main` update first, since
   the breadcrumb-refresh PR had moved `main` out from under it in between — the exact mechanism
   the `close` Skill's own step 11 already documents).
3. **Manual verification, both items addressed**: FEAT-042's other 3 analyte rows (Poikilocytosis,
   Polychromasia, Platelet Estimate) driven through a real browser live — all render correctly,
   zero console errors, badges and narratives all correct. The design-partner lab review of the
   generated text's actual clinical phrasing is filed as issue #483 (matching #171's own precedent
   — not something a session can do itself, tracked visibly instead of silently dropped).

**Second `/close` round** (`2026-08-11-0005-pre.md` → this final resolution): caught a real,
unrelated CI flake (`apps/web/auth/access-token.spec.ts`'s `refreshIfStale` test timed out on its
real, unmocked Keycloak call — on a PR that only touched this same breadcrumb file, confirmed
unrelated via a clean rerun) and documented it as `engineering/testing` Skill entry #17, so a
future session recognizes the exact symptom on sight instead of re-diagnosing it as a regression.

## Carried into next session

- **M9 (EPIC-008) is now code-complete** — all four features (FEAT-041/042/043/044) merged and
  closed. The epic issue itself (#8) stays open by its own stated Definition of Done (a staging
  demo to the design-partner lab), same pattern as M6/M7/M8's own epics.
- **Next session:** M6/M7/M8/M9 are all code-complete, every one blocked only on a human staging
  demo. Per M9's own carried-forward note from session 31's breadcrumb, check whether a milestone
  after M9 (M10 — Commercial Readiness, per the Execution Plan) has any independently-startable
  issue — not assumed from this file alone, worth a fresh `/orient` milestone check.
- Issue #483 (design-partner review of FEAT-042/043 generated text) is new this session, open,
  unstarted — genuinely blocked on a real lab relationship, not code.
- M6's own remaining item (FEAT-027) is still blocked on the design partner naming their actual
  instrument, unchanged.
- Issue #440 (specimen exhaustion/expiry tracking) remains open, unstarted (carried unchanged
  since session 29).
- Issues #427, #430 remain open, both deferred/filed in session 29, untouched since.
- Issue #292 (no CI check for OpenAPI/SDK schema drift) and #267 (pnpm-workspace config silently
  ignored in CI) both remain open, untouched since they were filed.
- Issue #145 (RLS-exemption mechanism needs an ADR) remains open, flagged again by this session's
  `/orient` engineering-radar run, still no ADR drafted.
- The real Tailscale/OpenTofu edge-node provisioning for `apps/gateway` still needs a human's
  `tofu apply`.
- Still not done by a human (carried from session 28/29): a live technologist pass on FEAT-024's
  notes-textarea/grade-button spacing, and a live pass confirming FEAT-022's SLA amber/red badges
  read clearly at a glance.
