# Implementation Proposal: FEAT-010 Design system v1
Status: IMPLEMENTED — merged as PR #212 (cf6538620e3aca6848870677b71df336ce6caf9b), 2026-07-31
ADR: none — §10 Q1 resolved as (c) (no live Stitch invocation for this task); not warranted for this scope
Date: 2026-07-31    Backlog ID: FEAT-010 (#19) / TASK-034 (#93)

## 1. Goal

FEAT-010 is M2's next feature now that FEAT-008 (Authentication) and FEAT-009 (Authorization
& audit) are both closed at the task level. FEAT-010's own dependency, FEAT-008, is closed.
Purpose per the issue: "one coherent visual language established before the first real
product screen" — this is genuinely the first design-system work in the repo. Confirmed, not
assumed: `packages/ui/src/index.ts` currently contains only `// Design system primitives
land here in FEAT-010 (Design system v1).` and `apps/web/app/globals.css` is still the
untouched `create-next-app` scaffold (`--background`/`--foreground` only, Geist fonts,
`prefers-color-scheme`-only dark mode, page title still "Create Next App"). Nothing to
reconcile against — this proposal is establishing the baseline, not migrating one.

**This proposal's approvable scope is TASK-034 only, not all four of FEAT-010's tasks.**
FEAT-010's issue names one proposal file (`docs/plans/feat-010-design-system-v1.md`) for the
whole feature, matching the FEAT-008/FEAT-009 one-proposal-per-feature precedent — but unlike
FEAT-009's two tightly-coupled tasks (where TASK-033's implementation details were already
fully knowable in advance), FEAT-010's remaining three tasks (TASK-035 primitives, TASK-036
app shell, TASK-037 Storybook/a11y CI) genuinely depend on TASK-034's actual output — the
finalized token *values* and however §10's open question below resolves — in ways that can't
be responsibly pinned down yet. Specifying their affected-files/testing-plan detail now would
be guessing, not planning. §5 states this as an explicit scope-narrowing decision. TASK-034's
own listed dependency, TASK-031 (web auth), is closed — no blocker there.

## 2. Affected files

- `docs/design.md` (new) — design tokens documented for light and dark: color (neutral +
  semantic + primary accent), typography (type scale, tabular-numeral rule for clinical
  values), spacing/radius/elevation scale — transcribed from the Google Stitch Prompt
  Library §0 (Global Design System), which already specifies exact values (see §3). This is
  the task's literal expected output per TASK-034's own issue body.
- `packages/ui/tokens.ts` (new) — the same tokens as a typed, importable TS object (or
  equivalent — exact shape decided at implementation time), consumed by `apps/web` and by
  TASK-035's future primitives. Also the task's literal expected output.
