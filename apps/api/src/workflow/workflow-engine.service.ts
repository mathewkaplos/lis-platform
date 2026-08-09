import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { workflowDefinition, workflowRuleFiring } from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../auth/db';
import { OutboxHandlerRegistry } from '../outbox/outbox-handler.registry';
import { evaluateCondition } from './workflow-condition-evaluator';
import { WorkflowCommandRegistry } from './workflow-command.registry';
import type { WorkflowRule } from './workflow-types';

/**
 * FEAT-029 (ADR-0029/KB-25 execution model). Registers itself as an
 * `ObservationVerified` handler in `OutboxHandlerRegistry` (FEAT-028) --
 * this is the engine's whole "consume a domain event" step. Runs in its own
 * transaction (not the outbox relay's own), since the handler contract
 * (`OutboxHandler`) doesn't thread a `tx` through -- workflow evaluation is
 * a side effect of an already-committed event, not something that needs to
 * be atomic with the outbox's own delivery bookkeeping.
 *
 * Every rule evaluated (matched or not) is recorded in
 * `workflow_rule_firing` -- KB-25's own explicit requirement ("every
 * automated action is as traceable as a human one").
 */
@Injectable()
export class WorkflowEngineService implements OnModuleInit {
  // Explicit @Inject -- see CapabilityGuard's own header comment for why
  // (vitest esbuild design:paramtypes gap).
  constructor(
    @Inject(OutboxHandlerRegistry)
    private readonly outboxHandlers: OutboxHandlerRegistry,
    @Inject(WorkflowCommandRegistry)
    private readonly commands: WorkflowCommandRegistry,
  ) {}

  onModuleInit() {
    this.outboxHandlers.register('ObservationVerified', (payload, tenantId) =>
      this.handleEvent('ObservationVerified', payload, tenantId),
    );
  }

  async handleEvent(
    eventType: string,
    payload: unknown,
    tenantId: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );

      const [definition] = await tx
        .select()
        .from(workflowDefinition)
        .where(
          and(
            eq(workflowDefinition.tenantId, tenantId),
            eq(workflowDefinition.status, 'published'),
          ),
        )
        .limit(1);
      if (!definition) {
        return; // no published rule set for this tenant -- nothing to evaluate
      }

      const context = (payload ?? {}) as Record<string, unknown>;
      const rules = definition.rules as WorkflowRule[];

      for (const rule of rules) {
        if (rule.on !== eventType) {
          continue; // ADR-0029 (tenant)-only scope: every published rule is
          // considered for every event; `on` itself is what filters by type.
        }

        const matched = evaluateCondition(rule.when, context);
        let dispatched: boolean | null = null;

        if (matched) {
          const handler = this.commands.handlerFor(rule.do.command);
          dispatched = handler !== undefined;
          if (handler) {
            await handler(rule.do, context, tenantId);
          }
        }

        await tx.insert(workflowRuleFiring).values({
          tenantId,
          workflowDefinitionId: definition.id,
          ruleId: rule.id,
          eventType,
          matched,
          command: rule.do.command,
          dispatched,
        });
      }
    });
  }
}
