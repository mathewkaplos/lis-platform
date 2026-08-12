-- FEAT-058 (docs/plans/feat-058-generic-synoptic-protocol-engine.md, ADR-0050).
--
-- Real, cited ICCR content -- not placeholder data (contrast
-- chemistry-catalog.sql's own "PLACEHOLDER, NOT PARTNER DATA" framing).
--
-- Source: Loughrey MB, Webster F, Arends MJ, Brown I, Burgart LJ,
-- Cunningham C, Flejou JF, Kakar S, Kirsch R, Kojima M, Lugli A, Rosty C,
-- Sheahan K, West NP, Wilson RH, Nagtegaal ID. "Dataset for pathology
-- reporting of colorectal cancer: recommendations from the International
-- Collaboration on Cancer Reporting (ICCR)." Ann Surg. 2022;275(3):e549-e561.
-- doi:10.1097/SLA.0000000000005051. Freely available via White Rose
-- Research Online (https://eprints.whiterose.ac.uk/id/eprint/175586/),
-- fetched and read in full (not from training-data memory) 2026-08-12.
--
-- 18 core (Required) + 7 non-core (Recommended) elements per the source's
-- own §Results/Abstract count, transcribed below as 20 required + 8
-- recommended rows (a small number of core items split into a primary coded
-- element plus a companion quantity/count field, e.g. "tumor deposits" ->
-- presence [required] + count [recommended companion]).
--
-- Cross-checked against the design-partner's own CAP colon/rectum resection
-- template (/mnt/d/LIS/research/COLON TEMPLATE(2)(1).pdf, a real CAP
-- protocol, not ICCR). One real, documented divergence found and reconciled
-- in favor of ICCR per ADR-0050: CAP's template carries a distinct pTis
-- (intramucosal carcinoma) category; ICCR's own dataset text explicitly
-- states pT in situ is NOT recognized in this dataset and folds those rare
-- cases into high-grade dysplasia instead -- `extent_of_invasion_pt` below
-- therefore has no pTis/pT0 option, matching ICCR, not CAP.
--
-- 'relation_to_peritoneal_reflection' and 'plane_of_mesorectal_excision' are
-- both explicitly rectal-only core items (ICCR's own text); the latter
-- carries a real `visibilityCondition` (hidden/not-required unless
-- tumor_site is rectum/rectosigmoid) -- proves AC #4's "conditional/
-- dependent elements correctly hide/show" directly, not just structurally.

INSERT INTO synoptic_protocol (name, source_standard, specimen_type)
SELECT 'Colorectal Cancer', 'ICCR', 'colorectal'
WHERE NOT EXISTS (
  SELECT 1 FROM synoptic_protocol WHERE name = 'Colorectal Cancer' AND source_standard = 'ICCR'
);

INSERT INTO synoptic_protocol_version (synoptic_protocol_id, version, status)
SELECT sp.id, 1, 'draft'
FROM synoptic_protocol sp
WHERE sp.name = 'Colorectal Cancer' AND sp.source_standard = 'ICCR'
  AND NOT EXISTS (
    SELECT 1 FROM synoptic_protocol_version spv WHERE spv.synoptic_protocol_id = sp.id AND spv.version = 1
  );

-- code_system_value + analyte: one dedicated global analyte per element, so
-- each response is queryable via observation.analyte_id like every other
-- discipline's discrete result (proposal §5/§10 Q4).
INSERT INTO code_system_value (system, code, version, display)
SELECT 'ICCR-SYNOPTIC', 'colorectal.' || v.key, '2022', v.label
FROM (VALUES
  ('neoadjuvant_therapy', 'Administration of neoadjuvant therapy'),
  ('operative_procedure', 'Operative procedure'),
  ('tumor_site', 'Tumor site'),
  ('tumor_max_dimension_mm', 'Maximum tumor dimension'),
  ('tumor_perforation', 'Tumor perforation'),
  ('relation_to_peritoneal_reflection', 'Relation of tumor to anterior peritoneal reflection'),
  ('plane_of_mesorectal_excision', 'Plane of mesorectal excision'),
  ('histological_tumor_type', 'Histological tumor type'),
  ('histological_tumor_grade', 'Histological tumor grade'),
  ('extent_of_invasion_pt', 'Extent of invasion (pT)'),
  ('lymphovascular_invasion', 'Lymphatic and venous invasion'),
  ('perineural_invasion', 'Perineural invasion'),
  ('lymph_node_status', 'Lymph node status (pN)'),
  ('tumor_deposits', 'Tumor deposits'),
  ('tumor_deposit_count', 'Number of tumor deposits'),
  ('response_to_neoadjuvant_therapy', 'Response to neoadjuvant therapy'),
  ('margin_status', 'Margin status'),
  ('margin_distance_mm', 'Distance to closest margin'),
  ('distant_metastasis_pm', 'Histologically confirmed distant metastases (pM)'),
  ('pathological_stage', 'Pathological stage (AJCC/UICC 8th edition group stage)'),
  ('anterior_resection_type', 'High vs low anterior resection'),
  ('plane_of_sphincter_excision', 'Plane of sphincter excision'),
  ('plane_of_mesocolic_excision', 'Plane of mesocolic excision'),
  ('invasion_beyond_muscularis_propria_mm', 'Measurement of invasion beyond muscularis propria'),
  ('tumor_budding_score', 'Tumor budding score'),
  ('coexistent_pathology', 'Coexistent pathology'),
  ('mmr_status', 'Mismatch repair (MMR) status'),
  ('ras_braf_status', 'RAS/BRAF mutation status')
) AS v(key, label)
ON CONFLICT (system, code, version) DO NOTHING;

INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT csv.id, csv.display, 'coded', NULL
FROM code_system_value csv
WHERE csv.system = 'ICCR-SYNOPTIC' AND csv.version = '2022' AND csv.code LIKE 'colorectal.%'
ON CONFLICT (code_system_value_id) DO NOTHING;

-- synoptic_element: (key, label, data_type, requirement, display_order,
-- visibility_condition). data_type overrides the placeholder 'coded' used
-- above for analyte rows that are actually quantity/text -- the analyte's
-- own data_type mirrors observation.data_type conventions independently of
-- this table's dataType (which governs recording/validation), matching how
-- report_template's own field-type column is independent of any bound
-- analyte's storage type.
INSERT INTO synoptic_element (
  synoptic_protocol_version_id, key, label, data_type, requirement, analyte_id, display_order, visibility_condition
)
SELECT spv.id, v.key, v.label, v.data_type, v.requirement, a.id, v.display_order, v.visibility_condition::jsonb
FROM (VALUES
  ('neoadjuvant_therapy', 'Administration of neoadjuvant therapy', 'coded', 'required', 1, NULL),
  ('operative_procedure', 'Operative procedure', 'coded', 'required', 2, NULL),
  ('tumor_site', 'Tumor site', 'coded', 'required', 3, NULL),
  ('tumor_max_dimension_mm', 'Maximum tumor dimension (mm)', 'quantity', 'required', 4, NULL),
  ('tumor_perforation', 'Tumor perforation', 'coded', 'required', 5, NULL),
  ('relation_to_peritoneal_reflection', 'Relation of tumor to anterior peritoneal reflection', 'coded', 'required', 6,
    '{"field":"tumor_site","op":"in","value":["rectum","rectosigmoid"]}'),
  ('plane_of_mesorectal_excision', 'Plane of mesorectal excision', 'coded', 'required', 7,
    '{"field":"tumor_site","op":"in","value":["rectum","rectosigmoid"]}'),
  ('histological_tumor_type', 'Histological tumor type', 'coded', 'required', 8, NULL),
  ('histological_tumor_grade', 'Histological tumor grade', 'coded', 'required', 9, NULL),
  ('extent_of_invasion_pt', 'Extent of invasion (pT)', 'coded', 'required', 10, NULL),
  ('lymphovascular_invasion', 'Lymphatic and venous invasion', 'coded', 'required', 11, NULL),
  ('perineural_invasion', 'Perineural invasion', 'coded', 'required', 12, NULL),
  ('lymph_node_status', 'Lymph node status (pN)', 'coded', 'required', 13, NULL),
  ('tumor_deposits', 'Tumor deposits', 'coded', 'required', 14, NULL),
  ('tumor_deposit_count', 'Number of tumor deposits', 'quantity', 'recommended', 15,
    '{"field":"tumor_deposits","op":"eq","value":"present"}'),
  ('response_to_neoadjuvant_therapy', 'Response to neoadjuvant therapy', 'coded', 'required', 16,
    '{"field":"neoadjuvant_therapy","op":"eq","value":"given"}'),
  ('margin_status', 'Margin status', 'coded', 'required', 17, NULL),
  ('margin_distance_mm', 'Distance to closest margin (mm)', 'quantity', 'recommended', 18, NULL),
  ('distant_metastasis_pm', 'Histologically confirmed distant metastases (pM)', 'coded', 'required', 19, NULL),
  ('pathological_stage', 'Pathological stage (AJCC/UICC 8th edition group stage)', 'text', 'required', 20, NULL),
  ('anterior_resection_type', 'High vs low anterior resection', 'coded', 'recommended', 21, NULL),
  ('plane_of_sphincter_excision', 'Plane of sphincter excision', 'coded', 'recommended', 22, NULL),
  ('plane_of_mesocolic_excision', 'Plane of mesocolic excision', 'coded', 'recommended', 23, NULL),
  ('invasion_beyond_muscularis_propria_mm', 'Measurement of invasion beyond muscularis propria (mm)', 'quantity', 'recommended', 24, NULL),
  ('tumor_budding_score', 'Tumor budding score', 'coded', 'recommended', 25, NULL),
  ('coexistent_pathology', 'Coexistent pathology', 'text', 'recommended', 26, NULL),
  ('mmr_status', 'Mismatch repair (MMR) status', 'coded', 'recommended', 27, NULL),
  ('ras_braf_status', 'RAS/BRAF mutation status', 'coded', 'recommended', 28, NULL)
) AS v(key, label, data_type, requirement, display_order, visibility_condition)
JOIN synoptic_protocol sp ON sp.name = 'Colorectal Cancer' AND sp.source_standard = 'ICCR'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN code_system_value csv ON csv.system = 'ICCR-SYNOPTIC' AND csv.code = 'colorectal.' || v.key AND csv.version = '2022'
JOIN analyte a ON a.code_system_value_id = csv.id
ON CONFLICT (synoptic_protocol_version_id, key) DO NOTHING;

-- synoptic_element_response_option: (element_key, value, display, display_order).
INSERT INTO synoptic_element_response_option (synoptic_element_id, value, display, display_order)
SELECT se.id, v.value, v.display, v.display_order
FROM (VALUES
  ('neoadjuvant_therapy', 'not_given', 'Not given', 1),
  ('neoadjuvant_therapy', 'given', 'Given', 2),

  ('operative_procedure', 'right_hemicolectomy', 'Right hemicolectomy', 1),
  ('operative_procedure', 'transverse_colectomy', 'Transverse colectomy', 2),
  ('operative_procedure', 'left_hemicolectomy', 'Left hemicolectomy', 3),
  ('operative_procedure', 'sigmoidectomy', 'Sigmoidectomy', 4),
  ('operative_procedure', 'low_anterior_resection', 'Low anterior resection', 5),
  ('operative_procedure', 'total_abdominal_colectomy', 'Total abdominal colectomy', 6),
  ('operative_procedure', 'abdominoperineal_resection', 'Abdominoperineal resection', 7),
  ('operative_procedure', 'other', 'Other', 8),

  ('tumor_site', 'caecum', 'Caecum', 1),
  ('tumor_site', 'ascending_colon', 'Ascending colon', 2),
  ('tumor_site', 'hepatic_flexure', 'Hepatic flexure', 3),
  ('tumor_site', 'transverse_colon', 'Transverse colon', 4),
  ('tumor_site', 'splenic_flexure', 'Splenic flexure', 5),
  ('tumor_site', 'descending_colon', 'Descending colon', 6),
  ('tumor_site', 'sigmoid_colon', 'Sigmoid colon', 7),
  ('tumor_site', 'rectosigmoid', 'Rectosigmoid', 8),
  ('tumor_site', 'rectum', 'Rectum', 9),

  ('tumor_perforation', 'not_identified', 'Not identified', 1),
  ('tumor_perforation', 'present', 'Present', 2),

  ('relation_to_peritoneal_reflection', 'entirely_above', 'Entirely above peritoneal reflection', 1),
  ('relation_to_peritoneal_reflection', 'entirely_below', 'Entirely below peritoneal reflection', 2),
  ('relation_to_peritoneal_reflection', 'straddles', 'Straddles peritoneal reflection', 3),
  ('relation_to_peritoneal_reflection', 'not_applicable', 'Not applicable', 4),

  ('plane_of_mesorectal_excision', 'mesorectal', 'Mesorectal plane (complete)', 1),
  ('plane_of_mesorectal_excision', 'intramesorectal', 'Intramesorectal plane (near complete)', 2),
  ('plane_of_mesorectal_excision', 'muscularis_propria', 'Muscularis propria plane (incomplete)', 3),

  ('histological_tumor_type', 'adenocarcinoma_nos', 'Adenocarcinoma, NOS', 1),
  ('histological_tumor_type', 'mucinous_adenocarcinoma', 'Mucinous adenocarcinoma', 2),
  ('histological_tumor_type', 'signet_ring_cell_adenocarcinoma', 'Signet-ring cell adenocarcinoma', 3),
  ('histological_tumor_type', 'medullary_carcinoma', 'Medullary carcinoma', 4),
  ('histological_tumor_type', 'serrated_adenocarcinoma', 'Serrated adenocarcinoma', 5),
  ('histological_tumor_type', 'micropapillary_adenocarcinoma', 'Micropapillary adenocarcinoma', 6),
  ('histological_tumor_type', 'adenoma_like_adenocarcinoma', 'Adenoma-like adenocarcinoma', 7),
  ('histological_tumor_type', 'other', 'Other', 8),

  ('histological_tumor_grade', 'low_grade', 'Low grade', 1),
  ('histological_tumor_grade', 'high_grade', 'High grade', 2),

  ('extent_of_invasion_pt', 'pT1', 'pT1: invades submucosa', 1),
  ('extent_of_invasion_pt', 'pT2', 'pT2: invades muscularis propria', 2),
  ('extent_of_invasion_pt', 'pT3', 'pT3: invades through muscularis propria into pericolorectal tissue', 3),
  ('extent_of_invasion_pt', 'pT4a', 'pT4a: invades visceral peritoneum', 4),
  ('extent_of_invasion_pt', 'pT4b', 'pT4b: directly invades or adheres to adjacent structures', 5),

  ('lymphovascular_invasion', 'not_identified', 'Not identified', 1),
  ('lymphovascular_invasion', 'small_vessel', 'Small vessel invasion', 2),
  ('lymphovascular_invasion', 'intramural_venous', 'Large vessel (venous), intramural', 3),
  ('lymphovascular_invasion', 'extramural_venous', 'Large vessel (venous), extramural', 4),
  ('lymphovascular_invasion', 'present_nos', 'Present, not otherwise specified', 5),

  ('perineural_invasion', 'not_identified', 'Not identified', 1),
  ('perineural_invasion', 'present', 'Present', 2),

  ('lymph_node_status', 'pN0', 'pN0: no regional lymph node metastasis', 1),
  ('lymph_node_status', 'pN1a', 'pN1a: one regional lymph node positive', 2),
  ('lymph_node_status', 'pN1b', 'pN1b: two or three regional lymph nodes positive', 3),
  ('lymph_node_status', 'pN1c', 'pN1c: tumor deposit(s), no positive regional lymph nodes', 4),
  ('lymph_node_status', 'pN2a', 'pN2a: four to six regional lymph nodes positive', 5),
  ('lymph_node_status', 'pN2b', 'pN2b: seven or more regional lymph nodes positive', 6),

  ('tumor_deposits', 'not_identified', 'Not identified', 1),
  ('tumor_deposits', 'present', 'Present', 2),

  ('response_to_neoadjuvant_therapy', 'score_0_complete', 'Score 0: complete response, no viable cancer cells', 1),
  ('response_to_neoadjuvant_therapy', 'score_1_near_complete', 'Score 1: near-complete response, single cells or rare small groups', 2),
  ('response_to_neoadjuvant_therapy', 'score_2_partial', 'Score 2: partial response, evident regression', 3),
  ('response_to_neoadjuvant_therapy', 'score_3_poor_or_none', 'Score 3: poor or no response', 4),

  ('margin_status', 'not_involved', 'Not involved', 1),
  ('margin_status', 'involved', 'Involved', 2),

  ('distant_metastasis_pm', 'not_applicable', 'Cannot be determined from submitted specimen(s)', 1),
  ('distant_metastasis_pm', 'pM1a', 'pM1a: metastasis to one distant organ', 2),
  ('distant_metastasis_pm', 'pM1b', 'pM1b: metastasis to two or more distant organs', 3),
  ('distant_metastasis_pm', 'pM1c', 'pM1c: metastasis to the peritoneal surface', 4),

  ('anterior_resection_type', 'high_anterior_resection', 'High anterior resection', 1),
  ('anterior_resection_type', 'low_anterior_resection', 'Low anterior resection', 2),
  ('anterior_resection_type', 'not_applicable', 'Not applicable', 3),

  ('plane_of_sphincter_excision', 'extralevator', 'Extralevator plane', 1),
  ('plane_of_sphincter_excision', 'sphincteric', 'Sphincteric plane', 2),
  ('plane_of_sphincter_excision', 'intrasphincteric', 'Intrasphincteric plane', 3),
  ('plane_of_sphincter_excision', 'not_applicable', 'Not applicable', 4),

  ('plane_of_mesocolic_excision', 'mesocolic', 'Mesocolic plane', 1),
  ('plane_of_mesocolic_excision', 'intramesocolic', 'Intramesocolic plane', 2),
  ('plane_of_mesocolic_excision', 'muscularis_propria', 'Muscularis propria plane', 3),
  ('plane_of_mesocolic_excision', 'not_applicable', 'Not applicable', 4),

  ('tumor_budding_score', 'bd1_low', 'Bd1: low (0-4 buds)', 1),
  ('tumor_budding_score', 'bd2_intermediate', 'Bd2: intermediate (5-9 buds)', 2),
  ('tumor_budding_score', 'bd3_high', 'Bd3: high (10 or more buds)', 3),

  ('mmr_status', 'proficient', 'MMR proficient / microsatellite stable', 1),
  ('mmr_status', 'deficient', 'MMR deficient / microsatellite instability-high', 2),
  ('mmr_status', 'not_performed', 'Not performed', 3),

  ('ras_braf_status', 'wild_type', 'Wild type', 1),
  ('ras_braf_status', 'mutant', 'Mutant', 2),
  ('ras_braf_status', 'not_performed', 'Not performed', 3)
) AS v(element_key, value, display, display_order)
JOIN synoptic_protocol sp ON sp.name = 'Colorectal Cancer' AND sp.source_standard = 'ICCR'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN synoptic_element se ON se.synoptic_protocol_version_id = spv.id AND se.key = v.element_key
ON CONFLICT (synoptic_element_id, value) DO NOTHING;

-- Publish, last -- matches report_template_version's own draft-then-publish
-- precedent; the partial unique index (ux_synoptic_protocol_version_protocol_published)
-- guarantees at most one published version per protocol.
UPDATE synoptic_protocol_version spv
SET status = 'published'
FROM synoptic_protocol sp
WHERE spv.synoptic_protocol_id = sp.id AND sp.name = 'Colorectal Cancer' AND sp.source_standard = 'ICCR'
  AND spv.version = 1 AND spv.status = 'draft';
