# Implementation Proposal: Cytology reviewer reject/return-to-screening action
Status: APPROVED
ADR: n/a (extends existing FEAT-063 two-tier workflow, adds no new architecture)    Date: 2026-08-19    Backlog ID: issue #639

## 1. Goal

The two-tier cytology workflow (FEAT-063) only has a forward path — `screen()` moves a case to
`pending_review`, `finalize()` signs it out from there. There is no way for a cytopathologist
reviewing a `pending_review` case to send it back if the screening was inadequate. Add the small,
well-scoped reverse transition: one new route, one new button on the case detail page, no new
schema. The ninth AP slice this session.

## 2. Affected files

- `packages/domain/src/anatomic-pathology.ts` — add `caseReturnToScreeningRequestSchema = z.object({
  reason: z.string().min(1) })`, a new purpose-named schema mirroring `caseAmendRequestSchema`'s
  own shape exactly rather than reusing that schema directly — matches this session's own
  established preference for one named type per action even when two actions happen to share a
  shape (e.g. `AddBlockState`/`AddSlideState` stayed separate despite being structurally
  identical).
- `apps/api/src/case/case.controller.ts` — new method `returnToScreening()`:
  - `POST 'v1/cases/:id/return-to-screening'`, `@HttpCode(200)` (an action on an existing
    resource, matching `screen()`'s own convention).
  - `@RequireCapability('verify')` — this is a reviewer's own decision, the same actor category as
    `finalize`/`amend`, not a routine technologist action like every `manage_specimens` route on
    this page.
  - No `@RequireStepUp()` — matches `screen()`'s own "routine tier transition, not the actual
    diagnostic release" reasoning (confirmed directly from its header comment) exactly; this
    transition is no more diagnostically significant than `screen()`'s own forward move.
  - `@UseGuards(JwtAuthGuard, CapabilityGuard)` + `@UseInterceptors(TenantContextInterceptor,
    AuditInterceptor)` + `@Audit({ action: 'case.return_to_screening', resourceType: 'case' })` —
    the simpler `screen()`-style pattern (return `{resourceId, before, after, reason}`, let
    `AuditInterceptor` write the audit event), not `amend`/`finalize`'s own manual
    `writeAuditEvent` — that heavier pattern exists specifically for the digital-signature/
    step-up routes, which this isn't.
  - Guard: current status must be exactly `pending_review` (400 otherwise, same "wrong status"
    message shape every AP mutation route already uses) — this transition only ever makes sense
    from the one status `screen()` itself produces.
  - Transition: `.set({ status: 'in_process' })` — confirmed directly this session that
    `in_process` is a real, already-defined value in `caseStatusSchema` that no code path in this
    controller has ever actually set (grepped every `.set({ status:` call: only
    `pending_review`/`signed_out`/`amended` are written anywhere today) — exactly the "screened but
    not yet in final review" re-entry state `screen()`'s own header comment already names as valid.
  - No new capability, no new DTO response typing (matches every other `@Audit()`-wrapped route's
    own undocumented-response precedent, confirmed directly during #636's own implementation —
    `AuditInterceptor` wraps every return value into `{resourceId, before, after, actorRole}`
    regardless of what the handler returns).
- `apps/web/app/(app)/cases/[caseId]/actions.ts` — add `returnToScreening` server action: raw
  `fetch` `POST` to `${API_BASE_URL}/v1/cases/${caseId}/return-to-screening` with JSON body
  `{ reason }`, no `@ZodResponse`/no typed client (same reasoning as every action in this file
  targeting an `@Audit()`-wrapped route). No `step_up_required` branch — this route has none. On
  success, `revalidatePath` the case route.
- `apps/web/app/(app)/cases/[caseId]/return-to-screening-form.tsx` (new) — `useActionState`, one
  required `FormField`-wrapped `<textarea name="reason">` (matching `amend-case-form.tsx`'s own
  reason-field shape exactly), submit button ("Return to screening"). **No permanent "done"
  replacement branch** (the one place this form's shape diverges from `amend-case-form.tsx` and
  matches `sign-out-case-form.tsx`/`screen-case-form.tsx` instead) — a successful submission
  changes `case.status` away from `pending_review`, so the card's own status-conditional gate on
  the page (§2 below) makes the whole card disappear on the next render; there's no "stays visible
  for a second use" scenario the way Amend's card has (an amendable case can be amended again and
  again; a case is only ever in `pending_review` once per screen→review cycle).
