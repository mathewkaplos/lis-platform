-- FEAT-022 Part 1 (ADR-0024): SLA targets per priority.
--
-- PLACEHOLDER, NOT PARTNER DATA: generic, widely-cited turnaround targets
-- (24h routine, 1h STAT), not validated by any specific lab -- same
-- "placeholder, not partner-validated" framing as every other seeded
-- clinical/operational config in this repo (chemistry-catalog.sql,
-- haematology-catalog.sql). Replace with the actual partner's own TAT
-- targets once a real design partner exists.
--
-- Seed tenant: same fixed placeholder tenant id every other seed file uses.

INSERT INTO sla_target (tenant_id, priority, target_minutes)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'routine', 1440),
  ('00000000-0000-0000-0000-000000000001', 'stat', 60)
ON CONFLICT (tenant_id, priority) DO NOTHING;
