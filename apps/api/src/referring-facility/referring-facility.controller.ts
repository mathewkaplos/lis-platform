import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  referringFacilityCreateSchema,
  referringFacilitySchema,
  type ReferringFacility,
} from '@lis/domain';
import { referringFacility } from '@lis/db';
import { eq } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { Audit } from '../auth/audit.decorator';
import { AuditInterceptor } from '../auth/audit.interceptor';
import { CapabilityGuard } from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

const referringFacilityIdParamSchema = z.object({ id: z.uuid() });

class ReferringFacilityCreateDto extends createZodDto(
  referringFacilityCreateSchema,
) {}
class ReferringFacilityDto extends createZodDto(referringFacilitySchema) {}
class ReferringFacilityIdParamDto extends createZodDto(
  referringFacilityIdParamSchema,
) {}

// engineering/api-design entry #4: no cursor pagination -- a real tenant's
// referring-facility directory is small (dozens, per the real design-
// partner evidence), same reasoning PATIENT_SEARCH_RESULT_LIMIT's own
// comment already establishes for a fixed cap over building pagination
// ahead of a real volume need.
export const REFERRING_FACILITY_LIST_LIMIT = 200;

function toReferringFacilityDto(
  row: typeof referringFacility.$inferSelect,
): ReferringFacility {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * FEAT-066 (docs/plans/feat-066-patient-contact-referring-facility.md,
 * ADR-0053). `referring_facility` is reused for both order attribution and
 * invoice payer -- see ADR-0053's own Decision section. `manage_patients`
 * capability reused (not a new capability): registration-adjacent admin
 * data, same gate as patient create/update/merge, per the approved
 * proposal's §5 open-question default.
 */
@Controller('v1/referring-facilities')
export class ReferringFacilityController {
  @Post()
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_patients')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({
    action: 'referring_facility.create',
    resourceType: 'referring_facility',
  })
  async create(
    @Body(new ZodValidationPipe(referringFacilityCreateSchema))
    body: ReferringFacilityCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [row] = await tx
      .insert(referringFacility)
      .values({
        tenantId: user.tenantId,
        name: body.name,
        phone: body.phone,
        email: body.email,
        address: body.address,
      })
      .returning();
    return {
      resourceId: row.id,
      before: null,
      after: toReferringFacilityDto(row),
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [ReferringFacilityDto], status: 200 })
  async list(@DbTx() tx: RequestWithTx['tx']): Promise<ReferringFacility[]> {
    const rows = await tx
      .select()
      .from(referringFacility)
      .limit(REFERRING_FACILITY_LIST_LIMIT);
    return rows.map(toReferringFacilityDto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: ReferringFacilityDto, status: 200 })
  async getById(
    @Param(new ZodValidationPipe(referringFacilityIdParamSchema))
    { id }: ReferringFacilityIdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<ReferringFacility> {
    const [row] = await tx
      .select()
      .from(referringFacility)
      .where(eq(referringFacility.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Referring facility not found');
    }
    return toReferringFacilityDto(row);
  }
}
