-- FEAT-058 (docs/plans/feat-058-generic-synoptic-protocol-engine.md, ADR-0050).
--
-- The single, shared table-typed analyte every protocol's grid Observation
-- attaches to (synoptic-response-recorder.ts's own SYNOPTIC_GRID_CODE),
-- mirroring FEAT-053's own single "Antibiogram (MIC)" analyte reused
-- regardless of which organism -- ADR-0050 §Decision 4's "one writer for
-- every protocol" applies equally to the analyte it writes the grid under.
--
-- Internal identifier, not a claimed LOINC/SNOMED binding -- real coding-
-- system mapping for the grid concept itself is deferred, not fabricated
-- here (proposal §5/§10).
--
-- Must run before synoptic-protocol-breast.sql / synoptic-protocol-
-- colorectal.sql in any seed sequence (scripts/db-reset.sh, pr.yml).

INSERT INTO code_system_value (system, code, version, display) VALUES
  ('ICCR-SYNOPTIC', 'synoptic-report-grid', '1', 'Synoptic Report Grid')
ON CONFLICT (system, code, version) DO NOTHING;

INSERT INTO analyte (code_system_value_id, display, data_type, default_unit_id)
SELECT csv.id, 'Synoptic Report Grid', 'table', NULL
FROM code_system_value csv
WHERE csv.system = 'ICCR-SYNOPTIC' AND csv.code = 'synoptic-report-grid' AND csv.version = '1'
ON CONFLICT (code_system_value_id) DO NOTHING;
