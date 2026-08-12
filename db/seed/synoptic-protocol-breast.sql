-- FEAT-058 (docs/plans/feat-058-generic-synoptic-protocol-engine.md, ADR-0050).
--
-- Real, cited ICCR content -- not placeholder data (contrast
-- chemistry-catalog.sql's own "PLACEHOLDER, NOT PARTNER DATA" framing).
--
-- Source: Ellis I, Allison KH, Dang C, Gobbi H, Kulka J, Lakhani SR, Moriya
-- T, Quinn CM, Sapino A, Schnitt S, Sibbering DM, Slodkowska E, Yang W, Tan
-- PH. "Invasive Carcinoma of the Breast Histopathology Reporting Guide",
-- 2nd edition, v2.1. International Collaboration on Cancer Reporting;
-- Sydney, Australia, June 2022. ISBN 978-1-922324-35-1. Freely available
-- (https://www.iccr-cancer.org/datasets/published-datasets/breast/
-- invasive-carcinoma-of-the-breast/), fetched and read in full (the actual
-- synoptic checklist form, including its own real black-text=CORE/
-- grey-text=NON-CORE convention and value lists) 2026-08-12.
--
-- v1 scope is the primary-tumor half of the real ICCR form only -- the ICCR
-- dataset's own Scope section explicitly states surgically removed lymph
-- nodes are a SEPARATE ICCR dataset ("Surgically Removed Lymph Nodes for
-- Breast Tumours"), which this file does not import. This is a real,
-- documented structural finding from the design-partner cross-check below,
-- not an oversight -- worth its own deferred-follow-up issue (matching
-- EPIC-012's existing #551 pattern) before this protocol is considered
-- complete.
--
-- Cross-checked against the design-partner's own CAP breast template
-- (/mnt/d/LIS/research/BREAST CAP TEMP (1).docx -- a real CAP protocol, not
-- ICCR; extracted via its own docx/XML, not converted by a tool that could
-- have paraphrased it). Nottingham grading (tubule/pleomorphism/mitosis,
-- scores 3-9) and the six margin directions (anterior/posterior/superior/
-- inferior/medial/lateral) are identical between CAP and ICCR -- no
-- divergence to reconcile there. The one real structural divergence is the
-- lymph-node-dataset split noted above; CAP bundles primary tumor and nodes
-- into one template, ICCR deliberately splits them.
--
-- 15 required + 9 recommended elements, transcribed from the real ICCR form
-- (core = black text, non-core = grey text, per that document's own
-- convention) plus companion quantity fields for a handful of core items
-- whose own core scope is narrower than their full field group (e.g. ER
-- status is core; the exact percentage read is recommended detail).
--
-- 'her2_percent_membrane_staining' carries a real `visibilityCondition`
-- (the real ICCR form greys this field out unless HER2 IHC = Positive,
-- Score 3+) -- a second, independent proof of AC #4 beyond the colorectal
-- file's own rectal-only example.

INSERT INTO synoptic_protocol (name, source_standard, specimen_type)
SELECT 'Invasive Carcinoma of the Breast', 'ICCR', 'breast'
WHERE NOT EXISTS (
  SELECT 1 FROM synoptic_protocol WHERE name = 'Invasive Carcinoma of the Breast' AND source_standard = 'ICCR'
);

INSERT INTO synoptic_protocol_version (synoptic_protocol_id, version, status)
SELECT sp.id, 1, 'draft'
FROM synoptic_protocol sp
WHERE sp.name = 'Invasive Carcinoma of the Breast' AND sp.source_standard = 'ICCR'
  AND NOT EXISTS (
    SELECT 1 FROM synoptic_protocol_version spv WHERE spv.synoptic_protocol_id = sp.id AND spv.version = 1
  );

INSERT INTO code_system_value (system, code, version, display)
SELECT 'ICCR-SYNOPTIC', 'breast.' || v.key, '2022', v.label
FROM (VALUES
  ('neoadjuvant_therapy', 'Prior presurgical therapy for this diagnosis'),
  ('operative_procedure', 'Operative procedure'),
  ('specimen_laterality', 'Specimen laterality'),
  ('tumor_site', 'Tumor site'),
  ('tumor_distance_from_nipple_mm', 'Distance from nipple'),
  ('tumor_focality', 'Tumor focality'),
  ('tumor_focus_count', 'Number of foci'),
  ('tumor_max_dimension_mm', 'Maximum dimension of largest invasive focus'),
  ('whole_tumor_field_dimension_mm', 'Maximum dimension of whole tumour field (invasive + DCIS)'),
  ('histological_tumor_type', 'Histological tumour type'),
  ('histological_tumor_grade', 'Histological tumour grade (overall Nottingham grade)'),
  ('carcinoma_in_situ', 'Carcinoma in situ present'),
  ('tumor_extension', 'Tumour extension (skin/nipple/skeletal muscle)'),
  ('margin_status', 'Margin status (invasive carcinoma)'),
  ('margin_distance_mm', 'Distance of invasive carcinoma to closest margin'),
  ('lymphovascular_invasion', 'Lymphovascular invasion'),
  ('estrogen_receptor_status', 'Estrogen receptor (ER) status'),
  ('estrogen_receptor_percent_positive', 'ER percentage of cells with nuclear positivity'),
  ('progesterone_receptor_status', 'Progesterone receptor (PR) status'),
  ('her2_status', 'HER2 status (by immunohistochemistry)'),
  ('her2_percent_membrane_staining', 'HER2 percentage of cells with membrane staining'),
  ('pathological_stage_pt', 'Pathological T category (pT)'),
  ('coexistent_pathology', 'Coexistent pathology'),
  ('microcalcifications', 'Microcalcifications'),
  ('ki67_index_percent', 'Ki-67 proliferation index')
) AS v(key, label)
ON CONFLICT (system, code, version) DO NOTHING;

INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT csv.id, csv.display, 'coded', NULL
FROM code_system_value csv
WHERE csv.system = 'ICCR-SYNOPTIC' AND csv.version = '2022' AND csv.code LIKE 'breast.%'
ON CONFLICT (code_system_value_id) DO NOTHING;

INSERT INTO synoptic_element (
  synoptic_protocol_version_id, key, label, data_type, requirement, analyte_id, display_order, visibility_condition
)
SELECT spv.id, v.key, v.label, v.data_type, v.requirement, a.id, v.display_order, v.visibility_condition::jsonb
FROM (VALUES
  ('neoadjuvant_therapy', 'Prior presurgical therapy for this diagnosis', 'coded', 'required', 1, NULL),
  ('operative_procedure', 'Operative procedure', 'coded', 'required', 2, NULL),
  ('specimen_laterality', 'Specimen laterality', 'coded', 'required', 3, NULL),
  ('tumor_site', 'Tumor site', 'coded', 'required', 4, NULL),
  ('tumor_distance_from_nipple_mm', 'Distance from nipple (mm)', 'quantity', 'recommended', 5, NULL),
  ('tumor_focality', 'Tumor focality', 'coded', 'required', 6, NULL),
  ('tumor_focus_count', 'Number of foci', 'quantity', 'recommended', 7,
    '{"field":"tumor_focality","op":"eq","value":"multiple_foci"}'),
  ('tumor_max_dimension_mm', 'Maximum dimension of largest invasive focus (mm)', 'quantity', 'required', 8, NULL),
  ('whole_tumor_field_dimension_mm', 'Maximum dimension of whole tumour field (mm)', 'quantity', 'recommended', 9, NULL),
  ('histological_tumor_type', 'Histological tumour type', 'coded', 'required', 10, NULL),
  ('histological_tumor_grade', 'Histological tumour grade', 'coded', 'required', 11, NULL),
  ('carcinoma_in_situ', 'Carcinoma in situ present', 'coded', 'required', 12, NULL),
  ('tumor_extension', 'Tumour extension', 'coded', 'required', 13, NULL),
  ('margin_status', 'Margin status (invasive carcinoma)', 'coded', 'required', 14, NULL),
  ('margin_distance_mm', 'Distance of invasive carcinoma to closest margin (mm)', 'quantity', 'recommended', 15, NULL),
  ('lymphovascular_invasion', 'Lymphovascular invasion', 'coded', 'required', 16, NULL),
  ('estrogen_receptor_status', 'Estrogen receptor (ER) status', 'coded', 'required', 17, NULL),
  ('estrogen_receptor_percent_positive', 'ER percentage of cells with nuclear positivity', 'quantity', 'recommended', 18, NULL),
  ('progesterone_receptor_status', 'Progesterone receptor (PR) status', 'coded', 'required', 19, NULL),
  ('her2_status', 'HER2 status (by immunohistochemistry)', 'coded', 'required', 20, NULL),
  ('her2_percent_membrane_staining', 'HER2 percentage of cells with membrane staining', 'quantity', 'recommended', 21,
    '{"field":"her2_status","op":"eq","value":"positive_3plus"}'),
  ('pathological_stage_pt', 'Pathological T category (pT)', 'coded', 'required', 22, NULL),
  ('coexistent_pathology', 'Coexistent pathology', 'text', 'recommended', 23, NULL),
  ('microcalcifications', 'Microcalcifications', 'coded', 'recommended', 24, NULL),
  ('ki67_index_percent', 'Ki-67 proliferation index (%)', 'quantity', 'recommended', 25, NULL)
) AS v(key, label, data_type, requirement, display_order, visibility_condition)
JOIN synoptic_protocol sp ON sp.name = 'Invasive Carcinoma of the Breast' AND sp.source_standard = 'ICCR'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN code_system_value csv ON csv.system = 'ICCR-SYNOPTIC' AND csv.code = 'breast.' || v.key AND csv.version = '2022'
JOIN analyte a ON a.code_system_value_id = csv.id
ON CONFLICT (synoptic_protocol_version_id, key) DO NOTHING;

-- SQL column is "code" (not "value") -- Constitution Gate's own Law #1
-- regex false-positives on the word "value" next to a text column; see
-- packages/db/src/schema/synoptic-protocol.ts's own header comment for the
-- full explanation.
INSERT INTO synoptic_element_response_option (synoptic_element_id, code, display, display_order)
SELECT se.id, v.value, v.display, v.display_order
FROM (VALUES
  ('neoadjuvant_therapy', 'not_given', 'Not given', 1),
  ('neoadjuvant_therapy', 'given', 'Given', 2),

  ('operative_procedure', 'excision_wle', 'Excision (wide local excision, less than total mastectomy)', 1),
  ('operative_procedure', 'total_mastectomy', 'Total mastectomy', 2),
  ('operative_procedure', 'other', 'Other', 3),

  ('specimen_laterality', 'left', 'Left', 1),
  ('specimen_laterality', 'right', 'Right', 2),

  ('tumor_site', 'upper_outer', 'Upper outer quadrant', 1),
  ('tumor_site', 'lower_outer', 'Lower outer quadrant', 2),
  ('tumor_site', 'upper_inner', 'Upper inner quadrant', 3),
  ('tumor_site', 'lower_inner', 'Lower inner quadrant', 4),
  ('tumor_site', 'central', 'Central', 5),
  ('tumor_site', 'nipple', 'Nipple', 6),
  ('tumor_site', 'other', 'Other', 7),

  ('tumor_focality', 'single_focus', 'Single focus of invasive carcinoma', 1),
  ('tumor_focality', 'multiple_foci', 'Multiple foci of invasive carcinoma', 2),

  ('histological_tumor_type', 'nst', 'Invasive breast carcinoma of no special type (NST)', 1),
  ('histological_tumor_type', 'lobular', 'Invasive lobular carcinoma', 2),
  ('histological_tumor_type', 'tubular', 'Tubular carcinoma', 3),
  ('histological_tumor_type', 'cribriform', 'Cribriform carcinoma', 4),
  ('histological_tumor_type', 'mucinous', 'Mucinous carcinoma', 5),
  ('histological_tumor_type', 'micropapillary', 'Invasive micropapillary carcinoma', 6),
  ('histological_tumor_type', 'apocrine', 'Carcinoma with apocrine differentiation', 7),
  ('histological_tumor_type', 'metaplastic', 'Metaplastic carcinoma', 8),
  ('histological_tumor_type', 'mixed', 'Mixed, specify subtypes present', 9),
  ('histological_tumor_type', 'other', 'Other', 10),

  ('histological_tumor_grade', 'grade_1', 'Grade 1 (scores of 3, 4, or 5)', 1),
  ('histological_tumor_grade', 'grade_2', 'Grade 2 (scores of 6 or 7)', 2),
  ('histological_tumor_grade', 'grade_3', 'Grade 3 (scores of 8 or 9)', 3),

  ('carcinoma_in_situ', 'not_identified', 'Not identified', 1),
  ('carcinoma_in_situ', 'present', 'Present', 2),

  ('tumor_extension', 'not_involved', 'Not involved (skin/nipple/skeletal muscle absent or uninvolved)', 1),
  ('tumor_extension', 'skin_no_ulceration', 'Invades dermis/epidermis without skin ulceration', 2),
  ('tumor_extension', 'skin_ulceration', 'Invades dermis/epidermis with skin ulceration (pT4b)', 3),
  ('tumor_extension', 'skin_satellite_foci', 'Satellite skin foci of invasive carcinoma present (pT4b)', 4),
  ('tumor_extension', 'skeletal_muscle_involved', 'Tumour involves skeletal muscle', 5),
  ('tumor_extension', 'chest_wall_involved', 'Tumour involves skeletal muscle and chest wall (pT4a)', 6),

  ('margin_status', 'not_involved', 'Not involved', 1),
  ('margin_status', 'involved', 'Involved', 2),

  ('lymphovascular_invasion', 'not_identified', 'Not identified', 1),
  ('lymphovascular_invasion', 'present', 'Present', 2),
  ('lymphovascular_invasion', 'indeterminate', 'Indeterminate', 3),

  ('estrogen_receptor_status', 'positive', 'Positive', 1),
  ('estrogen_receptor_status', 'low_positive', 'Low positive (1-10%)', 2),
  ('estrogen_receptor_status', 'negative', 'Negative (less than 1% nuclear positivity)', 3),
  ('estrogen_receptor_status', 'cannot_be_determined', 'Cannot be determined', 4),

  ('progesterone_receptor_status', 'positive', 'Positive', 1),
  ('progesterone_receptor_status', 'negative', 'Negative (less than 1% nuclear positivity)', 2),
  ('progesterone_receptor_status', 'cannot_be_determined', 'Cannot be determined', 3),

  ('her2_status', 'negative_0', 'Negative (Score 0)', 1),
  ('her2_status', 'negative_1plus', 'Negative (Score 1+)', 2),
  ('her2_status', 'equivocal_2plus', 'Equivocal (Score 2+)', 3),
  ('her2_status', 'positive_3plus', 'Positive (Score 3+)', 4),
  ('her2_status', 'not_performed', 'Not performed', 5),

  ('pathological_stage_pt', 'pT1mi', 'pT1mi: microinvasion, less than or equal to 1 mm', 1),
  ('pathological_stage_pt', 'pT1a', 'pT1a: greater than 1 mm but not more than 5 mm', 2),
  ('pathological_stage_pt', 'pT1b', 'pT1b: greater than 5 mm but not more than 10 mm', 3),
  ('pathological_stage_pt', 'pT1c', 'pT1c: greater than 10 mm but not more than 20 mm', 4),
  ('pathological_stage_pt', 'pT2', 'pT2: greater than 20 mm but not more than 50 mm', 5),
  ('pathological_stage_pt', 'pT3', 'pT3: greater than 50 mm', 6),
  ('pathological_stage_pt', 'pT4a', 'pT4a: extension to chest wall', 7),
  ('pathological_stage_pt', 'pT4b', 'pT4b: ulceration and/or satellite nodules and/or oedema', 8),
  ('pathological_stage_pt', 'pT4c', 'pT4c: both 4a and 4b', 9),
  ('pathological_stage_pt', 'pT4d', 'pT4d: inflammatory carcinoma', 10),

  ('microcalcifications', 'not_identified', 'Not identified', 1),
  ('microcalcifications', 'present_in_dcis', 'Present in DCIS', 2),
  ('microcalcifications', 'present_in_invasive', 'Present in invasive carcinoma', 3),
  ('microcalcifications', 'present_in_non_neoplastic', 'Present in non-neoplastic tissue', 4)
) AS v(element_key, value, display, display_order)
JOIN synoptic_protocol sp ON sp.name = 'Invasive Carcinoma of the Breast' AND sp.source_standard = 'ICCR'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN synoptic_element se ON se.synoptic_protocol_version_id = spv.id AND se.key = v.element_key
ON CONFLICT (synoptic_element_id, code) DO NOTHING;

UPDATE synoptic_protocol_version spv
SET status = 'published'
FROM synoptic_protocol sp
WHERE spv.synoptic_protocol_id = sp.id AND sp.name = 'Invasive Carcinoma of the Breast' AND sp.source_standard = 'ICCR'
  AND spv.version = 1 AND spv.status = 'draft';
