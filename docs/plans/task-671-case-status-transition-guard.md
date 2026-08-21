# Implementation Proposal: DB-level case-status transition guard (issue #671)
Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #671

## 1. Goal

`ck_case_status` constrains `case.status`'s value set but not its
transition graph -- that's enforced entirely by per-route application
guards in `case.controller.ts`. Defense-in-depth, not a bug fix: add a
DB-level backstop matching `case_report_version`'s own hand-written
trigger precedent (0045_case_report_version.sql).

## 2. Legal transition graph (derived directly from case.controller.ts)

Traced from every `caseTable` status UPDATE in the controller (the only
four call sites that ever change `case.status`):

- `screen()` (line ~1199): `accessioned|in_process -> pending_review`
- `returnToScreening()` (line ~1260): `pending_review -> in_process`
- `finalize()` (line ~1320): `accessioned|in_process|pending_review -> signed_out`
- `amend()` (line ~1427): `signed_out|amended -> amended`

No route ever transitions a case back to `accessioned` -- that's the
INSERT-only initial value, not a legal UPDATE target.

## 3. Design

A hand-written trigger, mirroring `fn_case_report_version_append_only`'s
own precedent exactly (triggers/functions aren't representable in the
Drizzle schema builder, so this is a raw-SQL-only migration, no
`schema.ts` change, no snapshot file -- matching 0007's own no-snapshot
precedent for a pure-trigger migration):

```sql
CREATE FUNCTION fn_case_status_transition_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF (OLD.status, NEW.status) IN (
    ('accessioned', 'pending_review'),
    ('in_process', 'pending_review'),
    ('pending_review', 'in_process'),
    ('accessioned', 'signed_out'),
    ('in_process', 'signed_out'),
    ('pending_review', 'signed_out'),
    ('signed_out', 'amended'),
    ('amended', 'amended')
  ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'illegal case status transition % -> % for case % (Constitution Law #2 applied to case.status)', OLD.status, NEW.status, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_case_status_transition_guard
  BEFORE UPDATE ON "case"
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_case_status_transition_guard();
```

A same-status update (any other column changing) is a no-op for this
trigger via the `WHEN` clause -- the trigger only fires when `status`
itself changes, so it can never interfere with any other case field
update. `('amended','amended')` is intentionally listed (not implied by
the `NEW.status = OLD.status` short-circuit, which is redundant with the
`WHEN` clause but kept as defense-in-depth against a future direct
`UPDATE ... SET status = status` that skips the trigger's `WHEN` some
other way) -- `amend()` always re-sets status to `'amended'` even when it
already is, so this must stay legal.

Sync note (per the issue's own instruction): if a future issue adds a
new `case.status` value or a new application-level transition, both this
trigger's transition list *and* the corresponding `case.controller.ts`
guard must be updated together -- each references the other by comment.

## 4. Acceptance criteria (from the issue, restated)

- A direct UPDATE attempting an illegal transition (raw SQL, bypassing
  the application layer) is rejected at the DB layer.
- No behavior change for any legal transition reachable through the
  existing API routes.

## 5. Out of scope

- Any change to the application-level guards -- already correct, this
  adds a backstop only.

## 6. Testing

Direct DB-level test: attempt an illegal transition via a raw SQL UPDATE
(e.g. `accessioned -> amended`, skipping every intermediate state) and
confirm it's rejected with the trigger's own exception. Re-run the full
existing case-lifecycle e2e coverage (screen/return-to-screening/
finalize/amend) to confirm zero behavior change for every legal
transition already exercised there.

## 7. Questions requiring human approval

None -- a defense-in-depth backstop with a fully-derived transition
graph, no product/business decision involved.
