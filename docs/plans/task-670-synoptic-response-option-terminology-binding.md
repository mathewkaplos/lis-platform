# Implementation Proposal: Terminology binding for synoptic response options (issue #670)
Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #670

## 1. Goal

`code_system_value` is already the general LOINC/UCUM-shaped terminology
table `analyte`/`unit` bind to. `synoptic_element_response_option` has no
such binding -- a real, live gap: ICCR-sourced content routinely cites
ICD-O-3 morphology codes directly against histologic-type options (e.g.
colorectal's own seeded `histological_tumor_type` element), and there's
nowhere for that code to land today.

## 2. Design

Additive nullable FK, `synoptic_element_response_option.codeSystemValueId
-> code_system_value.id` -- a response option optionally binds to a
terminology code, exactly the same shape `analyte.codeSystemValueId`/
`unit.codeSystemValueId` already establish. Resolved server-side into
`codeSystemCode`/`codeSystemDisplay` on the wire response, matching
`unitDisplay`'s own existing resolution pattern in
`synoptic-protocol.controller.ts` -- the frontend never resolves its own
terminology display text.

Genuinely optional per the issue's own instruction -- most CAP-sourced
protocols won't populate it (2 of 106 sampled CAP datasets cite a code at
all, per the architecture review), and that's expected, not a
data-quality gap to chase.

## 3. Schema

`db/migrations/00XX_synoptic_response_option_terminology.sql`: `ALTER
TABLE synoptic_element_response_option ADD COLUMN code_system_value_id
uuid REFERENCES code_system_value(id)`.

## 4. Seed

Binds colorectal's real, already-seeded `histological_tumor_type`
response options to their real, standard ICD-O-3 morphology codes (a
long-established, stable WHO classification -- not fabricated):
`adenocarcinoma_nos` -> 8140/3, `mucinous_adenocarcinoma` -> 8480/3,
`signet_ring_cell_adenocarcinoma` -> 8490/3, `medullary_carcinoma` ->
8510/3. The remaining options on that element (serrated/micropapillary/
adenoma-like/other) are left unbound -- opportunistic per the issue's own
"not a backfill project" instruction, not every option needs a code.

## 5. API

`GET /v1/synoptic-protocols/:id/versions/:versionId`'s response-option
mapping gains `codeSystemValueId`/`codeSystemCode`/`codeSystemDisplay`
(all null when unbound), resolved via the same batch-lookup pattern
`unitId -> unitDisplay` already uses.

## 6. Out of scope (per the issue's own exclusions)

- Retroactively coding every existing response option.
- A general ValueSet-management UI -- no frontend change; recording
  already works unchanged (the binding is metadata on an option that
  already has its own `value`/`display`).

## 7. Acceptance criteria (from the issue, restated)

- A response option can optionally bind to a `code_system_value` row.
- At least one real ICCR-sourced element demonstrates the binding end to
  end, from seed data through to a recorded response (e2e test records
  against a code-bound option and confirms the binding is resolvable).

## 8. Questions requiring human approval

None -- schema/seed/API work with a defined, literal acceptance criterion.
