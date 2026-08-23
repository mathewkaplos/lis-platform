import { describe, expect, it } from 'vitest';
import { orderCreateSchema } from './order';

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const TEST_ID = '22222222-2222-4222-8222-222222222222';
const PANEL_ID = '33333333-3333-4333-8333-333333333333';

/**
 * `orderCreateSchema`'s one real cross-field rule: at least one of
 * testDefinitionIds/panelIds must be present (proposal §5) -- an order for
 * nothing is meaningless, but both fields are individually optional, so
 * this is enforced only by the refine, not by the object shape alone.
 */
describe('orderCreateSchema', () => {
  it('accepts testDefinitionIds alone', () => {
    const result = orderCreateSchema.safeParse({
      patientId: PATIENT_ID,
      testDefinitionIds: [TEST_ID],
    });
    expect(result.success).toBe(true);
  });

  it('accepts panelIds alone', () => {
    const result = orderCreateSchema.safeParse({
      patientId: PATIENT_ID,
      panelIds: [PANEL_ID],
    });
    expect(result.success).toBe(true);
  });

  it('accepts both testDefinitionIds and panelIds together', () => {
    const result = orderCreateSchema.safeParse({
      patientId: PATIENT_ID,
      testDefinitionIds: [TEST_ID],
      panelIds: [PANEL_ID],
    });
    expect(result.success).toBe(true);
  });

  it('rejects neither testDefinitionIds nor panelIds present', () => {
    const result = orderCreateSchema.safeParse({ patientId: PATIENT_ID });
    expect(result.success).toBe(false);
  });

  it('rejects an explicitly empty testDefinitionIds array with no panelIds', () => {
    // Fails at the array-level min(1) before the refine even runs, but the
    // end result (rejected) is the same contract this schema promises.
    const result = orderCreateSchema.safeParse({
      patientId: PATIENT_ID,
      testDefinitionIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID patientId', () => {
    const result = orderCreateSchema.safeParse({
      patientId: 'not-a-uuid',
      testDefinitionIds: [TEST_ID],
    });
    expect(result.success).toBe(false);
  });

  it('accepts the full optional field set (priority, referringFacilityId, orderingProviderName)', () => {
    const result = orderCreateSchema.safeParse({
      patientId: PATIENT_ID,
      testDefinitionIds: [TEST_ID],
      priority: 'stat',
      referringFacilityId: '44444444-4444-4444-8444-444444444444',
      orderingProviderName: 'Dr. Otieno',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unrecognized priority value', () => {
    const result = orderCreateSchema.safeParse({
      patientId: PATIENT_ID,
      testDefinitionIds: [TEST_ID],
      priority: 'urgent',
    });
    expect(result.success).toBe(false);
  });
});
