-- FEAT-052 (docs/plans/feat-052-culture-workflow-reflex-cascade.md).
--
-- PLACEHOLDER, NOT PARTNER DATA: same framing as chemistry-catalog.sql's own
-- header comment -- no named design partner's real microbiology test menu
-- exists yet. Seeds two standalone test_definitions specifically to give the
-- reflex sub-engine a real culture -> organism-ID pair to configure a
-- workflow_definition rule against, the same "real, well-known pair, not an
-- invented relationship" precedent chemistry-catalog.sql's own step 17
-- (TSH -> Free T4) already established for FEAT-030.
--
-- 'Organism identified' uses LOINC 634-6 ("Bacteria identified in Specimen
-- by Culture") -- a real, widely-cited LOINC code for this exact
-- observation type (human-approved, FEAT-052 proposal §10 Q3). Colony count
-- is explicitly out of scope for this file/feature -- not named in FEAT-052's
-- own acceptance criteria (docs/plans/feat-052-culture-workflow-reflex-
-- cascade.md §7), left for a future feature rather than guessed here.
--
-- Seed tenant: same fixed placeholder id every other seed file in this
-- directory uses.

-- 1. Code system value: the organism-identified LOINC code.
INSERT INTO code_system_value (system, code, version, display) VALUES
  ('LOINC', '634-6', '2.78', 'Bacteria identified in Specimen by Culture')
ON CONFLICT (system, code, version) DO NOTHING;

-- 2. Analyte: coded, no default unit (a coded organism-identity value has no
-- unit of measure, same as any other coded analyte in this schema).
INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT csv.id, 'Organism Identified', 'coded', NULL
FROM code_system_value csv
WHERE csv.system = 'LOINC' AND csv.version = '2.78' AND csv.code = '634-6'
  AND NOT EXISTS (SELECT 1 FROM analyte existing WHERE existing.code_system_value_id = csv.id);

-- 3. Test definitions: the culture panel that gets a culture_read scheduled
-- against it, and the reflex target a recorded 'growth' result creates via
-- AddReflexTest.
INSERT INTO test_definition (tenant_id, code, display_name)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'CULT',  'Culture and Sensitivity'),
  ('00000000-0000-0000-0000-000000000001', 'ORGID', 'Organism Identification')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- 4. Link the Organism Identified analyte onto ORGID -- CULT carries no
-- analyte of its own in this seed (its own result, if any, is out of this
-- feature's scope; only the reflex-created ORGID panel produces the coded
-- isolate Observation this feature's own AC requires).
INSERT INTO test_analyte (tenant_id, test_definition_id, analyte_id)
SELECT '00000000-0000-0000-0000-000000000001', td.id, a.id
FROM test_definition td, code_system_value csv, analyte a
WHERE td.tenant_id = '00000000-0000-0000-0000-000000000001' AND td.code = 'ORGID'
  AND csv.system = 'LOINC' AND csv.version = '2.78' AND csv.code = '634-6'
  AND a.code_system_value_id = csv.id
ON CONFLICT (test_definition_id, analyte_id) DO NOTHING;