- `apps/web/app/globals.css` (modified) — replace the scaffold's two-variable
  `--background`/`--foreground` set with the real token set, wired through Tailwind v4's
  `@theme` block (the mechanism already present in this file today, just pointed at
  placeholder values). Dark-mode values defined for both the existing
  `prefers-color-scheme` media query (today's only mechanism) and, forward-compatible, a
  `[data-theme="dark"]` attribute selector — TASK-036 (app shell, out of this proposal's
  scope) is what actually builds the manual toggle; TASK-034 must not paint that decision
  into a corner by only supporting the media-query form.
- Stitch reference-screen artifacts (§0 + one or two Master Pattern instances, per TASK-034's
  own title) — **location/format/generation mechanism is the open question in §10.** Not
  pinned here.
- No `packages/ui/package.json` dependency changes expected — `tokens.ts` is plain TypeScript,
  no new runtime dependency. Revisit only if implementation reveals otherwise.

## 3. Architecture consulted

- **Google Stitch Prompt Library §0 (Global Design System)**, `/mnt/d/LIS/research/Google-
  Stitch-Prompt-Library.md` — already fully specifies the actual values this proposal treats
  as the source of truth: light mode (`#F7F8FA` background, `#FFFFFF` surface, `#E7E9EE`
  border, `#0F1729`/`#5B6472`/`#8A93A2` text tiers), dark mode (`#0B0E14`/`#131721`/`#1A202C`
  surfaces, `#232A36` border, `#E6E9EF`/`#9AA4B2` text), one primary accent indigo (`#4F46E5`,
  hover `#4338CA`), five semantic colors (success `#16A34A`, warning `#D97706`, danger
  `#DC2626`, info `#2563EB`, ai/assistant `#7C3AED`), an explicit non-negotiable rule that
  clinical result flags (N/H/L/HH/LL) are never color-only, an 8px-based spacing rhythm
  (8/12/16/24/32 on a 4px grid), and a radius scale (8px cards/buttons, 6px inputs/chips, 12px
  modals, full on avatars/pills). TASK-034's "extract tokens" is largely transcription of
  already-authored values into code/docs, not new design work — the actual open question is
  how the *reference screens* referenced in the task's own title get generated (§10).
- **Google Stitch Prompt Library §1 (Master Patterns A–G)** — the reusable prompt blocks
  TASK-035's primitives and later screens build on; read for context on what "reference
  screens" should demonstrate, not directly consumed by TASK-034's own deliverables.
- **FEAT-010 issue (#19)** — acceptance criteria and task breakdown.
- **`google-stitch-integration` Skill** (lis-engineering) — read in full given this proposal's
  §10 question. Its §4 ("When to actually use Stitch") states the exact rule that applies
  here: "Use it: the feature introduces a screen type with no existing `packages/ui` pattern
  to compose from" — true for TASK-034, since nothing exists yet. Its §1–3 establish that the
  Stitch MCP server is genuinely connected and its tools genuinely work (confirmed by calling
  `list_projects`/`get_project` directly), despite `claude mcp get stitch` still reporting
  "tools fetch failed" — re-confirmed live this session (`claude mcp get stitch` still shows
  that same status text as of 2026-07-31). This proposal does **not** resolve whether to
  actually invoke those tools — that's §10.
- **`playbooks/feature-development/README.md`, "When Google Stitch is appropriate"** — the
  same rule stated a second place, consistent with the Skill.
- **`engineering/frontend-design` Skill — referenced by FEAT-010's own issue body under
  "Required Skills" but does not exist anywhere in `lis-engineering/skills/`** (confirmed via
  a direct file search, not assumed). Flagged as a real drift finding, not fixed here — see
  §6.

## 4. Skills loaded

- `workflow/plan` (this proposal).
- `google-stitch-integration` — loaded in full given §10's open question; see §3 for what it
  establishes and what it deliberately doesn't resolve.
- `engineering/frontend-design` — **could not be loaded; does not exist.** See §3/§6.
- `docker-pnpm-monorepo-deploy` / `authentication` / `rls-multi-tenancy` — checked as
  candidates, not loaded in full: no deploy/infra, no auth, no tenant-scoped-table change is
  introduced by this task, so none apply beyond the general awareness already carried from
  this session's other work.

## 5. Assumptions & autonomous decisions

- **This proposal's approvable scope is TASK-034 only** — see §1. TASK-035/036/037 are
  described only at FEAT-010-issue level for context; a revision to this same proposal will
  specify their affected files/testing plan once TASK-034's real output exists. Not treated as
  an ambiguous reading — flagged explicitly, same move FEAT-009 §5 and earlier proposals used
  for comparable scope boundaries.
- **Token values are transcribed from the Prompt Library's §0, not independently redesigned.**
  §0 is already a complete, specific, human-authored specification (exact hex values, exact
  scales) — treating it as the source of truth avoids inventing a second, competing set of
  values. Reversible implementation detail if the generated reference screens surface a real
  problem with any specific value (e.g. a contrast failure) — not expected, but not assumed
  perfect either; the axe/WCAG AA check (TASK-037, out of scope here but worth naming) is the
  actual proof, not this proposal's read of the spec.
- **Dark-mode tokens are defined for both `prefers-color-scheme` (today's mechanism) and a
  `[data-theme="dark"]` attribute selector (TASK-036's future mechanism)**, so TASK-034
  doesn't foreclose TASK-036's manual-toggle requirement (FEAT-010 AC: "theme toggle...
  persists theme choice" — impossible via media query alone). A reversible implementation
  detail, not routed to an ADR.
- **`engineering/frontend-design` Skill's absence is flagged, not silently authored here.**
  Writing a new Skill mid-proposal, before any real implementation has happened to generate
  genuine findings, would produce a speculative Skill — against this repo's own stated
  principle (`engineering-radar` Skill's own note: "expand only after real observed
  friction"). If TASK-034's implementation surfaces real frontend-design lessons, they become
  this Skill's first real content then, per AGENTS.md's same-day Skill-writing rule — not
  invented now.

## 6. Risks

- **§10 Q1 resolved 2026-07-31 (option (c))** — TASK-034's own title literally names "Stitch
  reference screens" as required output, but live generation is now deferred to a follow-up
  rather than blocking this task; `docs/design.md`/`tokens.ts` are written directly from §0's
  already-specified values. §10 Q2/Q3 remain open and still block moving Status to APPROVED.
- **`engineering/frontend-design` Skill gap** — FEAT-010's own issue names it as required
  reading; it doesn't exist. Low risk to this specific task (§0's spec is detailed enough to
  implement from directly), but real risk to TASK-035 (building 6 primitives) if that task
  starts before any frontend-design lessons/conventions exist anywhere durable. Noted for
  whichever proposal revision covers TASK-035.
- **Tailwind v4's `@theme` block is CSS-first config** (no `tailwind.config.js` in this repo,
  confirmed by `apps/web/app/globals.css`'s existing `@theme inline` block) — token
  integration must follow that pattern, not a `tailwind.config.js`-based approach that would
  be inconsistent with what's already there. Low risk, just worth stating so implementation
  doesn't default to the more commonly-documented (but wrong for this repo) v3-style config.
- **Contrast/AA compliance is asserted by the Prompt Library's own text ("Accessibility (WCAG
  2.2 AA, non-negotiable)") but not independently verified by this proposal.** TASK-037 (axe
  CI check, out of this proposal's scope) is the real proof; TASK-034 should not be treated as
  having "verified AA" just because it transcribes a spec that claims AA compliance.

## 7. Acceptance criteria

TASK-034's literal AC (the only AC this proposal covers):
- [ ] Design tokens documented for light and dark and applied consistently. Judged by:
  `docs/design.md` contains the full light/dark token set (color, typography, spacing,
  radius); `packages/ui/tokens.ts` exports the same values in a typed, importable form;
  `apps/web/app/globals.css`'s `@theme` block consumes them (not hard-coded scaffold values);
  at least one real rendered surface (however §10 resolves) visually confirms the tokens
  produce the calm/enterprise/Linear-Stripe-Vercel-Notion aesthetic §0 describes, in both
  light and dark.

FEAT-010's feature-level AC is explicitly **not** claimed as satisfied by this proposal —
primitives (TASK-035), app shell (TASK-036), and the axe CI gate (TASK-037) are out of scope
here; see §1.

## 8. Testing plan

1. `docs/design.md` and `packages/ui/tokens.ts` reviewed side-by-side against Prompt Library
   §0's literal text — every color/spacing/radius/type value traced back to its source line,
   not eyeballed.
2. `pnpm --filter @lis/ui typecheck` and `pnpm --filter @lis/ui build` pass with the new
   `tokens.ts`.
3. `apps/web`'s `globals.css` change verified by running `apps/web` locally (`pnpm dev`) and
   visually confirming the new tokens are actually applied (background/text/border colors
   changed from the scaffold defaults) in both light and dark (toggle OS-level
   `prefers-color-scheme` to check both, since no manual toggle exists yet).
4. Whatever reference-screen mechanism §10 resolves to: the resulting screen(s) reviewed
   against §0's checklist by eye (calm/dense/enterprise aesthetic, tabular numerals on
   numeric/clinical values, semantic colors never color-only) before being treated as "done."
5. `pnpm typecheck`/`pnpm lint` at the repo root, confirming no regression elsewhere from the
   `globals.css` change.

## 9. Rollback plan

Purely additive/replacement — no migration, no new runtime dependency, no change to any
tenant-scoped table or clinical logic (this is a pure frontend-tokens task). Rollback is
reverting the PR: `apps/web/app/globals.css` returns to the scaffold's two-variable set,
`packages/ui/tokens.ts` and `docs/design.md` are removed, `packages/ui/src/index.ts` returns
to its current placeholder-only state. No production data or deployed feature depends on this
yet.

## 10. Questions requiring human approval

1. **RESOLVED 2026-07-31 — option (c): skip live Stitch generation for this task entirely.**
   §0's token values are already fully specified as text (§3) — `docs/design.md`/`tokens.ts`
   are written directly from that spec, with no Stitch MCP call in TASK-034's scope. Actual
   reference-screen generation (in whichever form — (a) or (b) from the original options below)
   is deferred to a follow-up, once the billing question (#192) resolves, rather than blocking
   TASK-034's core deliverable.

   **Scope of this decision, stated explicitly so it isn't over-read:** this decision covers
   **TASK-034's own token/reference-screen bootstrapping specifically**, using §0's
   already-specified values. It does **not** decide Stitch MCP's fate for future, genuinely
   novel screen-generation needs (per the `google-stitch-integration` Skill's §4 rule — a new
   screen type with no existing `packages/ui` pattern to compose from). That remains a separate,
   standing question, tracked in **issue #192** ("Decide GCP billing / cost ownership for Stitch
   MCP usage") — this proposal does not resolve #192.

   <details><summary>Original options considered (for record)</summary>

   - (a) Invoke the Stitch MCP tools programmatically as part of this task's implementation —
     fastest, most reproducible, but incurs a real API call against the still-undecided billing
     situation now, ahead of #192's resolution.
   - (b) Generate reference screens manually, a human pasting §0 + a Master Pattern prompt into
     the Stitch web app UI directly, then handing the exported screenshots/artifacts back for
     token extraction — avoids automated/repeated API usage until billing is resolved, at the
     cost of a manual step outside this session's automation.
   - (c) Skip live Stitch generation for this task entirely — chosen, see above.

   </details>

2. **RESOLVED 2026-07-31 — proceed without `engineering/frontend-design`.** Not authored now;
   §0's spec is self-contained enough for TASK-034. Any real frontend-design lessons that
   surface during implementation become that Skill's first content afterward, per AGENTS.md's
   same-day Skill-writing rule — not invented speculatively here.
3. **RESOLVED 2026-07-31 — confirmed.** This proposal's scope remains TASK-034 only.
   TASK-035/036/037 will be specified in a later revision once TASK-034's actual output exists.

**All three questions resolved — see Status header.**

---

# Revision: TASK-035 — Build 6 primitives (DataTable, StatusPill, FilterBar, SlideOver, StatCard, FormField)
Status: IMPLEMENTED — merged as PR #216 (cf59d28e5a5b404fc786693f041d96b9216797b4), 2026-08-01
ADR: none — §10 Q3 confirmed the dependency set as-is; a library-adoption choice, not architectural
Date: 2026-07-31    Backlog ID: TASK-035 (#94)

## 1. Goal

TASK-034 (tokens) is merged (PR #212, `cf65386`) and its issue (#93) closed. Per this proposal's
own §1 promise, TASK-035 is specified now that TASK-034's real output — `packages/ui/tokens.ts`
and `docs/design.md` — exists. TASK-035's dependency (TASK-034) is satisfied. This is M2's
largest remaining design-system task (size: L) and blocks TASK-036 (app shell, which composes
these primitives) and TASK-037 (Storybook, which catalogs them).

**This revision's approvable scope is TASK-035 only**, same scope-narrowing rationale as the
original proposal's §1 — TASK-036/037 still depend on TASK-035's actual component API shape in
ways not responsibly knowable yet.

## 2. Affected files

- `packages/ui/package.json` — add `react`/`react-dom` as `peerDependencies` (consumed, not
  bundled, by `apps/web`); add shadcn/ui's own standard dependency set as direct deps: per-
  primitive `@radix-ui/*` packages (e.g. `react-slot` for polymorphism, `dialog` for SlideOver),
  `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` (icons — status pills,
  slide-over close button, sort indicators). See §10 Q3 — confirm before installing.
- `packages/config/tsconfig.base.json` or a new `packages/ui/tsconfig.json` override — add
  `"jsx": "react-jsx"` and `"lib": ["dom", "dom.iterable", "esnext"]`; currently absent (verified
  — `packages/ui` has never compiled JSX before).
- `packages/ui/components.json` (new) + `apps/web/components.json` (new) — shadcn/ui's own
  documented monorepo pattern (confirmed via its official docs: `apps/<app>` +
  `packages/ui/src/{components,lib,hooks}`, package-import aliases `#components/*`/`#lib/*`,
  cross-package `exports` map). Adopting this exact structure rather than inventing our own.
- `packages/ui/src/lib/cn.ts` (new) — shadcn's standard `clsx` + `tailwind-merge` className
  utility, required by every generated component.
- `packages/ui/src/components/data-table.tsx`, `status-pill.tsx`, `filter-bar.tsx`,
  `slide-over.tsx`, `stat-card.tsx`, `form-field.tsx` (new) — the six primitives.
- `packages/ui/src/index.ts` — export the six, alongside the existing `tokens.ts` exports.
- `apps/web/app/globals.css` — add a Tailwind v4 `@source` directive pointing at
  `packages/ui/src` (confirmed via Tailwind's own docs: cross-package source files are **not**
  auto-detected and must be explicitly registered — `@source "../../../packages/ui/src";` or
  equivalent relative path).
- `packages/ui/.storybook/main.ts` + `preview.ts` (new) — `@storybook/react-vite` framework
  (plain React library, not Next.js-specific — the primitives themselves have no Next.js
  dependency, so `react-vite` is the correct framework here rather than `@storybook/nextjs`,
  confirmed via Storybook's own docs). `stories: ["../src/components/**/*.stories.tsx"]`.
- `packages/ui/package.json` — add `storybook`, `@storybook/react-vite`, `@storybook/addon-a11y`
  as devDependencies, plus a `"storybook": "storybook dev -p 6006"` script.
- `packages/ui/src/components/*.stories.tsx` (new, one per primitive) — light/dark story variants
  per primitive, per TASK-035's own AC.
- **Explicitly out of this task's scope, left for TASK-037 as originally sized:** the CI-enforcing
  step (`@storybook/test-runner` + `axe-playwright`, per Storybook's own documented pattern, that
  actually fails a CI run on a WCAG violation). This task's scaffold makes `@storybook/addon-a11y`
  available as an *interactive* panel inside Storybook itself — genuinely useful during
  development — but does not wire anything into CI. TASK-037's own AC ("CI fails when a WCAG AA
  violation is introduced") and "Expected output" ("Storybook config + CI a11y step") narrows to
  just the CI a11y step now that config is pulled forward here.

## 3. Architecture consulted

- **`docs/design.md` / `packages/ui/tokens.ts`** (this proposal's own TASK-034 output) — the six
  primitives consume these tokens directly, not new values.
- **Stitch Prompt Library §0** (table rules) and **§1 Master Patterns** — Pattern A (List/
  Data-Table: dense sortable multi-select table, sticky header/first column, bulk-action bar,
  pagination footer, right slide-over on row-open) and Pattern B (Dashboard: KPI stat cards —
  label, big tabular number, delta indicator, sparkline) directly specify DataTable, SlideOver,
  and StatCard's required behavior. §0 also specifies StatusPill's non-negotiable rule (clinical
  flags never color-only — letter + icon + color) and FormField's (labels above inputs, never
  placeholder-only, helper/error text, required markers).
- **AGENTS.md's stack line** — `shadcn/ui` named explicitly as this repo's intended component
  layer, alongside Tailwind. This is the first task that actually builds on it.
- **shadcn/ui official monorepo docs** (verified via Context7, `/shadcn-ui/ui`, this session) —
  confirmed the exact `apps/<app>` + `packages/ui/src/{components,lib,hooks}` layout with
  package-import aliases matches this repo's existing structure closely; adopting it rather than
  inventing a bespoke layout.
- **Tailwind v4 docs** (verified via Context7, `/websites/tailwindcss`, this session) — confirmed
  cross-package source files need an explicit `@source` directive; not auto-detected by default.
- **Storybook docs** (verified via Context7, `/storybookjs/storybook`, this session) — confirmed
  (a) `@storybook/react-vite` is the correct framework for a plain-React component-library package
  (not `@storybook/nextjs`, since `packages/ui` has no Next.js dependency), (b) Storybook's own
  documented monorepo pattern for colocated stories explicitly references a sibling
  `packages/ui/src/**/*.tsx` glob — validating scaffold placement inside `packages/ui` itself
  rather than a separate `apps/storybook`, and (c) the CI-enforcing a11y pattern is
  `@storybook/test-runner` + `axe-playwright`, distinct from the interactive
  `@storybook/addon-a11y` panel — confirming the TASK-035/TASK-037 split stated in §2.
- **`.mcp.json`** (committed this session, PR #214) — declares the `shadcn` MCP server
  (`npx shadcn@latest mcp`). First real opportunity to use it; not yet exercised — see §10 Q2.
- **`google-stitch-integration` Skill** — reused by analogy (its §4 rule: use MCP/generator
  tooling for a genuinely new component type with no existing `packages/ui` pattern — true for
  all six primitives, this package has never had a real component before).
- **`engineering/frontend-design` Skill** — still doesn't exist (FEAT-010 §10 Q2 resolved:
  proceed without it, let real findings become its first content). This task is that moment —
  see §6.

## 4. Skills loaded

- `google-stitch-integration` — for MCP-usage patterns generally (Stitch-specific content not
  directly reused here, but the "use generator tooling for genuinely new component types" rule
  is).
- `docker-pnpm-monorepo-deploy` — checked, not directly relevant (no deploy/infra change; no
  Dockerfile touches `packages/ui`).
- `engineering/frontend-design` — **could not be loaded; does not exist.** Same gap as TASK-034,
  now genuinely load-bearing — see §6.

## 5. Assumptions & autonomous decisions

- **Component file naming is kebab-case** (`data-table.tsx`, not `DataTable.tsx`), matching
  shadcn/ui's own convention shown in its official docs. Reversible, cosmetic.
- **All six primitives are built as thin, accessible wrappers over Radix UI primitives** (via
  shadcn's generator/CLI), not hand-rolled from raw HTML — Radix is the standard mechanism for
  the keyboard-accessibility TASK-035's own AC requires (focus trapping on SlideOver, listbox
  semantics on sortable/selectable DataTable rows, etc.). Not treated as ambiguous: AGENTS.md
  already names shadcn/ui as the stack.

## 6. Risks

- **`engineering/frontend-design` Skill gap is now load-bearing, not hypothetical.** FEAT-010
  §10 Q2 deferred authoring it until real findings existed — this task is where they'll surface
  (component API conventions, prop-naming patterns, composition rules). Recommend authoring it
  immediately after this task lands, same-day per AGENTS.md's rule, using whatever real
  decisions get made below as its first content.
- **`shadcn` MCP server (`.mcp.json`) is genuinely untested in this repo.** If MCP calls fail or
  behave unexpectedly, the fallback is the plain `npx shadcn@latest add <component>` CLI directly
  — same underlying generator, no MCP round-trip required. Not a hard blocker either way.
- **Tailwind v4's cross-package `@source` detection is the first time this repo's Tailwind config
  has needed to reach outside `apps/web`.** If misconfigured, primitives will render structurally
  correct but completely unstyled (classes present in the DOM, not in the generated CSS) — a
  silent-looking failure mode worth explicitly checking for (inspect the compiled CSS chunk for
  the primitives' expected classes, same verification method used for TASK-034).
- **Storybook scope creep, now that §10 Q1 is resolved as (a).** This task now delivers a real,
  working Storybook instance (not just six components) — larger surface than a pure-component
  task. Mitigated by keeping the pulled-forward scope genuinely minimal: config + stories +
  interactive a11y panel only, no CI wiring (that stays TASK-037's, as stated in §2).

## 7. Acceptance criteria

TASK-035's literal AC (the only AC this revision covers):
- [ ] All six render correctly in Storybook, light and dark, and are keyboard-accessible. Judged
  by: each primitive has a story exhibiting its light/dark rendering; keyboard navigation
  (Tab/Shift+Tab, Enter/Space activation, Esc where applicable, arrow-key nav on DataTable rows)
  manually verified per primitive; `@storybook/addon-a11y`'s panel shows no violations; no
  `console --errors` on render.

## 8. Testing plan

1. `pnpm --filter @lis/ui typecheck` and `pnpm --filter @lis/ui build` pass with the six new
   components and their new dependencies.
2. `pnpm typecheck`/`pnpm lint` at the repo root — confirms no regression in `apps/web` from the
   `@source` directive change or new `packages/ui` exports.
3. Compiled CSS chunk inspected directly (same method as TASK-034) to confirm the primitives'
   Tailwind classes actually made it into the generated stylesheet, not just the DOM.
4. `packages/ui`'s Storybook instance (`pnpm --filter @lis/ui storybook`) runs locally; each
   primitive's story checked for light/dark rendering, keyboard operability, and a clean
   `@storybook/addon-a11y` panel, per the AC above.
5. A real rendered check in `apps/web` itself (not just Storybook) for at least one primitive in
   context, given this session's earlier finding that `apps/web` has no public page and limited
   headless-browser tooling — plan for that constraint explicitly rather than rediscover it.

## 9. Rollback plan

Purely additive — no migration, no tenant-scoped table, no clinical logic. Rollback is reverting
the PR: new dependencies removed from `packages/ui/package.json`, new component files deleted,
`packages/ui/src/index.ts` and `apps/web/app/globals.css` revert to their TASK-034 state. No
production data or deployed feature depends on this yet.

## 10. Questions requiring human approval

1. **RESOLVED 2026-07-31 — option (a): pull forward a minimal Storybook scaffold.** Scope drawn
   precisely (see §2, §3, §6): `packages/ui/.storybook/` config (`@storybook/react-vite`
   framework, verified as the correct framework choice for this plain-React package via
   Storybook's own docs), one story file per primitive, and `@storybook/addon-a11y` for
   interactive-only accessibility feedback during development. Explicitly **not** pulled
   forward: the CI-enforcing `@storybook/test-runner` + `axe-playwright` step — TASK-037 keeps
   that, narrowed from "Storybook config + CI a11y step" to just the CI a11y step, matching its
   own dependency-on-TASK-035 relationship in the backlog.
2. **RESOLVED 2026-07-31 — option (a): use the `.mcp.json`-declared `shadcn` MCP server** to
   scaffold the six primitives — first real use of that server in this repo. If it fails or
   behaves unexpectedly, fall back to the plain `npx shadcn@latest add <component>` CLI (same
   underlying generator, no MCP round-trip) rather than debugging the MCP path at length.
3. **RESOLVED 2026-07-31 — confirmed.** New `packages/ui` runtime dependencies (per-primitive
   `@radix-ui/*` packages, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`)
   approved as-is — shadcn/ui's own standard set.
4. **RESOLVED 2026-07-31 — defer.** `engineering/frontend-design` is not authored as part of this
   task. Real findings from this task's implementation get noted in the breadcrumb
   (`docs/scope/current.md`); authoring the Skill itself is left for a later, explicit decision —
   not silently done same-day by default.

**All four questions resolved — see Status header.**

---

# Revision: TASK-037 — Storybook CI a11y step
Status: IMPLEMENTED — merged as PR #217 (db2982f9d1d0e3acca118320dbf706d056bf226d), 2026-08-01
ADR: none — CI-only addition, no architectural decision
Date: 2026-08-01    Backlog ID: TASK-037 (#96)

## 1. Goal

TASK-035 (PR #216, `cf59d28`) pulled forward a working Storybook scaffold and one story per
primitive, explicitly narrowing TASK-037's own remaining scope to just the CI-enforcing step —
stated at the time in that revision's §2 and §6. This revision specifies that narrower scope.
Dependency (TASK-035) is satisfied.

## 2. Affected files

- `packages/ui/.storybook/test-runner.ts` (new) — `@storybook/test-runner` config with
  `axe-playwright`'s `injectAxe`/`checkA11y` in `preVisit`/`postVisit` hooks, per Storybook's own
  documented pattern (verified via Context7 during TASK-035's research, not re-verified here
  since the pattern is unchanged).
- `packages/ui/package.json` — add `@storybook/test-runner`, `axe-playwright`, `http-server`,
  `concurrently`, `wait-on` as devDependencies; add a `"test-storybook": "test-storybook"` script.
- `.github/workflows/pr.yml` — new job `storybook-a11y`, independent of the existing
  `build-and-test` job (no Postgres/Keycloak needed — this is packages/ui-only). Runs inside the
  official Playwright Docker image (`mcr.microsoft.com/playwright:v1.58-noble` or latest matching
  tag) specifically to avoid the missing-system-library problem hit locally during TASK-034/035
  (no `sudo`/`--with-deps` available in this sandbox; a GitHub-hosted runner's container has full
  root, but using the pre-built Playwright image sidesteps needing to run `playwright install
  --with-deps` at all). Steps: install → `pnpm --filter @lis/ui build-storybook` → serve the
  static output (`http-server`) + `wait-on` + `test-storybook`, per Storybook's own documented CI
  recipe.

## 3. Architecture consulted

- TASK-035's own revision (§2, §3, §6) — already established the test-runner + axe-playwright
  split from the interactive `@storybook/addon-a11y` panel; this revision implements exactly
  that, not a new design.
- Storybook's own CI docs (Context7, fetched during TASK-035) — the build → serve → `wait-on` →
  `test-storybook` recipe, and the official Playwright Docker image as the recommended way to get
  browser dependencies in CI without a manual `--with-deps` install step.

## 4. Skills loaded

- `docker-pnpm-monorepo-deploy` — checked; not directly relevant (this workflow doesn't touch
  Dockerfiles or the deploy pipeline, just `pr.yml`), but its entry on validating a CI/Docker
  change with a real local run before pushing (§9 of that Skill) is the practice being followed
  here regardless.

## 5. Assumptions & autonomous decisions

- **A new, independent `storybook-a11y` job, not additional steps in the existing
  `build-and-test` job.** The existing job already carries Postgres/Keycloak service containers
  entirely unrelated to a frontend-only a11y check; bolting on more unrelated steps there would
  make an already-long job slower and harder to read. Reversible, low-risk.
- **Playwright's official Docker image, not a manual `playwright install --with-deps` step on
  `ubuntu-latest`.** Both work on GitHub-hosted runners (which have real root, unlike this
  sandbox); the image is simpler and is Storybook's own first-listed recommendation.

## 6. Risks

- **Not locally verified end-to-end in this sandbox** — the same missing-`libnss3.so`/no-sudo
  limitation that blocked a live screenshot in TASK-034/TASK-035 also blocks running
  `test-storybook` against a real browser locally here. Verification for this task happens by
  reading the CI run's real output after pushing (build the workflow correctly the first time by
  following the documented recipe closely, then confirm via the actual GitHub Actions run log —
  same "a green step is not proof" discipline as the deploy-pipeline gotchas already documented).
- **First CI job in this repo using a non-default container image** — worth double-checking the
  job actually starts and pulls the image correctly on the first real run, not just that the YAML
  is syntactically valid.

## 7. Acceptance criteria

TASK-037's literal AC:
- [ ] CI fails when a WCAG AA violation is introduced into a primitive. Judged by: a deliberate,
  temporary violation (e.g. removing an `aria-label`) introduced locally, confirming the new job
  fails, then reverted before merge — not just trusting the config looks right.

## 8. Testing plan

1. `pnpm --filter @lis/ui typecheck`/`build` unaffected (new devDeps/config only).
2. Push the branch and read the real `storybook-a11y` job output on GitHub Actions — confirms the
   Playwright image pulls, Storybook serves, and `test-storybook` actually runs against real
   browsers (not verifiable locally, per §6).
3. A deliberate, temporary a11y violation confirms the job actually fails on a real violation,
   not just that it runs green by coincidence (e.g. never actually executing the axe check).

## 9. Rollback plan

Purely additive — a new CI job and Storybook test-runner config, no application code path
affected. Rollback is reverting the PR.

## 10. Questions requiring human approval

No genuinely open questions — TASK-035's own revision already made the two real decisions this
task depends on (test-runner + axe-playwright split from the interactive panel; CI wiring
explicitly deferred here). Noting this explicitly rather than fabricating a question for the sake
of the template.

**No implementation begins until this revision's status changes to APPROVED.**

---

# Revision: TASK-036 — App shell: sidebar, top bar, org/branch switcher, theme, palette
Status: IMPLEMENTED — merged as PR #237 (60d5212b5b0bdb7cf47789f7b5a5143f6e48a8ba), 2026-08-01
ADR: none — §10's question resolved as a UI-scope decision, not architectural
Date: 2026-08-01    Backlog ID: TASK-036 (#95)

## 1. Goal

TASK-035 (primitives, PR #216) and TASK-037 (a11y CI, PR #217) are both merged. TASK-036's
dependency (TASK-035) is satisfied. Per FEAT-010's own AC: shell renders on every authenticated
route, theme choice persists across reload. Found during 2026-08-01 orientation: session 7's
breadcrumb wrongly claimed this task was already done — it was not (see `docs/scope/current.md`
correction, PR #235). This is genuinely the first time `apps/web` gets more than a single page.

## 2. Affected files

- `apps/web/app/(app)/layout.tsx` (new) — route-group layout wrapping every authenticated route
  in the shell (sidebar + top bar). `apps/web/app/page.tsx`'s existing content moves under this
  group as `apps/web/app/(app)/page.tsx`, unchanged in behavior.
- `apps/web/app/(app)/_components/sidebar.tsx`, `top-bar.tsx`, `theme-toggle.tsx`,
  `command-palette.tsx` (new) — composed from `packages/ui`'s existing primitives/shadcn base
  components (`Button`, `DropdownMenu`, `SlideOver` reused for the mobile sidebar drawer) per
  AGENTS.md's "compose from packages/ui" convention. No new `packages/ui` primitives — this is
  app-shell composition, not new design-system surface area.
- `apps/web/app/(app)/_components/tenant-switcher.tsx` (new) — **scope depends on §10.**
- `apps/web/middleware.ts` or a small server action (new/modified) — theme persistence via a
  `theme` cookie (not `localStorage`), read server-side so the initial SSR render already has the
  right `[data-theme]` attribute (the mechanism TASK-034 already reserved in `globals.css`) —
  avoids the flash-of-wrong-theme a client-only toggle would cause.
- `apps/web/app/globals.css` — no new tokens; only wiring the `[data-theme="dark"]` selector
  TASK-034 already defined to whatever the theme cookie resolves to.

## 3. Architecture consulted

- **FEAT-010 issue (#19) AC**: "App shell (sidebar, top bar, org/branch switcher, theme toggle,
  command palette stub) renders on every route and persists theme choice."
- **Session model** (`apps/web/auth/session.ts`) — confirmed directly: the verified session
  payload carries exactly `{ sub, tenantId }`. No org/branch concept anywhere.
- **Database schema** (`db/migrations/*.sql`) — confirmed directly, no `organizations` or
  `branches` table exists; `tenant_id` is a plain forward-referencing column per ADR-0005/ADR-0009
  (single Keycloak realm, `tenant_id` attribute) with no FK target table of its own yet.
- **Domain package** (`packages/domain/src`) — confirmed directly, no org/branch/facility/site
  type exists.
- **Conclusion: the "org/branch switcher" named in FEAT-010's AC has no backing data model
  anywhere in this repo today.** This is the one load-bearing gap this revision can't responsibly
  paint over — see §10.
- **Stitch Prompt Library §1 Master Pattern** (app shell/nav pattern) — sidebar + top bar
  structure, no specific guidance on tenant-switcher data source (that's application data, not a
  design-system concern).

## 4. Skills loaded

- `engineering/frontend-design` — still doesn't exist (tracked as #234, not blocking, per
  TASK-034/035's same precedent).
- `authentication` — checked for org/branch/multi-tenant-session precedent; confirms current
  session model is single-tenant-per-login only, consistent with §3's finding.
- `rls-multi-tenancy` — checked; covers RLS enforcement mechanics, not UI-level org/branch
  switching; no relevant precedent for this question either way.

## 5. Assumptions & autonomous decisions

- **Theme persists via a cookie, not `localStorage`.** Reversible implementation detail:
  cookie-based persistence lets the very first SSR render already carry the right theme
  (no flash-of-wrong-theme), matching TASK-034's own forward-looking `[data-theme]` selector.
- **Command palette is a genuine stub**: a keyboard shortcut (`Cmd/Ctrl+K`) opens an empty
  `SlideOver`/dialog with a disabled search input and a "Coming soon" placeholder — no real
  command registry or search logic. FEAT-010's own AC says "command palette stub" explicitly;
  building real command search now would be scope invention, not stub delivery.
- **Not treated as ambiguous, decided here:** sidebar/top-bar layout and composition — these
  compose existing `packages/ui` primitives per already-established convention, no new judgment
  call needed.

## 6. Risks

- **The org/branch switcher's actual scope is undecided — see §10.** Whichever option is chosen,
  this is the first UI element in the repo built ahead of its real backing data existing;
  flagging so it isn't later mistaken for a data-model decision made carelessly.
- **First multi-route `apps/web` layout** — moving `page.tsx` under a route group is a structural
  change; low risk (Next.js route groups are additive, don't change the URL), but worth a real
  manual check that `/` still resolves correctly and the login/logout flow (unauthenticated
  redirect) still works, not just that the build succeeds.

## 7. Acceptance criteria

TASK-036's literal AC:
- [ ] Shell renders on every authenticated route and the theme choice persists across reload.
  Judged by: sidebar + top bar visible on the (currently only) authenticated route; theme choice
  survives a full page reload (cookie-based, verified by inspecting the response's `Set-Cookie`
  and the next request's initial render); command palette opens via keyboard shortcut; whatever
  §10 resolves for the tenant switcher renders without a console error.

## 8. Testing plan

1. `pnpm --filter web typecheck`/`build` pass with the new route group and components.
2. `pnpm dev`, manual check: login flow still redirects correctly, shell renders post-login,
   theme toggle changes `[data-theme]` and survives a hard reload, command palette opens/closes
   via keyboard and click-outside/Esc.
3. `pnpm typecheck`/`pnpm lint` at the repo root.
4. Storybook/axe CI (TASK-037's job) will not directly cover `apps/web` pages (it's
   `packages/ui`-scoped) — manual keyboard-nav + a browser a11y check (axe DevTools or equivalent)
   substitutes for the shell itself, noted here so it isn't silently skipped.

## 9. Rollback plan

Purely additive/structural — no migration, no tenant-scoped table, no clinical logic. Rollback is
reverting the PR: `apps/web/app/(app)/` route group removed, `page.tsx` returns to
`apps/web/app/page.tsx` directly.

## 10. Questions requiring human approval

1. **RESOLVED 2026-08-01 — option (a).** The org/branch switcher shows only the current
   session's single `tenantId` as a non-interactive label (no dropdown, no switching) — matches
   what real data exists today, avoids fabricating multi-org UI ahead of the schema. Revisit once
   a real organizations/branches model exists (not yet scoped as any tracked task/feature).

**All questions resolved — see Status header. Implementation begins now.**
