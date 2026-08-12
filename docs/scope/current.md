# Status — 2026-08-12 (session 36)

Last commit on main: `cc116b0` (`lis-platform`) / `820bf61` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already
be one commit behind by construction — check `git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## Correction to session 35's own breadcrumb: EPIC-009 and issue #430 were already resolved before this session started

Session 35's breadcrumb (previous version of this file) carried EPIC-009 (#9, M10) forward as
"still open" and flagged issue #430 (rls-isolation-check.ts fixture gap) as unconfirmed. Both were
actually already resolved by the time this session's `/orient` ran: **EPIC-009 was closed
2026-08-12T04:13:10Z** (comment: M10 6/6 feature-complete, #489 deliberately deferred, not
blocking), and **issue #430 was closed 2026-08-12T04:28:41Z**, fixed via merged PRs #535 and #536
(add report fixture + remaining 10 missing fixtures to `rls-isolation-check.ts`). Both landed after
session 35's own breadcrumb-refresh commit, which is exactly the "one commit behind by construction"
lag this file's own header warns about — not a real gap, just confirmed here so neither gets
re-carried-forward by mistake.

## M13 (EPIC-012, Anatomic Pathology: Histology & Cytology) scoped and created this session — not yet started

With M9/M10/M11/M12 all epic-closed, this session identified the next undelivered roadmap phase
(`52-product-roadmap.md` Phase 2 — anatomic pathology was the one phase with zero scoping) and did a
full scoping pass: ADRs, epic, features, and deferred follow-ups. **No implementation has begun —
every feature below still needs its own Implementation Proposal before any task starts.**

### ADR-0049 / ADR-0050 / ADR-0051 — drafted and accepted this session

- **ADR-0049** — `Case` is a first-class aggregate above Order/Specimen (`Case → Specimen/part →
  Block → Slide`, each barcoded/custody-tracked), formalizing KB-17's existing resolution of
  domain-model open question OQ-02-1 into a binding schema decision.
- **ADR-0050** — synoptic cancer-reporting protocols are one generic, versioned, data-driven schema
  (`synoptic_protocol`/`synoptic_element`/etc., global reference data, same ADR-0045 precedent) —
  not one bespoke feature per organ site. **v1 content is sourced from freely-published ICCR
  datasets, not a paid CAP eCC vendor license** — an explicit human decision made after real online
  research established CAP eCC's 100+ protocols are only distributed as licensed SDC-XML to vendors
  (no public feed), while ICCR publishes the same Required/Recommended-element structure freely per
  cancer type. v1 protocols: breast and colorectal, matching two real CAP template files
  (`BREAST CAP TEMP`, `COLON TEMPLATE`) already sitting in the design-partner research folder
  (`/mnt/d/LIS/research`) — worth cross-checking those files against the published ICCR datasets
  before authoring the actual `synoptic_element` content.
- **ADR-0051** — no auto-verify path exists for AP reports at all; finalize requires **step-up
  authentication** (fresh re-auth, not just an active session) cryptographically bound to a digital
  signature on the report-version's content hash. Note: **step-up auth does not exist in the
  codebase yet** — confirmed by search, no `stepUp` implementation in `apps/api` — so FEAT-059 is
  building this mechanism for the first time, not reusing an existing one, even though
  `09-authentication.md` already describes the intended design.

All three accepted 2026-08-12, same session they were drafted, via the native options-prompt.

### EPIC-012 (#537) + 8 features + 9 deferred follow-ups created on GitHub, milestone M13

v1 slice: `FEAT-057` Case/Specimen/Block/Slide hierarchy (#538) → `FEAT-058` generic
synoptic-protocol engine (#539) → `FEAT-059` sign-out/step-up/signature (#544) → `FEAT-060`
reflex stains/IHC (#545) → `FEAT-061` image attachments (#540) → `FEAT-062` cytology Bethesda Pap
reporting (#541) → `FEAT-063` cytology two-tier workflow (#542) → `FEAT-064` cytology ASC-US→HPV
reflex (#543). Deferred, each its own filed issue, none exit-blocking: WSI viewer (#549),
AI-assisted pre-fill (#546), cancer-registry submission (#547), CAP eCC license path (#548),
additional cytology systems beyond cervical Bethesda (#550), additional CAP/ICCR protocols beyond
breast/colorectal (#551), two-tier workflow configurability (#552), synoptic protocol
update/reconciliation process (#553), cytology-histology correlation analytics (#554).

**Recommended next step:** `/plan` FEAT-057 (Case/Specimen/Block/Slide hierarchy) — the foundational
feature every other FEAT-05x/06x reads from, same role FEAT-051 played for EPIC-010.

### `/close` cycle this session (two passes: pre-close, then this final refresh)

Pre-close report (`~/work/lis-engineering/session-close-reports/2026-08-12-1503-pre.md`) found 3
pending items, all resolved this same session:
1. ADR-0049/0050/0051 ratified (accepted, see above).
2. This breadcrumb refresh.
3. §8 Engineering Flow Retrospective finding **not yet actioned** — a batched 8-way parallel
   `gh issue create` had 2 transient failures (1 GraphQL `HTTP 499`, 1 classifier-unavailable Bash
   block) that were easy to miscount from tool-result ordering alone; required an explicit
   `gh issue list`/`gh issue view` re-verification pass to confirm which 2 of 8 actually failed
   (FEAT-059, FEAT-060) before retrying them. Drafted AGENTS.md fix (verify any 3+-issue batch
   creation with a list call before wiring cross-references) — **still awaiting explicit approval,
   not yet applied.**

## Carried into next session

- **New this session:** M13/EPIC-012 (#537) + FEAT-057–064 (#538–545) + 9 deferred follow-ups
  (#546–554) — all `Not Started`. FEAT-057 is the recommended next feature to `/plan`.
- **New this session:** the §8 batch-issue-verification AGENTS.md fix remains drafted but
  unapproved — revisit if another session batch-creates 3+ related GitHub issues before this is
  resolved either way.
- Issue #489 (FEAT-046's own deferred Invoice List/Outstanding Balances/Refunds screens) remains
  open, unstarted, unchanged.
- M6's own remaining item (FEAT-027) is still blocked on the design partner naming their actual
  instrument, unchanged.
- Issue #440 (specimen exhaustion/expiry tracking) remains open, unstarted, unchanged.
- Issues #427 (backfill missing M1-M5 retrospectives), #267 (pnpm-workspace config ignored in CI)
  both remain open, untouched since filed.
- Deliberately-deferred M11/M12 follow-ups remain open, tracked, not blocking (#506, #507, #509,
  #510 under M11; #519, #520 under M12), same as prior sessions.
- Manual Verification Checklist items from session 35 remain open, unchanged: #529 (real
  antibiogram S/I/R rendering in `apps/web`), #530 (real culture-report PDF appearance), #531
  (rotate the `lis-platform-analytics` Keycloak client's dev-only secret before real deployment).
- The real Tailscale/OpenTofu edge-node provisioning for `apps/gateway` still needs a human's
  `tofu apply`.
- The staging droplet's `restore-drill.sh` cron job still has no active alerting beyond its own log
  file — unchanged, still worth a periodic human spot-check until real alerting exists.
- **SSH IP drift, found this session by `/orient`'s engineering-radar pass, not yet fixed:**
  `infra/terraform.tfvars`'s `ssh_allowed_ip` (`102.215.35.16/32`) no longer matches the live egress
  IP seen this session (`105.160.4.113`) — draft `tofu plan` fix was shown in the session's report
  but never applied; worth a human decision on whether/when to run it, since it's a real
  infra-state change.
- Manual verification still owed by a human, carried forward unchanged: FEAT-047's JSON-mode
  `visibilityCondition` editor (mechanically verified, not yet a live lab-admin pass); FEAT-048's
  shipped French translations (not yet a native-speaker review); FEAT-049's `/signup` UX + confirming
  `lis-onboarding`'s dev secret gets rotated before any real deploy; FEAT-046's take-payment UX +
  confirming the placeholder billing metadata reads unambiguously as placeholder; FEAT-045's
  Constitution-gate marker-recognition logic; a live technologist pass on FEAT-024's notes-textarea/
  grade-button spacing; a live pass confirming FEAT-022's SLA amber/red badges read clearly at a
  glance.
