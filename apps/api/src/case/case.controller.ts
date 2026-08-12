import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  blockCreateSchema,
  blockOrderedTestLinkCreateSchema,
  caseAmendRequestSchema,
  caseCreateSchema,
  caseLineageSchema,
  type Block,
  type Case,
  type CaseLineage,
  type CaseReportVersion,
  type Slide,
} from '@lis/domain';
import {
  block,
  blockFulfillment,
  caseReportVersion,
  caseTable,
  computeCaseReportContentHash,
  deriveBlockCode,
  deriveCaseSpecimenAccessionNumber,
  deriveSlideCode,
  generateAccessionNumber,
  observation,
  order,
  orderedTest,
  signCaseReportContent,
  slide,
  specimen,
  synopticElement,
  testDefinition,
  writeAuditEvent,
} from '@lis/db';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { Audit } from '../auth/audit.decorator';
import { AuditInterceptor } from '../auth/audit.interceptor';
import type { RequestWithGrantingRole } from '../auth/capability.guard';
import { CapabilityGuard } from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import { RequireStepUp } from '../auth/require-step-up.decorator';
import type { RequestContext } from '../auth/request-context';
import { StepUpGuard } from '../auth/step-up.guard';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

const idParamSchema = z.object({ id: z.uuid() });

class CaseCreateDto extends createZodDto(caseCreateSchema) {}
class CaseLineageDto extends createZodDto(caseLineageSchema) {}
class CaseAmendRequestDto extends createZodDto(caseAmendRequestSchema) {}
class BlockCreateDto extends createZodDto(blockCreateSchema) {}
class BlockOrderedTestLinkCreateDto extends createZodDto(
  blockOrderedTestLinkCreateSchema,
) {}
class IdParamDto extends createZodDto(idParamSchema) {}

function toCaseDto(row: typeof caseTable.$inferSelect): Case {
  return {
    ...row,
    status: row.status as Case['status'], // CHECK-constrained (ck_case_status)
    createdAt: row.createdAt.toISOString(),
  };
}

function toBlockDto(row: typeof block.$inferSelect): Block {
  return {
    ...row,
    status: row.status as Block['status'], // CHECK-constrained (ck_block_status)
    createdAt: row.createdAt.toISOString(),
  };
}

function toSlideDto(row: typeof slide.$inferSelect): Slide {
  return {
    ...row,
    status: row.status as Slide['status'], // CHECK-constrained (ck_slide_status)
    createdAt: row.createdAt.toISOString(),
  };
}

function toCaseReportVersionDto(
  row: typeof caseReportVersion.$inferSelect,
): CaseReportVersion {
  return {
    ...row,
    signature: row.signature.toString('hex'), // bytea -> hex for JSON transport
    authTimeUsed: row.authTimeUsed.toISOString(),
    status: row.status as CaseReportVersion['status'], // CHECK-constrained (ck_case_report_version_status)
    signedAt: row.signedAt.toISOString(),
  };
}

/**
 * FEAT-059. The signed content for a case: lineage ids (provenance, not a
 * full snapshot -- same "id + createdAt, not the whole row" minimalism as
 * report.includedObservations's own header comment) plus the ids of every
 * discrete synoptic-response Observation recorded against any ordered test
 * belonging to this case's order (FEAT-058's `assembleAndPersistSynopticResponse`
 * writes one such Observation per response, bound to that response's own
 * element analyte -- filtering observation.analyteId against the set of
 * every synopticElement.analyteId is what distinguishes these from any
 * other observation that might exist on the same order).
 */
