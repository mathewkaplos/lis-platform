-- TASK-019: Seed a chemistry test menu.
--
-- PLACEHOLDER, NOT PARTNER DATA: TASK-019's original acceptance criterion
-- ("the design partner's actual chemistry test menu is present") assumes a
-- named design-partner lab whose real menu and validated ranges have been
-- captured. No such partner or data source exists yet anywhere in this repo,
-- lis-engineering, or the research corpus as of 2026-07-30 (see
-- docs/scope/current.md) -- LIS-Execution-Plan.md describes design-partner
-- sessions as a future cadence, not something that has happened. Per human
-- decision this session: seed a standard, genuinely real, LOINC/UCUM-coded
-- Comprehensive Metabolic Panel (CMP) instead, explicitly as a placeholder,
-- so FEAT-004 is queryable end-to-end now. Replace with the actual partner's
-- menu and lab-validated ranges once a real design partner exists -- do not
-- treat these reference ranges as clinically authoritative for a real report.
--
-- Reference ranges below are widely published generic adult reference
-- intervals (standard clinical chemistry literature), not validated by any
-- specific lab or instrument -- see the `source` column on each row.
--
-- Seed tenant: no `tenant` table exists yet (multi-tenant onboarding is
-- FEAT-008/009, M2). '00000000-0000-0000-0000-000000000001' is a fixed
-- placeholder seed/demo tenant id, consistent with every other tenant-scoped
-- table already carrying a bare tenant_id with no FK to a tenant table.

-- 1. Code system values: LOINC analyte codes + UCUM unit codes.
INSERT INTO code_system_value (system, code, version, display) VALUES
  ('LOINC', '2345-7',  '2.78', 'Glucose [Mass/volume] in Serum or Plasma'),
  ('LOINC', '3094-0',  '2.78', 'Urea nitrogen [Mass/volume] in Serum or Plasma'),
  ('LOINC', '2160-0',  '2.78', 'Creatinine [Mass/volume] in Serum or Plasma'),
  ('LOINC', '2951-2',  '2.78', 'Sodium [Moles/volume] in Serum or Plasma'),
  ('LOINC', '2823-3',  '2.78', 'Potassium [Moles/volume] in Serum or Plasma'),
  ('LOINC', '2075-0',  '2.78', 'Chloride [Moles/volume] in Serum or Plasma'),
  ('LOINC', '2028-9',  '2.78', 'Carbon dioxide, total [Moles/volume] in Serum or Plasma'),
  ('LOINC', '17861-6', '2.78', 'Calcium [Mass/volume] in Serum or Plasma'),
  ('LOINC', '2885-2',  '2.78', 'Protein [Mass/volume] in Serum or Plasma'),
  ('LOINC', '1751-7',  '2.78', 'Albumin [Mass/volume] in Serum or Plasma'),
  ('LOINC', '1975-2',  '2.78', 'Bilirubin.total [Mass/volume] in Serum or Plasma'),
  ('LOINC', '6768-6',  '2.78', 'Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma'),
  ('LOINC', '1920-8',  '2.78', 'Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma'),
  ('LOINC', '1742-6',  '2.78', 'Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma')
ON CONFLICT (system, code, version) DO NOTHING;

INSERT INTO code_system_value (system, code, version, display) VALUES
  ('UCUM', 'mg/dL', '2.2', 'milligram per deciliter'),
  ('UCUM', 'mmol/L', '2.2', 'millimole per liter'),
  ('UCUM', 'g/dL', '2.2', 'gram per deciliter'),
  ('UCUM', 'U/L', '2.2', 'unit per liter')
ON CONFLICT (system, code, version) DO NOTHING;