- `apps/web/app/(app)/cases/[caseId]/types.ts` — add `ReturnToScreeningState` type + initial state,
  matching `SignOutCaseState`'s exact shape.
- `apps/web/app/(app)/cases/[caseId]/page.tsx` — new "Return to screening" card, gated on
  `caseData.status === 'pending_review' && hasVerifierRole(session)` — the exact inverse-status
  condition to issue #624's own `SCREENABLE_STATUSES` card, reusing `hasVerifierRole` (already
  imported, used by Sign out/Amend) rather than a new helper.
- `apps/api/openapi.json` + `packages/sdk/src/schema.ts` — regenerated (new route; request body is
  documented via `caseReturnToScreeningRequestSchema`, response stays undocumented like every
  sibling `@Audit()` route).

## 3. Architecture consulted

- `apps/api/src/case/case.controller.ts` `screen()` (currently ~932-978) — confirmed directly:
  exact guard/interceptor/audit-decorator stack, the `{resourceId, before, after}` return shape,
  the "routine transition, no step-up" reasoning quoted in its own header comment.
- `apps/api/src/case/case.controller.ts` `finalize()`/`amend()` (currently ~1001-1200) — confirmed
  the two-tier gate (`requiresTwoTierReview(...) && caseRow.status !== 'pending_review'`) that this
  new transition is the reverse of, and confirmed `amend()`'s own `caseAmendRequestSchema`
  `{reason}` shape as the precedent for this route's own request body.
- `packages/domain/src/anatomic-pathology.ts` `caseAmendRequestSchema` (`:200-203`) — confirmed the
  exact `{ reason: z.string().min(1) }` shape to mirror.
- Grepped `case.controller.ts` directly for `.set({ status:` (only `pending_review`/`signed_out`/
  `amended` appear) and for any existing reject/return-to-screening route (none found) — the
  issue's own claims independently re-confirmed, not trusted from its text alone.
- `apps/web/app/(app)/cases/[caseId]/page.tsx` (current state, post-#636) — confirmed
  `SCREENABLE_STATUSES`'s exact placement/shape and that a `pending_review` case already shows
  both the Narrative card and (for a verifier) the Sign out card — this new Return-to-screening
  card will be a third option shown alongside Sign out on a `pending_review` case, matching this
  session's own established "multiple action cards can coexist, a wrong choice just 400s cleanly"
  precedent (e.g. Screen/Sign out already coexist this way).
- `apps/web/app/(app)/cases/[caseId]/amend-case-form.tsx` and `sign-out-case-form.tsx` — confirmed
  the two structural precedents this new form blends: the required-reason-textarea shape from the
  former, the no-permanent-done-branch shape from the latter (§2's own reasoning for why).
- `apps/web/auth/roles.ts` `hasVerifierRole` — confirmed already imported and used on this page
  (Sign out, Amend), reused unmodified.

## 4. Skills loaded

- `engineering/api-design` (required — new `apps/api` route). Checked entry #7 (RLS via
  `TenantContextInterceptor` is the only tenant boundary needed, no manual filter) — this route
  follows every sibling AP mutation's own precedent exactly, nothing new to reason about.
- `engineering/frontend-design` (required — new `apps/web` client component). Checked: no
  function-valued props cross the Server/Client boundary (`ReturnToScreeningForm` takes only a
  plain `caseId: string`); no new route/dynamic segment added.

## 5. Assumptions & autonomous decisions

- **`verify` capability, not `manage_specimens`.** A genuine judgment call between two defensible
  options, resolved by treating this as a reviewer decision (same category as finalize/amend)
  rather than a routine technologist action (same category as screen/block/slide creation). Named
  explicitly rather than silently assumed, since the issue's own text proposed this but didn't
  force it.
- **Transition target is `in_process`, not back to `accessioned`.** `in_process` is the status
  `screen()`'s own header comment already names as the valid pre-review re-entry point, and
  `finalize()`'s own two-tier gate already accepts re-screening from `in_process` (its guard is
  "must have been screened," checked via `pending_review`, not "must currently be `accessioned`")
  — so a case returned to `in_process` can be corrected and re-screened via the existing `screen()`
  route without any further change.
