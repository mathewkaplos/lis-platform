-- TASK-071 (FEAT-023): Seed a Haematology CBC + differential test menu.
--
-- PLACEHOLDER, NOT PARTNER DATA: same precondition as db/seed/chemistry-
-- catalog.sql (TASK-019) -- no design-partner lab or validated menu exists
-- yet anywhere in this project (re-confirmed 2026-08-08). Seeds a standard,
-- genuinely real, LOINC/UCUM-coded CBC + 5-part differential instead,
-- explicitly as a placeholder. Reference ranges below are widely published
-- generic adult (M/F) reference intervals (standard haematology literature),
-- NOT age-banded/paediatric, NOT validated by any specific lab or
-- instrument -- see the `source` column on each row. LOINC codes are
-- good-faith picks, not verified against a live LOINC server (same
-- disclaimer chemistry-catalog.sql's own eGFR/LDL section already carries).
--
-- Per ADR-0020 (accepted): the differential is 5 discrete percentage +
-- calculated-absolute-count analyte PAIRS, not a `table`-dataType
-- Observation. Absolute counts are seeded here as ordinary quantity
-- analytes with their own reference ranges (same as any other analyte) --
-- TASK-072 wires the actual calculation formula; this file only seeds the
-- catalog/range data both the entered percentage and the calculated
-- absolute count need.
--
-- One test_definition ('CBC'), not one per analyte: a CBC is never ordered
-- one parameter at a time in real lab practice -- it IS the orderable unit,
-- same precedent chemistry-catalog.sql's own Lipid Panel section already
-- established ("no panel wrapper needed for a test that IS the panel"). No
-- `panel`/`panel_test` rows, unlike the 14-separate-tests CMP section.
--
-- Seed tenant: same fixed placeholder as chemistry-catalog.sql
-- ('00000000-0000-0000-0000-000000000001').

-- 1. Code system values: LOINC analyte codes (CBC direct parameters +
-- differential percentage/absolute pairs) + any UCUM unit codes not already
-- seeded by chemistry-catalog.sql. 'g/dL' is intentionally NOT re-inserted
-- here -- it already exists from chemistry-catalog.sql (Albumin/Total
-- Protein), reused directly in step 3 below via a plain lookup join, per
-- the ADR-0004 "global reference data, not tenant-scoped" precedent.
INSERT INTO code_system_value (system, code, version, display) VALUES
  ('LOINC', '718-7',   '2.78', 'Hemoglobin [Mass/volume] in Blood'),
  ('LOINC', '789-8',   '2.78', 'Erythrocytes [#/volume] in Blood by Automated count'),
  ('LOINC', '4544-3',  '2.78', 'Hematocrit [Volume Fraction] of Blood by Automated count'),
  ('LOINC', '787-2',   '2.78', 'MCV [Entitic volume] by Automated count'),
  ('LOINC', '785-6',   '2.78', 'MCH [Entitic mass] by Automated count'),
  ('LOINC', '786-4',   '2.78', 'MCHC [Mass/volume] by Automated count'),
  ('LOINC', '788-0',   '2.78', 'Erythrocyte distribution width [Ratio] by Automated count'),
  ('LOINC', '6690-2',  '2.78', 'Leukocytes [#/volume] in Blood by Automated count'),
  ('LOINC', '777-3',   '2.78', 'Platelets [#/volume] in Blood by Automated count'),
  ('LOINC', '32623-1', '2.78', 'Platelet mean volume [Entitic volume] in Blood by Automated count'),
  ('LOINC', '770-8',   '2.78', 'Neutrophils/100 leukocytes in Blood by Automated count'),
  ('LOINC', '751-8',   '2.78', 'Neutrophils [#/volume] in Blood by Automated count'),
  ('LOINC', '736-9',   '2.78', 'Lymphocytes/100 leukocytes in Blood by Automated count'),
  ('LOINC', '731-0',   '2.78', 'Lymphocytes [#/volume] in Blood by Automated count'),
  ('LOINC', '5905-5',  '2.78', 'Monocytes/100 leukocytes in Blood by Automated count'),
  ('LOINC', '742-7',   '2.78', 'Monocytes [#/volume] in Blood by Automated count'),
  ('LOINC', '713-8',   '2.78', 'Eosinophils/100 leukocytes in Blood by Automated count'),
  ('LOINC', '711-2',   '2.78', 'Eosinophils [#/volume] in Blood by Automated count'),
  ('LOINC', '706-2',   '2.78', 'Basophils/100 leukocytes in Blood by Automated count'),
  ('LOINC', '704-7',   '2.78', 'Basophils [#/volume] in Blood by Automated count')
ON CONFLICT (system, code, version) DO NOTHING;

INSERT INTO code_system_value (system, code, version, display) VALUES
  ('UCUM', '10*6/uL', '2.2', 'million per microliter'),
  ('UCUM', '10*3/uL', '2.2', 'thousand per microliter'),
  ('UCUM', '%',       '2.2', 'percent'),
  ('UCUM', 'fL',      '2.2', 'femtoliter'),
  ('UCUM', 'pg',      '2.2', 'picogram')
ON CONFLICT (system, code, version) DO NOTHING;

-- 2. Units: only the UCUM codes genuinely new to this file. 'g/dL' reuses
-- chemistry-catalog.sql's existing unit row (see step 3) -- inserting a
-- second unit row for the same code_system_value_id here would silently
-- duplicate it (no unique constraint on unit.code_system_value_id), so it
-- is deliberately excluded from this INSERT.
INSERT INTO unit (code_system_value_id)
SELECT csv.id FROM code_system_value csv
WHERE csv.system = 'UCUM' AND csv.code IN ('10*6/uL', '10*3/uL', '%', 'fL', 'pg')
  AND NOT EXISTS (SELECT 1 FROM unit u WHERE u.code_system_value_id = csv.id);

-- 3. Analytes: one per LOINC code, with its default unit. 'g/dL'-unit
-- analytes (Hemoglobin, MCHC) join directly to chemistry-catalog.sql's
-- already-seeded unit row instead of a freshly inserted one. DISTINCT ON
-- (csv.id), tie-broken by u.id -- confirmed live (issue #410) that
-- unit.code_system_value_id can hold more than one row (no unique
-- constraint), which fans out this JOIN otherwise.
INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT DISTINCT ON (csv.id) csv.id, a.display, 'quantity', u.id
FROM (VALUES
  ('718-7',   'Hemoglobin',              'g/dL'),
  ('789-8',   'RBC Count',               '10*6/uL'),
  ('4544-3',  'Hematocrit',              '%'),
  ('787-2',   'MCV',                     'fL'),
  ('785-6',   'MCH',                     'pg'),
  ('786-4',   'MCHC',                    'g/dL'),
  ('788-0',   'RDW',                     '%'),
  ('6690-2',  'WBC Count',               '10*3/uL'),
  ('777-3',   'Platelet Count',          '10*3/uL'),
  ('32623-1', 'MPV',                     'fL'),
  ('770-8',   'Neutrophils %',           '%'),
  ('751-8',   'Neutrophils Absolute',    '10*3/uL'),
  ('736-9',   'Lymphocytes %',           '%'),
  ('731-0',   'Lymphocytes Absolute',    '10*3/uL'),
  ('5905-5',  'Monocytes %',             '%'),
  ('742-7',   'Monocytes Absolute',      '10*3/uL'),
  ('713-8',   'Eosinophils %',           '%'),
  ('711-2',   'Eosinophils Absolute',    '10*3/uL'),
  ('706-2',   'Basophils %',             '%'),
  ('704-7',   'Basophils Absolute',      '10*3/uL')
) AS a(loinc_code, display, ucum_code)
JOIN code_system_value csv ON csv.system = 'LOINC' AND csv.version = '2.78' AND csv.code = a.loinc_code
JOIN code_system_value ucsv ON ucsv.system = 'UCUM' AND ucsv.version = '2.2' AND ucsv.code = a.ucum_code
JOIN unit u ON u.code_system_value_id = ucsv.id
WHERE NOT EXISTS (SELECT 1 FROM analyte existing WHERE existing.code_system_value_id = csv.id)
ORDER BY csv.id, u.id;

-- 4. One 'CBC' test_definition, all 20 analytes linked via test_analyte --
-- see this file's header note on why there is no per-analyte test or panel
-- wrapper here, unlike chemistry-catalog.sql's CMP section.
INSERT INTO test_definition (tenant_id, code, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'CBC', 'Complete Blood Count with Differential')
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO test_analyte (tenant_id, test_definition_id, analyte_id)
SELECT '00000000-0000-0000-0000-000000000001', td.id, a.id
FROM (VALUES
  ('718-7'), ('789-8'), ('4544-3'), ('787-2'), ('785-6'), ('786-4'), ('788-0'),
  ('6690-2'), ('777-3'), ('32623-1'),
  ('770-8'), ('751-8'), ('736-9'), ('731-0'), ('5905-5'), ('742-7'),
  ('713-8'), ('711-2'), ('706-2'), ('704-7')
) AS m(loinc_code)
JOIN code_system_value csv ON csv.system = 'LOINC' AND csv.version = '2.78' AND csv.code = m.loinc_code
JOIN analyte a ON a.code_system_value_id = csv.id
JOIN test_definition td ON td.tenant_id = '00000000-0000-0000-0000-000000000001' AND td.code = 'CBC'
ON CONFLICT (test_definition_id, analyte_id) DO NOTHING;

-- 5. Reference ranges: generic published adult (M/F only, NOT age-banded)
-- reference intervals, plus the KB-19-named haematology criticals (severe
-- anaemia, very low platelets, very high/low WBC) -- exactly those three,
-- not a broader set invented beyond what KB-19 names. One-sided rows follow
-- the same convention as chemistry-catalog.sql (a critical-low row sets
-- `high`, a critical-high row sets `low`).
INSERT INTO reference_range (tenant_id, analyte_id, unit_id, sex, condition, range_type, low, high, priority, source)
SELECT '00000000-0000-0000-0000-000000000001', a.id, a.default_unit_id, r.sex, r.condition, r.range_type, r.low, r.high, r.priority, r.source
FROM (VALUES
  -- analyte display,          sex,  condition, range_type, low,  high, priority, source
  ('Hemoglobin',            'M',  NULL, 'normal',   13.5, 17.5, 10, 'Standard adult male reference interval -- placeholder, not partner-validated'),
  ('Hemoglobin',            'F',  NULL, 'normal',   12.0, 15.5, 10, 'Standard adult female reference interval -- placeholder, not partner-validated'),
  ('Hemoglobin',            NULL, NULL, 'critical', NULL, 7.0,  1,  'Generic critical-low (severe anaemia, panic) threshold, widely published -- placeholder'),
  ('RBC Count',             'M',  NULL, 'normal',   4.5,  5.9,  10, 'Standard adult male reference interval -- placeholder, not partner-validated'),
  ('RBC Count',             'F',  NULL, 'normal',   4.0,  5.2,  10, 'Standard adult female reference interval -- placeholder, not partner-validated'),
  ('Hematocrit',            'M',  NULL, 'normal',   41,   53,   10, 'Standard adult male reference interval -- placeholder, not partner-validated'),
  ('Hematocrit',            'F',  NULL, 'normal',   36,   46,   10, 'Standard adult female reference interval -- placeholder, not partner-validated'),
  ('MCV',                   NULL, NULL, 'normal',   80,   100,  1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('MCH',                   NULL, NULL, 'normal',   27,   33,   1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('MCHC',                  NULL, NULL, 'normal',   32,   36,   1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('RDW',                   NULL, NULL, 'normal',   11.5, 14.5, 1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('WBC Count',             NULL, NULL, 'normal',   4.5,  11.0, 1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('WBC Count',             NULL, NULL, 'critical', NULL, 2.0,  1,  'Generic critical-low (severe leukopenia, panic) threshold -- placeholder'),
  ('WBC Count',             NULL, NULL, 'critical', 30.0, NULL, 1,  'Generic critical-high (severe leukocytosis, panic) threshold -- placeholder'),
  ('Platelet Count',        NULL, NULL, 'normal',   150,  450,  1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Platelet Count',        NULL, NULL, 'critical', NULL, 20,   1,  'Generic critical-low (severe thrombocytopenia, bleeding-risk panic) threshold, widely published -- placeholder'),
  ('Platelet Count',        NULL, NULL, 'critical', 1000, NULL, 1,  'Generic critical-high (severe thrombocytosis, panic) threshold -- placeholder'),
  ('MPV',                   NULL, NULL, 'normal',   7.5,  11.5, 1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Neutrophils %',         NULL, NULL, 'normal',   40,   70,   1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Neutrophils Absolute',  NULL, NULL, 'normal',   1.8,  7.7,  1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Lymphocytes %',         NULL, NULL, 'normal',   20,   40,   1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Lymphocytes Absolute',  NULL, NULL, 'normal',   1.0,  4.8,  1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Monocytes %',           NULL, NULL, 'normal',   2,    8,    1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Monocytes Absolute',    NULL, NULL, 'normal',   0.2,  0.95, 1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Eosinophils %',         NULL, NULL, 'normal',   1,    4,    1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Eosinophils Absolute',  NULL, NULL, 'normal',   0.0,  0.5,  1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Basophils %',           NULL, NULL, 'normal',   0,    1,    1,  'Standard adult reference interval -- placeholder, not partner-validated'),
  ('Basophils Absolute',    NULL, NULL, 'normal',   0.0,  0.2,  1,  'Standard adult reference interval -- placeholder, not partner-validated')
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
