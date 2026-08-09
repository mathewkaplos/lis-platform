import { Injectable } from '@nestjs/common';
import type { WorkflowRule } from './workflow-types';

export type WorkflowCommandHandler = (
  command: WorkflowRule['do'],
  eventPayload: unknown,
  tenantId: string,
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
