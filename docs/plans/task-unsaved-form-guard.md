# Implementation Proposal: Warn before losing unsaved input on the highest-risk forms
Status: APPROVED
ADR: none (defensive client-side UX, no architecture/data-model change)    Date: 2026-09-24    Backlog ID: `docs/world-class-execution-plan-8-2026-09.md` §4.E action 1 / Phase 2 ("Fix the mid-form-refresh data-loss hazard")

**Approved 2026-09-24** via the native options-prompt: "Approve as written."

## 1. Goal

`docs/pilot/PILOT-USER-GUIDE.md` (edge-case table, "Refresh mid-multi-step form") **confirmed live
on 2026-08-27** that refreshing mid-form wipes everything typed, with no warning. The execution plan
ranks this P1 and autonomous, and makes it a Gate 3 (pilot-ready) requirement: "The mid-form-refresh
data-loss hazard is fixed on the pilot's actual workflow forms." The pilot discipline (Decision 1)
is still open, so this covers the forms every discipline goes through: register patient → place
order → accession case.

Scope: when one of these forms holds unsubmitted input, refreshing, closing the tab or navigating
away by URL shows the browser's native "Leave site? Changes you made may not be saved" prompt.

## 2. Affected files

- `apps/web/lib/use-unsaved-changes-guard.ts` (new): a small client hook,
  `useUnsavedChangesGuard(isDirty: boolean)`. While `isDirty` is true it registers a `beforeunload`
  listener (`event.preventDefault()` plus the legacy `returnValue = ''` for older Chromium/Safari),
  and removes it on cleanup or when `isDirty` goes false. It returns `bypass()`, which sets a ref the
  listener checks, for intentional reloads such as the patient form's own "Cancel".
- `apps/web/app/(app)/cases/new/case-accession-form.tsx`: dirty = any part row has a non-empty
  `specimenType` or `rejectionReason` (derived from existing controlled state, no new state).
- `apps/web/app/(app)/orders/new/order-builder-form.tsx`: dirty = any test/panel selected, or a
  named field (priority, referring facility, requesting doctor) was edited. The field edits are
  tracked with one form-level `onChange` that ignores unnamed inputs, so typing in the catalog
  *filter* box alone doesn't count as unsaved data. This form is also used by the clinician order
  page (FEAT-038), so that page gets the guard too.
- `apps/web/app/(app)/patients/new/page.tsx`: uncontrolled fields, so dirty is set by a form-level
  `onChange`. Its duplicate-match "Cancel" button calls `location.reload()` on purpose, so it calls
  `bypass()` first.
- `apps/web/e2e/unsaved-changes-guard.spec.ts` (new): Playwright coverage (see §5).

Once a form reaches `status === 'created'`, it unmounts and the effect cleanup removes the
listener, so the success screen never prompts. A server-action submit is not a page unload, so
submitting never prompts.

## 3. Approach

Use the native `beforeunload` prompt only. It's one shared hook, three small call-site changes, and
it relies on standard browser behaviour instead of a custom dialog.

## 4. Alternatives considered

- **`sessionStorage` draft save and restore** (the plan's other suggested option). Rejected for v1:
  these forms hold patient identifiers (name, DOB, national ID, phone, next-of-kin), and lab
  reception PCs are commonly shared. Writing PHI to browser storage that outlives the submit, and
  that nothing in this codebase currently audits or clears on logout, is a new privacy surface that
  needs a deliberate decision. It isn't a defensive fix the plan allows us to make autonomously. The
  warning prevents the silent loss, which is the confirmed hazard.
- **Blocking in-app navigation too** (sidebar/`Link` clicks). Not included: the Next.js App Router
  has no supported route-change blocking API, and hand-intercepting every `<a>` click is fragile.
  **Disclosed gap:** clicking a sidebar link mid-form still discards input without warning. The
  confirmed hazard was refresh; this remaining case goes in the pilot guide's edge-case table.
- **A guard on every form in the app.** Rejected for now: the plan says "highest-risk multi-step
  forms". The hook makes adding more forms a one-line change once the pilot shows which ones matter.

## 5. Testing plan

- `apps/web/e2e/unsaved-changes-guard.spec.ts` (Playwright, real browser):
  1. Patient registration: type a first name, reload, and expect a `beforeunload` dialog.
  2. Patient registration, pristine: reload and expect no dialog.
  3. Order builder: tick a test, reload, and expect a dialog.
  4. Case accession: type a specimen type, reload, and expect a dialog. This needs an existing order
     id; reuse the seeding helpers `clinical-workflow.spec.ts` already uses.
- `pnpm --filter web typecheck`, `pnpm --filter web lint`.
- CI `web-e2e` runs the new spec against the full stack. This sandbox has no Docker daemon, so the
  local full-stack e2e run may not be possible. If it isn't, the PR will say so, and CI's `web-e2e`
  job is the evidence.

## 6. Risk

Low. Client-only, additive, and no server or API change. The main false-positive risk is prompting
when nothing needs saving; the dirty rules in §2 are chosen to avoid that. The main false-negative
risk is a browser suppressing the prompt: Chromium requires a prior user gesture on the page, which
is always true when the user has typed. Playwright's input counts as a trusted gesture.

## 7. Open questions

None blocking. The `sessionStorage` draft-save alternative (§4) is a possible follow-up decision for
Mathew, not a prerequisite.