async function buildCaseReportContent(
  tx: RequestWithTx['tx'],
  caseRow: typeof caseTable.$inferSelect,
): Promise<{
  content: Parameters<typeof computeCaseReportContentHash>[0];
  specimenRows: (typeof specimen.$inferSelect)[];
  blockRows: (typeof block.$inferSelect)[];
  slideRows: (typeof slide.$inferSelect)[];
}> {
  const specimenRows = await tx
    .select()
    .from(specimen)
    .where(eq(specimen.caseId, caseRow.id));
  const specimenIds = specimenRows.map((row) => row.id);
  const blockRows =
    specimenIds.length > 0
      ? await tx
          .select()
          .from(block)
          .where(inArray(block.specimenId, specimenIds))
      : [];
  const blockIds = blockRows.map((row) => row.id);
  const slideRows =
    blockIds.length > 0
      ? await tx.select().from(slide).where(inArray(slide.blockId, blockIds))
      : [];

  const orderedTestRows = await tx
    .select({ id: orderedTest.id })
    .from(orderedTest)
    .where(eq(orderedTest.orderId, caseRow.orderId));
  const orderedTestIds = orderedTestRows.map((row) => row.id);

  const synopticAnalyteRows = await tx
    .select({ analyteId: synopticElement.analyteId })
    .from(synopticElement);
  const synopticAnalyteIds = new Set(
    synopticAnalyteRows.map((row) => row.analyteId),
  );

  const observationRows =
    orderedTestIds.length > 0
      ? await tx
          .select({
            id: observation.id,
            analyteId: observation.analyteId,
            createdAt: observation.createdAt,
          })
          .from(observation)
          .where(inArray(observation.orderedTestId, orderedTestIds))
      : [];
  const synopticResponses = observationRows
    .filter((row) => synopticAnalyteIds.has(row.analyteId))
    .map((row) => ({ id: row.id, createdAt: row.createdAt.toISOString() }));

  return {
    content: {
      case: {
        id: caseRow.id,
        accessionNumber: caseRow.accessionNumber,
      },
      parts: specimenRows.map((row) => ({
        id: row.id,
        accessionNumber: row.accessionNumber,
        blockIds: blockRows
          .filter((b) => b.specimenId === row.id)
          .map((b) => b.id),
      })),
      synopticResponses,
    },
    specimenRows,
    blockRows,
    slideRows,
  };
}

/**
 * FEAT-057 (ADR-0049, docs/plans/feat-057-case-specimen-block-slide-hierarchy.md).
 * `/v1/cases` + `/v1/blocks` per ADR-0013 §3. Data model + accessioning API
 * only (proposal §1) -- no report/synoptic-content generation here, that is
 * FEAT-058/059's own scope (proposal §5 scope cut).
 *
 * `manage_specimens` gates every mutation here, the same capability
 * `specimen.controller.ts` uses -- no dedicated anatomic-pathology role
 * exists in Keycloak yet (identical reasoning to `manage_patients`/
 * `manage_orders`/`manage_specimens`'s own existing grants,
 * apps/api/src/auth/capabilities.ts's header comment). `finalize()` below is
 * a schema-only status transition, not the real step-up-signed sign-out
 * (FEAT-059) -- reusing `manage_specimens` for it is deliberately provisional,
 * not a statement that this is the real diagnostic sign-out gate.
 *
 * Every `@Body()`/`@Param()` below explicitly instantiates `new
 * ZodValidationPipe(schema)` (engineering/api-design entry #8: vitest's
 * esbuild transform doesn't emit `design:paramtypes`, so the global pipe
 * alone can't identify a DTO class by reflection under this repo's test
 * harness).
 */
