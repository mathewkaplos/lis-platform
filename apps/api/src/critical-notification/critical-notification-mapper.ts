import type { CriticalNotificationResult } from '@lis/domain';
import type { criticalNotification } from '@lis/db';

export type CriticalNotificationRow = typeof criticalNotification.$inferSelect;

/**
 * Extracted out of `critical-notification.controller.ts` (FEAT-038) so
 * `CriticalAcknowledgeService` can import this pure mapping function without
 * creating a circular import with the controller that also depends on the
 * service -- found for real, not hypothetical: NestJS's DI failed with
 * "argument at index [0] appears to be undefined at runtime" the first time
 * the controller imported the service while the service imported this
 * function back from the controller.
 */
export function toCriticalNotificationDto(
  row: CriticalNotificationRow,
): CriticalNotificationResult {
  return {
    id: row.id,
    observationId: row.observationId,
    status: row.status as CriticalNotificationResult['status'],
    createdAt: row.createdAt.toISOString(),
    escalationLevel: row.escalationLevel,
    lastEscalatedAt: row.lastEscalatedAt
      ? row.lastEscalatedAt.toISOString()
      : null,
    acknowledgedAt: row.acknowledgedAt
      ? row.acknowledgedAt.toISOString()
      : null,
    acknowledgedByUserId: row.acknowledgedByUserId,
    readBack: row.readBack,
  };
}
