# UX / Responsiveness Audit — 2026-09-05

**Author:** Claude Code, independent pass. **Scope actually executed vs. the original 28-section
brief:** narrowed live, with the user's explicit sign-off, after a real tooling wall was hit (see
§0). This is not a from-scratch re-audit — `docs/pilot/PILOT-USER-GUIDE.md` (Draft v4, three prior
live-verified passes through 2026-08-26 → 2026-08-28) already did an exhaustive functional/RBAC/
workflow audit of nearly every module in this brief, with real bugs found and fixed, issues filed,
and a scorecard with zero red rows as of the 2026-08-28 exit-gate re-run. Re-doing that here would
burn a lot of effort to restate already-correct, already-cited findings. **This report's job is to
add what that guide didn't cover**: real visual/interactive testing at achievable viewports, a
dedicated UX-quality lens (cognitive load, information hierarchy, consistency, terminology) rather
than a pass/fail functional lens, and one new, previously-undocumented finding that both approaches
should have caught but didn't.

Read this alongside `docs/pilot/PILOT-USER-GUIDE.md` — this report doesn't repeat that document's
RBAC matrix, audit-trail confirmation, or Part-by-Part workflow steps; it cites them by section
instead.

---

## 0. Environment constraint — read this before the scorecard

The brief asked for a full viewport matrix (1920×1080 down to 360×800) with real interaction, not
resized screenshots. That was attempted first. Result:

- The Claude-in-Chrome extension's `resize_window` tool reports success on every call but never
  actually changes the browser's viewport — confirmed via `window.innerWidth`/`matchMedia` staying
  locked at **1366×768 (the physical screen's native resolution)** regardless of the requested size
  (tested 1920×1080, 1024×700, and 390×844 — all three left `innerWidth` at 1366).
- A brand-new tab hit the identical ceiling.
- The extension's own screenshot capture intermittently times out (`CDP Page.captureScreenshot`,
  30s timeout) at roughly a 30–50% rate throughout this session — a live rendering tab, not a frozen
  one; a retry usually succeeds.
- No OS-level window for this Chrome instance is enumerable from this desktop session either
  (checked via `EnumWindows`), so there's no OS-level resize workaround.

This is not a new problem — `docs/pilot/PILOT-USER-GUIDE.md` §21 already documented `resize_window`
"regressing" on 2026-08-27 and never getting a working substitute. It is still broken on 2026-09-05.
**Recommendation to the team:** file this as its own tracked gap (tooling, not app) — until it's
fixed, no session can produce genuine narrow-viewport screenshots, and every future audit will
either silently skip mobile/tablet or falsely claim coverage it didn't do.

Given this, and with the user's explicit sign-off, this pass:
- Did real, live, interactive testing at **1366×768** (the one width actually achievable) —
  screenshots below, not just DOM assertions.
