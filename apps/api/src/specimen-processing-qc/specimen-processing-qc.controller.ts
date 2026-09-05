import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  specimenProcessingBatchCreateSchema,
  specimenProcessingBatchListQuerySchema,
  specimenProcessingBatchSchema,
  SPECIMEN_PROCESSING_BATCH_LIST_RESULT_LIMIT,
  type SpecimenProcessingBatch,
  type SpecimenProcessingBatchCaseResult,
} from '@lis/domain';
import {
  caseTable,
  order,
  patient,
  specimenProcessingBatch,
  specimenProcessingBatchCase,
} from '@lis/db';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
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

const batchIdParamSchema = z.object({ id: z.uuid() });

class SpecimenProcessingBatchCreateDto extends createZodDto(
  specimenProcessingBatchCreateSchema,
) {}
class SpecimenProcessingBatchDto extends createZodDto(
  specimenProcessingBatchSchema,
) {}
class SpecimenProcessingBatchListQueryDto extends createZodDto(
  specimenProcessingBatchListQuerySchema,
) {}
class BatchIdParamDto extends createZodDto(batchIdParamSchema) {}

function toBatchDto(
  row: typeof specimenProcessingBatch.$inferSelect,
  cases: SpecimenProcessingBatchCaseResult[],
): SpecimenProcessingBatch {
  return {
    ...row,
    tissueFixation:
      row.tissueFixation as SpecimenProcessingBatch['tissueFixation'],
    processing: row.processing as SpecimenProcessingBatch['processing'],
    sectionThickness:
      row.sectionThickness as SpecimenProcessingBatch['sectionThickness'],
    tissueFoldsTears:
      row.tissueFoldsTears as SpecimenProcessingBatch['tissueFoldsTears'],
    stainingQuality:
      row.stainingQuality as SpecimenProcessingBatch['stainingQuality'],
    coverslipping:
      row.coverslipping as SpecimenProcessingBatch['coverslipping'],
    tissueOrientation:
      row.tissueOrientation as SpecimenProcessingBatch['tissueOrientation'],
    grossingDate: row.grossingDate.toISOString(),
    slidesForwardedDate: row.slidesForwardedDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
    cases,
  };
}

/**
 * FEAT-068 (EPIC-013, docs/plans/feat-068-specimen-processing-batch-qc.md,
 * issue #795). `/v1/specimen-processing-batches` per ADR-0013 §3.
 *
 * Every `@Body()`/`@Query()`/`@Param()` below explicitly instantiates `new
 * ZodValidationPipe(schema)`, matching every other controller in this repo
 * (`engineering/api-design` entry #8).
 */
