import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  acknowledgeCriticalNotificationSchema,
  orderCreateSchema,
  patientSchema,
  portalResultsResponseSchema,
  type CriticalNotificationResult,
  type Patient,
  type PortalResultsResponse,
} from '@lis/domain';
import { criticalNotification, observation, patient } from '@lis/db';
import { and, eq, inArray } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import type { AuditedMutationResult } from '../auth/audit.interceptor';
import { Audit } from '../auth/audit.decorator';
import { AuditInterceptor } from '../auth/audit.interceptor';
import { CapabilityGuard } from '../auth/capability.guard';
import { relatedPatientIds } from '../auth/clinician-scope';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import { CriticalAcknowledgeService } from '../critical-notification/critical-acknowledge.service';
import { OrderCreationService } from '../order/order-creation.service';
import { toOrderDto } from '../order/order.controller';
import { toPatientDto } from '../patient/patient.controller';
import { PortalResultsService } from '../portal/portal-results.service';

class PatientDto extends createZodDto(patientSchema) {}

class OrderCreateDto extends createZodDto(orderCreateSchema) {}
class PortalResultsResponseDto extends createZodDto(
  portalResultsResponseSchema,
) {}
const notificationIdParamSchema = z.object({ id: z.uuid() });
class NotificationIdParamDto extends createZodDto(notificationIdParamSchema) {}
class AcknowledgeDto extends createZodDto(
  acknowledgeCriticalNotificationSchema,
) {}
const patientIdParamSchema = z.object({ patientId: z.uuid() });
class PatientIdParamDto extends createZodDto(patientIdParamSchema) {}

type Tx = RequestWithTx['tx'];

/**
 * FEAT-038 (docs/plans/feat-038-clinician-portal.md). The clinician-facing
 * slice of KB-33: place an order, view a result, acknowledge a critical --
 * every route here is scoped to `relatedPatientIds()` (`clinician-scope.ts`,
 * FEAT-040), never the whole tenant, and every write reuses an existing
 * "one write path" service (`OrderCreationService`/FEAT-036,
 * `CriticalAcknowledgeService`/this task's own extraction) rather than a
 * second implementation. A patient outside the caller's relationship set is
 * 404, never 403 (`engineering/authz` entry #4, same as `PatientController`).
 */
@Controller('v1/clinician')
export class ClinicianController {
  constructor(
    @Inject(OrderCreationService)
    private readonly orderCreationService: OrderCreationService,
    @Inject(PortalResultsService)
    private readonly portalResultsService: PortalResultsService,
    @Inject(CriticalAcknowledgeService)
    private readonly acknowledgeService: CriticalAcknowledgeService,
  ) {}

  /**
   * The Doctor Dashboard's own patient list. `PatientController.search()`
   * (FEAT-040) is already own-patient-scoped for a clinician caller, but its
   * schema requires one of several search terms (mrn/nationalId/q/name+dob)
   * -- there is no "list everything I'm scoped to" mode, since search() was
   * never meant to be a bare listing endpoint. Found for real building this
   * dashboard, not hypothetical: a clinician with no search term has no way
   * to see their own patient list at all otherwise. Reuses
   * `view_related_patient_results` rather than a fourth dedicated
   * capability -- listing a name/MRN is a strict subset of the sensitivity
   * of viewing that same patient's actual results.
   */
  @Get('patients')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('view_related_patient_results')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [PatientDto], status: 200 })
  async listPatients(
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<Patient[]> {
    const related = await relatedPatientIds(tx, user.sub);
    if (related.length === 0) {
      return [];
    }
    const rows = await tx
      .select()
      .from(patient)
      .where(inArray(patient.id, related));
    return rows.map(toPatientDto);
  }

  /**
   * `patientId`'s existence is proven by `care_relationship.patientId`'s own
   * FK -- if it's in `relatedPatientIds()`, the patient row necessarily
   * exists and belongs to this tenant, so no separate existence check is
   * needed (unlike `OrderController.create()`, which has no such
   * relationship row to lean on).
   */
  @Post('orders')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('place_order_own_patient')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'order.create', resourceType: 'order' })
  async createOrder(
    @Body(new ZodValidationPipe(orderCreateSchema)) body: OrderCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ) {
    const related = await relatedPatientIds(tx, user.sub);
    if (!related.includes(body.patientId)) {
      throw new NotFoundException(`Unknown patient id: ${body.patientId}`);
    }

    const { orderRow, orderedTestRows } =
      await this.orderCreationService.create(tx, {
        tenantId: user.tenantId,
        patientId: body.patientId,
        testDefinitionIds: body.testDefinitionIds,
        panelIds: body.panelIds,
        priority: body.priority,
      });

    return {
      resourceId: orderRow.id,
      before: null,
      after: toOrderDto(orderRow, orderedTestRows),
    };
  }

  /**
   * Bypasses the patient-portal `result_release_policy` delay entirely
   * (proposal §10 Q2) -- an ordering/treating clinician sees a verified
   * result the moment it's clinically actionable, same as internal staff.
   */
  @Get('patients/:patientId/results')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('view_related_patient_results')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: PortalResultsResponseDto, status: 200 })
  async getPatientResults(
    @Param(new ZodValidationPipe(patientIdParamSchema))
    { patientId }: PatientIdParamDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<PortalResultsResponse> {
    const related = await relatedPatientIds(tx, user.sub);
    if (!related.includes(patientId)) {
      throw new NotFoundException(`Patient not found`);
    }
    const analytes = await this.portalResultsService.getResultsForPatient(
      tx,
      user.tenantId,
      patientId,
      { bypassReleasePolicy: true },
    );
    return { analytes };
  }

  /**
   * The notification's own patient is resolved via its observation (a
   * `criticalNotification` row has no direct `patientId` column) before the
   * own-patient ABAC check -- the composite join mirrors the notification's
   * own FK shape (`observationId`/`observationCreatedAt`, since
   * `observation` is partitioned by `created_at`).
   */
  @Post('critical-notifications/:id/acknowledge')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('acknowledge_critical_own_patient')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({
    action: 'critical_notification.acknowledge',
    resourceType: 'critical_notification',
  })
  async acknowledgeCritical(
    @Param(new ZodValidationPipe(notificationIdParamSchema))
    { id }: NotificationIdParamDto,
    @Body(new ZodValidationPipe(acknowledgeCriticalNotificationSchema))
    body: AcknowledgeDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<AuditedMutationResult & { after: CriticalNotificationResult }> {
    const [row] = await tx
      .select({ patientId: observation.patientId })
      .from(criticalNotification)
      .innerJoin(
        observation,
        and(
          eq(observation.id, criticalNotification.observationId),
          eq(observation.createdAt, criticalNotification.observationCreatedAt),
        ),
      )
      .where(eq(criticalNotification.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Critical notification not found');
    }
    const related = await relatedPatientIds(tx, user.sub);
    // A control/QC observation (no patient at all) can never be "related" --
    // same not-found treatment as an unrelated real patient's critical.
    if (!row.patientId || !related.includes(row.patientId)) {
      throw new NotFoundException('Critical notification not found');
    }

    const { before, after } = await this.acknowledgeService.acknowledge(
      tx,
      id,
      user.sub,
      body.readBack,
    );
    return { resourceId: after.id, before, after };
  }
}
