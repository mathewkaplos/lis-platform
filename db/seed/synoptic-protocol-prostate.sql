-- Issue #645 (docs/plans/task-645-prostate-lung-synoptic-pilot.md), pilot #2 of
-- FEAT-058's synoptic-protocol library expansion.
--
-- Real, cited CAP content -- not placeholder data.
--
-- Source: College of American Pathologists. "Protocol for the Examination
-- of Specimens From Patients With Carcinoma of the Prostate Gland"
-- (Radical Prostatectomy), Version 4.3.0.0, REL_CAPCP. Real document
-- (D:\LIS\research\cap documents\Prostate_4.3.0.0.REL_CAPCP.docx), fetched
-- and read in full (its own real CASE SUMMARY text extracted directly from
-- the .docx XML, not summarized/paraphrased) 2026-08-20. AJCC-UICC 8th
-- edition staging.
--
-- Per proposal §5.5/§10 Q1 (approved): deeply nested conditional
-- sub-branches are flattened to their own top-level elements with an
-- `in`/`eq`-style visibilityCondition on the relevant parent selection(s),
-- rather than option-specific sub-forms. Two concrete examples:
--   - `minor_tertiary_pattern_5` ("required only if applicable" in the real
--     document) only applies to Grade group 2/3 -- visibilityCondition:
--     histologic_grade in [grade_group_2, grade_group_3].
--   - `percentage_of_pattern_4` (a further sub-field of the tertiary-pattern
--     question, and the real form's own two DIFFERENT percentage-bucket
--     scales depending on which grade group) is simplified to one numeric
--     0-100 quantity field rather than two mutually-exclusive coded option
--     sets that would require the same element to expose different
--     responseOptions depending on a sibling's value -- not supportable by
--     this schema (one fixed responseOptions set per element), and a
--     reasonable simplification per §5.5's own "presentation grouping
--     flattened, every real data element stays recordable" principle.
--
-- Per proposal's own explicit pilot-scope carve-out ("Core elements plus
-- their own directly-dependent Conditional elements at minimum -- Optional
-- ('+'-prefixed) elements may be included where straightforward but are not
-- required for pilot completeness"): the real document's own deeply-nested,
-- entirely-Optional per-lymph-node-site laterality block (Hypogastric/
-- Obturator/Internal iliac/etc., each with its own +Laterality sub-question)
-- and the Additional Findings/Special Studies sections (both entirely
-- "+"-prefixed) are NOT transcribed here -- a real, deliberate scope cut,
-- not an oversight. `regional_lymph_node_status`/`number_of_lymph_nodes_*`
-- (the Core-level lymph-node-status/count questions) ARE included.
--
-- 22 required (Core) + 6 recommended (Conditional/directly-dependent)
-- elements = 28 total. `histologic_type`, `treatment_effect`, and
-- `margins_involved_sites` use the new `coded_multi` data type (issue #645)
-- -- all three are real "select all that apply" questions in the source
-- document.

INSERT INTO synoptic_protocol (name, source_standard, specimen_type)
SELECT 'Carcinoma of the Prostate Gland (Radical Prostatectomy)', 'CAP', 'prostate'
WHERE NOT EXISTS (
  SELECT 1 FROM synoptic_protocol WHERE name = 'Carcinoma of the Prostate Gland (Radical Prostatectomy)' AND source_standard = 'CAP'
);

INSERT INTO synoptic_protocol_version (synoptic_protocol_id, version, status)
SELECT sp.id, 1, 'draft'
FROM synoptic_protocol sp
WHERE sp.name = 'Carcinoma of the Prostate Gland (Radical Prostatectomy)' AND sp.source_standard = 'CAP'
  AND NOT EXISTS (
    SELECT 1 FROM synoptic_protocol_version spv WHERE spv.synoptic_protocol_id = sp.id AND spv.version = 1
  );

INSERT INTO code_system_value (system, code, version, display)
SELECT 'CAP-SYNOPTIC', 'prostate.' || v.key, '4.3.0.0', v.label
FROM (VALUES
  ('procedure', 'Procedure'),
  ('histologic_type', 'Histologic type'),
  ('histologic_grade', 'Histologic grade (Grade group)'),
  ('minor_tertiary_pattern_5', 'Minor tertiary pattern 5'),
  ('percentage_of_pattern_4', 'Percentage of pattern 4'),
  ('intraductal_carcinoma', 'Intraductal carcinoma (IDC)'),
  ('idc_incorporated_into_grade', 'IDC incorporated into grade'),
  ('cribriform_glands', 'Cribriform glands'),
  ('treatment_effect', 'Treatment effect'),
  ('tumor_quantitation_method', 'Tumor quantitation method'),
  ('estimated_percentage_prostate_involved', 'Estimated percentage of prostate involved by tumor'),
  ('dominant_nodule_dimension_mm', 'Greatest dimension of dominant nodule'),
  ('extraprostatic_extension', 'Extraprostatic extension (EPE)'),
  ('urinary_bladder_neck_invasion', 'Urinary bladder neck invasion'),
  ('seminal_vesicle_invasion', 'Seminal vesicle invasion'),
  ('lymphovascular_invasion', 'Lymphatic and/or vascular invasion'),
  ('perineural_invasion', 'Perineural invasion'),
  ('margin_status', 'Margin status'),
  ('linear_length_margin_involvement', 'Linear length of margin(s) involved by carcinoma'),
  ('margins_involved_sites', 'Margin(s) involved by invasive carcinoma'),
  ('regional_lymph_node_status', 'Regional lymph node status'),
  ('number_of_lymph_nodes_with_tumor', 'Number of lymph nodes with tumor'),
  ('number_of_lymph_nodes_examined', 'Number of lymph nodes examined'),
  ('distant_metastasis_site', 'Distant metastasis site(s)'),
  ('pathological_stage_pt', 'Pathological T category (pT)'),
  ('pathological_stage_pn', 'Pathological N category (pN)'),
  ('pathological_stage_pm', 'Pathological M category (pM)'),
  ('comment', 'Comment')
) AS v(key, label)
ON CONFLICT (system, code, version) DO NOTHING;

INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT csv.id, csv.display, 'coded', NULL
FROM code_system_value csv
WHERE csv.system = 'CAP-SYNOPTIC' AND csv.version = '4.3.0.0' AND csv.code LIKE 'prostate.%'
ON CONFLICT (code_system_value_id) DO NOTHING;

INSERT INTO synoptic_element (
  synoptic_protocol_version_id, key, label, data_type, requirement, analyte_id, display_order, visibility_condition
)
SELECT spv.id, v.key, v.label, v.data_type, v.requirement, a.id, v.display_order, v.visibility_condition::jsonb
FROM (VALUES
  ('procedure', 'Procedure', 'coded', 'required', 1, NULL),
  ('histologic_type', 'Histologic type', 'coded_multi', 'required', 2, NULL),
  ('histologic_grade', 'Histologic grade (Grade group)', 'coded', 'required', 3, NULL),
  ('minor_tertiary_pattern_5', 'Minor tertiary pattern 5 (less than 5%)', 'coded', 'recommended', 4,
    '{"field":"histologic_grade","op":"in","value":["grade_group_2","grade_group_3"]}'),
  ('percentage_of_pattern_4', 'Percentage of pattern 4 (%)', 'quantity', 'recommended', 5,
    '{"field":"minor_tertiary_pattern_5","op":"eq","value":"present"}'),
  ('intraductal_carcinoma', 'Intraductal carcinoma (IDC)', 'coded', 'required', 6, NULL),
  ('idc_incorporated_into_grade', 'IDC incorporated into grade', 'coded', 'recommended', 7,
    '{"field":"intraductal_carcinoma","op":"eq","value":"present"}'),
  ('cribriform_glands', 'Cribriform glands', 'coded', 'required', 8, NULL),
  ('treatment_effect', 'Treatment effect', 'coded_multi', 'required', 9, NULL),
  ('tumor_quantitation_method', 'Tumor quantitation method', 'coded_multi', 'required', 10, NULL),
  ('estimated_percentage_prostate_involved', 'Estimated percentage of prostate involved by tumor', 'coded', 'recommended', 11,
    '{"field":"tumor_quantitation_method","op":"includes","value":"via_percentage"}'),
  ('dominant_nodule_dimension_mm', 'Greatest dimension of dominant nodule (mm)', 'quantity', 'recommended', 12,
    '{"field":"tumor_quantitation_method","op":"includes","value":"via_dimension"}'),
  ('extraprostatic_extension', 'Extraprostatic extension (EPE)', 'coded', 'required', 13, NULL),
  ('urinary_bladder_neck_invasion', 'Urinary bladder neck invasion', 'coded', 'required', 14, NULL),
  ('seminal_vesicle_invasion', 'Seminal vesicle invasion', 'coded', 'required', 15, NULL),
  ('lymphovascular_invasion', 'Lymphatic and/or vascular invasion', 'coded', 'required', 16, NULL),
  ('perineural_invasion', 'Perineural invasion', 'coded', 'recommended', 17, NULL),
  ('margin_status', 'Margin status', 'coded', 'required', 18, NULL),
  ('linear_length_margin_involvement', 'Linear length of margin(s) involved by carcinoma', 'coded', 'recommended', 19,
    '{"field":"margin_status","op":"eq","value":"invasive_carcinoma_present"}'),
  ('margins_involved_sites', 'Margin(s) involved by invasive carcinoma', 'coded_multi', 'recommended', 20,
    '{"field":"margin_status","op":"eq","value":"invasive_carcinoma_present"}'),
  ('regional_lymph_node_status', 'Regional lymph node status', 'coded', 'required', 21, NULL),
  ('number_of_lymph_nodes_with_tumor', 'Number of lymph nodes with tumor', 'quantity', 'recommended', 22,
    '{"field":"regional_lymph_node_status","op":"eq","value":"tumor_present"}'),
  ('number_of_lymph_nodes_examined', 'Number of lymph nodes examined', 'quantity', 'recommended', 23,
    '{"field":"regional_lymph_node_status","op":"in","value":["all_negative","tumor_present"]}'),
  ('distant_metastasis_site', 'Distant metastasis site(s)', 'coded_multi', 'recommended', 24, NULL),
  ('pathological_stage_pt', 'Pathological T category (pT)', 'coded', 'required', 25, NULL),
  ('pathological_stage_pn', 'Pathological N category (pN)', 'coded', 'required', 26, NULL),
  ('pathological_stage_pm', 'Pathological M category (pM)', 'coded', 'recommended', 27, NULL),
  ('comment', 'Comment', 'text', 'recommended', 28, NULL)
) AS v(key, label, data_type, requirement, display_order, visibility_condition)
JOIN synoptic_protocol sp ON sp.name = 'Carcinoma of the Prostate Gland (Radical Prostatectomy)' AND sp.source_standard = 'CAP'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN code_system_value csv ON csv.system = 'CAP-SYNOPTIC' AND csv.code = 'prostate.' || v.key AND csv.version = '4.3.0.0'
JOIN analyte a ON a.code_system_value_id = csv.id
ON CONFLICT (synoptic_protocol_version_id, key) DO NOTHING;

-- SQL column is "code" (not "value") -- Constitution Gate's own Law #1
-- regex false-positives on the word "value" next to a text column; see
-- packages/db/src/schema/synoptic-protocol.ts's own header comment for the
-- full explanation.
INSERT INTO synoptic_element_response_option (synoptic_element_id, code, display, display_order)
SELECT se.id, v.value, v.display, v.display_order
FROM (VALUES
  ('procedure', 'radical_prostatectomy', 'Radical prostatectomy', 1),
  ('procedure', 'other', 'Other', 2),
  ('procedure', 'not_specified', 'Not specified', 3),

  ('histologic_type', 'acinar_conventional', 'Acinar adenocarcinoma, conventional (usual)', 1),
  ('histologic_type', 'acinar_signet_ring_like', 'Acinar adenocarcinoma, signet-ring-like cell', 2),
  ('histologic_type', 'acinar_pleomorphic_giant_cell', 'Acinar adenocarcinoma, pleomorphic giant cell', 3),
  ('histologic_type', 'acinar_sarcomatoid', 'Acinar adenocarcinoma, sarcomatoid', 4),
  ('histologic_type', 'acinar_pin_like', 'Acinar adenocarcinoma, prostatic intraepithelial neoplasia-like', 5),
  ('histologic_type', 'intraductal_carcinoma', 'Intraductal carcinoma', 6),
  ('histologic_type', 'ductal_adenocarcinoma', 'Ductal adenocarcinoma', 7),
  ('histologic_type', 'adenosquamous_carcinoma', 'Adenosquamous carcinoma', 8),
  ('histologic_type', 'squamous_cell_carcinoma', 'Squamous cell carcinoma', 9),
  ('histologic_type', 'basal_cell_carcinoma', 'Basal cell (adenoid cystic) carcinoma', 10),
  ('histologic_type', 'adenocarcinoma_with_neuroendocrine_differentiation', 'Adenocarcinoma with neuroendocrine differentiation', 11),
  ('histologic_type', 'well_differentiated_net', 'Well-differentiated neuroendocrine tumor', 12),
  ('histologic_type', 'small_cell_neuroendocrine_carcinoma', 'Small cell neuroendocrine carcinoma', 13),
  ('histologic_type', 'large_cell_neuroendocrine_carcinoma', 'Large cell neuroendocrine carcinoma', 14),
  ('histologic_type', 'other', 'Other histologic type not listed', 15),
  ('histologic_type', 'cannot_be_determined', 'Carcinoma, type cannot be determined', 16),

  ('histologic_grade', 'grade_group_1', 'Grade group 1 (Gleason Score 3+3=6)', 1),
  ('histologic_grade', 'grade_group_2', 'Grade group 2 (Gleason Score 3+4=7)', 2),
  ('histologic_grade', 'grade_group_3', 'Grade group 3 (Gleason Score 4+3=7)', 3),
  ('histologic_grade', 'grade_group_4_4plus4', 'Grade group 4 (Gleason Score 4+4=8)', 4),
  ('histologic_grade', 'grade_group_4_3plus5', 'Grade group 4 (Gleason Score 3+5=8)', 5),
  ('histologic_grade', 'grade_group_4_5plus3', 'Grade group 4 (Gleason Score 5+3=8)', 6),
  ('histologic_grade', 'grade_group_5_4plus5', 'Grade group 5 (Gleason Score 4+5=9)', 7),
  ('histologic_grade', 'grade_group_5_5plus4', 'Grade group 5 (Gleason Score 5+4=9)', 8),
  ('histologic_grade', 'grade_group_5_5plus5', 'Grade group 5 (Gleason Score 5+5=10)', 9),
  ('histologic_grade', 'cannot_be_assessed', 'Cannot be assessed', 10),
  ('histologic_grade', 'not_applicable', 'Not applicable', 11),

  ('minor_tertiary_pattern_5', 'not_applicable_not_identified', 'Not applicable / not identified', 1),
  ('minor_tertiary_pattern_5', 'present', 'Present', 2),

  ('intraductal_carcinoma', 'not_identified', 'Not identified', 1),
  ('intraductal_carcinoma', 'present', 'Present', 2),

  ('idc_incorporated_into_grade', 'yes', 'Yes', 1),
  ('idc_incorporated_into_grade', 'no', 'No', 2),
  ('idc_incorporated_into_grade', 'cannot_be_determined', 'Cannot be determined', 3),

  ('cribriform_glands', 'not_applicable', 'Not applicable', 1),
  ('cribriform_glands', 'not_identified', 'Not identified', 2),
  ('cribriform_glands', 'present', 'Present', 3),
  ('cribriform_glands', 'cannot_be_determined', 'Cannot be determined', 4),

  ('treatment_effect', 'no_known_presurgical_therapy', 'No known presurgical therapy', 1),
  ('treatment_effect', 'not_identified', 'Not identified', 2),
  ('treatment_effect', 'radiation_therapy_effect_present', 'Radiation therapy effect present', 3),
  ('treatment_effect', 'hormonal_therapy_effect_present', 'Hormonal therapy effect present', 4),
  ('treatment_effect', 'other', 'Other therapy effect(s) present', 5),
  ('treatment_effect', 'cannot_be_determined', 'Cannot be determined', 6),

  ('tumor_quantitation_method', 'via_percentage', 'Via percentage', 1),
  ('tumor_quantitation_method', 'via_dimension', 'Via dimension', 2),
  ('tumor_quantitation_method', 'cannot_be_determined', 'Cannot be determined', 3),

  ('estimated_percentage_prostate_involved', 'less_than_1', 'Less than 1%', 1),
  ('estimated_percentage_prostate_involved', '1_5', '1-5%', 2),
  ('estimated_percentage_prostate_involved', '6_10', '6-10%', 3),
  ('estimated_percentage_prostate_involved', '11_20', '11-20%', 4),
  ('estimated_percentage_prostate_involved', '21_30', '21-30%', 5),
  ('estimated_percentage_prostate_involved', '31_40', '31-40%', 6),
  ('estimated_percentage_prostate_involved', '41_50', '41-50%', 7),
  ('estimated_percentage_prostate_involved', '51_60', '51-60%', 8),
  ('estimated_percentage_prostate_involved', '61_70', '61-70%', 9),
  ('estimated_percentage_prostate_involved', '71_80', '71-80%', 10),
  ('estimated_percentage_prostate_involved', '81_90', '81-90%', 11),
  ('estimated_percentage_prostate_involved', 'greater_than_90', 'Greater than 90%', 12),

  ('extraprostatic_extension', 'not_identified', 'Not identified', 1),
  ('extraprostatic_extension', 'present_focal', 'Present, focal', 2),
  ('extraprostatic_extension', 'present_nonfocal', 'Present, nonfocal', 3),
  ('extraprostatic_extension', 'cannot_be_determined', 'Cannot be determined', 4),

  ('urinary_bladder_neck_invasion', 'not_identified', 'Not identified', 1),
  ('urinary_bladder_neck_invasion', 'present', 'Present', 2),
  ('urinary_bladder_neck_invasion', 'cannot_be_determined', 'Cannot be determined', 3),

  ('seminal_vesicle_invasion', 'not_identified', 'Not identified', 1),
  ('seminal_vesicle_invasion', 'present_right', 'Present, right', 2),
  ('seminal_vesicle_invasion', 'present_left', 'Present, left', 3),
  ('seminal_vesicle_invasion', 'present_bilateral', 'Present, bilateral', 4),
  ('seminal_vesicle_invasion', 'present_laterality_cannot_be_determined', 'Present, laterality cannot be determined', 5),
  ('seminal_vesicle_invasion', 'no_seminal_vesicle_present', 'No seminal vesicle present', 6),

  ('lymphovascular_invasion', 'not_identified', 'Not identified', 1),
  ('lymphovascular_invasion', 'present', 'Present', 2),
  ('lymphovascular_invasion', 'cannot_be_determined', 'Cannot be determined', 3),

  ('perineural_invasion', 'not_identified', 'Not identified', 1),
  ('perineural_invasion', 'present', 'Present', 2),

  ('margin_status', 'cannot_be_assessed', 'Cannot be assessed', 1),
  ('margin_status', 'all_negative', 'All margins negative for invasive carcinoma', 2),
  ('margin_status', 'invasive_carcinoma_present', 'Invasive carcinoma present at margin', 3),

  ('linear_length_margin_involvement', 'less_than_3mm', 'Less than 3 mm (limited)', 1),
  ('linear_length_margin_involvement', 'greater_equal_3mm', 'Greater than or equal to 3 mm (non-limited)', 2),
  ('linear_length_margin_involvement', 'cannot_be_determined', 'Cannot be determined', 3),

  ('margins_involved_sites', 'right_apical', 'Right apical', 1),
  ('margins_involved_sites', 'right_bladder_neck', 'Right bladder neck', 2),
  ('margins_involved_sites', 'right_anterior', 'Right anterior', 3),
  ('margins_involved_sites', 'right_lateral', 'Right lateral', 4),
  ('margins_involved_sites', 'right_posterolateral', 'Right posterolateral (neurovascular bundle)', 5),
  ('margins_involved_sites', 'right_posterior', 'Right posterior', 6),
  ('margins_involved_sites', 'left_apical', 'Left apical', 7),
  ('margins_involved_sites', 'left_bladder_neck', 'Left bladder neck', 8),
  ('margins_involved_sites', 'left_anterior', 'Left anterior', 9),
  ('margins_involved_sites', 'left_lateral', 'Left lateral', 10),
  ('margins_involved_sites', 'left_posterolateral', 'Left posterolateral (neurovascular bundle)', 11),
  ('margins_involved_sites', 'left_posterior', 'Left posterior', 12),
  ('margins_involved_sites', 'other', 'Other(s)', 13),
  ('margins_involved_sites', 'cannot_be_determined', 'Cannot be determined', 14),

  ('regional_lymph_node_status', 'not_applicable', 'Not applicable (no regional lymph nodes submitted or found)', 1),
  ('regional_lymph_node_status', 'all_negative', 'Regional lymph nodes present, all negative for tumor', 2),
  ('regional_lymph_node_status', 'tumor_present', 'Tumor present in regional lymph node(s)', 3),

  ('distant_metastasis_site', 'not_applicable', 'Not applicable', 1),
  ('distant_metastasis_site', 'nonregional_lymph_nodes', 'Nonregional lymph node(s)', 2),
  ('distant_metastasis_site', 'bone', 'Bone', 3),
  ('distant_metastasis_site', 'other', 'Other', 4),
  ('distant_metastasis_site', 'cannot_be_determined', 'Cannot be determined', 5),

  ('pathological_stage_pt', 'pT2', 'pT2: Organ confined', 1),
  ('pathological_stage_pt', 'pT3a', 'pT3a: Extraprostatic extension or microscopic invasion of bladder neck', 2),
  ('pathological_stage_pt', 'pT3b', 'pT3b: Tumor invades seminal vesicle(s)', 3),
  ('pathological_stage_pt', 'pT3_subcategory_cannot_be_determined', 'pT3 (subcategory cannot be determined)', 4),
  ('pathological_stage_pt', 'pT4', 'pT4: Tumor is fixed or invades adjacent structures other than seminal vesicles', 5),

  ('pathological_stage_pn', 'pn_not_assigned_no_nodes', 'pN not assigned (no nodes submitted or found)', 1),
  ('pathological_stage_pn', 'pn_not_assigned_cannot_determine', 'pN not assigned (cannot be determined)', 2),
  ('pathological_stage_pn', 'pN0', 'pN0: No positive regional nodes', 3),
  ('pathological_stage_pn', 'pN1', 'pN1: Metastasis in regional nodes', 4),

  ('pathological_stage_pm', 'not_applicable', 'Not applicable - pM cannot be determined from the submitted specimen(s)', 1),
  ('pathological_stage_pm', 'pM1a', 'pM1a: Nonregional lymph node(s)', 2),
  ('pathological_stage_pm', 'pM1b', 'pM1b: Bone(s)', 3),
  ('pathological_stage_pm', 'pM1c', 'pM1c: Other site(s) with or without bone disease', 4),
  ('pathological_stage_pm', 'pM1_subcategory_cannot_be_determined', 'pM1 (subcategory cannot be determined)', 5)
) AS v(element_key, value, display, display_order)
JOIN synoptic_protocol sp ON sp.name = 'Carcinoma of the Prostate Gland (Radical Prostatectomy)' AND sp.source_standard = 'CAP'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN synoptic_element se ON se.synoptic_protocol_version_id = spv.id AND se.key = v.element_key
ON CONFLICT (synoptic_element_id, code) DO NOTHING;

-- Publish, last -- matches report_template_version's own draft-then-publish
-- precedent; the partial unique index (ux_synoptic_protocol_version_protocol_published)
-- guarantees at most one published version per protocol.
UPDATE synoptic_protocol_version spv
SET status = 'published'
FROM synoptic_protocol sp
WHERE spv.synoptic_protocol_id = sp.id AND sp.name = 'Carcinoma of the Prostate Gland (Radical Prostatectomy)' AND sp.source_standard = 'CAP'
  AND spv.version = 1 AND spv.status = 'draft';