@Controller('v1/specimen-processing-batches')
export class SpecimenProcessingQcController {
  /**
   * `grossingPathologistUserId` is never a body field — resolved from the
   * submitting user's own JWT `sub` claim (proposal §5 item 5), matching
   * `case_report_version.signedByUserId`'s own "no user table, JWT is the
   * source of truth" convention. Every `caseId` in `cases` is checked for
   * RLS visibility (the same tenant) before insert — a nonexistent or
   * cross-tenant id 400s the whole request, never a partial batch.
   */
  @Post()
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('record_processing_qc')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({
    action: 'specimen_processing_batch.record',
    resourceType: 'specimen_processing_batch',
  })
  async create(
    @Body(new ZodValidationPipe(specimenProcessingBatchCreateSchema))
    body: SpecimenProcessingBatchCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const caseIds = body.cases.map((c) => c.caseId);
    // Resolved once here (not just checked for existence) so the create()
    // response can include the same accessionNumber/patientName every other
    // read (list()/getById()) already resolves via this identical join --
    // found live: a first version returned only {id, caseId} here, so a
    // just-created batch's own optimistic UI update showed the raw case
    // UUID instead of its accession number until the next page load.
    const visibleCases = await tx
      .select({
        id: caseTable.id,
        accessionNumber: caseTable.accessionNumber,
        patientFirstName: patient.firstName,
        patientLastName: patient.lastName,
      })
      .from(caseTable)
      .innerJoin(order, eq(caseTable.orderId, order.id))
      .innerJoin(patient, eq(order.patientId, patient.id))
      .where(inArray(caseTable.id, caseIds));
    const visibleCasesById = new Map(visibleCases.map((row) => [row.id, row]));
    const missing = caseIds.filter((id) => !visibleCasesById.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown case id(s): ${missing.join(', ')}`,
      );
    }

    const [batchRow] = await tx
      .insert(specimenProcessingBatch)
      .values({
        tenantId: user.tenantId,
        grossingPathologistUserId: user.sub,
        histoTechName: body.histoTechName,
        grossingDate: new Date(body.grossingDate),
        slidesForwardedDate: new Date(body.slidesForwardedDate),
        tissueFixation: body.tissueFixation,
        processing: body.processing,
        sectionThickness: body.sectionThickness,
        tissueFoldsTears: body.tissueFoldsTears,
        stainingQuality: body.stainingQuality,
        coverslipping: body.coverslipping,
        tissueOrientation: body.tissueOrientation,
        comments: body.comments ?? null,
        correctiveAction: body.correctiveAction ?? null,
      })
      .returning();

    const caseRows = await tx
      .insert(specimenProcessingBatchCase)
      .values(
        body.cases.map((c) => ({
          tenantId: user.tenantId,
          batchId: batchRow.id,
          caseId: c.caseId,
          slideCount: c.slideCount,
          pathologistRemarks: c.pathologistRemarks ?? null,
        })),
      )
      .returning();

    return {
      resourceId: batchRow.id,
      before: null,
      after: toBatchDto(
        batchRow,
        caseRows.map((row) => {
          const caseInfo = visibleCasesById.get(row.caseId);
          return {
            id: row.id,
            caseId: row.caseId,
            slideCount: row.slideCount,
            pathologistRemarks: row.pathologistRemarks ?? undefined,
            accessionNumber: caseInfo?.accessionNumber,
            patientFirstName: caseInfo?.patientFirstName,
            patientLastName: caseInfo?.patientLastName,
          };
        }),
      ),
    };
  }

  /** Read-only, no capability gate — matching `case.controller.ts`'s own
   * `list()` precedent (a QC batch review is visible to anyone in the tenant
   * who can already see the cases it covers). */
  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [SpecimenProcessingBatchDto], status: 200 })
  async list(
    @Query(new ZodValidationPipe(specimenProcessingBatchListQuerySchema))
    query: SpecimenProcessingBatchListQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<SpecimenProcessingBatch[]> {
    const rows = await tx
      .select()
      .from(specimenProcessingBatch)
      .where(
        and(
          query.createdFrom !== undefined
            ? gte(
                specimenProcessingBatch.createdAt,
                new Date(query.createdFrom),
              )
            : undefined,
          query.createdTo !== undefined
            ? lte(specimenProcessingBatch.createdAt, new Date(query.createdTo))
            : undefined,
        ),
      )
      .orderBy(desc(specimenProcessingBatch.createdAt))
      .limit(SPECIMEN_PROCESSING_BATCH_LIST_RESULT_LIMIT);

    if (rows.length === 0) {
      return [];
    }

    const batchIds = rows.map((row) => row.id);
    const caseRows = await tx
      .select({
        caseRow: specimenProcessingBatchCase,
        accessionNumber: caseTable.accessionNumber,
        patientFirstName: patient.firstName,
        patientLastName: patient.lastName,
      })
      .from(specimenProcessingBatchCase)
      .innerJoin(
        caseTable,
        eq(specimenProcessingBatchCase.caseId, caseTable.id),
      )
      .innerJoin(order, eq(caseTable.orderId, order.id))
      .innerJoin(patient, eq(order.patientId, patient.id))
      .where(inArray(specimenProcessingBatchCase.batchId, batchIds));

    const casesByBatchId = new Map<
      string,
      SpecimenProcessingBatchCaseResult[]
    >();
    for (const row of caseRows) {
      const existing = casesByBatchId.get(row.caseRow.batchId) ?? [];
      existing.push({
        id: row.caseRow.id,
        caseId: row.caseRow.caseId,
        slideCount: row.caseRow.slideCount,
        pathologistRemarks: row.caseRow.pathologistRemarks ?? undefined,
        accessionNumber: row.accessionNumber,
        patientFirstName: row.patientFirstName,
        patientLastName: row.patientLastName,
      });
      casesByBatchId.set(row.caseRow.batchId, existing);
    }

    return rows.map((row) => toBatchDto(row, casesByBatchId.get(row.id) ?? []));
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: SpecimenProcessingBatchDto, status: 200 })
  async getById(
    @Param(new ZodValidationPipe(batchIdParamSchema)) { id }: BatchIdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<SpecimenProcessingBatch> {
    const [row] = await tx
      .select()
      .from(specimenProcessingBatch)
      .where(eq(specimenProcessingBatch.id, id))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible (engineering/api-design entry #7).
    if (!row) {
      throw new NotFoundException('Specimen processing batch not found');
    }

    const caseRows = await tx
      .select({
        caseRow: specimenProcessingBatchCase,
        accessionNumber: caseTable.accessionNumber,
        patientFirstName: patient.firstName,
        patientLastName: patient.lastName,
      })
      .from(specimenProcessingBatchCase)
      .innerJoin(
        caseTable,
        eq(specimenProcessingBatchCase.caseId, caseTable.id),
      )
      .innerJoin(order, eq(caseTable.orderId, order.id))
      .innerJoin(patient, eq(order.patientId, patient.id))
      .where(eq(specimenProcessingBatchCase.batchId, id));

    return toBatchDto(
      row,
      caseRows.map((r) => ({
        id: r.caseRow.id,
        caseId: r.caseRow.caseId,
        slideCount: r.caseRow.slideCount,
        pathologistRemarks: r.caseRow.pathologistRemarks ?? undefined,
        accessionNumber: r.accessionNumber,
        patientFirstName: r.patientFirstName,
        patientLastName: r.patientLastName,
      })),
    );
  }
}
