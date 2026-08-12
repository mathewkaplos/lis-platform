-- FEAT-054 (docs/plans/feat-054-culture-report-template-prelim-final-lifecycle.md).
--
-- A real, deliberately-authored culture/antibiogram report layout for
-- ORGID -- issue #504's own literal AC #1 ("a lab admin can author a
-- culture/antibiogram report layout entirely through the existing designer
-- UI, no code change"), persisted as durable seed data the same way every
-- other discipline's own default template already is
-- (default-report-templates.sql), not left as a one-off manual/e2e-only
-- artifact. `apps/api/test/culture-report-lifecycle.e2e-spec.ts` proves the
-- real authoring mechanism itself (POST .../versions + .../publish, the
-- exact same calls the FEAT-047 designer UI makes) independently of this
-- file; this seed exists so a fresh `pnpm db:reset` is demo-ready out of
-- the box, not so the authoring capability is only ever exercised in a test.
--
-- Supersedes ORGID's own generic single-table version 1 (default-report-
-- templates.sql's own catch-all: one flat 'table' field listing every
-- test_analyte-bound analyte) with a genuinely authored, two-section
-- layout: Organism Identification (a single coded field) and Antibiogram
-- (a table field bound only to the antibiogram analyte -- its own
-- table-typed Observation renders via `formatObservationValue`'s new
-- `dataType === 'table'` branch, `report-assembly.ts`'s own header comment).
--
-- Must run after default-report-templates.sql (needs ORGID's own
-- report_template row to already exist) and after microbiology-
-- catalog.sql (needs both analytes actually linked onto ORGID's own
-- test_analyte set, by FEAT-052/FEAT-053 respectively).
--
-- Idempotent (ADR-0022): archiving version 1 is a no-op once already
-- archived; inserting version 2 is guarded by NOT EXISTS. Archive first,
-- then insert version 2 as published -- reversing this order would
-- momentarily violate ux_report_template_version_template_published (at
-- most one published version per template), the same invariant
-- ReportTemplateController.publish() itself enforces at write time.

UPDATE report_template_version rtv
SET status = 'archived'
FROM report_template rt
JOIN test_definition td ON td.id = rt.test_definition_id
WHERE rtv.report_template_id = rt.id
  AND td.code = 'ORGID' AND td.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND rtv.version = 1
  AND rtv.status = 'published';

INSERT INTO report_template_version (tenant_id, report_template_id, version, status, definition)
SELECT
  rt.tenant_id,
  rt.id,
  2,
  'published',
  jsonb_build_object(
    'sections', jsonb_build_array(
      jsonb_build_object(
        'title', 'Organism Identification',
        'fields', jsonb_build_array(
          jsonb_build_object(
            'key', 'organism-identified',
            'label', 'Organism Identified',
            'type', 'coded',
            'analyteBinding', (
              SELECT a.id FROM analyte a
              JOIN code_system_value csv ON csv.id = a.code_system_value_id
              WHERE csv.system = 'LOINC' AND csv.code = '634-6'
            )
          )
        )
      ),
      jsonb_build_object(
        'title', 'Antibiogram',
        'fields', jsonb_build_array(
          jsonb_build_object(
            'key', 'antibiogram-table',
            'label', 'Susceptibility (MIC)',
            'type', 'table',
            'analyteBindings', jsonb_build_array((
              SELECT a.id FROM analyte a
              JOIN code_system_value csv ON csv.id = a.code_system_value_id
              WHERE csv.system = 'LOINC' AND csv.code = '50545-3'
            ))
          )
        )
      )
    )
  )
FROM report_template rt
JOIN test_definition td ON td.id = rt.test_definition_id
WHERE td.code = 'ORGID' AND td.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM report_template_version rtv
    WHERE rtv.report_template_id = rt.id AND rtv.version = 2
  );
