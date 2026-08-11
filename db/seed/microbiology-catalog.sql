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

-- FEAT-051 (docs/plans/feat-051-microbiology-organism-breakpoint-catalog.md,
-- ADR-0045). Organism/antimicrobial/breakpoint_table/breakpoint -- all four
-- global, no tenant_id, no RLS. §10 Q3 resolved: real, cited data, not
-- placeholder -- unlike every other section of this file and
-- chemistry-catalog.sql's own "PLACEHOLDER, NOT PARTNER DATA" framing, the
-- breakpoint values below are a real, current, freely-published clinical
-- standard, independently verified by extracting the exact pdftotext output
-- of the cited PDF (not from training-data memory) and cross-checking each
-- organism/antimicrobial code against two independent sources.
--
-- Source: The European Committee on Antimicrobial Susceptibility Testing.
-- Breakpoint tables for interpretation of MICs and zone diameters. Version
-- 16.0, 2026 (valid from 2026-01-01). https://www.eucast.org. Full PDF:
-- https://www.eucast.org/fileadmin/eucast/pdf/breakpoints/v_16.0_Breakpoint_Tables.pdf
--
-- v1 scope, deliberately narrow (proposal §5, approved): MIC-based
-- interpretation only, single-organism keying (no organism-group
-- generalization -- EUCAST's own Enterobacterales/Staphylococcus spp. table
-- headers apply to a whole genus/order, cited here against the one member
-- species this seed actually catalogs), S/I/R only.
--
-- Real, non-obvious shape finding from reading the actual source (the exact
-- risk `domain/reference-ranges` Skill entries #9-10 already warned this
-- project's own breakpoint work would hit): not every EUCAST breakpoint is
-- a plain two-threshold (S≤x, R>y) pair. Cefoxitin screening for methicillin
-- resistance in S. aureus is a one-sided rule ("MIC values >4 mg/L... are
-- methicillin resistant", EUCAST v16.0 p.32, Note 4) -- a genuinely
-- different breakpoint shape this v1 schema does not model. Deliberately
-- excluded from this seed rather than forced into the two-threshold shape,
-- not silently ignored.
--
-- EUCAST's own Area of Technical Uncertainty (ATU) -- a documented
-- uncertainty zone for some drugs, distinct from the R threshold -- is also
-- not modeled as a separate column in this v1 schema. Where an ATU exists
-- (Ciprofloxacin, below), it is noted in source_note but not represented
-- structurally; a real, later refinement, not silently dropped.

-- 5. Code system values: organism SNOMED CT concepts (verified against two
-- independent sources each: bioportal.bioontology.org and findacode.com)
-- and antimicrobial ATC codes (WHO ATC/DDD Index, verified against
-- atccode.com/icdcode.info).
INSERT INTO code_system_value (system, code, version, display) VALUES
  ('SNOMED', '112283007', '2026-08-01', 'Escherichia coli'),
  ('SNOMED', '3092008',   '2026-08-01', 'Staphylococcus aureus')
ON CONFLICT (system, code, version) DO NOTHING;

INSERT INTO code_system_value (system, code, version, display) VALUES
  ('ATC', 'J01CA01', '2026', 'Ampicillin'),
  ('ATC', 'J01DH02', '2026', 'Meropenem'),
  ('ATC', 'J01MA02', '2026', 'Ciprofloxacin'),
  ('ATC', 'J01XA01', '2026', 'Vancomycin')
ON CONFLICT (system, code, version) DO NOTHING;

-- 6. Organism catalog.
INSERT INTO organism (code_system_value_id, display)
SELECT csv.id, r.display
FROM (VALUES
  ('112283007', 'Escherichia coli'),
  ('3092008',   'Staphylococcus aureus')
) AS r(snomed_code, display)
JOIN code_system_value csv ON csv.system = 'SNOMED' AND csv.version = '2026-08-01' AND csv.code = r.snomed_code
WHERE NOT EXISTS (SELECT 1 FROM organism existing WHERE existing.code_system_value_id = csv.id);

-- 7. Antimicrobial catalog.
INSERT INTO antimicrobial (code_system_value_id, display)
SELECT csv.id, r.display
FROM (VALUES
  ('J01CA01', 'Ampicillin'),
  ('J01DH02', 'Meropenem'),
  ('J01MA02', 'Ciprofloxacin'),
  ('J01XA01', 'Vancomycin')
) AS r(atc_code, display)
JOIN code_system_value csv ON csv.system = 'ATC' AND csv.version = '2026' AND csv.code = r.atc_code
WHERE NOT EXISTS (SELECT 1 FROM antimicrobial existing WHERE existing.code_system_value_id = csv.id);

-- 8. The breakpoint table itself -- one real, cited, versioned standard.
INSERT INTO breakpoint_table (publisher, version, effective_from, effective_to, source_url)
SELECT 'EUCAST', '16.0', '2026-01-01T00:00:00Z', NULL,
  'https://www.eucast.org/fileadmin/eucast/pdf/breakpoints/v_16.0_Breakpoint_Tables.pdf'
WHERE NOT EXISTS (
  SELECT 1 FROM breakpoint_table existing WHERE existing.publisher = 'EUCAST' AND existing.version = '16.0'
);

-- 9. Breakpoint rows -- four real, directly-extracted MIC breakpoints.
INSERT INTO breakpoint (breakpoint_table_id, organism_id, antimicrobial_id, method, susceptible_max, resistant_min, source_note)
SELECT bt.id, o.id, am.id, r.method, r.susceptible_max, r.resistant_min, r.source_note
FROM (VALUES
  ('112283007', 'J01CA01', 'MIC', 8,    8,   'Enterobacterales, Ampicillin iv, EUCAST v16.0 p.13'),
  ('112283007', 'J01DH02', 'MIC', 2,    8,   'Enterobacterales, Meropenem (indications other than meningitis), EUCAST v16.0 p.15'),
  ('112283007', 'J01MA02', 'MIC', 0.25, 0.5, 'Enterobacterales, Ciprofloxacin (indications other than meningitis), EUCAST v16.0 p.15 -- EUCAST also defines an ATU of 0.5 mg/L, not modeled as a separate state in this v1 schema'),
  ('3092008',   'J01XA01', 'MIC', 2,    2,   'Staphylococcus spp., Vancomycin (S. aureus), EUCAST v16.0 p.35 -- disk diffusion explicitly unreliable for this pair per EUCAST Note A; MIC only')
) AS r(organism_snomed, antimicrobial_atc, method, susceptible_max, resistant_min, source_note)
JOIN organism o ON o.code_system_value_id = (
  SELECT id FROM code_system_value WHERE system = 'SNOMED' AND version = '2026-08-01' AND code = r.organism_snomed
)
JOIN antimicrobial am ON am.code_system_value_id = (
  SELECT id FROM code_system_value WHERE system = 'ATC' AND version = '2026' AND code = r.antimicrobial_atc
)
JOIN breakpoint_table bt ON bt.publisher = 'EUCAST' AND bt.version = '16.0'
WHERE NOT EXISTS (
  SELECT 1 FROM breakpoint existing
  WHERE existing.breakpoint_table_id = bt.id AND existing.organism_id = o.id
    AND existing.antimicrobial_id = am.id AND existing.method = r.method
);
