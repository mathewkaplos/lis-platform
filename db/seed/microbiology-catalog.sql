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

-- FEAT-053 (docs/plans/feat-053-susceptibility-interpretation-antibiogram.md).
-- Real, verified LOINC codes (loinc.org, cross-checked via its own search
-- listing) -- one dedicated, coded susceptibility-result analyte per
-- antimicrobial (proposal §5/§10 Q2, approved: each antimicrobial's own
-- S/I/R result is independently queryable via the normal
-- observation.analyteId join, not a shared analyte with the drug identified
-- in valueJson), scoped to exactly the four antimicrobials FEAT-051's own
-- real breakpoint data already covers -- not invented ahead of that list
-- (proposal §6's own risk, resolved as designed: the real antimicrobial
-- list is downstream of the real breakpoint data, never independently
-- guessed). Plus one "Antibiogram (MIC)" table analyte, the dual-emission
-- grid's own home (KB-21).

-- 10. Code system values: per-antimicrobial susceptibility-result LOINC
-- codes (MIC method specifically, matching this feature's own MIC-only v1
-- scope) and the antibiogram panel LOINC code.
INSERT INTO code_system_value (system, code, version, display) VALUES
  ('LOINC', '28-1',    '2.78', 'Ampicillin [Susceptibility] by Minimum inhibitory concentration (MIC)'),
  ('LOINC', '6652-2',  '2.78', 'Meropenem [Susceptibility] by Minimum inhibitory concentration (MIC)'),
  ('LOINC', '185-9',   '2.78', 'Ciprofloxacin [Susceptibility] by Minimum inhibitory concentration (MIC)'),
  ('LOINC', '524-9',   '2.78', 'Vancomycin [Susceptibility] by Minimum inhibitory concentration (MIC)'),
  ('LOINC', '50545-3', '2.78', 'Bacterial susceptibility panel by Minimum inhibitory concentration (MIC)')
ON CONFLICT (system, code, version) DO NOTHING;

-- 11. Analytes: one coded analyte per antimicrobial's own susceptibility
-- result, plus the table-shaped antibiogram grid. No default unit -- a
-- coded S/I/R value and a structured grid both have no unit of measure,
-- same as FEAT-052's own "Organism Identified" analyte.
INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT DISTINCT ON (csv.id) csv.id, r.display, r.data_type, NULL
FROM (VALUES
  ('28-1',    'Ampicillin Susceptibility',    'coded'),
  ('6652-2',  'Meropenem Susceptibility',     'coded'),
  ('185-9',   'Ciprofloxacin Susceptibility', 'coded'),
  ('524-9',   'Vancomycin Susceptibility',    'coded'),
  ('50545-3', 'Antibiogram (MIC)',            'table')
) AS r(loinc_code, display, data_type)
JOIN code_system_value csv ON csv.system = 'LOINC' AND csv.version = '2.78' AND csv.code = r.loinc_code
WHERE NOT EXISTS (SELECT 1 FROM analyte existing WHERE existing.code_system_value_id = csv.id);

-- 12. Link each antimicrobial to its own new susceptibility-result analyte.
UPDATE antimicrobial am
SET analyte_id = a.id
FROM code_system_value csv, analyte a, (VALUES
  ('J01CA01', '28-1'),
  ('J01DH02', '6652-2'),
  ('J01MA02', '185-9'),
  ('J01XA01', '524-9')
) AS r(antimicrobial_atc, susceptibility_loinc)
WHERE am.code_system_value_id = (
    SELECT id FROM code_system_value WHERE system = 'ATC' AND version = '2026' AND code = r.antimicrobial_atc
  )
  AND csv.system = 'LOINC' AND csv.version = '2.78' AND csv.code = r.susceptibility_loinc
  AND a.code_system_value_id = csv.id
  AND am.analyte_id IS NULL;

-- 13. Link the "Antibiogram (MIC)" table analyte onto ORGID's own
-- test_analyte set, alongside "Organism Identified" (FEAT-052) -- a real
-- culture report is not final until both organism ID and susceptibility
-- are verified, matching FEAT-054's own preliminary/final lifecycle
-- directly. The four individual antimicrobial-susceptibility analytes are
-- deliberately NOT linked to test_analyte -- which antimicrobials are
-- actually tested varies by organism (EUCAST's own breakpoint table is
-- itself organism-specific, see step 9 above), unlike a fixed chemistry
-- panel's own fixed analyte set; the antibiogram API's own bespoke write
-- path (not the generic test_analyte-gated result-entry endpoint) is what
-- writes these, and the existing generic verify action works on them
-- regardless of test_analyte membership (confirmed: `observation.verify`
-- checks only that a 'preliminary' row exists for the given
-- (orderedTestId, analyteId), never test_analyte).
INSERT INTO test_analyte (tenant_id, test_definition_id, analyte_id)
SELECT '00000000-0000-0000-0000-000000000001', td.id, a.id
FROM test_definition td, code_system_value csv, analyte a
WHERE td.tenant_id = '00000000-0000-0000-0000-000000000001' AND td.code = 'ORGID'
  AND csv.system = 'LOINC' AND csv.version = '2.78' AND csv.code = '50545-3'
  AND a.code_system_value_id = csv.id
ON CONFLICT (test_definition_id, analyte_id) DO NOTHING;

-- Pilot-readiness audit follow-up: unlike chemistry-catalog.sql/
-- haematology-catalog.sql, this file never gave CULT/ORGID a
-- billing_code/price_cents at all -- a real gap, not a placeholder-text
-- cosmetic issue: billing.service.ts's own validateAndTotal rejects
-- invoicing any order containing an unpriced test, so a culture order
-- placed and worked through this app's own real workflow could never
-- actually be invoiced. Same distinct, generic, published-adjacent
-- "placeholder, not partner data" pricing convention as every other
-- catalog file in this directory. ORGID priced lower than CULT -- it's
-- reflex-created off an already-billed CULT result (AddReflexTest, this
-- file's own step 3 comment), not a separately ordered specimen workup.
UPDATE test_definition td
SET billing_code = r.code, price_cents = r.price_cents
FROM (VALUES ('CULT', 4500), ('ORGID', 3000)) AS r(code, price_cents)
WHERE td.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND td.code = r.code AND td.billing_code IS NULL;
