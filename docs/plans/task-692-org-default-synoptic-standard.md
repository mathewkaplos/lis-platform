# Implementation Proposal: Per-org default synoptic reporting standard (issue #692)

Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #692

## 1. Goal

Issue #690 added a "Choose reporting standard" picker to the synoptic
recording page whenever more than one non-panel protocol is eligible for a
part's specimenType (e.g. colorectal: ICCR vs. CAP, issue #551). A design
partner using CAP called directly to ask whether the ICCR/CAP coexistence
decision would affect their workflow -- it doesn't (both protocols simply
coexist), but every recorder at every lab now sees this picker on every
colorectal case with no memory of which standard that lab actually uses.
In practice a lab almost always uses one standard consistently. This adds
an org-wide default that, once set, skips the picker automatically.

## 2. Design

- `tenant.preferred_synoptic_source_standard`: nullable text (not an enum
  -- matches `synoptic_protocol.source_standard`'s own existing
  unconstrained-text convention). Null (the default for every existing
  tenant) means "no preference"; the #690 picker keeps showing exactly as
  it does today.
- `GET/PUT /v1/org-settings`: `tenant` is the global registry table itself
  (ADR-0039, no `tenant_id` column, no RLS) -- both routes filter manually
  by the caller's own JWT `tenantId` rather than relying on RLS. GET needs
  no capability gate (informational, matches
  `MicrobiologyCatalogController`'s own precedent); PUT is a new
  `manage_org_settings` capability (granted to `qa`, identical reasoning to
  `manage_workflow`/`manage_report_templates`/`manage_catalog` -- a
  lab-oversight configuration change, not day-to-day result entry).
- `synoptic/[partId]/page.tsx`: when 2+ protocols are eligible and no
  `organProtocolId` is given, fetch `GET /v1/org-settings` alongside the
  existing protocol list; if a preference is set and exactly one eligible
  protocol's `sourceStandard` matches it, resolve that protocol directly
  (identical to the existing 1-eligible path) instead of rendering the
  picker. Falls back to the picker unchanged when no preference is set, or
  the preferred standard has no eligible protocol for that specimenType.

## 3. Explicitly out of scope (needs a separate product decision)

No settings/admin page exists anywhere in apps/web today -- this is a
genuinely new, standalone frontend surface (nav placement, and whether
this is the first of a broader settings section), not a "minor
implementation choice" this proposal can make unilaterally. This PR ships
the backend capability (`GET/PUT /v1/org-settings`, fully usable today via
the API) and the frontend auto-resolve consumption of it, but does not
invent a settings page UI. Setting the preference today requires a direct
API call (`PUT /v1/org-settings`, `qa`-only) -- a real gap, tracked as an
explicit follow-up once there's a product decision on where org settings
should live in the app.

## 4. Acceptance criteria

- `GET /v1/org-settings` returns the current tenant's preference (or
  `null`); any authenticated caller.
- `PUT /v1/org-settings` sets/clears the preference; `qa`-only, audited,
  400/403 handled per existing conventions.
- The synoptic recording page skips the picker when a preference is set
  and resolves unambiguously; unaffected in every other case.

## 5. Out of scope

- The settings UI itself (§3).
- Per-specimenType preferences (a lab's own real usage may turn out to
  vary by organ -- not assumed up front; today's setting is tenant-wide).

## 6. Questions requiring human approval

None for the backend + auto-resolve consumption shipped here. The
settings-UI question (§3) is flagged to the user, not decided here.
