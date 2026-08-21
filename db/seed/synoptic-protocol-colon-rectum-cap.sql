-- Issue #551/#690 (docs/plans/task-690-multi-protocol-disambiguation.md).
--
-- Real, cited CAP content -- not placeholder data.
--
-- Source: the design partner's own real, in-use local resection template
-- (D:\LIS\research\partner documents\COLON TEMPLATE.docx), fetched and read
-- in full from the .docx XML (not summarized/paraphrased) 2026-08-21 -- a
-- real, recognizable subset of CAP's own official "Protocol for the
-- Examination of Specimens From Patients With Primary Carcinoma of the
-- Colon and Rectum," AJCC 8th edition pTNM.
--
-- Additive alongside the existing seeded ICCR "Colorectal Cancer" protocol
-- (synoptic-protocol-colorectal.sql) -- same specimen_type ('colorectal'),
-- intentionally, per explicit product decision (both standards coexist).
-- Safe only because of issue #690's disambiguation mechanism, shipped in
-- the same PR: the frontend's synoptic recording page now shows a real
-- "Choose reporting standard" picker instead of a silent .find() pick when
-- more than one non-panel protocol shares a specimenType.
--
-- Deeply-nested/heavily-conditional sub-branches (precision-qualifier
-- fields, distance-to-margin sub-measurements, non-invasive-tumor margin
-- status, per-site tumor-deposit counts) are flattened away per task-645's
-- own established precedent ("Core elements plus directly-dependent
-- Conditional elements... Optional elements not required for pilot
-- completeness"), not modeled here. 'conditional' below uses issue #664's
-- three-tier requirement model (required when shown, hidden otherwise) --
-- not a new validation branch.

INSERT INTO synoptic_protocol (name, source_standard, specimen_type)
SELECT 'Colon and Rectum (Resection)', 'CAP', 'colorectal'
WHERE NOT EXISTS (
  SELECT 1 FROM synoptic_protocol WHERE name = 'Colon and Rectum (Resection)' AND source_standard = 'CAP'
);

INSERT INTO synoptic_protocol_version (synoptic_protocol_id, version, status)
SELECT sp.id, 1, 'draft'
FROM synoptic_protocol sp
WHERE sp.name = 'Colon and Rectum (Resection)' AND sp.source_standard = 'CAP'
  AND NOT EXISTS (
    SELECT 1 FROM synoptic_protocol_version spv WHERE spv.synoptic_protocol_id = sp.id AND spv.version = 1
  );

INSERT INTO code_system_value (system, code, version, display)
SELECT 'CAP-SYNOPTIC', 'colon_rectum.' || v.key, 'AJCC8', v.label
FROM (VALUES
  ('operative_procedure', 'Operative procedure'),
  ('mesorectal_excision_quality', 'Macroscopic evaluation of mesorectum'),
  ('tumor_site', 'Tumor site'),
  ('rectal_tumor_location', 'Rectal tumor location relative to anterior peritoneal reflection'),
  ('histologic_type', 'Histologic type'),
  ('histologic_grade', 'Histologic grade'),
  ('tumor_size_mm', 'Tumor size, greatest dimension'),
  ('pt_category', 'Primary tumor (pT) category'),
  ('submucosal_invasion_depth', 'Depth of submucosal invasion'),
  ('macroscopic_tumor_perforation', 'Macroscopic tumor perforation'),
  ('lymphovascular_invasion', 'Lymphatic/vascular invasion'),
  ('perineural_invasion', 'Perineural invasion'),
  ('tumor_budding_score', 'Tumor budding score'),
  ('treatment_effect', 'Treatment effect'),
  ('margin_status_invasive', 'Margin status for invasive carcinoma'),
  ('closest_margin_site', 'Closest margin site'),
  ('pn_category', 'Regional lymph nodes (pN) category'),
  ('number_of_lymph_nodes_with_tumor', 'Number of lymph nodes with tumor'),
  ('number_of_lymph_nodes_examined', 'Number of lymph nodes examined'),
  ('tumor_deposits', 'Tumor deposits'),
  ('pm_category', 'Distant metastasis (pM) category'),
  ('additional_findings', 'Additional findings')
) AS v(key, label)
ON CONFLICT (system, code, version) DO NOTHING;

INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT csv.id, csv.display, 'coded', NULL
FROM code_system_value csv
WHERE csv.system = 'CAP-SYNOPTIC' AND csv.version = 'AJCC8' AND csv.code LIKE 'colon_rectum.%'
ON CONFLICT (code_system_value_id) DO NOTHING;

INSERT INTO synoptic_element (
  synoptic_protocol_version_id, key, label, data_type, requirement, analyte_id, display_order, visibility_condition
)
SELECT spv.id, v.key, v.label, v.data_type, v.requirement, a.id, v.display_order, v.visibility_condition::jsonb
FROM (VALUES
  ('operative_procedure', 'Operative procedure', 'coded', 'required', 1, NULL),
  ('mesorectal_excision_quality', 'Macroscopic evaluation of mesorectum', 'coded', 'conditional', 2,
    '{"field":"operative_procedure","op":"in","value":["low_anterior_resection","abdominoperineal_resection"]}'),
  ('tumor_site', 'Tumor site', 'coded_multi', 'required', 3, NULL),
  ('rectal_tumor_location', 'Rectal tumor location relative to anterior peritoneal reflection', 'coded', 'conditional', 4,
    '{"or":[{"field":"tumor_site","op":"includes","value":"rectum"},{"field":"tumor_site","op":"includes","value":"rectosigmoid"}]}'),
  ('histologic_type', 'Histologic type', 'coded', 'required', 5, NULL),
  ('histologic_grade', 'Histologic grade', 'coded', 'required', 6, NULL),
  ('tumor_size_mm', 'Tumor size, greatest dimension (mm)', 'quantity', 'required', 7, NULL),
  ('pt_category', 'Primary tumor (pT) category', 'coded', 'required', 8, NULL),
  ('submucosal_invasion_depth', 'Depth of submucosal invasion', 'coded', 'conditional', 9,
    '{"field":"pt_category","op":"eq","value":"pT1"}'),
  ('macroscopic_tumor_perforation', 'Macroscopic tumor perforation', 'coded', 'required', 10, NULL),
  ('lymphovascular_invasion', 'Lymphatic/vascular invasion', 'coded', 'required', 11, NULL),
  ('perineural_invasion', 'Perineural invasion', 'coded', 'required', 12, NULL),
  ('tumor_budding_score', 'Tumor budding score', 'coded', 'recommended', 13, NULL),
  ('treatment_effect', 'Treatment effect', 'coded', 'recommended', 14, NULL),
  ('margin_status_invasive', 'Margin status for invasive carcinoma', 'coded', 'required', 15, NULL),
  ('closest_margin_site', 'Closest margin site', 'coded', 'conditional', 16,
    '{"field":"margin_status_invasive","op":"neq","value":"not_applicable"}'),
  ('pn_category', 'Regional lymph nodes (pN) category', 'coded', 'required', 17, NULL),
  ('number_of_lymph_nodes_with_tumor', 'Number of lymph nodes with tumor', 'quantity', 'conditional', 18,
    '{"field":"pn_category","op":"neq","value":"pN0"}'),
  ('number_of_lymph_nodes_examined', 'Number of lymph nodes examined', 'quantity', 'recommended', 19, NULL),
  ('tumor_deposits', 'Tumor deposits', 'coded', 'recommended', 20, NULL),
  ('pm_category', 'Distant metastasis (pM) category', 'coded', 'required', 21, NULL),
  ('additional_findings', 'Additional findings', 'coded_multi', 'recommended', 22, NULL)
) AS v(key, label, data_type, requirement, display_order, visibility_condition)
JOIN synoptic_protocol sp ON sp.name = 'Colon and Rectum (Resection)' AND sp.source_standard = 'CAP'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN code_system_value csv ON csv.system = 'CAP-SYNOPTIC' AND csv.code = 'colon_rectum.' || v.key AND csv.version = 'AJCC8'
JOIN analyte a ON a.code_system_value_id = csv.id
ON CONFLICT (synoptic_protocol_version_id, key) DO NOTHING;

INSERT INTO synoptic_element_response_option (synoptic_element_id, code, display, display_order)
SELECT se.id, v.value, v.display, v.display_order
FROM (VALUES
  ('operative_procedure', 'right_hemicolectomy', 'Right hemicolectomy', 1),
  ('operative_procedure', 'transverse_colectomy', 'Transverse colectomy', 2),
  ('operative_procedure', 'left_hemicolectomy', 'Left hemicolectomy', 3),
  ('operative_procedure', 'sigmoidectomy', 'Sigmoidectomy', 4),
  ('operative_procedure', 'low_anterior_resection', 'Low anterior resection', 5),
  ('operative_procedure', 'total_abdominal_colectomy', 'Total abdominal colectomy', 6),
  ('operative_procedure', 'abdominoperineal_resection', 'Abdominoperineal resection', 7),
  ('operative_procedure', 'other', 'Other', 8),
  ('operative_procedure', 'not_specified', 'Not specified', 9),

  ('mesorectal_excision_quality', 'not_applicable', 'Not applicable', 1),
  ('mesorectal_excision_quality', 'complete', 'Complete', 2),
  ('mesorectal_excision_quality', 'near_complete', 'Near complete', 3),
  ('mesorectal_excision_quality', 'incomplete', 'Incomplete', 4),
  ('mesorectal_excision_quality', 'cannot_be_determined', 'Cannot be determined', 5),

  ('tumor_site', 'cecum', 'Cecum', 1),
  ('tumor_site', 'ileocecal_valve', 'Ileocecal valve', 2),
  ('tumor_site', 'ascending_colon', 'Ascending colon', 3),
  ('tumor_site', 'hepatic_flexure', 'Hepatic flexure', 4),
  ('tumor_site', 'transverse_colon', 'Transverse colon', 5),
  ('tumor_site', 'splenic_flexure', 'Splenic flexure', 6),
  ('tumor_site', 'descending_colon', 'Descending colon', 7),
  ('tumor_site', 'sigmoid_colon', 'Sigmoid colon', 8),
  ('tumor_site', 'rectosigmoid', 'Rectosigmoid', 9),
  ('tumor_site', 'rectum', 'Rectum', 10),

  ('rectal_tumor_location', 'not_applicable', 'Not applicable (colon, not rectum)', 1),
  ('rectal_tumor_location', 'entirely_above_reflection', 'Entirely above anterior peritoneal reflection', 2),
  ('rectal_tumor_location', 'entirely_below_reflection', 'Entirely below anterior peritoneal reflection', 3),
  ('rectal_tumor_location', 'straddles_reflection', 'Straddles anterior peritoneal reflection', 4),
  ('rectal_tumor_location', 'cannot_be_determined', 'Cannot be determined', 5),

  ('histologic_type', 'adenocarcinoma_nos', 'Adenocarcinoma, NOS', 1),
  ('histologic_type', 'mucinous_adenocarcinoma', 'Mucinous adenocarcinoma', 2),
  ('histologic_type', 'poorly_cohesive_carcinoma', 'Poorly cohesive carcinoma', 3),
  ('histologic_type', 'signet_ring_cell_carcinoma', 'Signet-ring cell carcinoma', 4),
  ('histologic_type', 'medullary_carcinoma', 'Medullary carcinoma', 5),
  ('histologic_type', 'serrated_adenocarcinoma', 'Serrated adenocarcinoma', 6),
  ('histologic_type', 'micropapillary_adenocarcinoma', 'Micropapillary adenocarcinoma', 7),
  ('histologic_type', 'adenoma_like_adenocarcinoma', 'Adenoma-like adenocarcinoma', 8),
  ('histologic_type', 'adenosquamous_carcinoma', 'Adenosquamous carcinoma', 9),
  ('histologic_type', 'undifferentiated_carcinoma_nos', 'Undifferentiated carcinoma, NOS', 10),
  ('histologic_type', 'large_cell_neuroendocrine_carcinoma', 'Large cell neuroendocrine carcinoma', 11),
  ('histologic_type', 'small_cell_neuroendocrine_carcinoma', 'Small cell neuroendocrine carcinoma', 12),
  ('histologic_type', 'minen', 'Mixed neuroendocrine-non-neuroendocrine neoplasm (MiNEN)', 13),
  ('histologic_type', 'other', 'Other', 14),
  ('histologic_type', 'cannot_be_determined', 'Cannot be determined', 15),

  ('histologic_grade', 'g1', 'G1: well differentiated', 1),
  ('histologic_grade', 'g2', 'G2: moderately differentiated', 2),
  ('histologic_grade', 'g3', 'G3: poorly differentiated', 3),
  ('histologic_grade', 'g4', 'G4: undifferentiated', 4),
  ('histologic_grade', 'gx', 'GX: cannot be assessed', 5),
  ('histologic_grade', 'not_applicable', 'Not applicable', 6),

  ('pt_category', 'pT0', 'pT0: no evidence of primary tumor', 1),
  ('pt_category', 'pTis', 'pTis: carcinoma in situ, intramucosal carcinoma', 2),
  ('pt_category', 'pT1', 'pT1: invades submucosa', 3),
  ('pt_category', 'pT2', 'pT2: invades muscularis propria', 4),
  ('pt_category', 'pT3', 'pT3: invades through muscularis propria into pericolic/perirectal tissue', 5),
  ('pt_category', 'pT4a', 'pT4a: invades visceral peritoneum', 6),
  ('pt_category', 'pT4b', 'pT4b: directly invades or adheres to adjacent structures', 7),
  ('pt_category', 'cannot_be_determined', 'Cannot be determined', 8),

  ('submucosal_invasion_depth', 'less_than_1mm', 'Less than 1 mm', 1),
  ('submucosal_invasion_depth', 'one_to_2mm', '1 to 2 mm', 2),
  ('submucosal_invasion_depth', 'greater_than_2mm', 'Greater than 2 mm', 3),
  ('submucosal_invasion_depth', 'cannot_be_determined', 'Cannot be determined', 4),

  ('macroscopic_tumor_perforation', 'not_identified', 'Not identified', 1),
  ('macroscopic_tumor_perforation', 'present', 'Present', 2),

  ('lymphovascular_invasion', 'not_identified', 'Not identified', 1),
  ('lymphovascular_invasion', 'small_vessel', 'Small vessel invasion', 2),
  ('lymphovascular_invasion', 'large_vessel_intramural', 'Large vessel invasion, intramural', 3),
  ('lymphovascular_invasion', 'large_vessel_extramural', 'Large vessel invasion, extramural', 4),
  ('lymphovascular_invasion', 'present_nos', 'Present, not otherwise specified', 5),
  ('lymphovascular_invasion', 'cannot_be_determined', 'Cannot be determined', 6),

  ('perineural_invasion', 'not_identified', 'Not identified', 1),
  ('perineural_invasion', 'present', 'Present', 2),

  ('tumor_budding_score', 'not_applicable', 'Not applicable', 1),
  ('tumor_budding_score', 'low_bd1', 'Low (Bd1): 0-4 buds', 2),
  ('tumor_budding_score', 'intermediate_bd2', 'Intermediate (Bd2): 5-9 buds', 3),
  ('tumor_budding_score', 'high_bd3', 'High (Bd3): 10 or more buds', 4),
  ('tumor_budding_score', 'cannot_be_determined', 'Cannot be determined', 5),

  ('treatment_effect', 'no_known_presurgical_therapy', 'No known presurgical therapy', 1),
  ('treatment_effect', 'score_0_complete', 'Score 0: complete response, no viable cancer cells', 2),
  ('treatment_effect', 'score_1_near_complete', 'Score 1: near-complete response, single cells or rare small groups', 3),
  ('treatment_effect', 'score_2_partial', 'Score 2: partial response, evident tumor regression', 4),
  ('treatment_effect', 'present_nos', 'Treatment effect present, not otherwise specified', 5),
  ('treatment_effect', 'score_3_poor_or_no_response', 'Score 3: poor or no response', 6),
  ('treatment_effect', 'cannot_be_determined', 'Cannot be determined', 7),

  ('margin_status_invasive', 'all_margins_negative', 'All margins negative for invasive carcinoma', 1),
  ('margin_status_invasive', 'invasive_carcinoma_at_margin', 'Invasive carcinoma present at margin', 2),
  ('margin_status_invasive', 'cannot_be_determined', 'Cannot be determined', 3),
  ('margin_status_invasive', 'not_applicable', 'Not applicable', 4),

  ('closest_margin_site', 'proximal', 'Proximal', 1),
  ('closest_margin_site', 'distal', 'Distal', 2),
  ('closest_margin_site', 'radial', 'Radial', 3),
  ('closest_margin_site', 'mesenteric', 'Mesenteric', 4),
  ('closest_margin_site', 'deep', 'Deep', 5),
  ('closest_margin_site', 'mucosal', 'Mucosal', 6),
  ('closest_margin_site', 'other', 'Other', 7),

  ('pn_category', 'pNX', 'pNX: cannot be assessed', 1),
  ('pn_category', 'pN0', 'pN0: no regional lymph node metastasis', 2),
  ('pn_category', 'pN1a', 'pN1a: one regional lymph node positive', 3),
  ('pn_category', 'pN1b', 'pN1b: two or three regional lymph nodes positive', 4),
  ('pn_category', 'pN1c', 'pN1c: tumor deposit(s), no positive regional lymph nodes', 5),
  ('pn_category', 'pN2a', 'pN2a: four to six regional lymph nodes positive', 6),
  ('pn_category', 'pN2b', 'pN2b: seven or more regional lymph nodes positive', 7),
  ('pn_category', 'cannot_be_determined', 'Cannot be determined', 8),

  ('tumor_deposits', 'not_identified', 'Not identified', 1),
  ('tumor_deposits', 'present', 'Present', 2),

  ('pm_category', 'not_applicable', 'Not applicable (pM cannot be determined from this specimen)', 1),
  ('pm_category', 'pM1a', 'pM1a: metastasis to one distant organ or site, no peritoneal metastasis', 2),
  ('pm_category', 'pM1b', 'pM1b: metastasis to two or more distant organs or sites, no peritoneal metastasis', 3),
  ('pm_category', 'pM1c', 'pM1c: metastasis to the peritoneal surface, alone or with other site/organ metastases', 4),
  ('pm_category', 'cannot_be_determined', 'Cannot be determined', 5),

  ('additional_findings', 'none_identified', 'None identified', 1),
  ('additional_findings', 'adenomas', 'Adenoma(s)', 2),
  ('additional_findings', 'ulcerative_colitis', 'Ulcerative colitis', 3),
  ('additional_findings', 'crohn_disease', 'Crohn disease', 4),
  ('additional_findings', 'diverticulosis', 'Diverticulosis', 5),
  ('additional_findings', 'dysplasia_arising_in_ibd', 'Dysplasia arising in inflammatory bowel disease', 6),
  ('additional_findings', 'other', 'Other', 7)
) AS v(element_key, value, display, display_order)
JOIN synoptic_protocol sp ON sp.name = 'Colon and Rectum (Resection)' AND sp.source_standard = 'CAP'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN synoptic_element se ON se.synoptic_protocol_version_id = spv.id AND se.key = v.element_key
ON CONFLICT (synoptic_element_id, code) DO NOTHING;

-- Reuses the UCUM 'mm' unit already seeded by synoptic-protocol-colorectal.sql
-- (which must run before this file -- see scripts/db-reset.sh /
-- .github/workflows/pr.yml ordering).
UPDATE synoptic_element se
SET unit_id = u.id
FROM unit u
JOIN code_system_value csv ON csv.id = u.code_system_value_id,
synoptic_protocol_version spv
JOIN synoptic_protocol sp ON sp.id = spv.synoptic_protocol_id
WHERE csv.system = 'UCUM' AND csv.code = 'mm' AND csv.version = '2.2'
  AND sp.name = 'Colon and Rectum (Resection)' AND sp.source_standard = 'CAP' AND spv.version = 1
  AND se.synoptic_protocol_version_id = spv.id
  AND se.key = 'tumor_size_mm'
  AND se.unit_id IS NULL;

-- Publish, last -- matches every other synoptic-protocol seed's own
-- draft-then-publish precedent.
UPDATE synoptic_protocol_version spv
SET status = 'published'
FROM synoptic_protocol sp
WHERE spv.synoptic_protocol_id = sp.id AND sp.name = 'Colon and Rectum (Resection)' AND sp.source_standard = 'CAP'
  AND spv.version = 1 AND spv.status = 'draft';
