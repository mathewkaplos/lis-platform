-- Issue #645 (docs/plans/task-645-prostate-lung-synoptic-pilot.md), pilot #2 of
-- FEAT-058's synoptic-protocol library expansion (companion to
-- synoptic-protocol-prostate.sql, this session).
--
-- Real, cited CAP content -- not placeholder data.
--
-- Source: College of American Pathologists. "Protocol for the Examination
-- of Specimens From Patients With Primary Non-Small Cell Carcinoma,
-- Small Cell Carcinoma, or Carcinoid Tumor of the Lung", Version 5.1.0.0,
-- REL_CAPCP. Real document
-- (D:\LIS\research\cap documents\Lung_5.1.0.0.REL_CAPCP.docx), fetched and
-- read in full (its own real CASE SUMMARY text extracted directly from the
-- .docx XML, not summarized/paraphrased) 2026-08-20. AJCC 9th edition
-- staging.
--
-- Per proposal §5.5/§10 Q1 (approved): deeply nested conditional
-- sub-branches flattened to their own top-level elements with a
-- visibilityCondition on the relevant parent selection(s). Per the
-- proposal's own explicit pilot-scope carve-out (Core elements plus their
-- own directly-dependent Conditional elements at minimum -- Optional
-- ("+"-prefixed) elements not required for pilot completeness): the real
-- document's own entirely-Optional per-metastasis-type count sub-fields
-- under Tumor Focality, the full 30+-option nodal-station checklist (kept
-- here as a real but trimmed `coded_multi` set covering the clinically
-- common stations, not the document's own exhaustive right/central/left
-- breakdown), and the granular Direct Invasion "Involved Other Structures"
-- 20+-option list (trimmed to the clinically common subset) are simplified
-- -- a real, deliberate scope cut consistent with Prostate's own.
--
-- 15 required (Core) + 10 recommended (Conditional/directly-dependent)
-- elements = 25 total. `procedure`, `tumor_site`, `involved_other_structures`,
-- and `nodal_stations_involved` use the new `coded_multi` data type (issue
-- #645) -- all four are real "select all that apply" questions in the
-- source document.

INSERT INTO synoptic_protocol (name, source_standard, specimen_type)
SELECT 'Primary Non-Small Cell Carcinoma, Small Cell Carcinoma, or Carcinoid Tumor of the Lung', 'CAP', 'lung'
WHERE NOT EXISTS (
  SELECT 1 FROM synoptic_protocol WHERE name = 'Primary Non-Small Cell Carcinoma, Small Cell Carcinoma, or Carcinoid Tumor of the Lung' AND source_standard = 'CAP'
);

INSERT INTO synoptic_protocol_version (synoptic_protocol_id, version, status)
SELECT sp.id, 1, 'draft'
FROM synoptic_protocol sp
WHERE sp.name = 'Primary Non-Small Cell Carcinoma, Small Cell Carcinoma, or Carcinoid Tumor of the Lung' AND sp.source_standard = 'CAP'
  AND NOT EXISTS (
    SELECT 1 FROM synoptic_protocol_version spv WHERE spv.synoptic_protocol_id = sp.id AND spv.version = 1
  );

INSERT INTO code_system_value (system, code, version, display)
SELECT 'CAP-SYNOPTIC', 'lung.' || v.key, '5.1.0.0', v.label
FROM (VALUES
  ('procedure', 'Procedure'),
  ('specimen_laterality', 'Specimen laterality'),
  ('tumor_focality', 'Tumor focality'),
  ('tumor_site', 'Tumor site'),
  ('invasive_tumor_size_cm', 'Invasive tumor size'),
  ('total_tumor_size_cm', 'Total tumor size'),
  ('size_in_situ_carcinoma_cm', 'Size of in situ carcinoma'),
  ('histologic_type', 'Histologic type'),
  ('histologic_grade', 'Histologic grade'),
  ('spread_through_air_spaces', 'Spread through air spaces (STAS)'),
  ('visceral_pleura_invasion', 'Visceral pleura invasion'),
  ('direct_invasion_other_structures', 'Direct invasion of other structures'),
  ('involved_other_structures', 'Involved other structures'),
  ('treatment_effect', 'Treatment effect'),
  ('percentage_residual_viable_tumor', 'Percentage of residual viable tumor'),
  ('lymphatic_vascular_invasion', 'Lymphatic and/or vascular invasion'),
  ('margin_status_invasive', 'Margin status for invasive tumor'),
  ('distance_to_closest_margin_cm', 'Distance from invasive tumor to closest margin'),
  ('margin_status_noninvasive', 'Margin status for non-invasive tumor'),
  ('regional_lymph_node_status', 'Regional lymph node status'),
  ('number_of_lymph_nodes_with_tumor', 'Number of lymph nodes with tumor'),
  ('nodal_stations_involved', 'Nodal station(s) involved'),
  ('pathological_stage_pt', 'Pathological T category (pT)'),
  ('pathological_stage_pn', 'Pathological N category (pN)'),
  ('comment', 'Comment')
) AS v(key, label)
ON CONFLICT (system, code, version) DO NOTHING;

INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT csv.id, csv.display, 'coded', NULL
FROM code_system_value csv
WHERE csv.system = 'CAP-SYNOPTIC' AND csv.version = '5.1.0.0' AND csv.code LIKE 'lung.%'
ON CONFLICT (code_system_value_id) DO NOTHING;

INSERT INTO synoptic_element (
  synoptic_protocol_version_id, key, label, data_type, requirement, analyte_id, display_order, visibility_condition
)
SELECT spv.id, v.key, v.label, v.data_type, v.requirement, a.id, v.display_order, v.visibility_condition::jsonb
FROM (VALUES
  ('procedure', 'Procedure', 'coded_multi', 'required', 1, NULL),
  ('specimen_laterality', 'Specimen laterality', 'coded', 'required', 2, NULL),
  ('tumor_focality', 'Tumor focality', 'coded', 'required', 3, NULL),
  ('tumor_site', 'Tumor site', 'coded_multi', 'required', 4, NULL),
  ('invasive_tumor_size_cm', 'Invasive tumor size (cm)', 'quantity', 'recommended', 5, NULL),
  ('total_tumor_size_cm', 'Total tumor size (cm)', 'quantity', 'recommended', 6, NULL),
  ('size_in_situ_carcinoma_cm', 'Size of in situ carcinoma (cm)', 'quantity', 'recommended', 7, NULL),
  ('histologic_type', 'Histologic type', 'coded', 'required', 8, NULL),
  ('histologic_grade', 'Histologic grade', 'coded', 'recommended', 9, NULL),
  ('spread_through_air_spaces', 'Spread through air spaces (STAS)', 'coded', 'required', 10, NULL),
  ('visceral_pleura_invasion', 'Visceral pleura invasion', 'coded', 'required', 11, NULL),
  ('direct_invasion_other_structures', 'Direct invasion of other structures', 'coded', 'required', 12, NULL),
  ('involved_other_structures', 'Involved other structures', 'coded_multi', 'recommended', 13,
    '{"field":"direct_invasion_other_structures","op":"eq","value":"present"}'),
  ('treatment_effect', 'Treatment effect', 'coded', 'required', 14, NULL),
  ('percentage_residual_viable_tumor', 'Percentage of residual viable tumor (%)', 'quantity', 'recommended', 15,
    '{"field":"treatment_effect","op":"eq","value":"present"}'),
  ('lymphatic_vascular_invasion', 'Lymphatic and/or vascular invasion', 'coded', 'required', 16, NULL),
  ('margin_status_invasive', 'Margin status for invasive tumor', 'coded', 'required', 17, NULL),
  ('distance_to_closest_margin_cm', 'Distance from invasive tumor to closest margin (cm)', 'quantity', 'recommended', 18,
    '{"field":"margin_status_invasive","op":"eq","value":"all_negative"}'),
  ('margin_status_noninvasive', 'Margin status for non-invasive tumor', 'coded', 'recommended', 19, NULL),
  ('regional_lymph_node_status', 'Regional lymph node status', 'coded', 'required', 20, NULL),
  ('number_of_lymph_nodes_with_tumor', 'Number of lymph nodes with tumor', 'quantity', 'recommended', 21,
    '{"field":"regional_lymph_node_status","op":"eq","value":"tumor_present"}'),
  ('nodal_stations_involved', 'Nodal station(s) involved', 'coded_multi', 'recommended', 22,
    '{"field":"regional_lymph_node_status","op":"eq","value":"tumor_present"}'),
  ('pathological_stage_pt', 'Pathological T category (pT)', 'coded', 'required', 23, NULL),
  ('pathological_stage_pn', 'Pathological N category (pN)', 'coded', 'required', 24, NULL),
  ('comment', 'Comment', 'text', 'recommended', 25, NULL)
) AS v(key, label, data_type, requirement, display_order, visibility_condition)
JOIN synoptic_protocol sp ON sp.name = 'Primary Non-Small Cell Carcinoma, Small Cell Carcinoma, or Carcinoid Tumor of the Lung' AND sp.source_standard = 'CAP'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN code_system_value csv ON csv.system = 'CAP-SYNOPTIC' AND csv.code = 'lung.' || v.key AND csv.version = '5.1.0.0'
JOIN analyte a ON a.code_system_value_id = csv.id
ON CONFLICT (synoptic_protocol_version_id, key) DO NOTHING;

INSERT INTO synoptic_element_response_option (synoptic_element_id, code, display, display_order)
SELECT se.id, v.value, v.display, v.display_order
FROM (VALUES
  ('procedure', 'wedge_resection', 'Wedge resection', 1),
  ('procedure', 'segmentectomy', 'Segmentectomy', 2),
  ('procedure', 'lobectomy', 'Lobectomy', 3),
  ('procedure', 'completion_lobectomy', 'Completion lobectomy', 4),
  ('procedure', 'sleeve_lobectomy', 'Sleeve lobectomy', 5),
  ('procedure', 'bilobectomy', 'Bilobectomy', 6),
  ('procedure', 'pneumonectomy', 'Pneumonectomy', 7),
  ('procedure', 'major_airway_resection', 'Major airway resection', 8),
  ('procedure', 'adjacent_structures', 'Adjacent structures', 9),
  ('procedure', 'other', 'Other', 10),
  ('procedure', 'not_specified', 'Not specified', 11),

  ('specimen_laterality', 'right', 'Right', 1),
  ('specimen_laterality', 'left', 'Left', 2),
  ('specimen_laterality', 'not_specified', 'Not specified', 3),

  ('tumor_focality', 'single_focus', 'Single focus', 1),
  ('tumor_focality', 'separate_nodules_same_lobe', 'Separate tumor nodules (metastases) in same lobe (pT3)', 2),
  ('tumor_focality', 'separate_nodules_different_ipsilateral_lobe', 'Separate tumor nodules (metastases) in different ipsilateral lobe (pT4)', 3),
  ('tumor_focality', 'separate_nodules_contralateral_lobe', 'Separate tumor nodules (metastases) in a contralateral lobe (pM1a)', 4),
  ('tumor_focality', 'multifocal_nodules_similar_histology', 'Multifocal tumor nodules of similar histology type', 5),
  ('tumor_focality', 'pneumonic_type_adenocarcinoma', 'Pneumonic-type adenocarcinoma', 6),
  ('tumor_focality', 'other', 'Other', 7),
  ('tumor_focality', 'cannot_be_determined', 'Cannot be determined', 8),

  ('tumor_site', 'upper_lobe', 'Upper lobe of lung', 1),
  ('tumor_site', 'middle_lobe', 'Middle lobe of lung', 2),
  ('tumor_site', 'lower_lobe', 'Lower lobe of lung', 3),
  ('tumor_site', 'bronchus_main', 'Bronchus, main', 4),
  ('tumor_site', 'bronchus_intermedius', 'Bronchus intermedius', 5),
  ('tumor_site', 'bronchus_lobar', 'Bronchus, lobar', 6),
  ('tumor_site', 'other', 'Other', 7),
  ('tumor_site', 'not_specified', 'Not specified', 8),

  ('histologic_type', 'ais_non_mucinous', 'Adenocarcinoma in situ (AIS), non-mucinous', 1),
  ('histologic_type', 'ais_mucinous', 'Adenocarcinoma in situ (AIS), mucinous', 2),
  ('histologic_type', 'mia_non_mucinous', 'Minimally invasive adenocarcinoma, non-mucinous', 3),
  ('histologic_type', 'mia_mucinous', 'Minimally invasive adenocarcinoma, mucinous', 4),
  ('histologic_type', 'invasive_lepidic_adenocarcinoma', 'Invasive lepidic adenocarcinoma', 5),
  ('histologic_type', 'invasive_acinar_adenocarcinoma', 'Invasive acinar adenocarcinoma', 6),
  ('histologic_type', 'invasive_papillary_adenocarcinoma', 'Invasive papillary adenocarcinoma', 7),
  ('histologic_type', 'invasive_micropapillary_adenocarcinoma', 'Invasive micropapillary adenocarcinoma', 8),
  ('histologic_type', 'invasive_solid_adenocarcinoma', 'Invasive solid adenocarcinoma', 9),
  ('histologic_type', 'invasive_mucinous_adenocarcinoma', 'Invasive mucinous adenocarcinoma', 10),
  ('histologic_type', 'mixed_invasive_mucinous_and_nonmucinous', 'Mixed invasive mucinous and non-mucinous adenocarcinoma', 11),
  ('histologic_type', 'colloid_adenocarcinoma', 'Colloid adenocarcinoma', 12),
  ('histologic_type', 'fetal_adenocarcinoma', 'Fetal adenocarcinoma', 13),
  ('histologic_type', 'enteric_type_adenocarcinoma', 'Enteric-type adenocarcinoma', 14),
  ('histologic_type', 'scis', 'Squamous cell carcinoma in situ (SCIS)', 15),
  ('histologic_type', 'invasive_squamous_keratinizing', 'Invasive squamous cell carcinoma, keratinizing', 16),
  ('histologic_type', 'invasive_squamous_non_keratinizing', 'Invasive squamous cell carcinoma, non-keratinizing', 17),
  ('histologic_type', 'invasive_squamous_basaloid', 'Invasive squamous cell carcinoma, basaloid', 18),
  ('histologic_type', 'lymphoepithelial_carcinoma', 'Lymphoepithelial carcinoma', 19),
  ('histologic_type', 'large_cell_carcinoma', 'Large cell carcinoma', 20),
  ('histologic_type', 'adenosquamous_carcinoma', 'Adenosquamous carcinoma', 21),
  ('histologic_type', 'pleomorphic_carcinoma', 'Pleomorphic carcinoma', 22),
  ('histologic_type', 'nut_carcinoma', 'NUT carcinoma', 23),
  ('histologic_type', 'smarca4_deficient', 'Thoracic SMARCA4-deficient undifferentiated tumor', 24),
  ('histologic_type', 'adenoid_cystic_carcinoma', 'Adenoid cystic carcinoma', 25),
  ('histologic_type', 'mucoepidermoid_carcinoma', 'Mucoepidermoid carcinoma', 26),
  ('histologic_type', 'typical_carcinoid', 'Typical carcinoid / Neuroendocrine tumor, grade 1', 27),
  ('histologic_type', 'atypical_carcinoid', 'Atypical carcinoid / Neuroendocrine tumor, grade 2', 28),
  ('histologic_type', 'carcinoid_nos', 'Carcinoid tumor, NOS / Neuroendocrine tumor, NOS', 29),
  ('histologic_type', 'small_cell_carcinoma', 'Small cell carcinoma', 30),
  ('histologic_type', 'large_cell_neuroendocrine_carcinoma', 'Large cell neuroendocrine carcinoma', 31),
  ('histologic_type', 'cannot_be_determined', 'Carcinoma, type cannot be determined', 32),
  ('histologic_type', 'other', 'Other histologic type not listed', 33),

  ('histologic_grade', 'g1_well_differentiated', 'G1, well-differentiated', 1),
  ('histologic_grade', 'g2_moderately_differentiated', 'G2, moderately differentiated', 2),
  ('histologic_grade', 'g3_poorly_differentiated', 'G3, poorly differentiated', 3),
  ('histologic_grade', 'g4_undifferentiated', 'G4, undifferentiated', 4),
  ('histologic_grade', 'gx_cannot_be_assessed', 'GX, cannot be assessed', 5),
  ('histologic_grade', 'not_applicable', 'Not applicable', 6),
  ('histologic_grade', 'other', 'Other', 7),

  ('spread_through_air_spaces', 'not_identified', 'Not identified', 1),
  ('spread_through_air_spaces', 'present', 'Present', 2),
  ('spread_through_air_spaces', 'cannot_be_determined', 'Cannot be determined', 3),
  ('spread_through_air_spaces', 'not_applicable', 'Not applicable', 4),

  ('visceral_pleura_invasion', 'not_identified', 'Not identified', 1),
  ('visceral_pleura_invasion', 'present', 'Present', 2),
  ('visceral_pleura_invasion', 'cannot_be_determined', 'Cannot be determined', 3),

  ('direct_invasion_other_structures', 'not_applicable', 'Not applicable (no other structures present)', 1),
  ('direct_invasion_other_structures', 'not_identified', 'Not identified', 2),
  ('direct_invasion_other_structures', 'present', 'Present', 3),

  ('involved_other_structures', 'adjacent_lobe', 'Adjacent lobe of lung', 1),
  ('involved_other_structures', 'parietal_pleura', 'Parietal pleura', 2),
  ('involved_other_structures', 'chest_wall', 'Chest wall', 3),
  ('involved_other_structures', 'main_bronchus', 'Main bronchus (up to but not including the carina)', 4),
  ('involved_other_structures', 'hilar_soft_tissues', 'Hilar soft tissues', 5),
  ('involved_other_structures', 'phrenic_nerve', 'Phrenic nerve', 6),
  ('involved_other_structures', 'pericardium_parietal', 'Parietal pericardium', 7),
  ('involved_other_structures', 'pericardium_visceral', 'Visceral pericardium (epicardium)', 8),
  ('involved_other_structures', 'diaphragm', 'Diaphragm', 9),
  ('involved_other_structures', 'heart', 'Heart', 10),
  ('involved_other_structures', 'great_vessels', 'Great vessels (aorta, superior/inferior vena cava, intrapericardial pulmonary arteries/veins)', 11),
  ('involved_other_structures', 'trachea', 'Trachea', 12),
  ('involved_other_structures', 'carina', 'Carina', 13),
  ('involved_other_structures', 'esophagus', 'Esophagus', 14),
  ('involved_other_structures', 'other', 'Other (including mediastinal structures not listed above)', 15),
  ('involved_other_structures', 'cannot_be_determined', 'Cannot be determined', 16),

  ('treatment_effect', 'no_known_presurgical_therapy', 'No known presurgical therapy', 1),
  ('treatment_effect', 'not_identified', 'Not identified', 2),
  ('treatment_effect', 'present', 'Present', 3),
  ('treatment_effect', 'other', 'Other', 4),
  ('treatment_effect', 'cannot_be_determined', 'Cannot be determined', 5),

  ('lymphatic_vascular_invasion', 'not_identified', 'Not identified', 1),
  ('lymphatic_vascular_invasion', 'present', 'Present', 2),
  ('lymphatic_vascular_invasion', 'cannot_be_determined', 'Cannot be determined', 3),

  ('margin_status_invasive', 'all_negative', 'All margins negative for invasive tumor', 1),
  ('margin_status_invasive', 'invasive_tumor_present', 'Invasive tumor present at margin', 2),
  ('margin_status_invasive', 'not_applicable', 'Not applicable', 3),

  ('margin_status_noninvasive', 'all_negative', 'All margins negative for non-invasive tumor', 1),
  ('margin_status_noninvasive', 'cis_present_bronchial', 'Carcinoma in situ present at bronchial margin', 2),
  ('margin_status_noninvasive', 'cis_present_parenchymal', 'Carcinoma in situ present at parenchymal margin', 3),
  ('margin_status_noninvasive', 'lepidic_present_parenchymal', 'Lepidic component of invasive carcinoma present at parenchymal margin', 4),
  ('margin_status_noninvasive', 'other', 'Other', 5),
  ('margin_status_noninvasive', 'cannot_be_determined', 'Cannot be determined', 6),
  ('margin_status_noninvasive', 'not_applicable', 'Not applicable', 7),

  ('regional_lymph_node_status', 'not_applicable', 'Not applicable (no regional lymph nodes submitted or found)', 1),
  ('regional_lymph_node_status', 'all_negative', 'Regional lymph nodes present, all negative for tumor', 2),
  ('regional_lymph_node_status', 'tumor_present', 'Tumor present in regional lymph node(s)', 3),

  ('nodal_stations_involved', 'station_1r', '1R: Low cervical, supraclavicular, scalene and sternal notch', 1),
  ('nodal_stations_involved', 'station_2r', '2R: Upper paratracheal', 2),
  ('nodal_stations_involved', 'station_4r', '4R: Lower paratracheal', 3),
  ('nodal_stations_involved', 'station_8r', '8R: Para-esophageal (below carina)', 4),
  ('nodal_stations_involved', 'station_9r', '9R: Pulmonary ligament', 5),
  ('nodal_stations_involved', 'station_10r', '10R: Hilar', 6),
  ('nodal_stations_involved', 'station_11r', '11R: Interlobar', 7),
  ('nodal_stations_involved', 'station_3a', '3a: Pre-vascular', 8),
  ('nodal_stations_involved', 'station_3p', '3p: Retrotracheal', 9),
  ('nodal_stations_involved', 'station_7', '7: Subcarinal', 10),
  ('nodal_stations_involved', 'station_1l', '1L: Low cervical, supraclavicular, scalene and sternal notch', 11),
  ('nodal_stations_involved', 'station_2l', '2L: Upper paratracheal', 12),
  ('nodal_stations_involved', 'station_4l', '4L: Lower paratracheal', 13),
  ('nodal_stations_involved', 'station_5', '5: Subaortic / aortopulmonary (AP) / AP window', 14),
  ('nodal_stations_involved', 'station_6', '6: Para-aortic (ascending aorta or phrenic)', 15),
  ('nodal_stations_involved', 'station_10l', '10L: Hilar', 16),
  ('nodal_stations_involved', 'other', 'Other node(s)', 17),

  ('pathological_stage_pt', 'pT_not_assigned', 'pT not assigned (cannot be determined based on available pathological information)', 1),
  ('pathological_stage_pt', 'pT0', 'pT0: No evidence of primary tumor', 2),
  ('pathological_stage_pt', 'pTis', 'pTis: Carcinoma in situ', 3),
  ('pathological_stage_pt', 'pT1mi', 'pT1mi: Minimally invasive adenocarcinoma', 4),
  ('pathological_stage_pt', 'pT1a', 'pT1a: Tumor <= 1 cm in greatest dimension', 5),
  ('pathological_stage_pt', 'pT1b', 'pT1b: Tumor > 1 cm but <= 2 cm in greatest dimension', 6),
  ('pathological_stage_pt', 'pT1c', 'pT1c: Tumor > 2 cm but <= 3 cm in greatest dimension', 7),
  ('pathological_stage_pt', 'pT1_subgroup_cannot_be_determined', 'pT1 (subgroup cannot be determined)', 8),
  ('pathological_stage_pt', 'pT2a', 'pT2a: Tumor > 3 cm but <= 4 cm in greatest dimension', 9),
  ('pathological_stage_pt', 'pT2b', 'pT2b: Tumor > 4 cm but <= 5 cm in greatest dimension', 10),
  ('pathological_stage_pt', 'pT2_subgroup_cannot_be_determined', 'pT2 (subgroup cannot be determined)', 11),
  ('pathological_stage_pt', 'pT3', 'pT3: Tumor > 5 cm but <= 7 cm in greatest dimension, or with other T3 features', 12),
  ('pathological_stage_pt', 'pT4', 'pT4: Tumor > 7 cm in greatest dimension, or with other T4 features', 13),

  ('pathological_stage_pn', 'pn_not_assigned_no_nodes', 'pN not assigned (no nodes submitted or found)', 1),
  ('pathological_stage_pn', 'pn_not_assigned_cannot_determine', 'pN not assigned (cannot be determined)', 2),
  ('pathological_stage_pn', 'pN0', 'pN0: No tumor involvement of regional lymph node(s)', 3),
  ('pathological_stage_pn', 'pN1', 'pN1: Tumor involvement of ipsilateral peribronchial and/or hilar and/or intrapulmonary lymph node station(s)', 4),
  ('pathological_stage_pn', 'pN2a', 'pN2a: Tumor involvement of a single ipsilateral mediastinal or subcarinal nodal station', 5),
  ('pathological_stage_pn', 'pN2b', 'pN2b: Tumor involvement of multiple ipsilateral mediastinal nodal stations', 6),
  ('pathological_stage_pn', 'pN2_subgroup_cannot_be_determined', 'pN2 (subgroup cannot be determined)', 7),
  ('pathological_stage_pn', 'pN3', 'pN3: Tumor involvement of contralateral mediastinal, contralateral hilar, or scalene/supraclavicular lymph node station(s)', 8)
) AS v(element_key, value, display, display_order)
JOIN synoptic_protocol sp ON sp.name = 'Primary Non-Small Cell Carcinoma, Small Cell Carcinoma, or Carcinoid Tumor of the Lung' AND sp.source_standard = 'CAP'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN synoptic_element se ON se.synoptic_protocol_version_id = spv.id AND se.key = v.element_key
ON CONFLICT (synoptic_element_id, code) DO NOTHING;

UPDATE synoptic_protocol_version spv
SET status = 'published'
FROM synoptic_protocol sp
WHERE spv.synoptic_protocol_id = sp.id AND sp.name = 'Primary Non-Small Cell Carcinoma, Small Cell Carcinoma, or Carcinoid Tumor of the Lung' AND sp.source_standard = 'CAP'
  AND spv.version = 1 AND spv.status = 'draft';
