import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CriticalNotificationResult } from '@lis/domain';
import { criticalNotification } from '@lis/db';
import { eq } from 'drizzle-orm';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { toCriticalNotificationDto } from './critical-notification-mapper';

type Tx = RequestWithTx['tx'];

/**
 * FEAT-038 (ADR-0027 "one write path" pattern, same shape as
 * `OrderCreationService`): the acknowledge/read-back write, extracted out of
 * `CriticalNotificationController.acknowledge()` so both the existing
 * staff-facing route and the new clinician-facing route (proposal §2) call
 * the identical write path. Authorization/ABAC scoping stays with each
 * caller, not this service -- the staff route needs none (unscoped, `verify`
 * capability); the clinician route resolves and checks own-patient
 * membership before ever calling this.
 */
@Injectable()
export class CriticalAcknowledgeService {
  async acknowledge(
    tx: Tx,
    id: string,
    actorUserId: string,
    readBack: string,
  ): Promise<{
    before: CriticalNotificationResult;
    after: CriticalNotificationResult;
  }> {
    const [existing] = await tx
      .select()
      .from(criticalNotification)
      .where(eq(criticalNotification.id, id))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible (engineering/
    // api-design entry #7).
    if (!existing) {
      throw new NotFoundException('Critical notification not found');
    }
    if (existing.status === 'acknowledged') {
      throw new ConflictException(
        `Critical notification ${id} is already acknowledged`,
      );
    }

    const before = toCriticalNotificationDto(existing);
    const [updated] = await tx
      .update(criticalNotification)
      .set({
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedByUserId: actorUserId,
        readBack,
      })
      .where(eq(criticalNotification.id, id))
      .returning();

    return { before, after: toCriticalNotificationDto(updated) };
  }
}
