# Status — 2026-08-13 (session 37)

Last commit on main: `63927a7` (`lis-platform`) / `f1ff8f5` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already
be one commit behind by construction — check `git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## M13 (EPIC-012, Anatomic Pathology: Histology & Cytology) v1 slice complete — all 8 features shipped this session

Session 36's breadcrumb scoped M13 and recommended `/plan FEAT-057` as the next step. This session
built and merged the entire v1 slice in the scoped order, each via its own approved Implementation
Proposal:

`FEAT-057` Case/Specimen/Block/Slide hierarchy & accessioning (#538, PR #557) → `FEAT-058` generic
synoptic-protocol engine, ICCR-sourced breast + colorectal v1 (#539, PR #558) → `FEAT-059` human
sign-out, step-up authentication & digital signature (#544, PR #559) → `FEAT-060` reflex/add-on
stains & IHC on existing blocks (#545, PR #562) → `FEAT-061` image attachments with coordinate
annotations (#540, PR #566) → `FEAT-062` cytology v1, Bethesda-coded Pap reporting & adequacy
tracking (#541, PR #569) → `FEAT-063` cytology two-tier workflow, screen → review → sign-out (#542,
PR #571) → `FEAT-064` cytology reflex, ASC-US → HPV management (#543, PR #573). All 8 issues closed,
all 8 proposals marked `IMPLEMENTED`.

**EPIC-012 (#537) itself is still open** — same pattern EPIC-009 followed (v1 slice done, epic
closed as its own deliberate later step once the 9 deferred follow-ups are confirmed non-blocking).
Worth an explicit close-out pass next session: re-confirm none of #546–554 (WSI viewer, AI pre-fill,
cancer-registry submission, CAP eCC license path, additional cytology systems, additional CAP/ICCR
protocols, two-tier workflow configurability, synoptic protocol update process, cytology-histology
correlation analytics) block a genuine v1 launch, then close #537 with that reasoning recorded,
mirroring EPIC-009's own close comment.

One real production-code fix landed mid-slice, not part of any single feature's own scope: **`fix:
don't crash API boot when object storage is unconfigured` (#568)** — an `OnModuleInit` hook
depending on MinIO/S3 config threw uncaught on boot when object storage env vars were absent,
taking the whole API down rather than just disabling the image-attachment feature. Fixed to catch
its own failure and degrade gracefully. Real, staging-relevant class of bug — any future
`OnModuleInit` hook that depends on external infra/env config needs the same self-contained
try/catch, not an assumption that config is always present.

## FEAT-065 (patient merge, ADR-0052) and FEAT-066 (patient contact fields + referring-facility/
payer model, ADR-0053) — both built and merged after the M13 slice, at the user's own direction

After M13's v1 slice, the user asked for a full regression pass (login through both apps, driven
via raw HTTP since no browser tool/Playwright exists), then to expand the patient model based on
"what implementations that came after" require and "the actual design partner" — deliberately not
part of any epic, both found/scoped mid-session rather than pre-planned:

