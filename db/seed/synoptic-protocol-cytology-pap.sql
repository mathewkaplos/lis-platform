-- FEAT-062 (docs/plans/feat-062-cytology-bethesda-pap-reporting.md).
--
-- Real, cited Bethesda System content -- not placeholder data (contrast
-- chemistry-catalog.sql's own "PLACEHOLDER, NOT PARTNER DATA" framing).
--
-- Sources: Nayar R, Wilbur DC (eds.), "The Bethesda System for Reporting
-- Cervical Cytology: Definitions, Criteria, and Explanatory Notes," 3rd ed.,
-- Springer, 2015 -- the official 2014 Bethesda System publication -- for
-- the adequacy/interpretation category definitions; IARC/WHO Screening
-- Group's own freely-published Bethesda classification atlas
-- (https://screening.iarc.fr/atlasclassifbethesda.php) for the exact
-- category taxonomy; cross-checked against Nayar & Wilbur, "The Pap test
-- and Bethesda 2014," Cancer Cytopathology 2015;123(5):271-281,
-- doi:10.1002/cncy.21521. All three fetched and read in full (not from
-- training-data memory) 2026-08-13.
--
-- v1 scope (proposal §5/§10 Q2): specimen adequacy + interpretation
-- category only -- the two elements either issue AC actually requires.
-- Organisms and other non-neoplastic findings are real Bethesda categories
-- too but deliberately deferred, same discipline
-- synoptic-protocol-colorectal.sql's own breast/colorectal-only v1 scoping
-- already established.
--
-- 'adequacy_reason' carries a real `visibilityCondition` (required only
-- when specimen_adequacy = unsatisfactory_for_evaluation) -- the same
-- required+conditional shape colorectal's own
-- 'response_to_neoadjuvant_therapy' element already demonstrates.

INSERT INTO synoptic_protocol (name, source_standard, specimen_type)
SELECT 'Cervical Cytology (Pap)', 'Bethesda', 'cervical_cytology'
WHERE NOT EXISTS (
  SELECT 1 FROM synoptic_protocol WHERE name = 'Cervical Cytology (Pap)' AND source_standard = 'Bethesda'
);

INSERT INTO synoptic_protocol_version (synoptic_protocol_id, version, status)
SELECT sp.id, 1, 'draft'
FROM synoptic_protocol sp
WHERE sp.name = 'Cervical Cytology (Pap)' AND sp.source_standard = 'Bethesda'
  AND NOT EXISTS (
    SELECT 1 FROM synoptic_protocol_version spv WHERE spv.synoptic_protocol_id = sp.id AND spv.version = 1
  );

-- code_system_value + analyte: one dedicated global analyte per element, so
-- each response is queryable via observation.analyte_id like every other
-- discipline's discrete result (same precedent colorectal/breast already
-- established).
INSERT INTO code_system_value (system, code, version, display)
SELECT 'BETHESDA-SYNOPTIC', 'pap.' || v.key, '2014', v.label
FROM (VALUES
  ('specimen_adequacy', 'Specimen adequacy'),
  ('adequacy_reason', 'Reason for unsatisfactory adequacy'),
  ('interpretation_category', 'Interpretation / result category')
) AS v(key, label)
ON CONFLICT (system, code, version) DO NOTHING;

INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT csv.id, csv.display, 'coded', NULL
FROM code_system_value csv
WHERE csv.system = 'BETHESDA-SYNOPTIC' AND csv.version = '2014' AND csv.code LIKE 'pap.%'
ON CONFLICT (code_system_value_id) DO NOTHING;

INSERT INTO synoptic_element (
  synoptic_protocol_version_id, key, label, data_type, requirement, analyte_id, display_order, visibility_condition
)
SELECT spv.id, v.key, v.label, v.data_type, v.requirement, a.id, v.display_order, v.visibility_condition::jsonb
FROM (VALUES
  ('specimen_adequacy', 'Specimen adequacy', 'coded', 'required', 1, NULL),
  ('adequacy_reason', 'Reason for unsatisfactory adequacy', 'coded', 'required', 2,
    '{"field":"specimen_adequacy","op":"eq","value":"unsatisfactory_for_evaluation"}'),
  ('interpretation_category', 'Interpretation / result category', 'coded', 'required', 3, NULL)
) AS v(key, label, data_type, requirement, display_order, visibility_condition)
JOIN synoptic_protocol sp ON sp.name = 'Cervical Cytology (Pap)' AND sp.source_standard = 'Bethesda'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN code_system_value csv ON csv.system = 'BETHESDA-SYNOPTIC' AND csv.code = 'pap.' || v.key AND csv.version = '2014'
JOIN analyte a ON a.code_system_value_id = csv.id
ON CONFLICT (synoptic_protocol_version_id, key) DO NOTHING;

-- synoptic_element_response_option: (element_key, value, display, display_order).
-- SQL column is "code" (not "value") -- Constitution Gate's own Law #1
-- regex false-positive precedent, same reasoning as
-- synoptic-protocol.ts's own header comment.
INSERT INTO synoptic_element_response_option (synoptic_element_id, code, display, display_order)
SELECT se.id, v.value, v.display, v.display_order
FROM (VALUES
  ('specimen_adequacy', 'satisfactory', 'Satisfactory for evaluation', 1),
  ('specimen_adequacy', 'unsatisfactory_for_evaluation', 'Unsatisfactory for evaluation', 2),

  ('adequacy_reason', 'obscuring_blood_or_inflammation', 'Obscuring blood, inflammation, or mucus', 1),
  ('adequacy_reason', 'scant_squamous_cellularity', 'Scant squamous cellularity', 2),
  ('adequacy_reason', 'air_drying_artifact', 'Air-drying artifact', 3),
  ('adequacy_reason', 'insufficient_epithelial_cells', 'Insufficient well-preserved/visualized epithelial cells', 4),
  ('adequacy_reason', 'other', 'Other (specify)', 5),

  ('interpretation_category', 'nilm', 'Negative for Intraepithelial Lesion or Malignancy (NILM)', 1),
  ('interpretation_category', 'asc_us', 'Atypical squamous cells of undetermined significance (ASC-US)', 2),
  ('interpretation_category', 'asc_h', 'Atypical squamous cells, cannot exclude HSIL (ASC-H)', 3),
  ('interpretation_category', 'lsil', 'Low-grade squamous intraepithelial lesion (LSIL)', 4),
  ('interpretation_category', 'hsil', 'High-grade squamous intraepithelial lesion (HSIL)', 5),
  ('interpretation_category', 'agc_nos', 'Atypical glandular cells, not otherwise specified (AGC, NOS)', 6),
  ('interpretation_category', 'agc_favor_neoplastic', 'Atypical glandular cells, favor neoplastic', 7),
  ('interpretation_category', 'ais', 'Endocervical adenocarcinoma in situ (AIS)', 8),
  ('interpretation_category', 'squamous_cell_carcinoma', 'Squamous cell carcinoma', 9),
  ('interpretation_category', 'adenocarcinoma', 'Adenocarcinoma', 10),
  ('interpretation_category', 'other_malignant_neoplasm', 'Other malignant neoplasm (specify)', 11)
) AS v(element_key, value, display, display_order)
JOIN synoptic_protocol sp ON sp.name = 'Cervical Cytology (Pap)' AND sp.source_standard = 'Bethesda'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN synoptic_element se ON se.synoptic_protocol_version_id = spv.id AND se.key = v.element_key
ON CONFLICT (synoptic_element_id, code) DO NOTHING;

-- Publish, last -- matches colorectal/breast's own draft-then-publish
-- precedent; the partial unique index
-- (ux_synoptic_protocol_version_protocol_published) guarantees at most one
-- published version per protocol.
UPDATE synoptic_protocol_version spv
SET status = 'published'
FROM synoptic_protocol sp
WHERE spv.synoptic_protocol_id = sp.id AND sp.name = 'Cervical Cytology (Pap)' AND sp.source_standard = 'Bethesda'
  AND spv.version = 1 AND spv.status = 'draft';

-- FEAT-064 (docs/plans/feat-064-cytology-reflex-ascus-hpv.md). The reflex
-- target for an ASC-US interpretation, per Perkins RB, Guido RS, Castle PE,
-- et al., "2019 ASCCP Risk-Based Management Consensus Guidelines for
-- Abnormal Cervical Cancer Screening Tests and Cancer Precursors," J Low
-- Genit Tract Dis. 2020;24(2):102-131 -- HPV testing (reflex or co-testing)
-- is the standard triage step following an ASC-US cytology result.
-- PLACEHOLDER test code, same "PLACEHOLDER, NOT PARTNER DATA" framing as
-- chemistry-catalog.sql/microbiology-catalog.sql's own header comments --
-- only the clinical justification for the reflex is a real, cited external
-- source, not this internal test code. No analyte (HPV result-entry is a
-- distinct, unscoped future feature, not named in issue #543's own ACs) --
-- same "CULT carries no analyte of its own" precedent
-- microbiology-catalog.sql's own step 3/4 already established for a reflex
-- target whose result-entry is out of scope.
INSERT INTO test_definition (tenant_id, code, display_name)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'HPV', 'High-Risk HPV DNA Test (Reflex)')
ON CONFLICT (tenant_id, code) DO NOTHING;
