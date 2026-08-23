# Implementation Proposal: real, distinct billing prices for chemistry/haematology/microbiology
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-23    Backlog ID: n/a (pilot-readiness audit follow-up)

## 1. Goal

Per the user's request to address the remaining issues in the pilot-
readiness audit (`pilot-readiness.html`, score 87/100): the one concrete,
still-open code gap in that report (item #9 of the Top 10 blockers,
"Should"-priority in the scorecard) is that the original chemistry/
haematology starter catalog bills every test against the literal string
`"{code}-PLACEHOLDER"` (e.g. `"GLU-PLACEHOLDER"` printed on a real
invoice/receipt line item — the report calls this out by name as a demo
red flag) at one flat $15.00 regardless of actual test complexity. PR #732
already fixed this exact problem for the newly-seeded AP procedures; this
follow-up applies the same fix to the original chemistry/haematology seed,
and closes a related, more serious gap found while doing so: microbiology
(`CULT`/`ORGID`) had no billing metadata at all, making a real culture
order structurally un-invoiceable.

Everything else in the report is either already fixed (19 of 22 roadmap
items), a deliberate deferral (email delivery, per #698's recorded
decision), or an accepted-risk item already signed off (the token-
revocation timing finding, #718) — none of those call for further code
changes.

## 2. What this adds

- `db/seed/chemistry-catalog.sql` — step 19's flat `UPDATE ... SET
  billing_code = code || '-PLACEHOLDER', price_cents = 1500` replaced with
  a `FROM (VALUES ...)` update giving each of the 17 tests (GLU, BUN,
  CREAT, NA, K, CL, CO2, CA, TP, ALB, TBIL, ALP, AST, ALT, LIPID, TSH, FT4)
  its own `billing_code` (now just the test's own already-existing `code`,
  not a second parallel `-PLACEHOLDER` string) and a distinct price
  ($10.00–$35.00, differentiated by real complexity — panels/hormone
  assays priced higher than a single basic-metabolic analyte).
- `db/seed/haematology-catalog.sql` — same fix for CBC ($25.00) and PBS
  ($30.00, priced higher — a manual peripheral-smear morphology review is
  real additional technologist labor a routine automated CBC doesn't
  carry).
- `db/seed/microbiology-catalog.sql` — added a billing block that never
  existed before (a real gap, not a cosmetic one): CULT ($45.00) and ORGID
  ($30.00, priced lower — it's reflex-created off an already-billed CULT
  result, not a separately ordered specimen workup).

All three keep the exact same "placeholder, not partner-negotiated rate"
framing every other price in these files already carries (each file's own
header comment), and the same `WHERE billing_code IS NULL` idempotency
guard the original code used — never overwrites a real price a lab has
since configured.

## 3. Architecture consulted

`db/seed/anatomic-pathology-catalog.sql` (PR #732's own precedent for this
exact "distinct code + distinct price per test" pattern, applied here to
the three older catalog files it didn't touch); `packages/db/src/tenant-
catalog-seed.ts` (confirmed chemistry/haematology are both re-executed
verbatim for every real self-signup tenant, so this fix reaches production
onboarding, not just the fixed demo tenant — confirmed microbiology is
*not* in that list, unaffected either way, no scope change there);
`billing.service.ts`'s own `validateAndTotal` (confirmed directly this is
what rejects an order containing any unpriced test, the reason
microbiology's missing billing block was a structural gap, not a
theoretical one).

## 4. Assumptions & autonomous decisions

- Prices are illustrative, generic, published-adjacent US cash-pay lab
  reference prices for demo purposes — not partner-negotiated rates, same
  caveat every other price in this seed sequence already carries. Replace
  with a real design partner's own fee schedule once one exists, per each
  file's own header comment.
- `billing_code` is now the test's own `code` column value, not a second
  parallel identifier — matches AP's own convention and removes the
  literal `-PLACEHOLDER` string from anything a real invoice/receipt could
  print.

## 5. Risks

Low. Pure seed-data change, no schema/migration, no application code
touched. The `WHERE billing_code IS NULL` guard means this only affects
rows that were never explicitly priced — a lab that already configured
real prices is unaffected.

## 6. Testing plan

- `pnpm --filter @lis/db build` — clean.
- **Live-verified, real Postgres, not just reviewed:** ran `scripts/
  db-reset.sh` (full local reset + migrate + seed) against the real local
  dev stack, then confirmed all 21 affected tests (`SELECT code,
  billing_code, price_cents FROM test_definition ...`) carry real,
  distinct codes/prices — no `-PLACEHOLDER` strings, no flat $15.00.
- **Idempotency confirmed live:** re-ran all three seed files a second
  time against the now-seeded database — `UPDATE 0` on every run, no
  errors, matching the existing `WHERE billing_code IS NULL` guard's own
  intent.
- **Full order → invoice cycle, real API, no mocks:** real patient → real
  order for GLU → real invoice, confirmed the actual response line item
  shows `billingCode: "GLU"`, `unitPriceCents: 1200` — not
  `"GLU-PLACEHOLDER"` / 1500.

## 7. Rollback plan

Revert the three seed files. No schema/migration change. A tenant already
seeded under the old placeholder convention keeps its old `-PLACEHOLDER`
values until this fix's own `WHERE billing_code IS NULL` guard no longer
applies to them (i.e. never, automatically) — a real lab would need an
explicit one-time re-price to pick up the new values on an
already-provisioned tenant, same as any other "never overwrites a real
price" seed change.