-- 2. Units, keyed off the UCUM code_system_value rows just inserted. No
-- unique constraint on unit.code_system_value_id (see haematology-catalog.sql
-- step 2's own note), so an explicit NOT EXISTS guard is required here --
-- staging never wipes its DB between deploys, unlike CI/local.
INSERT INTO unit (code_system_value_id)
SELECT csv.id FROM code_system_value csv
WHERE csv.system = 'UCUM' AND csv.code IN ('mg/dL', 'mmol/L', 'g/dL', 'U/L')
  AND NOT EXISTS (SELECT 1 FROM unit u WHERE u.code_system_value_id = csv.id);

-- 3. Analytes: one per LOINC code, with its default unit. DISTINCT ON
-- (csv.id), tie-broken by u.id -- same defensive guard as step 10's own
-- comment explains (confirmed live: unit.code_system_value_id can hold more
-- than one row, no unique constraint on that column).
INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT DISTINCT ON (csv.id) csv.id, a.display, 'quantity', u.id
FROM (VALUES
  ('2345-7',  'Glucose',                'mg/dL'),
  ('3094-0',  'Urea Nitrogen (BUN)',     'mg/dL'),
  ('2160-0',  'Creatinine',              'mg/dL'),
  ('2951-2',  'Sodium',                  'mmol/L'),
  ('2823-3',  'Potassium',               'mmol/L'),
  ('2075-0',  'Chloride',                'mmol/L'),
  ('2028-9',  'Carbon Dioxide (CO2)',    'mmol/L'),
  ('17861-6', 'Calcium',                 'mg/dL'),
  ('2885-2',  'Total Protein',          'g/dL'),
  ('1751-7',  'Albumin',                 'g/dL'),
  ('1975-2',  'Total Bilirubin',        'mg/dL'),
  ('6768-6',  'Alkaline Phosphatase',    'U/L'),
  ('1920-8',  'AST (SGOT)',              'U/L'),
  ('1742-6',  'ALT (SGPT)',              'U/L')
) AS a(loinc_code, display, ucum_code)
JOIN code_system_value csv ON csv.system = 'LOINC' AND csv.version = '2.78' AND csv.code = a.loinc_code
JOIN code_system_value ucsv ON ucsv.system = 'UCUM' AND ucsv.version = '2.2' AND ucsv.code = a.ucum_code
JOIN unit u ON u.code_system_value_id = ucsv.id
WHERE NOT EXISTS (SELECT 1 FROM analyte existing WHERE existing.code_system_value_id = csv.id)
ORDER BY csv.id, u.id;

-- 4. One test_definition per analyte (order-able unit), tenant-scoped.
INSERT INTO test_definition (tenant_id, code, display_name)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'GLU',   'Glucose'),
  ('00000000-0000-0000-0000-000000000001', 'BUN',   'Urea Nitrogen (BUN)'),
  ('00000000-0000-0000-0000-000000000001', 'CREAT', 'Creatinine'),
  ('00000000-0000-0000-0000-000000000001', 'NA',    'Sodium'),
  ('00000000-0000-0000-0000-000000000001', 'K',     'Potassium'),
  ('00000000-0000-0000-0000-000000000001', 'CL',    'Chloride'),
  ('00000000-0000-0000-0000-000000000001', 'CO2',   'Carbon Dioxide (CO2)'),
  ('00000000-0000-0000-0000-000000000001', 'CA',    'Calcium'),
  ('00000000-0000-0000-0000-000000000001', 'TP',    'Total Protein'),
  ('00000000-0000-0000-0000-000000000001', 'ALB',   'Albumin'),
  ('00000000-0000-0000-0000-000000000001', 'TBIL',  'Total Bilirubin'),
  ('00000000-0000-0000-0000-000000000001', 'ALP',   'Alkaline Phosphatase'),
  ('00000000-0000-0000-0000-000000000001', 'AST',   'AST (SGOT)'),
  ('00000000-0000-0000-0000-000000000001', 'ALT',   'ALT (SGPT)')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- 5. test_analyte links: each test_definition to its one analyte.
INSERT INTO test_analyte (tenant_id, test_definition_id, analyte_id)
SELECT '00000000-0000-0000-0000-000000000001', td.id, a.id
FROM (VALUES
  ('GLU',   '2345-7'), ('BUN', '3094-0'), ('CREAT', '2160-0'), ('NA', '2951-2'),
  ('K',     '2823-3'), ('CL',  '2075-0'), ('CO2',   '2028-9'), ('CA', '17861-6'),
  ('TP',    '2885-2'), ('ALB', '1751-7'), ('TBIL',  '1975-2'), ('ALP', '6768-6'),
  ('AST',   '1920-8'), ('ALT', '1742-6')
) AS m(test_code, loinc_code)
JOIN test_definition td ON td.tenant_id = '00000000-0000-0000-0000-000000000001' AND td.code = m.test_code
JOIN code_system_value csv ON csv.system = 'LOINC' AND csv.version = '2.78' AND csv.code = m.loinc_code
JOIN analyte a ON a.code_system_value_id = csv.id
ON CONFLICT (test_definition_id, analyte_id) DO NOTHING;

