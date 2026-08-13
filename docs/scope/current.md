# Status — 2026-08-13 (session 37, refreshed)

Last commit on main: `cee43d1` (`lis-platform`) / `1901859` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already
be one commit behind by construction — check `git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## M13 (EPIC-012, Anatomic Pathology: Histology & Cytology) — v1 slice (8 features) plus FEAT-067, all this session

Session 36's breadcrumb scoped M13 and recommended `/plan FEAT-057` as the next step. This session
built and merged the entire v1 slice in the scoped order, each via its own approved Implementation
Proposal:

`FEAT-057` Case/Specimen/Block/Slide hierarchy & accessioning (#538, PR #557) → `FEAT-058` generic
synoptic-protocol engine, ICCR-sourced breast + colorectal v1 (#539, PR #558) → `FEAT-059` human
sign-out, step-up authentication & digital signature (#544, PR #559) → `FEAT-060` reflex/add-on
stains & IHC on existing blocks (#545, PR #562) → `FEAT-061` image attachments with coordinate
annotations (#540, PR #566) → `FEAT-062` cytology v1, Bethesda-coded Pap reporting & adequacy
tracking (#541, PR #569) → `FEAT-063` cytology two-tier workflow, screen → review → sign-out (#542,
PR #571) → `FEAT-064` cytology reflex, ASC-US → HPV management (#543, PR #573).

**EPIC-012 (#537) closed this session** — v1 slice done, then formally closed with a comment
mirroring EPIC-009's own precedent: all 9 deferred follow-ups (#546–554) named explicitly as
non-blocking, none silently dropped.

After the epic closed, one of its own named follow-ups was picked up the same session:
**`FEAT-067` digital pathology / whole-slide-image (WSI) viewer** (#549, PR #582 + docs PR #583,
ADR-0054 + ADR-0055). A real, load-bearing scoping finding drove this proposal: **no `apps/web` UI
existed anywhere in the whole AP epic** — all 8 v1-slice features were API-only. So FEAT-067's scope
became the WSI mechanism *plus* the minimal case/slide UI needed to actually reach it (`/cases` list,
`/cases/:caseId` detail, per-slide upload/view), confirmed with the human before drafting. Scoped to
pre-tiled DZI zip upload only (no raw scanner-format decoding — needs OpenSlide, no real scanner/
vendor exists yet to size that against), synchronous in-request unzip (no job queue exists yet), and
tile serving via an authenticated-redirect chain (`apps/api` 302 → a new `apps/web` proxy route → a
short-lived presigned MinIO URL) — never bytes through either server, never a public bucket.
Also backfilled **ADR-0054**: FEAT-061's own proposal named its object-storage decision "ADR-0052,"
but that file was never actually committed (0052 is patient merge, unrelated) — found during
FEAT-067's own `/plan` research.

**This is the first M13/FEAT-06x feature to get a real browser (`web-verify`) pass**, not just
typecheck/lint/e2e coverage — and it found three real bugs, all now documented in the
`frontend-design` Skill (entries #10/#11) so they don't need rediscovering:
- `unzipper.Parse({forceStream: true})` requires async iteration (`for await...of`), not
  `.on('entry', ...)` events — the event silently never fires in that mode.
- `openseadragon` touches `document` at *module-evaluation* time, not just construction — crashed
  SSR of the client viewer component with a real `500` that React's own client-side render silently
  "recovered" from (invisible without checking the dev server's own log). Fixed with a type-only
  import + a dynamic `import()` inside `useEffect`.
- Two sibling routes at the same path depth under `/cases/` used different dynamic-segment names
  (`[id]` vs `[caseId]`) — Next.js requires one name per position in the tree; crashed the dev
  server outright at boot.

One real production-code fix landed mid-slice, not part of any single feature's own scope: **`fix:
don't crash API boot when object storage is unconfigured` (#568)** — an `OnModuleInit` hook
depending on MinIO/S3 config threw uncaught on boot when object storage env vars were absent,
taking the whole API down rather than just disabling the image-attachment feature. Fixed to catch
its own failure and degrade gracefully. Real, staging-relevant class of bug — any future
`OnModuleInit` hook that depends on external infra/env config needs the same self-contained
try/catch, not an assumption that config is always present.

## FEAT-065 (patient merge, ADR-0052) and FEAT-066 (patient contact fields + referring-facility/
payer model, ADR-0053) — built and merged between the M13 slice and FEAT-067, at the user's own
direction

After M13's v1 slice, the user asked for a full regression pass (login through both apps, driven
via raw HTTP since no browser tool/Playwright was available *at that point in the session* — later
sessions/tasks do have one, see FEAT-067 above), then to expand the patient model based on "what
implementations that came after" require and "the actual design partner" — deliberately not part
of any epic, both found/scoped mid-session rather than pre-planned:

