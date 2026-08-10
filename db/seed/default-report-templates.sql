-- FEAT-032 (docs/plans/feat-032-template-engine-config-driven-versioned.md
-- §5 assumption). A published report_template_version -- one 'table' field
-- listing every one of a test_definition's own analytes, reproducing
-- TASK-058's old fixed `drawChemistryReport` layout exactly -- for every
-- test_definition that has at least one test_analyte row and doesn't
-- already have one. Generic/set-based, not one INSERT per test code: covers
-- every test_definition this seed sequence has created so far (chemistry +
-- haematology, both already applied by the time this file runs -- see
-- scripts/db-reset.sh/pr.yml ordering) without drifting as the catalog
-- grows. Must run after both discipline seed files.
--
-- Idempotent, matching ADR-0022's own "every seed file runs unconditionally,
-- relying on its own idempotency guard" convention: report_template's own
-- unique (tenant_id, test_definition_id) index makes the first INSERT a
-- no-op on re-run (ON CONFLICT DO NOTHING); the version INSERT only fires
-- for a report_template that doesn't already have any version row.
--
-- A test_definition with zero test_analyte rows is deliberately skipped
-- (WHERE EXISTS below) rather than seeded with an empty/invalid
-- analyteBindings array -- report generation for such a test correctly
-- 404s until a real template is configured, an honest gap, not a fabricated
-- one.

INSERT INTO report_template (tenant_id, test_definition_id)
SELECT DISTINCT td.tenant_id, td.id
FROM test_definition td
WHERE EXISTS (
  SELECT 1 FROM test_analyte ta WHERE ta.test_definition_id = td.id
)
ON CONFLICT (tenant_id, test_definition_id) DO NOTHING;

INSERT INTO report_template_version (tenant_id, report_template_id, version, status, definition)
SELECT
  rt.tenant_id,
  rt.id,
  1,
  'published',
  jsonb_build_object(
    'sections', jsonb_build_array(
      jsonb_build_object(
        'title', 'Results',
        'fields', jsonb_build_array(
          jsonb_build_object(
            'key', 'results-table',
            'label', 'Results',
            'type', 'table',
            'analyteBindings', (
              SELECT jsonb_agg(ta.analyte_id)
              FROM test_analyte ta
              WHERE ta.test_definition_id = rt.test_definition_id
            )
          )
        )
      )
    )
  )
FROM report_template rt
WHERE NOT EXISTS (
  SELECT 1 FROM report_template_version rtv WHERE rtv.report_template_id = rt.id
);
