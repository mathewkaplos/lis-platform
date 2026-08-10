import { sql } from 'drizzle-orm';
import { writeAuditEvent, type createDb } from '@lis/db';
import { minimize } from './phi-minimization';
import type { InferenceProvider } from './inference-provider.interface';

// Type-only -- does not import ../auth/db's runtime singleton (which throws
// at import time if APP_DATABASE_URL isn't set, matching every other
// db-touching service in this repo, e.g. sla-breach-detector.service.ts).
// `db` is injected via the constructor instead, so this file stays
// importable by a plain unit spec; ai.module.ts wires the real singleton in
// for production use.
type Db = ReturnType<typeof createDb>;

export interface InferenceRequest {
  tenantId: string;
  // The human principal responsible for this request, when known (e.g. the
  // clinician whose task triggered an AI suggestion) -- this layer doesn't
  // itself define what "the AI" is as an actor beyond actorType: 'ai'; see
  // KB-11's "every AI suggestion and its human disposition" for why the
  // human side of that pair belongs to the caller, not this gateway.
  actorPrincipalId: string;
  capability: string;
  prompt: string;
  context: Record<string, unknown>;
  allowedContextFields: readonly string[];
  resourceType: string;
  resourceId: string;
}

export interface InferenceResult {
  output: string;
  providerId: string;
}

/**
 * ADR-0037 / FEAT-041: the one path any AI capability uses to reach a model
 * provider. Minimizes context (deny-by-default, phi-minimization.ts), calls
 * the configured provider, and audits the interaction -- actorType 'ai'
 * (KB-11's own named third actor type), reusing writeAuditEvent unchanged
 * (task-459/ADR-0036 already hardened it against concurrent writers). The
 * audited `after` payload is the *minimized* context plus the provider's
 * output, never the caller's raw input -- the audit trail must not become a
 * second place PHI leaks through un-minimized (FEAT-041 proposal §5).
 */
export class InferenceGatewayService {
  constructor(
    private readonly provider: InferenceProvider,
    private readonly db: Db,
  ) {}

  async invoke(request: InferenceRequest): Promise<InferenceResult> {
    const minimizedContext = minimize(
      request.context,
      request.allowedContextFields,
    );

    const result = await this.provider.complete({
      capability: request.capability,
      prompt: request.prompt,
      minimizedContext,
    });

    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${request.tenantId}, true)`,
      );
      await writeAuditEvent(tx, {
        tenantId: request.tenantId,
        actorPrincipalId: request.actorPrincipalId,
        actorRole: 'ai',
        actorType: 'ai',
        action: 'ai_inference.invoke',
        resourceType: request.resourceType,
        resourceId: request.resourceId,
        after: {
          capability: request.capability,
          providerId: result.providerId,
          minimizedContext,
          output: result.output,
        },
      });
    });

    return result;
  }
}