- **No distinct "rejected"/"returned" case status.** Explicitly out of scope per the issue's own
  text — `in_process` combined with the audit trail (which records the reviewer's reason) is
  sufficient to reconstruct what happened; a new status would only matter for a reviewer-queue UI
  distinguishing "never screened" from "returned once already," which issue #613's own Pending
  Review tab doesn't attempt today and isn't asked for here.
- **Both Return-to-screening and Sign-out cards render on a `pending_review` case for a verifier**
  (§3) — not mutually exclusive. Matches this session's own established pattern rather than adding
  new coordinating logic between two independent action cards.

## 6. Risks

- **Low.** Purely additive, reuses every established convention from the eight prior AP proposals
  this session (guard stack, audit shape, form structure, capability reuse). No schema change, no
  new migration.
- The one genuine design risk (§5's first bullet) — `verify` vs. `manage_specimens` — is named
  explicitly in §10 for confirmation rather than silently picked, since it's a real access-control
  decision with no single obviously-correct answer from the architecture alone.

## 7. Acceptance criteria

1. A verifier viewing a `pending_review` case sees a "Return to screening" card with a required
   reason field; a technologist (no `verify`) viewing the same case does not.
2. A verifier viewing a case in any other status sees no such card.
3. Submitting with a reason transitions the case to `in_process`, writes one `case.return_to_screening`
   audit event with the given reason, and the card disappears from the re-rendered page (status no
   longer `pending_review`).
4. The case can be screened again via the existing Screen action once corrected, re-entering
   `pending_review` exactly as before.
5. Submitting with an empty reason is blocked client-side (native `required`) and, if bypassed,
   400s with a clear message server-side.
6. Attempting this action on a case not in `pending_review` (verified via a direct API call, since
   the UI itself won't render the control) 400s with a clear wrong-status message.
7. No change to `screen()`/`finalize()`/`amend()`'s own business logic or any existing e2e
   assertion.

## 8. Testing plan

- New `apps/api` e2e case(s) in `cytology-two-tier.e2e-spec.ts` (the natural home, alongside
  `screen()`'s own coverage): a full `screen → return-to-screening → screen again → finalize`
  round trip; `verify`-capability gate (a `manage_specimens`-only token is rejected, 403); wrong-status
  rejection (attempting on an `accessioned` case 400s); empty-reason rejection (400); one audit
  event with the correct action name and reason recorded.
- No new `apps/web` automated tests (matching every prior AP-page proposal's own precedent).
- Manual/browser verification (`web-verify` Skill): as a verifier, screen a cytology case, return
  it to screening with a reason, confirm the card disappears and the case shows `in_process`;
  re-screen and finalize it successfully; confirm a technologist session never sees the
  Return-to-screening control.

## 9. Rollback plan

Revert the commit(s). No migration, no schema change — a plain `git revert` fully restores prior
behavior.

## 10. Questions requiring human approval

1. Confirm `verify` (not `manage_specimens`) is the right capability for this action (§5) — i.e.,
   this is a reviewer's own judgment call, not something a screening technologist should be able to
   do to their own submitted case.
