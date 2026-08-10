import { randomUUID } from 'node:crypto';
import { createDb } from '@lis/db';
import { sql } from 'drizzle-orm';
import { InferenceGatewayService } from '../src/ai/inference-gateway.service';
import { StubProvider } from '../src/ai/providers/stub-provider';

/**
 * FEAT-041 (ADR-0037) proposal §7/§8: proves invoke() against a real
 * Postgres instance, not a mock (engineering/testing entry #1's own
 * "trace the actual data" discipline, task-459/ADR-0036's own precedent for
 * this exact audit_event table). No HTTP route exists for this feature
 * (proposal §5's own scoping decision), so this constructs the service
 * directly rather than booting the full AppModule/HTTP stack.
 */
describe('InferenceGatewayService (e2e, real Postgres)', () => {
  it("invoke() writes exactly one audit_event row, actorType 'ai', containing only the minimized context", async () => {
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    const service = new InferenceGatewayService(new StubProvider(), db);

    const tenantId = randomUUID();
    const actorPrincipalId = randomUUID();
    const resourceId = randomUUID();

    const result = await service.invoke({
      tenantId,
      actorPrincipalId,
      capability: 'test-capability',
      prompt: 'irrelevant for this test',
      context: {
        analyteCode: 'K',
        value: 5.2,
        patientName: 'Jane Doe',
        mrn: 'MRN123',
      },
      allowedContextFields: ['analyteCode', 'value'],
      resourceType: 'test-resource',
      resourceId,
    });

    expect(result.providerId).toBe('stub');
    expect(result.output).toContain('test-capability');

    const rows = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );
      return tx.execute<{
        actor_type: string;
        actor_role: string;
        action: string;
        resource_type: string;
        resource_id: string;
        after: unknown;
      }>(
        sql`SELECT actor_type, actor_role, action, resource_type, resource_id, after FROM audit_event WHERE tenant_id = ${tenantId}`,
      );
    });

    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0];
    expect(row.actor_type).toBe('ai');
    expect(row.actor_role).toBe('ai');
    expect(row.action).toBe('ai_inference.invoke');
    expect(row.resource_type).toBe('test-resource');
    expect(row.resource_id).toBe(resourceId);

    const after = row.after as {
      capability: string;
      providerId: string;
      minimizedContext: Record<string, unknown>;
      output: string;
    };
    expect(after.capability).toBe('test-capability');
    expect(after.providerId).toBe('stub');
    // Only the allowlisted fields survive -- never patientName/mrn, proving
    // the audit trail itself never becomes a second place PHI leaks through
    // un-minimized (FEAT-041 proposal §5).
    expect(after.minimizedContext).toEqual({ analyteCode: 'K', value: 5.2 });
    expect(JSON.stringify(after)).not.toContain('Jane Doe');
    expect(JSON.stringify(after)).not.toContain('MRN123');
  });
});
