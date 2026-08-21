-- Issue #551/#668 (docs/plans/task-675-breast-biomarker-panel.md).
--
-- Real, cited CAP content -- not placeholder data.
--
-- Source: College of American Pathologists. "Template for Reporting
-- Results of Biomarker Testing of Specimens from Patients with Carcinoma
-- of the Breast," Version 1.6.1.0, Protocol Posting Date June 2025
-- (D:\LIS\research\cap documents\Breast.Bmk_1.6.1.0.-REL_CAPCP.docx),
-- fetched and read in full (its own real CASE SUMMARY text extracted
-- directly from the .docx XML, not summarized/paraphrased) 2026-08-21.
-- Cites ASCO/CAP ER/PgR/HER2 guideline updates (Allison et al. 2020;
-- Wolff et al. 2018, 2023).
--
-- Scoped to the design partner's own real, in-use local template
-- (D:\LIS\research\partner documents\breast cancer biomarkers.docx, also
-- read in full) -- a simplified, real-world derivative of the same CAP
-- structure (ER status/%/intensity, PgR status/%/intensity, HER2 IHC
-- 0/1+/2+/3+), notably with no HER2 ISH section -- a concrete signal
-- this design partner doesn't perform in-house ISH/FISH, used here to
-- scope HER2 ISH as 'recommended' rather than 'required'. Deeply-nested
-- optional sub-branches (heterogeneity clustering, alternative Allred/
-- other scoring systems) are flattened away per task-645's own precedent
-- ("Core elements plus directly-dependent Conditional elements... not
-- required for pilot completeness"), not modeled here.
--
-- isPanel = true (issue #668): this is CAP's own "linked document" shape,
-- not embedded inline -- linked to the existing seeded ICCR "Invasive
-- Carcinoma of the Breast" organ protocol via synoptic_protocol_linked_panel
-- below, reusing #668's mechanism unchanged.

INSERT INTO synoptic_protocol (name, source_standard, specimen_type, is_panel)
SELECT 'Breast Biomarker Panel (ER/PR/HER2)', 'CAP', 'breast', true
WHERE NOT EXISTS (
  SELECT 1 FROM synoptic_protocol WHERE name = 'Breast Biomarker Panel (ER/PR/HER2)' AND source_standard = 'CAP'
);

INSERT INTO synoptic_protocol_version (synoptic_protocol_id, version, status)
SELECT sp.id, 1, 'published'
FROM synoptic_protocol sp
WHERE sp.name = 'Breast Biomarker Panel (ER/PR/HER2)' AND sp.source_standard = 'CAP'
  AND NOT EXISTS (
    SELECT 1 FROM synoptic_protocol_version spv WHERE spv.synoptic_protocol_id = sp.id AND spv.version = 1
  );

INSERT INTO code_system_value (system, code, version, display)
SELECT 'CAP-SYNOPTIC', 'breast_bmk.' || v.key, '1.6.1.0', v.label
FROM (VALUES
  ('er_status', 'Estrogen Receptor (ER) Status'),
  ('er_percentage_positive', 'ER: Percentage of Cells with Nuclear Positivity'),
  ('er_intensity', 'ER: Average Intensity of Staining'),
  ('er_internal_control_status', 'ER: Status of Internal Controls'),
  ('er_comment', 'Comment(s) on ER Result'),
  ('pgr_status', 'Progesterone Receptor (PgR) Status'),
  ('pgr_percentage_positive', 'PgR: Percentage of Cells with Nuclear Positivity'),
  ('pgr_intensity', 'PgR: Average Intensity of Staining'),
  ('pgr_internal_control_status', 'PgR: Status of Internal Controls'),
  ('pgr_comment', 'Comment(s) on PgR Results'),
  ('her2_ihc_score', 'HER2 by Immunohistochemistry (IHC) Status'),
  ('her2_ihc_comment', 'Comment(s) on HER2 IHC'),
  ('her2_ish_performed', 'HER2 by In Situ Hybridization (ISH) Performed'),
  ('her2_ish_result', 'HER2 by In Situ Hybridization (ISH) Status'),
  ('her2_ish_comment', 'Comment(s) on HER2 ISH Result')
) AS v(key, label)
ON CONFLICT (system, code, version) DO NOTHING;

INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT csv.id, csv.display, 'coded', NULL
FROM code_system_value csv
WHERE csv.system = 'CAP-SYNOPTIC' AND csv.version = '1.6.1.0' AND csv.code LIKE 'breast_bmk.%'
ON CONFLICT (code_system_value_id) DO NOTHING;

INSERT INTO synoptic_element (
  synoptic_protocol_version_id, key, label, data_type, requirement, analyte_id, display_order, visibility_condition
)
SELECT spv.id, v.key, v.label, v.data_type, v.requirement, a.id, v.display_order, v.visibility_condition::jsonb
FROM (VALUES
  ('er_status', 'Estrogen Receptor (ER) Status', 'coded', 'required', 1, NULL),
  ('er_percentage_positive', 'Percentage of Cells with Nuclear Positivity (%)', 'quantity', 'recommended', 2,
    '{"field":"er_status","op":"in","value":["positive","low_positive"]}'),
  ('er_intensity', 'Average Intensity of Staining', 'coded', 'recommended', 3,
    '{"field":"er_status","op":"in","value":["positive","low_positive"]}'),
  ('er_internal_control_status', 'Status of Internal Controls', 'coded', 'recommended', 4,
    '{"field":"er_status","op":"in","value":["low_positive","negative"]}'),
  ('er_comment', 'Comment(s) on ER Result', 'text', 'recommended', 5, NULL),

  ('pgr_status', 'Progesterone Receptor (PgR) Status', 'coded', 'required', 6, NULL),
  ('pgr_percentage_positive', 'Percentage of Cells with Nuclear Positivity (%)', 'quantity', 'recommended', 7,
    '{"field":"pgr_status","op":"eq","value":"positive"}'),
  ('pgr_intensity', 'Average Intensity of Staining', 'coded', 'recommended', 8,
    '{"field":"pgr_status","op":"eq","value":"positive"}'),
  ('pgr_internal_control_status', 'Status of Internal Controls', 'coded', 'recommended', 9,
    '{"field":"pgr_status","op":"eq","value":"negative"}'),
  ('pgr_comment', 'Comment(s) on PgR Results', 'text', 'recommended', 10, NULL),

  ('her2_ihc_score', 'HER2 by Immunohistochemistry (IHC) Status', 'coded', 'required', 11, NULL),
  ('her2_ihc_comment', 'Comment(s) on HER2 IHC', 'text', 'recommended', 12, NULL),

  ('her2_ish_performed', 'HER2 by In Situ Hybridization (ISH) Performed', 'coded', 'recommended', 13, NULL),
  ('her2_ish_result', 'HER2 by In Situ Hybridization (ISH) Status', 'coded', 'recommended', 14,
    '{"field":"her2_ish_performed","op":"eq","value":"yes"}'),
  ('her2_ish_comment', 'Comment(s) on HER2 ISH Result', 'text', 'recommended', 15, NULL)
) AS v(key, label, data_type, requirement, display_order, visibility_condition)
JOIN synoptic_protocol sp ON sp.name = 'Breast Biomarker Panel (ER/PR/HER2)' AND sp.source_standard = 'CAP'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN code_system_value csv ON csv.system = 'CAP-SYNOPTIC' AND csv.code = 'breast_bmk.' || v.key AND csv.version = '1.6.1.0'
JOIN analyte a ON a.code_system_value_id = csv.id
ON CONFLICT (synoptic_protocol_version_id, key) DO NOTHING;

INSERT INTO synoptic_element_response_option (synoptic_element_id, code, display, display_order)
SELECT se.id, v.value, v.display, v.display_order
FROM (VALUES
  ('er_status', 'positive', 'Positive (greater than 10% of cells demonstrate nuclear positivity)', 1),
  ('er_status', 'low_positive', 'Low Positive (1-10% of cells with nuclear positivity)', 2),
  ('er_status', 'negative', 'Negative (less than 1%)', 3),
  ('er_status', 'cannot_be_determined', 'Cannot be determined', 4),

  ('er_intensity', 'weak_1plus', 'Weak (1+)', 1),
  ('er_intensity', 'moderate_2plus', 'Moderate (2+)', 2),
  ('er_intensity', 'strong_3plus', 'Strong (3+)', 3),

  ('er_internal_control_status', 'not_applicable', 'Not applicable', 1),
  ('er_internal_control_status', 'present_as_expected', 'Internal control present and stains as expected', 2),
  ('er_internal_control_status', 'absent_external_expected', 'Internal control absent; external controls stain as expected', 3),
  ('er_internal_control_status', 'other', 'Other', 4),

  ('pgr_status', 'positive', 'Positive', 1),
  ('pgr_status', 'negative', 'Negative (less than 1%)', 2),
  ('pgr_status', 'cannot_be_determined', 'Cannot be determined', 3),

  ('pgr_intensity', 'weak_1plus', 'Weak (1+)', 1),
  ('pgr_intensity', 'moderate_2plus', 'Moderate (2+)', 2),
  ('pgr_intensity', 'strong_3plus', 'Strong (3+)', 3),

  ('pgr_internal_control_status', 'not_applicable', 'Not applicable', 1),
  ('pgr_internal_control_status', 'present_as_expected', 'Internal control present and stains as expected', 2),
  ('pgr_internal_control_status', 'absent_external_expected', 'Internal control absent; external controls stain as expected', 3),
  ('pgr_internal_control_status', 'other', 'Other', 4),

  ('her2_ihc_score', 'score_0', 'Negative (Score 0) -- no membrane staining detected', 1),
  ('her2_ihc_score', 'score_1plus', 'Negative (Score 1+) -- incomplete, faint/barely perceptible staining in greater than 10% of tumor cells', 2),
  ('her2_ihc_score', 'score_2plus_equivocal', 'Equivocal (Score 2+)', 3),
  ('her2_ihc_score', 'score_3plus_positive', 'Positive (Score 3+) -- circumferential, complete, intense membrane staining in greater than 10% of tumor cells', 4),

  ('her2_ish_performed', 'yes', 'Yes', 1),
  ('her2_ish_performed', 'no', 'No', 2),

  ('her2_ish_result', 'not_performed', 'Not performed', 1),
  ('her2_ish_result', 'pending', 'Pending', 2),
  ('her2_ish_result', 'negative_group5', 'Negative (not amplified, Group 5: ratio less than 2.0 and less than 4.0 HER2 signals/cell)', 3),
  ('her2_ish_result', 'group2', 'Group 2 (ratio greater than or equal to 2.0 and less than 4.0 HER2 signals/cell)', 4),
  ('her2_ish_result', 'group3', 'Group 3 (ratio less than 2.0 and greater than or equal to 6.0 HER2 signals/cell)', 5),
  ('her2_ish_result', 'group4', 'Group 4 (ratio less than 2.0, 4.0 to less than 6.0 HER2 signals/cell)', 6),
  ('her2_ish_result', 'positive_group1', 'Positive (amplified, Group 1: ratio greater than or equal to 2.0 and greater than or equal to 4.0 HER2 signals/cell, in greater than 10% of cell population)', 7),
  ('her2_ish_result', 'cannot_be_determined', 'Cannot be determined', 8)
) AS v(element_key, value, display, display_order)
JOIN synoptic_protocol sp ON sp.name = 'Breast Biomarker Panel (ER/PR/HER2)' AND sp.source_standard = 'CAP'
JOIN synoptic_protocol_version spv ON spv.synoptic_protocol_id = sp.id AND spv.version = 1
JOIN synoptic_element se ON se.synoptic_protocol_version_id = spv.id AND se.key = v.element_key
ON CONFLICT (synoptic_element_id, code) DO NOTHING;

-- Issue #668: link the panel to the existing ICCR breast organ protocol --
-- reachable from that protocol's own recording page via the "Linked
-- panels" UI, recorded as its own independent response.
INSERT INTO synoptic_protocol_linked_panel (organ_protocol_id, panel_protocol_id)
SELECT organ.id, panel.id
FROM synoptic_protocol organ, synoptic_protocol panel
WHERE organ.name = 'Invasive Carcinoma of the Breast' AND organ.source_standard = 'ICCR'
  AND panel.name = 'Breast Biomarker Panel (ER/PR/HER2)' AND panel.source_standard = 'CAP'
  AND NOT EXISTS (
    SELECT 1 FROM synoptic_protocol_linked_panel lp
    WHERE lp.organ_protocol_id = organ.id AND lp.panel_protocol_id = panel.id
  );
