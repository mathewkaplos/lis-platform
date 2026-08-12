import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  blockCreateSchema,
  blockOrderedTestLinkCreateSchema,
  caseCreateSchema,
  caseLineageSchema,
  type Block,
  type Case,
  type CaseLineage,
  type Slide,
} from '@lis/domain';
import {
  block,
  blockFulfillment,
  caseTable,
  deriveBlockCode,
  deriveCaseSpecimenAccessionNumber,
  deriveSlideCode,
  generateAccessionNumber,
  order,
  orderedTest,
  slide,
  specimen,
  testDefinition,
} from '@lis/db';
import { and, count, eq, inArray } from 'drizzle-orm';
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

const idParamSchema = z.object({ id: z.uuid() });

class CaseCreateDto extends createZodDto(caseCreateSchema) {}
class CaseLineageDto extends createZodDto(caseLineageSchema) {}
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
   * Proposal §5 scope cut: transitions `case.status` to `signed_out` after
   * confirming every part has ≥1 active block and every block has ≥1 active
   * slide (AC #3's own "single report-finalize action covers every
   * part/block/slide under one case" read at the lineage-completeness level,
   * not a generated report -- see the proposal's §5/§10 Q1 for why `report.ts`
   * is untouched here, deferred to FEAT-058/059).
   */
  @Post('v1/cases/:id/finalize')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'case.finalize', resourceType: 'case' })
  async finalize(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
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

    const specimenRows = await tx
      .select()
      .from(specimen)
      .where(eq(specimen.caseId, id));
    if (specimenRows.length === 0) {
      throw new BadRequestException('Case has no specimen/parts');
    }
    const specimenIds = specimenRows.map((row) => row.id);
    const blockRows = await tx
      .select()
      .from(block)
      .where(inArray(block.specimenId, specimenIds));
    const blockIds = blockRows.map((row) => row.id);
    const slideRows =
      blockIds.length > 0
        ? await tx.select().from(slide).where(inArray(slide.blockId, blockIds))
        : [];

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

    const [before] = await tx
      .select()
      .from(caseTable)
      .where(eq(caseTable.id, id))
      .limit(1);
    const [after] = await tx
      .update(caseTable)
      .set({ status: 'signed_out' })
      .where(eq(caseTable.id, id))
      .returning();

    return {
      resourceId: id,
      before: toCaseDto(before),
      after: toCaseDto(after),
    };
  }
}