- **FEAT-065** (#574, PR #575): a codebase audit found `patient-identity` Skill entry #6's own
  flagged-but-unbuilt merge gap was still real. Built `POST /v1/patients/:id/merge` — physical FK
  rewrite onto the survivor across all six `patient_id`-carrying tables, loser tombstoned via a new
  `patient.mergedInto` self-FK, never deleted (ADR-0052's central decision, extending
  `patient-identity` entry #5's "subject metadata, not clinical value" reading one column further).
- **FEAT-066** (#577, PR #578): the user supplied 4 real screenshots of Eldoret Pathology
  Diagnostics' production system — the first genuine design-partner field-set evidence this project
  has had, closing `patient-identity` Skill entry #8's own "illustrative, not a spec" caveat. Added
  patient contact fields (phone/email/address/next-of-kin), and a new tenant-scoped
  `referring_facility` table deliberately reused for **both** order attribution and invoice payer
  (ADR-0053's central decision). `invoice.payerType` (cash/corporate) stays inside ADR-0041's own
  no-ledger boundary.

Both features: full local verification before merge (real Postgres/Keycloak, not mocked). **No
`apps/web` UI from either feature has been seen in a real browser** — this predates FEAT-067's own
`web-verify` pass being available/used this session. See the Manual Verification Checklist below.

## Two `/close` process findings from earlier this session — both approved and applied

Full detail in `~/work/lis-engineering/session-close-reports/2026-08-13-1257-pre.md` /
`-1334-final.md`:

1. A resume-after-compaction fires `SessionStart` twice (`source=resume` then `source=compact`),
   producing two contradictory Rule #0 instructions in the same context. **Fixed** (PR #581):
   `session-start.sh`'s resume-branch output now states explicitly that a later "SESSION CONTINUED"
   message supersedes it.
2. Regenerating `openapi.json`/SDK once mid-implementation, then making a later domain-schema fix
   without regenerating again, let staleness back into CI's own drift check (cost a CI round-trip on
   FEAT-066's PR). **Fixed**: `develop` Skill step 4a now treats regeneration as the literal last
   code step before commit.

## Two more `/close` process findings from this session's later refresh — both approved and applied

Full detail in `~/work/lis-engineering/session-close-reports/2026-08-13-1723-pre.md`:

3. The `tsconfig.build.tsbuildinfo` stale-incremental-cache race (`nest build` reports success while
   silently producing zero `dist/` output) recurred **3+ times this session** despite already being
   documented twice (`engineering/testing` entry #10, `web-verify`'s own header) — the fix was
   always reactive. **Fixed** (PR #584): `apps/api`'s own `build` script now clears the stale file
   automatically, structurally removing the whole recurring class.
4. A proposal referencing an ADR number that was never actually committed happened **twice in one
   session** (FEAT-066's ADR-0053, FEAT-061's never-committed "ADR-0052"/ADR-0054). **Fixed**:
   `develop` Skill gained step 4b — confirm a proposal's own named ADR file actually exists before
   opening the PR.

## Manual Verification Checklist — carried, not yet done live

- FEAT-065/066 (`apps/web`, pre-FEAT-067): `/patients/new` (5 new contact fields + duplicate-found
  resubmission), `/patients/:id` (new demographic rows), `/admin/referring-facilities` (list+create
  + permission fallback), `/orders/new` (Referring facility select + Requesting doctor field),
  `/orders/:id` (Requesting doctor line), sidebar "Referring facilities" nav (French string
  unreviewed).
- FEAT-067 (`apps/web` + WSI mechanism): *did* get a real `web-verify` pass this session (login →
  cases list → case detail → upload → viewer → real zoom/pan, zero console errors) — but only
  against a tiny synthetic 3-level/1-tile-per-level test fixture. Still owed: the viewer's real
  behavior against an actual multi-level DZI export from a real slide scan (real pyramids are orders
  of magnitude larger); the `apps/web` tile-proxy route under real concurrent tile-request volume
  (only 2-3 requests ever exercised); `/cases`/`/cases/:id`'s own visual polish (no Stitch mockup
  existed to check against, this UI was scoped ad-hoc); `fr.json`'s new "Dossiers" string (same
  standing FEAT-048 unreviewed-French gap, one entry larger again).

## Carried into next session

- **New this session:** M13/EPIC-012 fully closed (#537), all 8 v1-slice features plus FEAT-067
  shipped. FEAT-065/066 also shipped, neither part of any epic.
- **New this session:** all four `/close` process findings from both refreshes this session are
  now applied, not just drafted (PRs #580, #581, #584, plus the `develop` Skill's own direct commit
  for step 4b).
- **New this session:** the Manual Verification Checklist above remains genuinely open for FEAT-065/
  066, and partially open (real-scale DZI, concurrent tile load) for FEAT-067.
- No new milestone/epic has been scoped yet for what comes after M13 — the roadmap's own Phase 5
  (AI & advanced: molecular/blood bank packs, digital pathology) is the one clearly-unstarted major
  direction; #546 (AI-assisted synoptic pre-fill, deferred from EPIC-012) is a real, already-filed
  entry point if that's the next pick.
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
- Issue #564 (staging droplet has no memory headroom left for MinIO) remains open and unresolved —
  now directly relevant to FEAT-067 too (WSI storage volume is categorically larger than FEAT-061's
  own already-too-big-for-current-headroom numbers). Both FEAT-061 and FEAT-067 ship local-dev-only
  until this is resolved.
- **SSH IP drift**, found several sessions ago by `/orient`'s engineering-radar pass, not yet fixed
  (no infra work happened this session to re-check the live egress IP): `infra/terraform.tfvars`'s
  `ssh_allowed_ip` may still not match the real current egress IP — worth a human decision on
  whether/when to re-check and apply, since it's a real infra-state change.
- Manual verification still owed by a human, carried forward unchanged: FEAT-047's JSON-mode
  `visibilityCondition` editor (mechanically verified, not yet a live lab-admin pass); FEAT-048's
  shipped French translations (not yet a native-speaker review, now including FEAT-066's and
  FEAT-067's own additions); FEAT-049's `/signup` UX + confirming `lis-onboarding`'s dev secret gets
  rotated before any real deploy; FEAT-046's take-payment UX + confirming the placeholder billing
  metadata reads unambiguously as placeholder; FEAT-045's Constitution-gate marker-recognition
  logic; a live technologist pass on FEAT-024's notes-textarea/grade-button spacing; a live pass
  confirming FEAT-022's SLA amber/red badges read clearly at a glance.
