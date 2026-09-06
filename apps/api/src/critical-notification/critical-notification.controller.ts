import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  acknowledgeCriticalNotificationSchema,
  criticalNotificationSchema,
  criticalNotificationStatusSchema,
  type CriticalNotificationResult,
} from '@lis/domain';
import {
  analyte,
  criticalNotification,
  observation,
  order,
  orderedTest,
  patient,
} from '@lis/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { Audit } from '../auth/audit.decorator';
import type { AuditedMutationResult } from '../auth/audit.interceptor';
import { AuditInterceptor } from '../auth/audit.interceptor';
import { CapabilityGuard } from '../auth/capability.guard';
import { isClinicianOnly, relatedPatientIds } from '../auth/clinician-scope';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import { CriticalAcknowledgeService } from './critical-acknowledge.service';
import { toCriticalNotificationDto } from './critical-notification-mapper';

const notificationIdParamSchema = z.object({ id: z.uuid() });
class NotificationIdParamDto extends createZodDto(notificationIdParamSchema) {}
// A plain object schema, not a discriminatedUnion -- unlike
// observation.controller.ts's ResultEntryDto, this doesn't need the
// "bind as a value" workaround (engineering/api-design entry #14), and
// using it anyway was a real bug: nestjs-zod's value-bound form leaves the
// class's own `.name` as its generic internal "AugmentedZodDto" rather than
// a distinct one, so this DTO and ResultEntryDto collided on the SAME
// generated OpenAPI schema component -- confirmed by a real repo-wide build
// failure in apps/web (a route completely unrelated to this one got the
// wrong request-body type), not assumed. The normal `extends` form below
// gets its own real class name and avoids the collision entirely.
class AcknowledgeDto extends createZodDto(
  acknowledgeCriticalNotificationSchema,
) {}
class CriticalNotificationDto extends createZodDto(
  criticalNotificationSchema,
) {}
const listQuerySchema = z.object({
  status: criticalNotificationStatusSchema.optional(),
});
class ListQueryDto extends createZodDto(listQuerySchema) {}

type Tx = RequestWithTx['tx'];

/**
 * TASK-065 (FEAT-021, ADR-0016). The notification/read-back half of
 * Constitution Law #3 -- decoupled from `observation.verify()` on purpose
 * (ADR-0016 Decision): acknowledging a critical's read-back and verifying
 * its analyte value are two different real actions, potentially performed
 * by different people at different times, not one atomic call.
 *
 * Acknowledge reuses the existing `verify` capability, not a new one
 * (ADR-0016 Decision/§10 Q3 of the proposal) -- same actor already trusted
 * to clinically confirm a critical result; no clinician/on-call role exists
 * yet to justify a dedicated capability.
 */
@Controller('v1/critical-notifications')
export class CriticalNotificationController {
  constructor(
    @Inject(CriticalAcknowledgeService)
    private readonly acknowledgeService: CriticalAcknowledgeService,
  ) {}

  /**
   * Captures the documented read-back FEAT-021's own AC requires. Rejects
   * an already-`'acknowledged'` notification with 409 rather than silently
   * overwriting a prior read-back -- acknowledgement is a one-time,
   * documented action, not an editable field.
   *
   * The write itself lives in `CriticalAcknowledgeService` (FEAT-038,
   * ADR-0027) -- this route stays unscoped/staff-only (`verify`), the new
   * clinician-facing route in `ClinicianController` calls the same service
   * after its own own-patient ABAC check.
   */
  @Post(':id/acknowledge')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('verify')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({
    action: 'critical_notification.acknowledge',
    resourceType: 'critical_notification',
  })
  async acknowledge(
    @Param(new ZodValidationPipe(notificationIdParamSchema))
    { id }: NotificationIdParamDto,
    @Body(new ZodValidationPipe(acknowledgeCriticalNotificationSchema))
    body: AcknowledgeDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<AuditedMutationResult & { after: CriticalNotificationResult }> {
    const { before, after } = await this.acknowledgeService.acknowledge(
      tx,
      id,
      user.sub,
      body.readBack,
    );
    return { resourceId: after.id, before, after };
  }

  /**
   * The in-app "alert" surface (proposal §6/Risks) -- no SMS/email/push
   * provider exists yet (KB-34's own channel/provider selection is a
   * future/open item), so this read is the only real notification channel
   * this task builds. No `@Audit()` -- an unmutating read (`engineering/
   * api-design` entry #6). Any authenticated tenant user may read, matching
   * `observation.controller.ts`'s own `list()`/`prior()` precedent (no
   * capability gate on a read).
   *
   * FEAT-038 (§2/Risks): a `clinician`-only caller is additionally scoped to
   * criticals on their own related patients' observations -- a real,
   * pre-existing gap found while building the clinician portal (this route
   * had no ABAC at all, so any authenticated caller, `clinician` included,
   * could already see every tenant patient's criticals). Every other role's
   * behavior is unchanged. Zero related patients returns an empty list.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [CriticalNotificationDto], status: 200 })
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<CriticalNotificationResult[]> {
    let scopeToObservationIds: string[] | undefined;
    if (isClinicianOnly(user.roles)) {
      const related = await relatedPatientIds(tx, user.sub);
      if (related.length === 0) {
        return [];
      }
      const observationRows = await tx
        .select({ id: observation.id })
        .from(observation)
        .where(inArray(observation.patientId, related));
      if (observationRows.length === 0) {
        return [];
      }
      scopeToObservationIds = observationRows.map((r) => r.id);
    }

    // Issue #809: joined so the critical-notifications worklist screen has
    // enough context (patient identity, analyte, value, a link to the order)
    // to act on a row without a second round-trip per notification --
    // `observation.patientId`/`analyteId` are already denormalized onto the
    // row (ADR-0005), so only `orderedTest`/`order` need an actual join hop.
    const rows = await tx
      .select({
        notification: criticalNotification,
        patientFirstName: patient.firstName,
        patientLastName: patient.lastName,
        patientMrn: patient.mrn,
        analyteDisplay: analyte.display,
        valueNum: observation.valueNum,
        unit: observation.unit,
        flags: observation.flags,
        orderId: order.id,
      })
      .from(criticalNotification)
      .leftJoin(
        observation,
        eq(observation.id, criticalNotification.observationId),
      )
      .leftJoin(patient, eq(patient.id, observation.patientId))
      .leftJoin(analyte, eq(analyte.id, observation.analyteId))
      .leftJoin(orderedTest, eq(orderedTest.id, observation.orderedTestId))
      .leftJoin(order, eq(order.id, orderedTest.orderId))
      .where(
        and(
          query.status
            ? eq(criticalNotification.status, query.status)
            : undefined,
          scopeToObservationIds
            ? inArray(criticalNotification.observationId, scopeToObservationIds)
            : undefined,
        ),
      )
      .orderBy(desc(criticalNotification.createdAt));

    return rows.map((row) =>
      toCriticalNotificationDto(row.notification, {
        patientFirstName: row.patientFirstName,
        patientLastName: row.patientLastName,
        patientMrn: row.patientMrn,
        analyteDisplay: row.analyteDisplay,
        valueNum: row.valueNum === null ? null : Number(row.valueNum),
        unit: row.unit,
        flags: row.flags,
        orderId: row.orderId,
      }),
    );
  }
}
