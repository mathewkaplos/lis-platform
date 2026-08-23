# Implementation Proposal: Unit tests for packages/domain's cross-field schema rules
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-23    Backlog ID: n/a (coverage-improvement follow-up)

## 1. Goal

Continuing the coverage-improvement pass: `packages/domain` (the shared
Zod schemas that ARE the API contract — request validation, OpenAPI
generation, and `apps/web`'s own typed client all derive from these same
schemas) had zero test coverage at all, no test infrastructure, not even a
`test` script. A schema-shape bug here silently affects every layer at
once, and is currently only ever caught indirectly, if at all, by an
`apps/api` e2e spec that happens to exercise the exact validation path.

## 2. Scope

Not every schema in `packages/domain` (34 files) — most are plain
`z.object()` shapes with no custom logic, self-evident from reading them.
Scoped to the 4 files with real `.refine()`/cross-field validation logic
(the only ones a repo-wide grep for `.refine(`/`.superRefine(` turned up),
exactly the class of rule that's easy to silently break in a future edit
and hardest to verify just by reading the code:

- `billing.ts` — `generateInvoiceRequestSchema`: `payerType: 'corporate'`
  requires `referringFacilityId`; also carries a `.default({})` added
  specifically so every existing no-body caller keeps parsing.
- `observation.ts` — `resultEntrySchema`: a discriminated union (one
  branch per `dataType`) plus a cross-branch refine mirroring a real DB
  CHECK constraint (`notesAiOriginated`/`notesAiDisposition` must travel
  together, ordinal branch only).
- `order.ts` — `orderCreateSchema`: at least one of
  `testDefinitionIds`/`panelIds` required, neither individually required.
- `patient.ts` — `patientSearchQuerySchema`: exactly one of five
  mutually-independent lookup modes required; an empty query is
  deliberately rejected (fail-closed), not treated as "list everything."

## 3. Affected files

- `packages/domain/src/{billing,observation,order,patient}.spec.ts` (new)
  — 42 tests total, covering every real branch/edge of each refine: every
  valid path, every way to fail the cross-field rule, and adjacent
  field-level validation (enum/format/min-length) each schema also
  enforces.
- `packages/domain/package.json` — added `vitest`/`vite-tsconfig-paths`
  devDependencies and a `test` script (`vitest run`) — this package had no
  test infrastructure at all before this.
- `packages/domain/vitest.config.ts` (new) — mirrors `apps/web`'s own
  config shape (plain node environment; these are pure Zod parses, no I/O).
- `packages/domain/tsconfig.build.json` (new) — a real bug caught while
  wiring this up: the plain `build` script (`tsc -p tsconfig.json`) would
  have compiled the new `.spec.ts` files straight into the shipped
  `dist/` output (confirmed: `find dist -iname "*.spec.*"` showed 8 files
  after a first build). Fixed by adding a build-only tsconfig that
  excludes spec files — same `tsconfig.json` (typecheck, includes
  everything) / `tsconfig.build.json` (build, excludes specs) split
  `apps/api` already establishes for the identical reason. `build` script
  updated to use it; `typecheck` unchanged (still checks spec files too).

## 4. Architecture consulted

`apps/web/auth/access-token.spec.ts` (the existing "test the real thing,
not a fake" house style — not applicable here in the literal sense, since
these are pure functions with no real thing to call, but the same
directness applies: real inputs, real `.safeParse()`, no mocking
scaffolding); `apps/api/tsconfig.build.json` (the build/typecheck tsconfig
split, reused directly for the dist-pollution fix).

## 5. Assumptions & autonomous decisions

- **Real bug caught while validating the tests themselves, not just
  writing them:** the first draft of `order.spec.ts`/`billing.spec.ts`
  used placeholder UUIDs like `11111111-1111-1111-1111-111111111111` —
  these fail Zod v4's `z.uuid()` (RFC 4122 variant-nibble check, not just
  "looks like a UUID"). Caught by actually running the suite (6 failures
  on first run), not assumed correct from writing them. Fixed by using
  RFC-4122-valid placeholder UUIDs (`...4111-8...`-style version/variant
  nibbles) throughout.
- Scoped to the 4 refine-bearing files rather than every schema in the
  package — a deliberate, stated scope decision (§2), not an oversight;
  the remaining 30 files are plain object shapes with no logic beyond
  what Zod's own type system already enforces structurally.

## 6. Risks

None — purely additive test coverage plus a real fix (the dist-pollution
bug) that only makes the existing build cleaner, no behavior change to
any shipped schema.

## 7. Testing plan

- `pnpm --filter @lis/domain build` clean; confirmed no `.spec.*` files in
  `dist/` after a fresh rebuild (the bug this proposal itself fixed).
- `pnpm --filter @lis/domain typecheck` clean (still checks spec files).
- `pnpm --filter @lis/domain test`: 42/42 pass (after fixing the UUID
  validity bug found by actually running them).
- `pnpm -r test` (the root command CI's `pnpm test` step runs): confirmed
  `packages/domain`'s new suite is picked up automatically, alongside
  every other workspace package's own tests, all still passing.
- `pnpm --filter api build`, `pnpm --filter web typecheck` both still
  clean (downstream consumers of `@lis/domain`'s dist output unaffected).
- `pnpm lint` clean (reverted two unrelated files ESLint's `--fix`
  reformats as a known side effect, per this repo's own established
  gotcha).

## 8. Rollback plan

Revert all files listed in §3. No schema/API behavior change — safe to
revert independently of any other work.
