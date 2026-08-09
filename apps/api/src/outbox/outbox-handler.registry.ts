import { Injectable, Logger } from '@nestjs/common';

export type OutboxHandler = (
  payload: unknown,
  tenantId: string,
) => Promise<void>;

/**
 * FEAT-028 (ADR-0028): a plain in-process `Map<eventType, handler[]>` --
 * not a message broker (KB-05's own "REST sync + events async + outbox"
 * choice, no broker infrastructure exists in this repo). FEAT-029+
 * register their own handlers here as they're built; this feature
 * registers exactly one trivial logging handler for `ObservationVerified`,
 * proving real delivery without inventing rule-evaluation logic that isn't
 * this feature's scope.
 */
@Injectable()
export class OutboxHandlerRegistry {
  private readonly logger = new Logger(OutboxHandlerRegistry.name);
  private readonly handlers = new Map<string, OutboxHandler[]>();

  constructor() {
    this.register('ObservationVerified', (payload, tenantId) => {
      this.logger.log(
        `ObservationVerified delivered (tenant ${tenantId}): ${JSON.stringify(payload)}`,
      );
      return Promise.resolve();
    });
  }

  register(eventType: string, handler: OutboxHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  handlersFor(eventType: string): OutboxHandler[] {
    return this.handlers.get(eventType) ?? [];
  }
}