-- 6. The panel itself, grouping all 14 tests.
INSERT INTO panel (tenant_id, code, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'CMP', 'Comprehensive Metabolic Panel')
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO panel_test (tenant_id, panel_id, test_definition_id)
SELECT '00000000-0000-0000-0000-000000000001', p.id, td.id
FROM panel p, test_definition td
WHERE p.tenant_id = '00000000-0000-0000-0000-000000000001' AND p.code = 'CMP'
  AND td.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND td.code IN ('GLU','BUN','CREAT','NA','K','CL','CO2','CA','TP','ALB','TBIL','ALP','AST','ALT')
ON CONFLICT (panel_id, test_definition_id) DO NOTHING;

-- 7. Reference ranges: generic published adult intervals (normal), plus
-- widely-cited generic critical/panic thresholds for the four analytes with
-- well-established ones. One-sided rows: a critical-low row sets `high`
-- (below it is critical), a critical-high row sets `low` (above it is
-- critical) -- per KB-15's one-sided range convention.
INSERT INTO reference_range (tenant_id, analyte_id, unit_id, sex, condition, range_type, low, high, priority, source)
SELECT '00000000-0000-0000-0000-000000000001', a.id, a.default_unit_id, r.sex, r.condition, r.range_type, r.low, r.high, r.priority, r.source
FROM (VALUES
  -- analyte display,             sex,   condition,  range_type, low,   high,  priority, source
  ('Glucose',               NULL, 'fasting', 'normal',   70,   99, 1, 'Standard adult fasting reference interval (generic clinical chemistry literature) -- placeholder, not partner-validated'),
  ('Glucose',               NULL, NULL,      'critical', NULL, 40, 1, 'Generic critical-low (panic) threshold, widely published -- placeholder'),
  ('Glucose',               NULL, NULL,      'critical', 500, NULL, 1, 'Generic critical-high (panic) threshold, widely published -- placeholder'),
  ('Urea Nitrogen (BUN)',   NULL, NULL,      'normal',   7,    20,  1, 'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Creatinine',            'M',  NULL,      'normal',   0.74, 1.35, 10, 'Standard adult male reference interval -- placeholder, not partner-validated'),
  ('Creatinine',            'F',  NULL,      'normal',   0.59, 1.04, 10, 'Standard adult female reference interval -- placeholder, not partner-validated'),
  ('Sodium',                NULL, NULL,      'normal',   136,  145, 1, 'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Sodium',                NULL, NULL,      'critical', NULL, 120, 1, 'Generic critical-low (panic) threshold -- placeholder'),
  ('Sodium',                NULL, NULL,      'critical', 160, NULL, 1, 'Generic critical-high (panic) threshold -- placeholder'),
  ('Potassium',             NULL, NULL,      'normal',   3.5,  5.1, 1, 'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Potassium',             NULL, NULL,      'critical', NULL, 2.5, 1, 'Generic critical-low (panic) threshold -- placeholder'),
  ('Potassium',             NULL, NULL,      'critical', 6.5, NULL, 1, 'Generic critical-high (panic) threshold -- placeholder'),
  ('Chloride',              NULL, NULL,      'normal',   98,   107, 1, 'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Carbon Dioxide (CO2)',  NULL, NULL,      'normal',   23,   29,  1, 'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Calcium',               NULL, NULL,      'normal',   8.6,  10.2, 1, 'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Calcium',               NULL, NULL,      'critical', NULL, 6.0, 1, 'Generic critical-low (panic) threshold -- placeholder'),
  ('Calcium',               NULL, NULL,      'critical', 13.0, NULL, 1, 'Generic critical-high (panic) threshold -- placeholder'),
  ('Total Protein',         NULL, NULL,      'normal',   6.0,  8.3, 1, 'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Albumin',                NULL, NULL,      'normal',   3.5,  5.0, 1, 'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Total Bilirubin',       NULL, NULL,      'normal',   0.1,  1.2, 1, 'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Alkaline Phosphatase',  NULL, NULL,      'normal',   44,   147, 1, 'Standard adult reference interval -- placeholder, not partner-validated'),
  ('AST (SGOT)',             NULL, NULL,      'normal',   8,    48,  1, 'Standard adult reference interval -- placeholder, not partner-validated'),
  ('ALT (SGPT)',             NULL, NULL,      'normal',   7,    56,  1, 'Standard adult reference interval -- placeholder, not partner-validated')
) AS r(analyte_display, sex, condition, range_type, low, high, priority, source)
JOIN analyte a ON a.display = r.analyte_display
WHERE NOT EXISTS (
  SELECT 1 FROM reference_range existing
  WHERE existing.tenant_id = '00000000-0000-0000-0000-000000000001'
    AND existing.analyte_id = a.id
    AND existing.range_type = r.range_type
    AND existing.sex IS NOT DISTINCT FROM r.sex
    AND existing.low IS NOT DISTINCT FROM r.low
    AND existing.high IS NOT DISTINCT FROM r.high
);