- Assessed mobile/tablet layout by **code inspection** (Tailwind breakpoints, `overflow-x-auto`
  containers, the mobile nav's `sm:hidden` gate) cross-referenced against the prior session's own
  2026-08-27 DOM-measurement pass (§21 of the guide), which did get real `matchMedia`/`scrollWidth`
  readings at 390px before its own tooling failed. Anything below is explicitly marked **[LIVE
  1366×768]**, **[CODE-INSPECTED]**, or **[CARRIED FORWARD from 2026-08-27]** — never blended.

---

## 1. Executive verdict

**YES, WITH CONDITIONS.**

The prior audit already earned this tenant a clean functional scorecard (zero 🔴/🟠 rows,
2026-08-28 exit gate). This pass didn't find anything that overturns that. It did find one
**new P0**: the AP case detail page — the single screen a pathologist spends the most time on
(narrative, synoptic recording, sign-out, amendment) — never displays the patient's name, MRN, or
any order context, and has no link back to the order or patient chart. That's a real pilot-blocker:
it's a specimen-identification concern in a pathology system, and it's the kind of thing a design-
partner pathologist would notice in the first five minutes of a demo. Filed as
[issue #800](https://github.com/mathewkaplos/lis-platform/issues/800).

Everything else found this pass is P1/P2 polish on top of an already-solid functional base: the
synoptic protocol form has no section structure or progress indicator for what will be a 20–40+
field CAP/ICCR form in real use, and the shared tenant's demo data is more polluted with e2e
fixture noise now (613 pending worklist items, "ProcessingQc List-...", "Case Fixture", etc.) than
when the prior pass flagged the same problem at 272 rows — `pnpm db:reset` immediately before any
real design-partner session is not optional, it's mandatory, and it's getting more necessary over
time, not less.

**Condition for pilot readiness:** fix #800, reset the demo tenant, and get one real narrow-viewport
pass done (once the tooling is fixed, or on a real phone) before showing this to a lab that will
actually use it standing at a reception desk.

---

## 2. What's new this pass vs. what's carried forward

| Area | Status |
|---|---|
| RBAC matrix, audit trail, workflow completeness (Parts 2–20 of the guide) | **Carried forward**, not re-driven — already exhaustively live-verified 2026-08-26→28 |
| AP case detail — patient identity | **NEW — P0, issue #800** |
| Synoptic protocol form — section/progress structure | **NEW — P1**, code-inspected + cross-checked against the guide's own §10 functional confirmation (which tested that fields work, not that the form is easy to navigate at 20+ fields) |
| Demo-tenant fixture pollution | **Re-confirmed, materially worse** (613 vs. 272 pending items) — same root cause the guide already named, not a new bug |
| Mobile nav drawer, table horizontal-scroll containment | **Carried forward from 2026-08-27** DOM-measurement pass — not re-verified live this pass (tooling, §0) |
| Tablet-width case tree/WSI viewer | **Still never visually verified**, third consecutive session to hit this exact tooling wall |

---

## 3. Live findings at 1366×768

### 3.1 Dashboard / Worklist — [LIVE 1366×768]

Loads instantly, dark theme, clear Pending/In Progress/Verified stat tiles, working stage tabs and
a filter panel (Priority/From/To). No complaints about the layout itself at this width — it's clean
and legible. The problem is the data in it (§4).

### 3.2 Patients list — [LIVE 1366×768]

Table scrolls horizontally inside its own bounded container (confirmed by scrolling right: MRN
column slides off, Name/Sex/Age/National ID come into view) — this is the documented convention
(guide §21) working correctly, not a new finding. Genuinely no complaint at this width.

**One real, reproducible perceived-performance gap**: navigating Dashboard → Patients via the sidebar
link took 3–4 seconds with **zero visual feedback** — the dashboard's own stale content just sits on
screen, unresponsive, until the new page suddenly replaces it. This is very likely the direct
consequence of the guide's own §7 fix (deleting `loading.tsx` to kill the Suspense-hang bug) — a
correct fix for a worse bug, but it traded away the loading skeleton that route used to have. **P2**:
worth a lightweight top-of-page progress bar (e.g. `nprogress`-style) across the app rather than a
per-route `loading.tsx`, so this doesn't return route-by-route.

### 3.3 AP case detail — [LIVE 1366×768 + code-inspected]

See §5 below — this is the session's main finding (issue #800).

### 3.4 Synoptic protocol form — [CODE-INSPECTED]

Could not reach a case with an eligible protocol still attached in the current (heavily-fixtured)
tenant in the time available (a case ID from the prior session's own notes now 404s — the data has
moved on since 2026-08-27). Read `protocol-form.tsx` directly instead. Findings:

- Elements render as one continuous `ElementGroup` recursion in `displayOrder` — there is no section
  header, no "Part A of B," no collapsible group, and no progress indicator ("12 of 34 required
  fields complete") anywhere in this component.
- Required/conditional/recommended tiers **are** distinguished (asterisk + a source-standard-aware
  hint like "(required per ICCR)") — this part is good, and matches the guide's own §10 confirmation
  that conditional visibility works live.
- Validation is submit-time only (`recordSynopticResponse` action) — there's no inline "3 required
  fields remaining" affordance while filling the form.
- Repeatable elements (`Add <label>` / `Remove`) are supported but only as flat cards, not
  numbered/collapsed sections either.

For the two protocols the guide's own live pass actually opened (Breast, Colorectal), this was
apparently manageable — but those are described as "not that many fields" relative to the 20–40+
field ceiling this audit brief is explicitly worried about, and none of the three larger unopened
protocols (Lung, Prostate, Cervical Cytology/Bethesda) have ever been live-verified end to end by
anyone (guide's own §23 scorecard admits this: 🟡, "never opened/filled live — code presence only").
**P1**: before relying on this for a real 30+ field protocol, add at minimum a sticky section nav or
a "N required fields remaining" indicator — the current flat-list structure will make "what do I
still need to fill in" (the audit brief's own named question) genuinely hard to answer past ~15
fields, even though every individual field behaves correctly.

### 3.5 Cases list — [LIVE 1366×768]

Status tabs (Active/Pending Review/Signed Out/Amended) work, patient name column present (confirms
issue #749 is genuinely fixed). Capped at 100 rows with no visible pager, same class of limitation
already disclosed for Patients (guide §7) — not re-filing, just noting for completeness.

---

## 4. Demo-data hygiene — re-confirmed, worse

The prior audit (2026-08-26) already flagged the shared `...0001` tenant as unfit for a live demo
without a `pnpm db:reset` first — 272 obviously-fake worklist rows at the time. This pass, ten days
later, the same tenant shows **613 pending items**, including entries literally named
`ProcessingQc List-1788605442868`, `ProcessingQc CrossTenant-...`, `ProcessingQc Malformed-...`, and
`Case Fixture` — all e2e/manual-test leftovers, visible on the very first screen a design partner
would see, and in the "Recently registered" patient list too. This is not a new bug — it's the same
already-tracked operational risk, just growing linearly as more sessions run their own tests against
the shared tenant without ever resetting it. **Restating as P0-adjacent operational risk, not a code
finding**: whoever runs the actual design-partner demo must run `pnpm db:reset` immediately
beforehand — this is already the guide's own recommendation, just getting more urgent, not less.

---

## 5. Finding detail — AP case detail page has no patient identity (P0)

**Route:** `/cases/[caseId]` (`apps/web/app/(app)/cases/[caseId]/page.tsx`)
**Evidence:** live-rendered (screenshot below) + confirmed in source — `caseData` is never queried
or rendered with any patient field; the only patient fetch on this page is inside an
`isAmendable`-gated branch used solely to prefill an email quick-fill button, and that patient
record is discarded after use, never displayed.

What actually renders at the top of the page, live:

```
260905-000431   [signed_out]

Part 260905-000431-P1 — tissue
  Block 260905-000431-B1
    Slide 260905-000431-B1-S1
```

No patient name. No MRN. No DOB/sex. No ordering clinician. No order date/priority. No referring
facility. No link back to `/orders/[id]` or `/patients/[id]` anywhere on the page — the Narrative,
Screen, Sign out, Amend, Report versions, and Audit trail cards below it all operate on this same
unidentified case with zero additional context added.

**Why this matters more than a typical missing-field bug:** the brief's own Part-C evaluation
criteria for the AP workflow asks explicitly whether a pathologist can tell "what case they are
working on, patient identity, specimen identity." The honest answer today is **no** — the only
identifying string on the entire page is a bare accession number. A pathologist working several
cases per session (switching tabs, returning from a worklist) has no way to visually confirm they're
signing out the correct patient's diagnosis without leaving this page. Filed as
[issue #800](https://github.com/mathewkaplos/lis-platform/issues/800), severity P0, with a scoped
fix recommendation (surface `orderId`/patient fields unconditionally in the existing API response,
add a header line + "View order" link — no other layout change needed).

---

## 6. Terminology / consistency spot-checks

Nothing new to add beyond what the guide already tracks (issue #768's inconsistent 403 messaging
class of gap; the guide's own confirmed nav-vs-capability-gate convention in `sidebar.tsx`, which is
deliberate and documented, not a bug). Domain terminology (case/part/block/slide/accession/synoptic/
gross/microscopic/sign-out) is used consistently and correctly across every screen touched this
pass — no confusing renames or SaaS-generic substitutions found.

---

## 7. Mobile / tablet verdict — [CODE-INSPECTED + CARRIED FORWARD, not re-verified live]

Cannot be upgraded past the prior session's own confidence level this pass (§0). Repeating with the
correct provenance labels so this isn't mistaken for fresh verification:

- **Mobile nav drawer**: `sidebar.tsx` gates a hamburger trigger behind `sm:hidden` (Tailwind
  ≤640px) — matches the 2026-08-27 live finding that the drawer opens with the full link set at
  390px. **[CARRIED FORWARD]**.
- **Table horizontal-scroll containment**: the Patients table's `overflow-x-auto` wrapper pattern
  was directly observed live at 1366px this pass (§3.2) and DOM-measured at 390px in the prior pass.
  **[LIVE 1366 + CARRIED FORWARD 390]**.
- **Tablet-width case tree/WSI viewer**: **still never visually verified by anyone**, across three
  consecutive sessions now blocked by the same class of tooling failure. This is the single largest
  remaining gap in this system's responsiveness evidence — the case tree + WSI viewer is explicitly
  called out in the brief as the most complex layout in the app, and nobody has actually looked at
  it below desktop width.

**Overall mobile verdict:** registration/search/dashboard — usable (carried-forward evidence).
AP case detail, synoptic protocol, WSI viewer — **not verified at any narrow width**, treat as
desktop/tablet-preferred until someone with working tooling (or a real phone) checks them.

---

## 8. P0 / P1 / P2 backlog

| ID | Severity | Finding | Status |
|---|---|---|---|
| — | P0 | Case detail page has no patient identity or order link | [Issue #800](https://github.com/mathewkaplos/lis-platform/issues/800) — filed this pass |
| — | P0-adjacent (data, not code) | Shared demo tenant fixture pollution, now worse (613 vs 272 rows) | Not a new issue — restates guide's own existing recommendation (`pnpm db:reset` before any demo) |
| — | P1 | Synoptic protocol form has no section/progress structure for large protocols | Not yet filed — recommend filing before Lung/Prostate/Cervical protocols are used live for the first time |
| — | P2 | No loading feedback on Dashboard→Patients (and likely other) navigations since `loading.tsx` was deliberately removed | Not yet filed — low urgency, correct trade against the worse hang bug it fixed |
| — | Tooling (not app) | `resize_window`/screenshot capture broken in this Chrome-automation environment, 3rd session running | Recommend the team track this separately so future audits don't silently under-cover mobile/tablet |

---

## 9. Regression assessment

No regressions found or introduced. No code was changed this pass beyond filing issue #800 (no fix
attempted — out of scope for this pass, and the guide's own precedent is to fix-and-reverify inline
only for pilot-blocking bugs found with a clear, scoped fix ready; this one needs an API-shape
decision, not just a UI tweak, per #800's own recommendation).

---

## 10. Recommended order

1. Fix #800 (case detail patient identity) — small, scoped, highest real-world impact.
2. `pnpm db:reset` immediately before any actual design-partner session — not a code fix, an
   operational must-do, restated because the problem is measurably worse now than last time it was
   flagged.
3. File and address the synoptic-form section/progress-indicator gap before Lung/Prostate/Cervical
   protocols are used live for the first time with a real pathologist.
4. Separately track and fix the Chrome-automation resize/screenshot tooling — it has now blocked
   genuine mobile/tablet verification for three sessions running the same class of check.
5. Once (4) is fixed, run one real interactive pass at 768px and 390px specifically on the case
   tree/WSI viewer and the synoptic form — the two screens this report and every prior one agree are
   the highest-complexity, least-verified layouts in the system.
