-- Issue #670 (docs/plans/task-670-synoptic-response-option-terminology-binding.md).
--
-- Binds real, already-seeded colorectal `histological_tumor_type` response
-- options to their real ICD-O-3 morphology codes -- a long-established,
-- stable WHO/IARC classification, not fabricated. Genuinely optional/
-- opportunistic per the issue's own instruction: only the options with an
-- unambiguous, well-established ICD-O-3 code are bound here
-- (serrated/micropapillary/adenoma-like/other are left unbound, not a
-- gap to chase).
--
-- A separate seed file, not an edit to synoptic-protocol-colorectal.sql --
-- preserves that file's own already-reviewed authoring history; this is
-- purely additive metadata on top of it, must run after it.

INSERT INTO code_system_value (system, code, version, display)
SELECT 'ICD-O-3', v.code, '3', v.display
FROM (VALUES
  ('8140/3', 'Adenocarcinoma, NOS'),
  ('8480/3', 'Mucinous adenocarcinoma'),
  ('8490/3', 'Signet ring cell carcinoma'),
  ('8510/3', 'Medullary carcinoma, NOS')
) AS v(code, display)
ON CONFLICT (system, code, version) DO NOTHING;

UPDATE synoptic_element_response_option sero
SET code_system_value_id = csv.id
FROM synoptic_element se, synoptic_protocol_version spv, synoptic_protocol sp,
     code_system_value csv,
     (VALUES
       ('adenocarcinoma_nos', '8140/3'),
       ('mucinous_adenocarcinoma', '8480/3'),
       ('signet_ring_cell_adenocarcinoma', '8490/3'),
       ('medullary_carcinoma', '8510/3')
     ) AS mapping(option_value, icdo_code)
WHERE sero.synoptic_element_id = se.id
  AND se.synoptic_protocol_version_id = spv.id
  AND spv.synoptic_protocol_id = sp.id
  AND sp.name = 'Colorectal Cancer' AND sp.source_standard = 'ICCR'
  AND se.key = 'histological_tumor_type'
  AND sero.code = mapping.option_value
  AND csv.system = 'ICD-O-3' AND csv.code = mapping.icdo_code AND csv.version = '3';
