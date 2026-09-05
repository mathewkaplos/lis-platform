# Implementation Proposal: Synoptic protocol form progress indicator
Status: APPROVED
ADR: n/a    Date: 2026-09-05    Backlog ID: issue #803

## 1. Goal

`ProtocolForm` (`apps/web/app/(app)/cases/[caseId]/synoptic/[partId]/protocol-form.tsx`) renders a
flat, undifferentiated list of elements with no way to tell "what's left to fill in" or "what's
blocking sign-out" (issue #803, from the 2026-09-05 UX audit §3.4). Add a small, live-updating "N of M
required elements answered" indicator above the form — the smallest change that answers both
questions, without speculatively building section-grouping/navigation no seeded protocol currently
uses (per the component's own header comment: "None of the three real seeded protocols use grouping
today").

## 2. Affected files

- `apps/web/app/(app)/cases/[caseId]/synoptic/[partId]/protocol-form.tsx` — the only file touched.
  Purely a client-side derived count from data already in the component (`elements`, `values`,
  `isVisibleForKey`) — no new prop, no new fetch, no API/schema change.

## 3. Architecture consulted

- The component's own existing `isVisibleForKey`/`FieldControl`'s `enforced` logic — reused exactly
  as-is for the new count, not reimplemented. `enforced = element.requirement !== 'recommended'`
  (both `required` and `conditional` count; only `recommended` is excluded) is the file's own existing
  rule (`FieldControl`, line ~199) for what a field's own asterisk already means — the counter must
  agree with that, not invent a second definition of "required."
- `docs/pilot/PILOT-USER-GUIDE.md` §10 (synoptic protocol functional coverage) — confirms conditional
  visibility already works live for the two protocols actually opened; this proposal doesn't touch
  that logic, only adds a readout above it.

## 4. Skills loaded

- `engineering/frontend-design` (required — `apps/web` component edit). No entry applies directly (no
  new route/dynamic segment, no new client-only library, no new `useActionState` form, no thrown
  Server Component error). Re-confirmed no regression risk to entry #8 (`useActionState`
  `initialState` must live outside a `'use server'` file) since this proposal touches only the client
  component, not `actions.ts`/`types.ts`.
- `engineering/api-design` — not loaded; no `apps/api` change.

## 5. Assumptions & autonomous decisions

- **Count only currently-*visible*, enforced (required + conditional) elements** — a hidden
  conditional field (its `visibilityCondition` currently false) must not count toward "N required
  remaining," matching the form's own submit-time filtering (`isVisibleForKey`) exactly. Reusing that
  existing function, not writing a second visibility check.
- **Repeatable elements are excluded from the count entirely, not counted per-instance.** The seeded
  protocols' repeatable groups (per issue #666's own header comment) are themselves optional
  containers with no minimum-instance requirement — there's no defined "how many instances are
  required" today, so counting a repeatable element's own required children per-instance would invent
  a number the domain model doesn't actually enforce. Flagging as a question below in case this reads
  as incomplete once a real repeatable-heavy protocol is used live.
- **No section grouping/sticky nav** — explicitly deferred, matching issue #803's own recommended
  scope: none of the three seeded protocols uses `ElementGroup`'s nesting for real sections today, so
  building navigation for a structure that doesn't exist yet would be speculative. If a future protocol
  actually groups elements, this is a natural follow-up, not blocked by anything in this change.
- Indicator text: `"N of M required fields answered"` rendered as a single `<p>` above the `<form>`'s
  `ElementGroup`, using the existing `text-sm text-text-secondary` convention already used elsewhere in
  this file (matches `FieldControl`'s own hint-text styling) — no new color/badge convention introduced.
- Not shown once `state.status === 'done'` (the post-submit success view) — nothing left to fill in at
  that point, and that branch already returns a wholly different, simpler read-only view.

## 6. Risks

- Recomputing the count on every keystroke (via `useMemo` keyed on `values`) is O(elements) — trivial
  even for a 40-element protocol, no debouncing needed.
- Low risk overall: purely additive, read-only derived UI; no change to submit logic, validation, or
  the recorded response shape.

## 7. Acceptance criteria

- Opening any synoptic protocol form shows "N of M required fields answered" directly above the field
  list, where M = the count of currently-visible elements with `requirement !== 'recommended'`, and N
  = how many of those currently have a non-empty value in `values`.
- The count updates live as fields are filled in or a conditional field's visibility changes (e.g.
  setting HER2 status to "Positive" reveals the HER2-percent field and immediately increments M).
- Submitting still works exactly as before; the post-submit success view is unchanged.

## 8. Testing plan

- `pnpm --filter web typecheck` and `pnpm --filter web lint`.
- `protocol-form.spec.ts` (existing) — run to confirm no regression; add one new case asserting the
  counter's initial M for a known fixture protocol and that it increments after filling one required
  field.
- Manual `web-verify` pass: open the live Breast protocol (the one confirmed live-fillable per the
  guide's §10.2), confirm the counter appears, is correct at load, and updates when the conditional
  HER2-percent field appears after setting HER2 status.

## 9. Rollback plan

Single-file, additive change — revert the one commit if anything regresses. No migration, no API
change, no data change.

## 10. Questions requiring human approval

**Approved 2026-09-05** — scoped exactly as proposed: plain text counter, repeatable elements' own
children excluded from the count, no section nav/progress bar.