-- FEAT-025 (ADR-0023): delta-check thresholds, percent-only, one row per
-- analyte, scoped to the four analytes that already have a critical
-- threshold above (Glucose, Sodium, Potassium, Calcium) -- proposal §2's own
-- scoping decision, not every analyte in this file. Generic, widely-cited
-- delta-check percent limits, same "placeholder, not partner-validated"
-- framing as every other threshold in this file (see this file's own header
-- comment) -- do not treat as clinically authoritative.
INSERT INTO delta_check_rule (tenant_id, analyte_id, threshold_percent, source)
SELECT '00000000-0000-0000-0000-000000000001', a.id, r.threshold_percent, r.source
FROM (VALUES
  -- analyte display, threshold_percent, source
  ('Glucose',   50, 'Generic placeholder delta-check threshold -- not partner-validated'),
  ('Sodium',    10, 'Generic placeholder delta-check threshold -- not partner-validated'),
  ('Potassium', 30, 'Generic placeholder delta-check threshold -- not partner-validated'),
  ('Calcium',   15, 'Generic placeholder delta-check threshold -- not partner-validated')
) AS r(analyte_display, threshold_percent, source)
JOIN analyte a ON a.display = r.analyte_display
ON CONFLICT (tenant_id, analyte_id) DO NOTHING; -- ux_delta_check_rule_tenant_analyte, a real unique index (unlike reference_range)

