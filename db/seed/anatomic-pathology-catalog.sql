-- Issue #705 (EPIC #697, decision recorded on #698): seed a starter
-- anatomic-pathology procedure/billing catalog. The original pilot-
-- readiness audit's own finding: the order-entry catalog had zero AP
-- procedures (chemistry/haematology/microbiology only), and the one AP
-- case walked through billing landed on a placeholder charge code because
-- nothing existed to bill against.
--
-- PLACEHOLDER, NOT PARTNER DATA -- same honesty framing
-- chemistry-catalog.sql's own header comment establishes: no named design
-- partner's real fee schedule exists yet. Per #698's recorded decision,
-- this seeds a starter set of generic, commonly-recognized AP procedure
-- categories rather than waiting on one.
--
-- Deliberately NOT CPT codes. AMA's CPT code set (including the
-- 88300-series surgical-pathology-by-complexity-level codes many labs use)
-- is a licensed, copyrighted compilation -- reproducing its code numbers
-- and official descriptions without a license is a real legal exposure,
-- not a style choice. `code`/`billing_code` below are plain internal
-- identifiers, the same convention this catalog already uses for every
-- other seeded test (GLU/CMP/TSH/LIPID were never derived from an
-- external registry either) -- not tied to CPT or any other licensed
-- billing code system. Replace with the design partner's own real fee
-- schedule (their own codes, whether CPT-licensed or a local equivalent)
-- once one exists, the same way every other placeholder in this seed
-- sequence is meant to be replaced.
--
-- No code_system_value/analyte/unit chain, unlike the chemistry/
-- haematology files: an AP procedure's result is a narrative
-- (gross/microscopic/diagnosis text on a case, FEAT-067) entered through
-- the case/block workflow, not a numeric analyte value through the
-- observation pipeline -- CatalogController's own `analytes: [] ` default
-- already handles a test_definition with zero test_analyte rows
-- correctly, and default-report-templates.sql's own `WHERE EXISTS
-- (test_analyte)` guard correctly skips these (AP reporting goes through
-- the case/synoptic pipeline, not the generic per-analyte report
-- template).
--
-- Prices are distinct, generic, published-adjacent US lab reference
-- prices for illustration -- not partner-negotiated rates, same
-- "placeholder, not clinically/financially authoritative" caveat as every
-- other price in this seed sequence.

INSERT INTO test_definition (tenant_id, code, display_name, billing_code, price_cents)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'AP-BX-SMALL', 'Surgical pathology, small biopsy (gross and microscopic examination)', 'AP-BX-SMALL', 8500),
  ('00000000-0000-0000-0000-000000000001', 'AP-STD',      'Surgical pathology, standard specimen (gross and microscopic examination)', 'AP-STD', 14500),
  ('00000000-0000-0000-0000-000000000001', 'AP-COMPLEX',  'Surgical pathology, complex/resection specimen (gross and microscopic examination)', 'AP-COMPLEX', 28500),
  ('00000000-0000-0000-0000-000000000001', 'AP-FROZEN',   'Intraoperative frozen section consultation, per block', 'AP-FROZEN', 17500),
  ('00000000-0000-0000-0000-000000000001', 'AP-STAIN',    'Special histochemical stain, per stain', 'AP-STAIN', 4500),
  ('00000000-0000-0000-0000-000000000001', 'AP-IHC1',     'Immunohistochemistry, single antibody stain', 'AP-IHC1', 6500),
  ('00000000-0000-0000-0000-000000000001', 'AP-IHC-ERPR', 'Immunohistochemistry panel, ER/PR', 'AP-IHC-ERPR', 13000),
  ('00000000-0000-0000-0000-000000000001', 'AP-IHC-HER2', 'HER2 immunohistochemistry', 'AP-IHC-HER2', 9500)
ON CONFLICT (tenant_id, code) DO NOTHING;