// No single-resource base path (unlike specimen.controller.ts's own
// `@Controller('v1/specimens')`) -- this controller spans two resource
// roots (`/v1/cases`, `/v1/blocks`), so each method decorator below carries
// its own full path instead.
@Controller()
export class CaseController {
  /**
   * One combined create action, mirroring `specimen.controller.ts`'s own
   * "one combined create action" shape: a Case and all of its specimen/parts
   * are created together, in one transaction. Per proposal §5: the Case
   * draws its own accessionNumber from `generateAccessionNumber()` (the same
   * global sequence `specimen` uses); each part's accessionNumber is instead
   * derived (`{case}-P{n}`) rather than a second independent sequence call.
   */
  @Post('v1/cases')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'case.accession', resourceType: 'case' })
  async create(
    @Body(new ZodValidationPipe(caseCreateSchema)) body: CaseCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [orderRow] = await tx
      .select({ id: order.id })
      .from(order)
      .where(eq(order.id, body.orderId))
      .limit(1);
    if (!orderRow) {
      throw new BadRequestException(`Unknown order id: ${body.orderId}`);
    }

    const [existingCase] = await tx
      .select({ id: caseTable.id })
      .from(caseTable)
      .where(eq(caseTable.orderId, body.orderId))
      .limit(1);
    if (existingCase) {
      throw new BadRequestException(
        `Order ${body.orderId} already has a case (ux_case_tenant_order)`,
      );
    }

    const accessionNumber = await generateAccessionNumber(tx);

    const [caseRow] = await tx
      .insert(caseTable)
      .values({
        tenantId: user.tenantId,
        orderId: body.orderId,
        accessionNumber,
      })
      .returning();

    const specimenRows = await tx
      .insert(specimen)
      .values(
        body.parts.map((part, index) => ({
          tenantId: user.tenantId,
          caseId: caseRow.id,
          accessionNumber: deriveCaseSpecimenAccessionNumber(
            accessionNumber,
            index + 1,
          ),
          specimenType: part.specimenType,
          status:
            part.rejectionReason !== undefined ? 'rejected' : 'accessioned',
          rejectionReason: part.rejectionReason ?? null,
          receivedAt: new Date(),
        })),
      )
      .returning();

    return {
      resourceId: caseRow.id,
      before: null,
      after: {
        ...toCaseDto(caseRow),
        partIds: specimenRows.map((row) => row.id),
      },
    };
  }

  /**
   * ADR-0049 §Decision 2: Block is a child of Specimen/part. `blockNumber` is
   * case-scoped (proposal §5), computed as a max-plus-one count of existing
   * blocks under the whole case at insert time.
   */
  @Post('v1/cases/:id/blocks')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'case.add_block', resourceType: 'block' })
  async addBlock(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @Body(new ZodValidationPipe(blockCreateSchema)) body: BlockCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [caseRow] = await tx
      .select()
      .from(caseTable)
      .where(eq(caseTable.id, id))
      .limit(1);
    if (!caseRow) {
      throw new NotFoundException('Case not found');
    }

    const [specimenRow] = await tx
      .select()
      .from(specimen)
      .where(and(eq(specimen.id, body.specimenId), eq(specimen.caseId, id)))
      .limit(1);
    if (!specimenRow) {
      throw new BadRequestException(
        `Specimen ${body.specimenId} is not a part of case ${id}`,
      );
    }

    const [{ value: existingBlockCount }] = await tx
      .select({ value: count() })
      .from(block)
      .innerJoin(specimen, eq(block.specimenId, specimen.id))
      .where(eq(specimen.caseId, id));

    const blockNumber = existingBlockCount + 1;
    const code = deriveBlockCode(caseRow.accessionNumber, blockNumber);

    const [blockRow] = await tx
      .insert(block)
      .values({
        tenantId: user.tenantId,
        specimenId: body.specimenId,
        blockNumber,
        code,
      })
      .returning();

    return {
      resourceId: blockRow.id,
      before: null,
      after: toBlockDto(blockRow),
    };
  }

  /**
   * ADR-0049 §Decision 2: Slide is a child of Block. `slideNumber` is
   * block-scoped, same max-plus-one convention as `addBlock` above.
   */
  @Post('v1/blocks/:id/slides')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'case.add_slide', resourceType: 'slide' })
  async addSlide(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [blockRow] = await tx
      .select()
      .from(block)
      .where(eq(block.id, id))
      .limit(1);
    if (!blockRow) {
      throw new NotFoundException('Block not found');
    }

    const [{ value: existingSlideCount }] = await tx
      .select({ value: count() })
      .from(slide)
      .where(eq(slide.blockId, id));

    const slideNumber = existingSlideCount + 1;
    const code = deriveSlideCode(blockRow.code, slideNumber);

    const [slideRow] = await tx
      .insert(slide)
      .values({ tenantId: user.tenantId, blockId: id, slideNumber, code })
      .returning();

    return {
      resourceId: slideRow.id,
      before: null,
      after: toSlideDto(slideRow),
    };
  }

  /**
   * ADR-0049 §Decision 4 (AC #4): a reflex/add-on stain creates a new
   * OrderedTest on an existing block, never a new Case or Specimen row --
   * reuses FEAT-030's existing `parentOrderedTestId` reflex-lineage self-FK
   * unchanged, just a new `block_fulfillment` row linking the new
   * OrderedTest to the existing block (the exact join-table mechanism
   * `specimen_fulfillment` already established for other disciplines).
   */
  @Post('v1/blocks/:id/ordered-tests')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({
    action: 'case.add_block_ordered_test',
    resourceType: 'ordered_test',
  })
  async addOrderedTest(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @Body(new ZodValidationPipe(blockOrderedTestLinkCreateSchema))
    body: BlockOrderedTestLinkCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [blockRow] = await tx
      .select()
      .from(block)
      .where(eq(block.id, id))
      .limit(1);
    if (!blockRow) {
      throw new NotFoundException('Block not found');
    }

    const [specimenRow] = await tx
      .select()
      .from(specimen)
      .where(eq(specimen.id, blockRow.specimenId))
      .limit(1);
    if (!specimenRow || !specimenRow.caseId) {
      throw new BadRequestException('Block is not linked to a case');
    }
    const [caseRow] = await tx
      .select()
      .from(caseTable)
      .where(eq(caseTable.id, specimenRow.caseId))
      .limit(1);
    if (!caseRow) {
      throw new BadRequestException('Block is not linked to a case');
    }

    const [testDef] = await tx
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(eq(testDefinition.id, body.testDefinitionId))
      .limit(1);
    if (!testDef) {
      throw new BadRequestException(
        `Unknown test definition id: ${body.testDefinitionId}`,
      );
    }

    const [orderedTestRow] = await tx
      .insert(orderedTest)
      .values({
        tenantId: user.tenantId,
        orderId: caseRow.orderId,
        testDefinitionId: body.testDefinitionId,
        parentOrderedTestId: body.parentOrderedTestId ?? null,
      })
      .returning();

    await tx.insert(blockFulfillment).values({
      tenantId: user.tenantId,
      blockId: id,
      orderedTestId: orderedTestRow.id,
    });

    return {
      resourceId: orderedTestRow.id,
      before: null,
      after: {
        ...orderedTestRow,
        createdAt: orderedTestRow.createdAt.toISOString(),
      },
    };
  }

  /** Full case → part → block → slide lineage in one response (AC #2). */
  @Get('v1/cases/:id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: CaseLineageDto, status: 200 })
  async getById(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<CaseLineage> {
    const [caseRow] = await tx
      .select()
      .from(caseTable)
      .where(eq(caseTable.id, id))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible (engineering/api-design entry #7).
    if (!caseRow) {
      throw new NotFoundException('Case not found');
    }

    const specimenRows = await tx
      .select()
      .from(specimen)
      .where(eq(specimen.caseId, id));
    const specimenIds = specimenRows.map((row) => row.id);

    const blockRows =
      specimenIds.length > 0
        ? await tx
            .select()
            .from(block)
            .where(inArray(block.specimenId, specimenIds))
        : [];
    const blockIds = blockRows.map((row) => row.id);

    const slideRows =
      blockIds.length > 0
        ? await tx.select().from(slide).where(inArray(slide.blockId, blockIds))
        : [];
    const fulfillmentRows =
      blockIds.length > 0
        ? await tx
            .select()
            .from(blockFulfillment)
            .where(inArray(blockFulfillment.blockId, blockIds))
        : [];

    const orderedTestIdsByBlockId = new Map<string, string[]>();
    for (const row of fulfillmentRows) {
      const existing = orderedTestIdsByBlockId.get(row.blockId) ?? [];
      existing.push(row.orderedTestId);
      orderedTestIdsByBlockId.set(row.blockId, existing);
    }
    const slidesByBlockId = new Map<string, typeof slideRows>();
    for (const row of slideRows) {
      const existing = slidesByBlockId.get(row.blockId) ?? [];
      existing.push(row);
      slidesByBlockId.set(row.blockId, existing);
    }
    const blocksBySpecimenId = new Map<string, typeof blockRows>();
    for (const row of blockRows) {
      const existing = blocksBySpecimenId.get(row.specimenId) ?? [];
      existing.push(row);
      blocksBySpecimenId.set(row.specimenId, existing);
    }

    return {
      ...toCaseDto(caseRow),
      parts: specimenRows.map((specimenRow) => ({
        id: specimenRow.id,
        accessionNumber: specimenRow.accessionNumber,
        specimenType: specimenRow.specimenType,
        status: specimenRow.status,
        blocks: (blocksBySpecimenId.get(specimenRow.id) ?? []).map(
          (blockRow) => ({
            ...toBlockDto(blockRow),
            orderedTestIds: orderedTestIdsByBlockId.get(blockRow.id) ?? [],
            slides: (slidesByBlockId.get(blockRow.id) ?? []).map(toSlideDto),
          }),
        ),
      })),
    };
  }

  /**
   * FEAT-059 (ADR-0051). The real, step-up-signed sign-out FEAT-057's own
   * placeholder deferred -- see this method's git history for that
   * placeholder's own header comment. Confirms every part has ≥1 active
   * block and every block has ≥1 active slide (AC #3's own "single
   * report-finalize action covers every part/block/slide under one case"),
   * then signs a new `case_report_version` (v1) binding the case's lineage +
   * synoptic content to this exact fresh step-up assertion.
   *
   * `verify` capability (not `manage_specimens`) + `@RequireStepUp()`: the
   * same gate `report.controller.ts generate()` already uses for "this
   * feature's own final, clinically-signed artifact", plus the new freshness
   * check (StepUpGuard, 403 `step_up_required` if `auth_time` is stale --
   * AC #1).
   *
   * No `@Audit()`/`AuditInterceptor` here -- exactly one `writeAuditEvent`
   * call below, inside the same transaction as the `case_report_version`
   * insert and the `case.status` update, matching AC #2's own "plus one
   * audit_event row in the same transaction" and the synoptic recorder's own
   * established "the function already writes its own audit event" precedent.
   */
  @Post('v1/cases/:id/finalize')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard, StepUpGuard)
  @RequireCapability('verify')
  @RequireStepUp()
  @UseInterceptors(TenantContextInterceptor)
  async finalize(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @Req() request: RequestWithGrantingRole,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [caseRow] = await tx
      .select()
      .from(caseTable)
      .where(eq(caseTable.id, id))
      .limit(1);
    if (!caseRow) {
      throw new NotFoundException('Case not found');
    }
    if (caseRow.status === 'signed_out' || caseRow.status === 'amended') {
      throw new BadRequestException(
        `Case ${id} is already finalized (status: ${caseRow.status})`,
      );
    }

    const { content, specimenRows, blockRows, slideRows } =
      await buildCaseReportContent(tx, caseRow);
    if (specimenRows.length === 0) {
      throw new BadRequestException('Case has no specimen/parts');
    }
    for (const specimenRow of specimenRows) {
      const activeBlocks = blockRows.filter(
        (row) => row.specimenId === specimenRow.id && row.status === 'active',
      );
      if (activeBlocks.length === 0) {
        throw new BadRequestException(
          `Part ${specimenRow.id} has no active block`,
        );
      }
      for (const blockRow of activeBlocks) {
        const activeSlides = slideRows.filter(
          (row) => row.blockId === blockRow.id && row.status === 'active',
        );
        if (activeSlides.length === 0) {
          throw new BadRequestException(
            `Block ${blockRow.id} has no active slide`,
          );
        }
      }
    }

    const contentHash = computeCaseReportContentHash(content);
    const authTimeUsed = request.authContext.authTime;
    const signature = signCaseReportContent({
      caseId: id,
      contentHash,
      actorPrincipalId: request.authContext.sub,
      authTimeUsed,
    });

    const [reportVersion] = await tx
      .insert(caseReportVersion)
      .values({
        tenantId: request.authContext.tenantId,
        caseId: id,
        versionNumber: 1,
        contentHash,
        includedContent: content,
        signature,
        signedByUserId: request.authContext.sub,
        signedByRole: request.grantingRole,
        authTimeUsed: new Date(authTimeUsed * 1000),
      })
      .returning();

    const [after] = await tx
      .update(caseTable)
      .set({ status: 'signed_out' })
      .where(eq(caseTable.id, id))
      .returning();

    await writeAuditEvent(tx, {
      tenantId: request.authContext.tenantId,
      actorPrincipalId: request.authContext.sub,
      actorRole: request.grantingRole,
      actorType: 'human',
      action: 'case.sign_out',
      resourceType: 'case_report_version',
      resourceId: reportVersion.id,
      before: null,
      after: {
        ...toCaseReportVersionDto(reportVersion),
        caseStatus: after.status,
      },
      context: {
        step_up: { authTime: authTimeUsed, method: 'reauthentication' },
      },
    });

    return {
      case: toCaseDto(after),
      reportVersion: toCaseReportVersionDto(reportVersion),
    };
  }

  /**
   * FEAT-059 (ADR-0051, AC #3). Amends an already-signed case: creates a new
   * `case_report_version` (`amendmentOf` the current `final` one), which the
   * `trg_case_report_version_supersede` trigger atomically marks the prior
   * version `superseded`. Same `verify` + `@RequireStepUp()` gates as
   * `finalize()` -- StepUpGuard re-checks freshness unconditionally on every
   * call, so this genuinely requires its own independent step-up, not a
   * carried-forward one from the original sign-out.
   */
  @Post('v1/cases/:id/amend')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, CapabilityGuard, StepUpGuard)
  @RequireCapability('verify')
  @RequireStepUp()
  @UseInterceptors(TenantContextInterceptor)
  async amend(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @Body(new ZodValidationPipe(caseAmendRequestSchema))
    body: CaseAmendRequestDto,
    @Req() request: RequestWithGrantingRole,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [caseRow] = await tx
      .select()
      .from(caseTable)
      .where(eq(caseTable.id, id))
      .limit(1);
    if (!caseRow) {
      throw new NotFoundException('Case not found');
    }
    if (caseRow.status !== 'signed_out' && caseRow.status !== 'amended') {
      throw new BadRequestException(
        `Case ${id} has not been signed out yet (status: ${caseRow.status})`,
      );
    }

    const [currentVersion] = await tx
      .select()
      .from(caseReportVersion)
      .where(
        and(
          eq(caseReportVersion.caseId, id),
          eq(caseReportVersion.status, 'final'),
        ),
      )
      .orderBy(desc(caseReportVersion.versionNumber))
      .limit(1);
    if (!currentVersion) {
      throw new BadRequestException(
        `Case ${id} has no signed version to amend`,
      );
    }

    const { content } = await buildCaseReportContent(tx, caseRow);
    const contentHash = computeCaseReportContentHash(content);
    const authTimeUsed = request.authContext.authTime;
    const signature = signCaseReportContent({
      caseId: id,
      contentHash,
      actorPrincipalId: request.authContext.sub,
      authTimeUsed,
    });

    const [newVersion] = await tx
      .insert(caseReportVersion)
      .values({
        tenantId: request.authContext.tenantId,
        caseId: id,
        versionNumber: currentVersion.versionNumber + 1,
        contentHash,
        includedContent: content,
        signature,
        signedByUserId: request.authContext.sub,
        signedByRole: request.grantingRole,
        authTimeUsed: new Date(authTimeUsed * 1000),
        amendmentOf: currentVersion.id,
        reason: body.reason,
      })
      .returning();

    const [after] = await tx
      .update(caseTable)
      .set({ status: 'amended' })
      .where(eq(caseTable.id, id))
      .returning();

    await writeAuditEvent(tx, {
      tenantId: request.authContext.tenantId,
      actorPrincipalId: request.authContext.sub,
      actorRole: request.grantingRole,
      actorType: 'human',
      action: 'case.amend',
      resourceType: 'case_report_version',
      resourceId: newVersion.id,
      before: toCaseReportVersionDto(currentVersion),
      after: {
        ...toCaseReportVersionDto(newVersion),
        caseStatus: after.status,
      },
      reason: body.reason,
      context: {
        step_up: { authTime: authTimeUsed, method: 'reauthentication' },
      },
    });

    return {
      case: toCaseDto(after),
      reportVersion: toCaseReportVersionDto(newVersion),
    };
  }
}