-- TASK-053 (FEAT-014): calculated fields (eGFR, LDL). Same placeholder
-- framing as the rest of this file -- LOINC codes are good-faith picks, not
-- verified against a live LOINC server (docs/plans/feat-014-result-entry-
-- engine.md's TASK-053 revision §5). eGFR is modeled as a SECOND analyte on
-- the already-seeded CREAT test (extending #3/#4/#5 above), not a new test
-- -- it's realistic lab practice to report eGFR alongside creatinine on the
-- same result line, and it keeps the calculated-value recompute scoped to
-- one ordered_test (revision §1 finding #3). LDL and its three Friedewald
-- inputs (Total Cholesterol, HDL, Triglycerides) are a new standalone
-- "Lipid Panel" test -- the order builder already supports ordering a
-- single test directly (apps/web/.../orders/new/order-builder-form.tsx),
-- no panel wrapper needed for a test that IS the panel.

-- 8. Code system values: the two calculated analytes' own LOINC codes, plus
-- the three new Lipid Panel input analytes' LOINC codes, plus a new UCUM
-- unit for eGFR.
INSERT INTO code_system_value (system, code, version, display) VALUES
  ('LOINC', '98979-8', '2.78', 'Estimated glomerular filtration rate/1.73 sq M predicted [Volume Rate/Area] by Creatinine-based formula (CKD-EPI 2021)'),
  ('LOINC', '13457-7', '2.78', 'Cholesterol in LDL [Mass/volume] in Serum or Plasma by calculation'),
  ('LOINC', '2093-3',  '2.78', 'Cholesterol [Mass/volume] in Serum or Plasma'),
  ('LOINC', '2085-9',  '2.78', 'Cholesterol in HDL [Mass/volume] in Serum or Plasma'),
  ('LOINC', '2571-8',  '2.78', 'Triglyceride [Mass/volume] in Serum or Plasma')
ON CONFLICT (system, code, version) DO NOTHING;

INSERT INTO code_system_value (system, code, version, display) VALUES
  ('UCUM', 'mL/min/{1.73_m2}', '2.2', 'milliliter per minute per 1.73 square meter')
ON CONFLICT (system, code, version) DO NOTHING;

-- 9. Units: the new eGFR unit, keyed off the code_system_value row just
-- inserted; LDL/Total Cholesterol/HDL/Triglycerides reuse the existing
-- mg/dL unit already inserted in step 2 above. `ON CONFLICT DO NOTHING`
-- (no target) is a no-op here -- unit.code_system_value_id has no unique
-- constraint (step 2's own note) -- so this needs the same explicit NOT
-- EXISTS guard step 2 uses.
INSERT INTO unit (code_system_value_id)
SELECT csv.id FROM code_system_value csv
WHERE csv.system = 'UCUM' AND csv.code = 'mL/min/{1.73_m2}'
  AND NOT EXISTS (SELECT 1 FROM unit u WHERE u.code_system_value_id = csv.id);

-- 10. Analytes: eGFR (new unit) and LDL/Total Cholesterol/HDL/Triglycerides
-- (existing mg/dL unit). DISTINCT ON (csv.id), tie-broken by u.id: confirmed
-- live on staging (2026-08-09, issue #410) that `unit` can hold more than one
-- row for the same code_system_value_id (no unique constraint on that
-- column) -- without this, the ucsv/unit JOIN below fans out per duplicate
-- unit row, producing two source rows for the same analyte within this one
-- INSERT's own result set, which WHERE NOT EXISTS (checking only
-- already-committed rows) cannot catch.
INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT DISTINCT ON (csv.id) csv.id, a.display, 'quantity', u.id
FROM (VALUES
  ('98979-8', 'eGFR (CKD-EPI 2021)',    'mL/min/{1.73_m2}'),
  ('13457-7', 'LDL Cholesterol',         'mg/dL'),
  ('2093-3',  'Total Cholesterol',       'mg/dL'),
  ('2085-9',  'HDL Cholesterol',         'mg/dL'),
  ('2571-8',  'Triglycerides',           'mg/dL')
) AS a(loinc_code, display, ucum_code)
JOIN code_system_value csv ON csv.system = 'LOINC' AND csv.version = '2.78' AND csv.code = a.loinc_code
JOIN code_system_value ucsv ON ucsv.system = 'UCUM' AND ucsv.version = '2.2' AND ucsv.code = a.ucum_code
JOIN unit u ON u.code_system_value_id = ucsv.id
WHERE NOT EXISTS (SELECT 1 FROM analyte existing WHERE existing.code_system_value_id = csv.id)
ORDER BY csv.id, u.id;

-- 11. Link eGFR onto the already-seeded CREAT test (a second analyte on an
-- existing test_definition, not a new one).
INSERT INTO test_analyte (tenant_id, test_definition_id, analyte_id)
SELECT '00000000-0000-0000-0000-000000000001', td.id, a.id
FROM test_definition td, code_system_value csv, analyte a
WHERE td.tenant_id = '00000000-0000-0000-0000-000000000001' AND td.code = 'CREAT'
  AND csv.system = 'LOINC' AND csv.version = '2.78' AND csv.code = '98979-8'
  AND a.code_system_value_id = csv.id
ON CONFLICT (test_definition_id, analyte_id) DO NOTHING;

-- 12. The new standalone Lipid Panel test, and its four analytes (three
-- inputs the user enters, plus the calculated LDL).
INSERT INTO test_definition (tenant_id, code, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'LIPID', 'Lipid Panel')
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO test_analyte (tenant_id, test_definition_id, analyte_id)
SELECT '00000000-0000-0000-0000-000000000001', td.id, a.id
FROM (VALUES ('13457-7'), ('2093-3'), ('2085-9'), ('2571-8')) AS m(loinc_code)
JOIN code_system_value csv ON csv.system = 'LOINC' AND csv.version = '2.78' AND csv.code = m.loinc_code
JOIN analyte a ON a.code_system_value_id = csv.id
JOIN test_definition td ON td.tenant_id = '00000000-0000-0000-0000-000000000001' AND td.code = 'LIPID'
ON CONFLICT (test_definition_id, analyte_id) DO NOTHING;

-- 13. Reference ranges for eGFR/LDL: generic published adult intervals,
-- same "not partner-validated" placeholder framing as step 7 above. One-
-- sided per KB-15's own convention: eGFR's normal lower bound only (>= 90
-- is normal), LDL's normal upper bound only (< 100 is optimal).
INSERT INTO reference_range (tenant_id, analyte_id, unit_id, sex, condition, range_type, low, high, priority, source)
SELECT '00000000-0000-0000-0000-000000000001', a.id, a.default_unit_id, r.sex, r.condition, r.range_type, r.low, r.high, r.priority, r.source
FROM (VALUES
  ('eGFR (CKD-EPI 2021)', NULL, NULL, 'normal', 90,   NULL, 1, 'Standard adult reference interval (Stage 1, no CKD) -- placeholder, not partner-validated'),
  ('LDL Cholesterol',     NULL, NULL, 'normal', NULL, 100,  1, 'Standard adult optimal-LDL reference interval -- placeholder, not partner-validated')
) AS r(analyte_display, sex, condition, range_type, low, high, priority, source)
JOIN analyte a ON a.display = r.analyte_display
WHERE NOT EXISTS (
  SELECT 1 FROM reference_range existing
  WHERE existing.tenant_id = '00000000-0000-0000-0000-000000000001'
    AND existing.analyte_id = a.id
    AND existing.range_type = r.range_type
);
