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

  it('grants both enter_result and verify to a pathologist', () => {
    expect(resolveGrantingRole(['pathologist'], 'enter_result')).toBe(
      'pathologist',
    );
    expect(resolveGrantingRole(['pathologist'], 'verify')).toBe('pathologist');
  });

  it('grants manage_patients to both technologist and pathologist (TASK-039 AC)', () => {
    expect(resolveGrantingRole(['technologist'], 'manage_patients')).toBe(
      'technologist',
    );
    expect(resolveGrantingRole(['pathologist'], 'manage_patients')).toBe(
      'pathologist',
    );
  });

  it('grants manage_specimens to both technologist and pathologist (TASK-047 AC)', () => {
    expect(resolveGrantingRole(['technologist'], 'manage_specimens')).toBe(
      'technologist',
    );
    expect(resolveGrantingRole(['pathologist'], 'manage_specimens')).toBe(
      'pathologist',
    );
  });

  it('denies every capability for an empty roles array (ADR-0011 fail-closed AC)', () => {
    expect(resolveGrantingRole([], 'enter_result')).toBeUndefined();
    expect(resolveGrantingRole([], 'verify')).toBeUndefined();
  });

  it('denies a capability no known role grants', () => {
    expect(
      resolveGrantingRole(['technologist', 'pathologist'], 'admin' as never),
    ).toBeUndefined();
  });

  it('denies a role name with no entry in the capability map', () => {
    expect(
      resolveGrantingRole(['some-unmapped-role'], 'verify'),
    ).toBeUndefined();
  });

  it('grants resolve_qc to qa but not to technologist or pathologist (ADR-0019 Decision 3)', () => {
    expect(resolveGrantingRole(['qa'], 'resolve_qc')).toBe('qa');
    expect(resolveGrantingRole(['technologist'], 'resolve_qc')).toBeUndefined();
    expect(resolveGrantingRole(['pathologist'], 'resolve_qc')).toBeUndefined();
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
    expect(
      resolveGrantingRole(['pathologist'], 'gateway_ingest'),
    ).toBeUndefined();
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

  it('grants manage_workflow to qa but not to technologist or pathologist (FEAT-029)', () => {
    expect(resolveGrantingRole(['qa'], 'manage_workflow')).toBe('qa');
    expect(
      resolveGrantingRole(['technologist'], 'manage_workflow'),
    ).toBeUndefined();
    expect(
      resolveGrantingRole(['pathologist'], 'manage_workflow'),
    ).toBeUndefined();
  });

  it('grants manage_catalog to qa but not to technologist or pathologist (FEAT-035)', () => {
    expect(resolveGrantingRole(['qa'], 'manage_catalog')).toBe('qa');
    expect(
      resolveGrantingRole(['technologist'], 'manage_catalog'),
    ).toBeUndefined();
    expect(
      resolveGrantingRole(['pathologist'], 'manage_catalog'),
    ).toBeUndefined();
  });

  it('grants view_operational_reports to qa but not to technologist or pathologist (FEAT-034)', () => {
    expect(resolveGrantingRole(['qa'], 'view_operational_reports')).toBe('qa');
    expect(
      resolveGrantingRole(['technologist'], 'view_operational_reports'),
    ).toBeUndefined();
    expect(
      resolveGrantingRole(['pathologist'], 'view_operational_reports'),
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
      resolveGrantingRole(['pathologist'], 'acknowledge_critical_own_patient'),
    ).toBeUndefined();
  });

  it('denies staff-wide manage_orders/verify to a clinician-only principal (FEAT-038)', () => {
    // The whole point of the three dedicated capabilities above: a
    // clinician must not silently inherit the unscoped staff grants.
    expect(resolveGrantingRole(['clinician'], 'manage_orders')).toBeUndefined();
    expect(resolveGrantingRole(['clinician'], 'verify')).toBeUndefined();
  });

  it('resolves deterministically when multiple held roles grant the same capability', () => {
    // Both technologist and pathologist grant enter_result — the result must
    // always be the same role for the same input, not arbitrary, since two
    // audit rows for the same logical action must never disagree on which
    // role authorized it (ADR-0011 §6).
    const first = resolveGrantingRole(
      ['technologist', 'pathologist'],
      'enter_result',
    );
    const second = resolveGrantingRole(
      ['pathologist', 'technologist'],
      'enter_result',
    );
    expect(first).toBe(second);
    expect(first).toBeDefined();
  });

  // Issue #701 (EPIC #697, decision on #698): the real lab role model.
  it('grants manage_patients and manage_orders to reception, but no clinical/billing capability', () => {
    expect(resolveGrantingRole(['reception'], 'manage_patients')).toBe(
      'reception',
    );
    expect(resolveGrantingRole(['reception'], 'manage_orders')).toBe(
      'reception',
    );
    expect(
      resolveGrantingRole(['reception'], 'manage_specimens'),
    ).toBeUndefined();
    expect(resolveGrantingRole(['reception'], 'enter_result')).toBeUndefined();
    expect(
      resolveGrantingRole(['reception'], 'manage_billing'),
    ).toBeUndefined();
  });

  it('grants manage_billing to cashier only, no clinical or patient/order capability', () => {
    expect(resolveGrantingRole(['cashier'], 'manage_billing')).toBe('cashier');
    expect(resolveGrantingRole(['cashier'], 'manage_patients')).toBeUndefined();
    expect(resolveGrantingRole(['cashier'], 'enter_result')).toBeUndefined();
  });

  it('grants manage_org_settings and manage_users to lab_admin, no clinical capability', () => {
    expect(resolveGrantingRole(['lab_admin'], 'manage_org_settings')).toBe(
      'lab_admin',
    );
    expect(resolveGrantingRole(['lab_admin'], 'manage_users')).toBe(
      'lab_admin',
    );
    expect(resolveGrantingRole(['lab_admin'], 'enter_result')).toBeUndefined();
    expect(
      resolveGrantingRole(['lab_admin'], 'manage_patients'),
    ).toBeUndefined();
  });

  it('denies manage_users to every role except lab_admin', () => {
    expect(resolveGrantingRole(['qa'], 'manage_users')).toBeUndefined();
    expect(
      resolveGrantingRole(['technologist'], 'manage_users'),
    ).toBeUndefined();
    expect(
      resolveGrantingRole(['pathologist'], 'manage_users'),
    ).toBeUndefined();
  });
});
