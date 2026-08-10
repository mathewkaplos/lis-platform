import { describe, expect, it } from 'vitest';
import { resolveGrantingRole } from './capabilities';

describe('resolveGrantingRole', () => {
  it('grants enter_result to a technologist', () => {
    expect(resolveGrantingRole(['technologist'], 'enter_result')).toBe(
      'technologist',
    );
  });

  it('denies verify to a technologist (TASK-032 AC)', () => {
    expect(resolveGrantingRole(['technologist'], 'verify')).toBeUndefined();
  });

  it('grants both enter_result and verify to a verifier', () => {
    expect(resolveGrantingRole(['verifier'], 'enter_result')).toBe('verifier');
    expect(resolveGrantingRole(['verifier'], 'verify')).toBe('verifier');
  });

  it('grants manage_patients to both technologist and verifier (TASK-039 AC)', () => {
    expect(resolveGrantingRole(['technologist'], 'manage_patients')).toBe(
      'technologist',
    );
    expect(resolveGrantingRole(['verifier'], 'manage_patients')).toBe(
      'verifier',
    );
  });

  it('grants manage_specimens to both technologist and verifier (TASK-047 AC)', () => {
    expect(resolveGrantingRole(['technologist'], 'manage_specimens')).toBe(
      'technologist',
    );
    expect(resolveGrantingRole(['verifier'], 'manage_specimens')).toBe(
      'verifier',
    );
  });

  it('denies every capability for an empty roles array (ADR-0011 fail-closed AC)', () => {
    expect(resolveGrantingRole([], 'enter_result')).toBeUndefined();
    expect(resolveGrantingRole([], 'verify')).toBeUndefined();
  });

  it('denies a capability no known role grants', () => {
    expect(
      resolveGrantingRole(['technologist', 'verifier'], 'admin' as never),
    ).toBeUndefined();
  });

  it('denies a role name with no entry in the capability map', () => {
    expect(
      resolveGrantingRole(['some-unmapped-role'], 'verify'),
    ).toBeUndefined();
  });

  it('grants resolve_qc to qa but not to technologist or verifier (ADR-0019 Decision 3)', () => {
    expect(resolveGrantingRole(['qa'], 'resolve_qc')).toBe('qa');
    expect(resolveGrantingRole(['technologist'], 'resolve_qc')).toBeUndefined();
    expect(resolveGrantingRole(['verifier'], 'resolve_qc')).toBeUndefined();
  });

  it('denies enter_result and verify to a qa-only principal', () => {
    expect(resolveGrantingRole(['qa'], 'enter_result')).toBeUndefined();
    expect(resolveGrantingRole(['qa'], 'verify')).toBeUndefined();
  });

  it('grants gateway_ingest only to gateway-ingest, never to a human role (ADR-0026)', () => {
    expect(resolveGrantingRole(['gateway-ingest'], 'gateway_ingest')).toBe(
      'gateway-ingest',
    );
    expect(
      resolveGrantingRole(['technologist'], 'gateway_ingest'),
    ).toBeUndefined();
    expect(resolveGrantingRole(['verifier'], 'gateway_ingest')).toBeUndefined();
    expect(resolveGrantingRole(['qa'], 'gateway_ingest')).toBeUndefined();
  });

  it('denies every human capability to a gateway-ingest-only principal', () => {
    expect(
      resolveGrantingRole(['gateway-ingest'], 'enter_result'),
    ).toBeUndefined();
    expect(resolveGrantingRole(['gateway-ingest'], 'verify')).toBeUndefined();
    expect(
      resolveGrantingRole(['gateway-ingest'], 'resolve_qc'),
    ).toBeUndefined();
  });

  it('grants manage_workflow to qa but not to technologist or verifier (FEAT-029)', () => {
    expect(resolveGrantingRole(['qa'], 'manage_workflow')).toBe('qa');
    expect(
      resolveGrantingRole(['technologist'], 'manage_workflow'),
    ).toBeUndefined();
    expect(
      resolveGrantingRole(['verifier'], 'manage_workflow'),
    ).toBeUndefined();
  });

  it('grants manage_catalog to qa but not to technologist or verifier (FEAT-035)', () => {
    expect(resolveGrantingRole(['qa'], 'manage_catalog')).toBe('qa');
    expect(
      resolveGrantingRole(['technologist'], 'manage_catalog'),
    ).toBeUndefined();
    expect(resolveGrantingRole(['verifier'], 'manage_catalog')).toBeUndefined();
  });

  it('grants view_operational_reports to qa but not to technologist or verifier (FEAT-034)', () => {
    expect(resolveGrantingRole(['qa'], 'view_operational_reports')).toBe('qa');
    expect(
      resolveGrantingRole(['technologist'], 'view_operational_reports'),
    ).toBeUndefined();
    expect(
      resolveGrantingRole(['verifier'], 'view_operational_reports'),
    ).toBeUndefined();
  });

  it('grants place_order_own_patient/view_related_patient_results/acknowledge_critical_own_patient to clinician only (FEAT-038)', () => {
    expect(resolveGrantingRole(['clinician'], 'place_order_own_patient')).toBe(
      'clinician',
    );
    expect(
      resolveGrantingRole(['clinician'], 'view_related_patient_results'),
    ).toBe('clinician');
    expect(
      resolveGrantingRole(['clinician'], 'acknowledge_critical_own_patient'),
    ).toBe('clinician');
    expect(
      resolveGrantingRole(['technologist'], 'place_order_own_patient'),
    ).toBeUndefined();
    expect(
      resolveGrantingRole(['verifier'], 'acknowledge_critical_own_patient'),
    ).toBeUndefined();
  });

  it('denies staff-wide manage_orders/verify to a clinician-only principal (FEAT-038)', () => {
    // The whole point of the three dedicated capabilities above: a
    // clinician must not silently inherit the unscoped staff grants.
    expect(resolveGrantingRole(['clinician'], 'manage_orders')).toBeUndefined();
    expect(resolveGrantingRole(['clinician'], 'verify')).toBeUndefined();
  });

  it('resolves deterministically when multiple held roles grant the same capability', () => {
    // Both technologist and verifier grant enter_result — the result must
    // always be the same role for the same input, not arbitrary, since two
    // audit rows for the same logical action must never disagree on which
    // role authorized it (ADR-0011 §6).
    const first = resolveGrantingRole(
      ['technologist', 'verifier'],
      'enter_result',
    );
    const second = resolveGrantingRole(
      ['verifier', 'technologist'],
      'enter_result',
    );
    expect(first).toBe(second);
    expect(first).toBeDefined();
  });
});
