# Implementation Proposal: FEAT-010 Design system v1
Status: APPROVED
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
