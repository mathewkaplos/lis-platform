-- Issue #667 (docs/plans/task-667-synoptic-concept-block-library.md).
--
-- The first reusable concept block: Regional Lymph Nodes. Two real,
-- structurally divergent variants -- proof of the issue's own central
-- finding, not fabricated content:
--   - ICCR variant: the exact 6-option pN0-pN2b flat coded field already
--     real and cited in synoptic-protocol-colorectal.sql's own
--     lymph_node_status element.
--   - CAP variant: the exact 4-field structure (status + two lymph-node
--     counts + pN category, with real conditional visibility) already
--     real and cited in synoptic-protocol-prostate.sql.
--
-- Both variants reuse the SAME analyte rows the original protocols already
-- created (looked up via their existing code_system_value entries, not
-- re-inserted) -- one canonical clinical concept per real question,
-- regardless of which protocol or block recorded it, matching
-- analyteId NOT NULL's own "queryable like every other discrete result"
-- rationale (FEAT-058 proposal §5/§10 Q4).
--
-- Existing colorectal/prostate protocol content is untouched -- this seeds
-- the library only; re-pointing those protocols at it is out of scope
-- for this issue (§7 of the proposal).

INSERT INTO concept_block (key, name)
SELECT 'regional_lymph_nodes', 'Regional Lymph Nodes'
WHERE NOT EXISTS (SELECT 1 FROM concept_block WHERE key = 'regional_lymph_nodes');

-- ICCR variant -- colorectal's own real flat pN0-pN2b field.
INSERT INTO concept_block_version (concept_block_id, source_standard, version, status)
SELECT cb.id, 'ICCR', 1, 'published'
FROM concept_block cb
WHERE cb.key = 'regional_lymph_nodes'
  AND NOT EXISTS (
    SELECT 1 FROM concept_block_version cbv
    WHERE cbv.concept_block_id = cb.id AND cbv.source_standard = 'ICCR'
  );

INSERT INTO concept_block_element (
  concept_block_version_id, key, label, data_type, requirement, analyte_id, display_order
)
SELECT cbv.id, 'lymph_node_status', 'Lymph node status (pN)', 'coded', 'required', a.id, 1
FROM concept_block cb
JOIN concept_block_version cbv ON cbv.concept_block_id = cb.id AND cbv.source_standard = 'ICCR'
JOIN code_system_value csv ON csv.system = 'ICCR-SYNOPTIC' AND csv.code = 'colorectal.lymph_node_status' AND csv.version = '2022'
JOIN analyte a ON a.code_system_value_id = csv.id
WHERE cb.key = 'regional_lymph_nodes'
ON CONFLICT (concept_block_version_id, key) DO NOTHING;

INSERT INTO concept_block_element_response_option (concept_block_element_id, code, display, display_order)
SELECT cbe.id, v.code, v.display, v.display_order
FROM (VALUES
  ('pN0', 'pN0: no regional lymph node metastasis', 1),
  ('pN1a', 'pN1a: one regional lymph node positive', 2),
  ('pN1b', 'pN1b: two or three regional lymph nodes positive', 3),
  ('pN1c', 'pN1c: tumor deposit(s), no positive regional lymph nodes', 4),
  ('pN2a', 'pN2a: four to six regional lymph nodes positive', 5),
  ('pN2b', 'pN2b: seven or more regional lymph nodes positive', 6)
) AS v(code, display, display_order)
JOIN concept_block cb ON cb.key = 'regional_lymph_nodes'
JOIN concept_block_version cbv ON cbv.concept_block_id = cb.id AND cbv.source_standard = 'ICCR'
JOIN concept_block_element cbe ON cbe.concept_block_version_id = cbv.id AND cbe.key = 'lymph_node_status'
ON CONFLICT (concept_block_element_id, code) DO NOTHING;

-- CAP variant -- prostate's own real 4-field structure, including its real
-- conditional visibility (number_of_lymph_nodes_* only visible once status
-- is answered).
INSERT INTO concept_block_version (concept_block_id, source_standard, version, status)
SELECT cb.id, 'CAP', 1, 'published'
FROM concept_block cb
WHERE cb.key = 'regional_lymph_nodes'
  AND NOT EXISTS (
    SELECT 1 FROM concept_block_version cbv
    WHERE cbv.concept_block_id = cb.id AND cbv.source_standard = 'CAP'
  );

INSERT INTO concept_block_element (
  concept_block_version_id, key, label, data_type, requirement, analyte_id, display_order, visibility_condition
)
SELECT cbv.id, v.key, v.label, v.data_type, v.requirement, a.id, v.display_order, v.visibility_condition::jsonb
FROM (VALUES
  ('regional_lymph_node_status', 'Regional lymph node status', 'coded', 'required', 1, NULL),
  ('number_of_lymph_nodes_with_tumor', 'Number of lymph nodes with tumor', 'quantity', 'recommended', 2,
    '{"field":"regional_lymph_node_status","op":"eq","value":"tumor_present"}'),
  ('number_of_lymph_nodes_examined', 'Number of lymph nodes examined', 'quantity', 'recommended', 3,
    '{"field":"regional_lymph_node_status","op":"in","value":["all_negative","tumor_present"]}'),
  ('pathological_stage_pn', 'Pathological N category (pN)', 'coded', 'required', 4, NULL)
) AS v(key, label, data_type, requirement, display_order, visibility_condition)
JOIN concept_block cb ON cb.key = 'regional_lymph_nodes'
JOIN concept_block_version cbv ON cbv.concept_block_id = cb.id AND cbv.source_standard = 'CAP'
JOIN code_system_value csv ON csv.system = 'CAP-SYNOPTIC' AND csv.code = 'prostate.' || v.key AND csv.version = '4.3.0.0'
JOIN analyte a ON a.code_system_value_id = csv.id
ON CONFLICT (concept_block_version_id, key) DO NOTHING;

INSERT INTO concept_block_element_response_option (concept_block_element_id, code, display, display_order)
SELECT cbe.id, v.code, v.display, v.display_order
FROM (VALUES
  ('regional_lymph_node_status', 'not_applicable', 'Not applicable (no regional lymph nodes submitted or found)', 1),
  ('regional_lymph_node_status', 'all_negative', 'Regional lymph nodes present, all negative for tumor', 2),
  ('regional_lymph_node_status', 'tumor_present', 'Tumor present in regional lymph node(s)', 3),
  ('pathological_stage_pn', 'pn_not_assigned_no_nodes', 'pN not assigned (no nodes submitted or found)', 1),
  ('pathological_stage_pn', 'pn_not_assigned_cannot_determine', 'pN not assigned (cannot be determined)', 2),
  ('pathological_stage_pn', 'pN0', 'pN0: No positive regional nodes', 3),
  ('pathological_stage_pn', 'pN1', 'pN1: Metastasis in regional nodes', 4)
) AS v(element_key, code, display, display_order)
JOIN concept_block cb ON cb.key = 'regional_lymph_nodes'
JOIN concept_block_version cbv ON cbv.concept_block_id = cb.id AND cbv.source_standard = 'CAP'
JOIN concept_block_element cbe ON cbe.concept_block_version_id = cbv.id AND cbe.key = v.element_key
ON CONFLICT (concept_block_element_id, code) DO NOTHING;
