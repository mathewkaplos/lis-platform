import { Injectable } from '@nestjs/common';
import { db } from '../auth/db';
import type { WorkflowRule } from './workflow-types';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// FEAT-031 (ADR-0031): which rule/definition version fired, and whether it
// fired in dry-run mode. Threaded through so a handler can (a) record which
// rule set released a result (KB-25's own "each auto-verified result
// records the rule set version that released it") and (b) honor dry-run
// itself -- the engine still calls the handler for a dryRun rule; it is the
// handler's own job to run its real checks and skip only the mutating write,
// since dry-run's whole value is proving what WOULD have happened, not just
// that a rule's `when` matched.
export interface WorkflowFiringContext {
  workflowDefinitionId: string;
  ruleId: string;
  dryRun: boolean;
}

// The transaction is WorkflowEngineService's own already-open one, threaded
// through -- not a separate transaction the handler opens itself. FEAT-030
// (ADR-0030) found the hard way that a handler opening its own
// db.transaction() while called from inside handleEvent()'s still-open
// transaction, on the same singleton `db` pool, is the identical
// nested-checkout deadlock database-design Skill entry #14 already
// documents for OutboxRelayService -- one layer of the same call stack
// deeper. Threading `tx` through here is the fix: a command handler's own
// writes are part of the same one atomic per-event transaction as the rule
// evaluation and firing record, never a nested one.
export type WorkflowCommandHandler = (
  command: WorkflowRule['do'],
  eventPayload: unknown,
  tenantId: string,
  tx: Tx,
  firingContext: WorkflowFiringContext,
) => Promise<void>;

/**
 * FEAT-029 (proposal §5): starts empty, exactly like `OutboxHandlerRegistry`
 * did in FEAT-028 -- a rule that matches and names a `do.command` with no
 * registered handler here is recorded (`workflow_rule_firing.dispatched:
 * false`) and nothing is executed. FEAT-030 (reflex)/FEAT-031
 * (auto-verification) register their own real command handlers against
 * this registry later.
 */
@Injectable()
export class WorkflowCommandRegistry {
  private readonly handlers = new Map<string, WorkflowCommandHandler>();

  register(command: string, handler: WorkflowCommandHandler): void {
    this.handlers.set(command, handler);
  }

  handlerFor(command: string): WorkflowCommandHandler | undefined {
    return this.handlers.get(command);
  }
}