- **FEAT-065** (#574, PR #575): a codebase audit found `patient-identity` Skill entry #6's own
  flagged-but-unbuilt merge gap was still real. Built `POST /v1/patients/:id/merge` — physical FK
  rewrite onto the survivor across all six `patient_id`-carrying tables, loser tombstoned via a new
  `patient.mergedInto` self-FK, never deleted (ADR-0052's central decision, extending
  `patient-identity` entry #5's "subject metadata, not clinical value" reading one column further).
- **FEAT-066** (#577, PR #578): the user supplied 4 real screenshots of Eldoret Pathology
  Diagnostics' production system (`/mnt/d/LIS/research/ref/*.png`) — the first genuine design-
  partner field-set evidence this project has had, closing `patient-identity` Skill entry #8's own
  "illustrative, not a spec" caveat. Added patient contact fields (phone/email/address/next-of-kin),
  and a new tenant-scoped `referring_facility` table deliberately reused for **both** order
  attribution and invoice payer (ADR-0053's central decision — the real evidence shows the same
  named organizations serving both roles, not two overlapping directories). `invoice.payerType`
  (cash/corporate) stays inside ADR-0041's own no-ledger boundary — the literal follow-up gap that
  ADR-0041's Consequences section already named.

Both features: full local verification before merge (real Postgres/Keycloak, not mocked) — FEAT-066
alone: 499 e2e tests, 205 unit tests, 3 web tests, `rls-check` across all 43 tenant-scoped tables
(added the new `referring_facility` fixture, same class of gap issue #430/PRs #535/#536 fixed
previously — a new tenant table always needs its own `rls-isolation-check.ts` fixture, this project
has now hit that same lesson 3 separate times).

**No `apps/web` UI from either feature has been seen in a real browser this session** — no browser
tool was available. Everything shipped on `tsc --noEmit`/`eslint`/unit-test coverage only. See the
Manual Verification Checklist below for the specific screens worth a live pass.

## Two process findings from this session's `/close`, drafted not yet applied

Full detail in `~/work/lis-engineering/session-close-reports/2026-08-13-1257-pre.md`:

1. A resume-after-compaction fires `SessionStart` twice (`source=resume` then `source=compact`),
   producing two contradictory Rule #0 instructions in the same context — resolved this session by
   inference (trust the later, more-specific message), but not mechanically guaranteed. Suggested
   fix: one added sentence in `session-start.sh`'s resume-branch output naming this precedence
   explicitly. **Awaiting approval.**
2. Regenerating `openapi.json`/SDK once mid-implementation, then making a later domain-schema fix
   (found via a real e2e failure) without regenerating again, let staleness back into CI's own drift
   check — cost one full CI round-trip on FEAT-066's PR. Suggested fix: a `develop` Skill checklist
   line treating regeneration as the literal last code step before commit, not a mid-implementation
   checkpoint. **Awaiting approval.**

## Manual Verification Checklist — FEAT-066, none of this session's `apps/web` changes seen live

- `/patients/new` — the 5 new contact fields render correctly; the "possible duplicate found"
  resubmission path carries all 5 forward via the new hidden inputs rather than dropping them.
- `/patients/:id` — the new Phone/Email/Address/Next of kin rows display sensibly.
- `/admin/referring-facilities` — new list+create screen, including the non-technologist/verifier
  permission-denied fallback.
- `/orders/new` — the new "Referring facility" `<select>` (only rendered when facilities exist) and
  "Requesting doctor" field fit the existing Order Summary layout.
- `/orders/:id` — the new "Requesting doctor" line, present/absent correctly.
- Sidebar — new "Referring facilities" nav entry, both English and the unreviewed French string
  ("Établissements référents" — same standing FEAT-048 French-review gap, unchanged, now one entry
  larger).

## Carried into next session

- **New this session:** M13/EPIC-012's 8-feature v1 slice fully shipped; EPIC-012 (#537) itself
  still open, worth an explicit close-out pass (see above).
- **New this session:** FEAT-065 (#574, patient merge) and FEAT-066 (#577, patient contact/
  referring-facility) both shipped and closed, neither part of any epic.
- **New this session:** the two `/close` process findings above remain drafted, unapproved.
- **New this session:** the Manual Verification Checklist above (FEAT-066's `apps/web` surfaces)
  remains unchecked in a live browser.
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
- **SSH IP drift**, found several sessions ago by `/orient`'s engineering-radar pass, not yet fixed
  (no infra work happened this session to re-check the live egress IP): `infra/terraform.tfvars`'s
  `ssh_allowed_ip` may still not match the real current egress IP — worth a human decision on
  whether/when to re-check and apply, since it's a real infra-state change.
- Manual verification still owed by a human, carried forward unchanged: FEAT-047's JSON-mode
  `visibilityCondition` editor (mechanically verified, not yet a live lab-admin pass); FEAT-048's
  shipped French translations (not yet a native-speaker review, now including FEAT-066's own
  addition); FEAT-049's `/signup` UX + confirming `lis-onboarding`'s dev secret gets rotated before
  any real deploy; FEAT-046's take-payment UX + confirming the placeholder billing metadata reads
  unambiguously as placeholder; FEAT-045's Constitution-gate marker-recognition logic; a live
  technologist pass on FEAT-024's notes-textarea/grade-button spacing; a live pass confirming
  FEAT-022's SLA amber/red badges read clearly at a glance.
