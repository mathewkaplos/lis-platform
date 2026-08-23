import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  blockCreateSchema,
  blockOrderedTestLinkCreateSchema,
  caseAmendRequestSchema,
  caseReturnToScreeningRequestSchema,
  caseAuditTrailResponseSchema,
  caseCreateSchema,
  caseLineageSchema,
  caseListQuerySchema,
  caseListResponseSchema,
  caseNarrativeUpdateSchema,
  caseReportSendEmailRequestSchema,
  caseReportVersionListResponseSchema,
  caseSynopticResponseListSchema,
  type Block,
  type Case,
  type CaseAuditEvent,
  type CaseAuditTrailResponse,
  type CaseLineage,
  type CaseLineageSlide,
  type CaseListResponse,
  type CaseNarrative,
  type CaseReportVersion,
  type CaseReportVersionListResponse,
  type CaseSynopticResponseList,
  type Slide,
  type WholeSlideImageStatus,
} from '@lis/domain';
import {
  auditEvent,
  block,
  blockFulfillment,
  caseNarrative,
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
  patient,
  signCaseReportContent,
  slide,
  specimen,
  specimenFulfillment,
  wholeSlideImage,
  synopticElement,
  synopticProtocol,
  synopticProtocolVersion,
  testDefinition,
  writeAuditEvent,
} from '@lis/db';
import { assembleCaseReportContent } from './case-report-content-assembler';
import { sendEmail } from '../email/email.client';
import { renderCaseReportPdf } from './case-report-render';
import { findSynopticGridAnalyte } from '../synoptic-protocol/synoptic-response-recorder';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
} from 'drizzle-orm';
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
import { requiresTwoTierReview } from './case-tiering';

const idParamSchema = z.object({ id: z.uuid() });
const reportVersionPdfParamSchema = z.object({
  id: z.uuid(),
  versionId: z.uuid(),
});

class CaseCreateDto extends createZodDto(caseCreateSchema) {}
class CaseLineageDto extends createZodDto(caseLineageSchema) {}
class CaseAmendRequestDto extends createZodDto(caseAmendRequestSchema) {}
class CaseReturnToScreeningRequestDto extends createZodDto(
  caseReturnToScreeningRequestSchema,
) {}
class CaseNarrativeUpdateDto extends createZodDto(caseNarrativeUpdateSchema) {}
class CaseReportSendEmailRequestDto extends createZodDto(
  caseReportSendEmailRequestSchema,
) {}
class CaseListQueryDto extends createZodDto(caseListQuerySchema) {}
class CaseListResponseDto extends createZodDto(caseListResponseSchema) {}
class CaseAuditTrailResponseDto extends createZodDto(
  caseAuditTrailResponseSchema,
) {}
class CaseReportVersionListResponseDto extends createZodDto(
  caseReportVersionListResponseSchema,
) {}
class CaseSynopticResponseListDto extends createZodDto(
  caseSynopticResponseListSchema,
) {}
class BlockCreateDto extends createZodDto(blockCreateSchema) {}
class BlockOrderedTestLinkCreateDto extends createZodDto(
  blockOrderedTestLinkCreateSchema,
) {}
class IdParamDto extends createZodDto(idParamSchema) {}
class ReportVersionPdfParamDto extends createZodDto(
  reportVersionPdfParamSchema,
) {}

function toCaseDto(row: typeof caseTable.$inferSelect): Case {
  return {
    ...row,
    status: row.status as Case['status'], // CHECK-constrained (ck_case_status)
    createdAt: row.createdAt.toISOString(),
  };
}

// Issue #714: `context` is a loosely-typed jsonb column at the schema level
// (`{ request_id, session_ref, source_ip, client, step_up? }`, per
// audit.ts's own header comment) -- narrowed here to just the one field
// this screen surfaces, matching every other text-discriminator DTO in this
// file's "narrow at the response boundary" convention.
function toCaseAuditEventDto(
  row: typeof auditEvent.$inferSelect,
): CaseAuditEvent {
  const context = row.context as {
    step_up?: { authTime: number; method: string };
  } | null;
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    action: row.action,
    actorPrincipalId: row.actorPrincipalId,
    actorRole: row.actorRole,
    reason: row.reason,
    stepUp: context?.step_up
      ? { authTime: context.step_up.authTime, method: context.step_up.method }
      : null,
  };
}

function toCaseNarrativeDto(
  row: typeof caseNarrative.$inferSelect,
): CaseNarrative {
  return {
    grossDescription: row.grossDescription,
    microscopicDescription: row.microscopicDescription,
    diagnosis: row.diagnosis,
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

// FEAT-067 (ADR-0055): the lineage response's own per-slide shape --
// wholeSlideImageRow is undefined when no WSI has been uploaded for this
// slide yet, mapped to null (the wire shape caseLineageSlideSchema expects,
// not an omitted key -- an omitted key would break AuditInterceptor-style
// hashing the same way order.controller.ts's own toOrderDto header comment
// already documents for a different response, though this route isn't
// itself audited).
function toCaseLineageSlideDto(
  row: typeof slide.$inferSelect,
  wholeSlideImageRow: typeof wholeSlideImage.$inferSelect | undefined,
): CaseLineageSlide {
  return {
    ...toSlideDto(row),
    wholeSlideImage: wholeSlideImageRow
      ? {
          id: wholeSlideImageRow.id,
          status: wholeSlideImageRow.status as WholeSlideImageStatus,
        }
      : null,
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
 * FEAT-057/059/063 shared. The full part/block/slide lineage for a case,
 * with no observation/content assembly -- used by `screen()` and `finalize()`
 * alike (both need this same tree, `finalize()`'s own `buildCaseReportContent`
 * below layers the signed-content assembly on top of it).
 */
async function loadCaseLineage(
  tx: RequestWithTx['tx'],
  caseId: string,
): Promise<{
  specimenRows: (typeof specimen.$inferSelect)[];
  blockRows: (typeof block.$inferSelect)[];
  slideRows: (typeof slide.$inferSelect)[];
}> {
  const specimenRows = await tx
    .select()
    .from(specimen)
    .where(eq(specimen.caseId, caseId));
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
  return { specimenRows, blockRows, slideRows };
}

/**
 * FEAT-057/059/063 shared (AC #3's own "single report-finalize action covers
 * every part/block/slide under one case"). Extracted out of `finalize()` so
 * `screen()` can require the same completeness before a case leaves
 * cytotechnologist hands, not just at final sign-out.
 */
function assertCompleteLineage(
  specimenRows: (typeof specimen.$inferSelect)[],
  blockRows: (typeof block.$inferSelect)[],
  slideRows: (typeof slide.$inferSelect)[],
): void {
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
  const { specimenRows, blockRows, slideRows } = await loadCaseLineage(
    tx,
    caseRow.id,
  );

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

  // Issue #669: `isNull(supersededBy)` -- taken here, at sign time, so a
  // re-recorded (amended, #662) element's stale predecessor Observation
  // never gets snapshotted alongside its current value (a real bug found
  // during this issue's own investigation: without this filter, every
  // re-recording duplicated both the old and new value in every signed
  // report thereafter). An already-signed version's own frozen snapshot
  // is unaffected by a later amendment -- this filter only changes what a
  // *future* sign/amend call captures, preserving the same immutability
  // invariant `case_narrative`'s own value-snapshot already establishes.
  const observationRows =
    orderedTestIds.length > 0
      ? await tx
          .select({
            id: observation.id,
            analyteId: observation.analyteId,
            createdAt: observation.createdAt,
          })
          .from(observation)
          .where(
            and(
              inArray(observation.orderedTestId, orderedTestIds),
              isNull(observation.supersededBy),
            ),
          )
      : [];
  const synopticResponses = observationRows
    .filter((row) => synopticAnalyteIds.has(row.analyteId))
    .map((row) => ({ id: row.id, createdAt: row.createdAt.toISOString() }));

  // Issue #636: a real value snapshot, not a reference by id -- unlike
  // synoptic responses (safely referenced because a verified `observation`
  // row is immutable via a real trigger), `case_narrative` has no such
  // protection. Copying the current values in here, at the one point
  // finalize()/amend() both already call before signing, is what keeps an
  // already-signed version's own `includedContent` from silently changing
  // if the narrative is edited afterward (proposal §2/§6).
  const [narrativeRow] = await tx
    .select()
    .from(caseNarrative)
    .where(eq(caseNarrative.caseId, caseRow.id))
    .limit(1);

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
      narrative: {
        grossDescription: narrativeRow?.grossDescription ?? null,
        microscopicDescription: narrativeRow?.microscopicDescription ?? null,
        diagnosis: narrativeRow?.diagnosis ?? null,
      },
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
   *
   * Issue #561: also insert a `specimen_fulfillment` row (targeting the
   * block's own parent specimen, already loaded as `specimenRow` below) and
   * set `status: 'received'` directly -- `ObservationWriteService.loadWriteContext`
   * hard-requires both for any result-entry route, and `block_fulfillment`
   * alone was leaving every block-linked OrderedTest permanently un-enterable.
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
        // 'received' directly, skipping 'ordered'/'collected' -- no physical
        // recollection for a block already in hand (same reasoning as
        // add-block-reflex-test.command.ts's identical direct-set).
        status: 'received',
      })
      .returning();

    await tx.insert(blockFulfillment).values({
      tenantId: user.tenantId,
      blockId: id,
      orderedTestId: orderedTestRow.id,
    });

    await tx.insert(specimenFulfillment).values({
      tenantId: user.tenantId,
      specimenId: specimenRow.id,
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

  /**
   * FEAT-063 (§10 Q3/Q4). A live query over `case.status` (KB-26's own
   * "worklist = live query" principle), this repo's first case-listing
   * route -- satisfies AC #3's "the screening tier's own task appears on the
   * correct role's worklist" via `?status=accessioned` (a freshly-accessioned
   * case's own default status, and `?status=in_process` once some future
   * feature starts writing that value -- neither `case.controller.ts` nor
   * any other code sets it today) for the cytotechnologist's screening
   * queue, and `?status=pending_review` for the cytopathologist's
   * review/sign-out queue -- without a new Task-record mechanism. No
   * `status` filter excludes terminal states (`signed_out`/`amended`) by
   * default, matching `worklist.controller.ts`'s own `ACTIVE_STATUSES`
   * precedent -- read-only, no capability gate, same as `getById` below.
   */
  @Get('v1/cases')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: CaseListResponseDto, status: 200 })
  async list(
    @Query(new ZodValidationPipe(caseListQuerySchema)) query: CaseListQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<CaseListResponse> {
    const rows = await tx
      .select()
      .from(caseTable)
      .where(
        query.status
          ? eq(caseTable.status, query.status)
          : notInArray(caseTable.status, ['signed_out', 'amended']),
      )
      .orderBy(desc(caseTable.createdAt));

    return { items: rows.map(toCaseDto) };
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
    // FEAT-067 (ADR-0055): each slide's own most-recent whole-slide-image
    // row, batch-fetched the same way blocks/slides/fulfillments already
    // are -- ordered newest-first so the first row seen per slideId in the
    // loop below is the one the case detail page should surface (a rescan
    // is a real, plausible event; no supersede/version chain exists, "most
    // recent wins" is the whole policy).
    const slideIds = slideRows.map((row) => row.id);
    const wholeSlideImageRows =
      slideIds.length > 0
        ? await tx
            .select()
            .from(wholeSlideImage)
            .where(inArray(wholeSlideImage.slideId, slideIds))
            .orderBy(desc(wholeSlideImage.createdAt))
        : [];
    const wholeSlideImageBySlideId = new Map<
      string,
      (typeof wholeSlideImageRows)[number]
    >();
    for (const row of wholeSlideImageRows) {
      if (!wholeSlideImageBySlideId.has(row.slideId)) {
        wholeSlideImageBySlideId.set(row.slideId, row);
      }
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

    // Issue #636: folded into the lineage response the same way
    // `wholeSlideImage` already is on each slide -- avoids a second round
    // trip from the case detail page, which already calls this route once.
    const [narrativeRow] = await tx
      .select()
      .from(caseNarrative)
      .where(eq(caseNarrative.caseId, id))
      .limit(1);

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
            slides: (slidesByBlockId.get(blockRow.id) ?? []).map((slideRow) =>
              toCaseLineageSlideDto(
                slideRow,
                wholeSlideImageBySlideId.get(slideRow.id),
              ),
            ),
          }),
        ),
      })),
      narrative: narrativeRow ? toCaseNarrativeDto(narrativeRow) : null,
    };
  }

  /**
   * Issue #714 (EPIC #697): the case's own audit trail -- previously
   * visible only by reading a raw API response (`finalize()`/`amend()`'s
   * own `context.step_up`), never from a screen. Read-only, no capability
   * gate, same as `getById`/`list` above -- viewing a case's own history is
   * informational, not a write action.
   *
   * Two `resourceType`s merged: the case's own directly-audited actions
   * (`resourceType: 'case'`, resourceId = this case's id -- accession,
   * add_block, add_slide, record_narrative, screen, return_to_screening)
   * and its report-version lifecycle events (`resourceType:
   * 'case_report_version'`, resourceId = one of this case's own report
   * version ids -- sign_out, amend). Not every child entity's own
   * individually-audited row (a block's `resourceType: 'block'` carries the
   * *block's* id, not the case's) -- this is the case-lifecycle trail the
   * issue itself names, not a full recursive audit of every descendant.
   */
  @Get('v1/cases/:id/audit-trail')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: CaseAuditTrailResponseDto, status: 200 })
  async getAuditTrail(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<CaseAuditTrailResponse> {
    const [caseRow] = await tx
      .select({ id: caseTable.id })
      .from(caseTable)
      .where(eq(caseTable.id, id))
      .limit(1);
    if (!caseRow) {
      throw new NotFoundException('Case not found');
    }

    const reportVersionRows = await tx
      .select({ id: caseReportVersion.id })
      .from(caseReportVersion)
      .where(eq(caseReportVersion.caseId, id));
    const reportVersionIds = reportVersionRows.map((row) => row.id);

    const rows = await tx
      .select()
      .from(auditEvent)
      .where(
        or(
          and(
            eq(auditEvent.resourceType, 'case'),
            eq(auditEvent.resourceId, id),
          ),
          reportVersionIds.length > 0
            ? and(
                eq(auditEvent.resourceType, 'case_report_version'),
                inArray(auditEvent.resourceId, reportVersionIds),
              )
            : undefined,
        ),
      )
      .orderBy(desc(auditEvent.sequence));

    return { items: rows.map(toCaseAuditEventDto) };
  }

  /**
   * Issue #636. Upserts the case's own narrative row -- `manage_specimens`
   * (same routine-mutation gate as accession/block/slide/ordered-test/
   * screen), no step-up (the real diagnostic gate stays `finalize()`'s own
   * `verify` + step-up; narrative is draft documentation until signed,
   * matching #621/#624's own "draft-time gates are UI convenience" pattern).
   * Genuinely mutable at any case status (proposal §5) -- unlike every other
   * AP mutation here, deliberately no wrong-status guard.
   *
   * `onConflictDoUpdate` rather than this file's own usual select-then-
   * branch convention: an always-editable field genuinely invites a
   * concurrent-save race no other AP mutation here has (proposal §5/§6) --
   * two overlapping saves under select-then-decide could otherwise violate
   * `ux_case_narrative_case` or silently drop one writer's edit.
   *
   * No `@ZodResponse` here, correcting the proposal's own initial
   * assumption -- `AuditInterceptor` (`audit.interceptor.ts:82`) wraps
   * every `@Audit()` route's return value into `{resourceId, before, after,
   * actorRole}` before it reaches the client, the exact same reason every
   * other `@Audit()`-decorated route in this file (`addBlock`/`addSlide`/
   * `addOrderedTest`) also leaves its response undocumented: documenting
   * this as a clean `CaseNarrative` shape would misdescribe the real wire
   * response. Confirmed by reading the interceptor directly during
   * implementation, not assumed from the proposal.
   */
  @Put('v1/cases/:id/narrative')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'case.record_narrative', resourceType: 'case_narrative' })
  async updateNarrative(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @Body(new ZodValidationPipe(caseNarrativeUpdateSchema))
    body: CaseNarrativeUpdateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [caseRow] = await tx
      .select({ id: caseTable.id })
      .from(caseTable)
      .where(eq(caseTable.id, id))
      .limit(1);
    if (!caseRow) {
      throw new NotFoundException('Case not found');
    }

    const [existingRow] = await tx
      .select()
      .from(caseNarrative)
      .where(eq(caseNarrative.caseId, id))
      .limit(1);

    const [narrativeRow] = await tx
      .insert(caseNarrative)
      .values({
        tenantId: user.tenantId,
        caseId: id,
        grossDescription: body.grossDescription ?? null,
        microscopicDescription: body.microscopicDescription ?? null,
        diagnosis: body.diagnosis ?? null,
        updatedByUserId: user.sub,
      })
      .onConflictDoUpdate({
        target: caseNarrative.caseId,
        set: {
          ...(body.grossDescription !== undefined
            ? { grossDescription: body.grossDescription }
            : {}),
          ...(body.microscopicDescription !== undefined
            ? { microscopicDescription: body.microscopicDescription }
            : {}),
          ...(body.diagnosis !== undefined
            ? { diagnosis: body.diagnosis }
            : {}),
          updatedAt: new Date(),
          updatedByUserId: user.sub,
        },
      })
      .returning();

    return {
      resourceId: narrativeRow.id,
      before: existingRow ? toCaseNarrativeDto(existingRow) : null,
      after: toCaseNarrativeDto(narrativeRow),
    };
  }

  /**
   * Issue #615: metadata-only version history for a case's signed/amended
   * report chain -- read-only, no capability gate, same precedent as
   * `getById` above (RLS via `TenantContextInterceptor` is the only tenant
   * boundary, matching `engineering/api-design` entry #7). Ordered
   * newest-first so a caller can show "current" first without re-sorting.
   */
  @Get('v1/cases/:id/report-versions')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: CaseReportVersionListResponseDto, status: 200 })
  async listReportVersions(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<CaseReportVersionListResponse> {
    const [caseRow] = await tx
      .select()
      .from(caseTable)
      .where(eq(caseTable.id, id))
      .limit(1);
    if (!caseRow) {
      throw new NotFoundException('Case not found');
    }

    const rows = await tx
      .select()
      .from(caseReportVersion)
      .where(eq(caseReportVersion.caseId, id))
      .orderBy(desc(caseReportVersion.versionNumber));

    return { items: rows.map(toCaseReportVersionDto) };
  }

  /**
   * Issue #659 (proposal `task-659-synoptic-response-read-path.md`). A
   * recorded synoptic protocol response had no read path at all before this
   * -- every recording writes a `table`-dataType "grid" Observation under
   * the shared synoptic-report-grid analyte (`synoptic-response-recorder.ts`)
   * whose `valueJson` already holds exactly the `{synopticProtocolVersionId,
   * results}` shape this route returns; no re-derivation from discrete
   * Observations needed.
   *
   * Same read-only, `JwtAuthGuard`-only, no-`@Audit()` shape as
   * `listReportVersions`/`getReportVersionPdf` above (RLS is the tenant
   * boundary; `engineering/api-design` entry #6 -- only mutating actions are
   * audited).
   *
   * Keyed on `(orderedTestId, synopticProtocolVersionId)`, most-recent-wins
   * per key -- mirrors `wholeSlideImage`'s own already-proven
   * "most-recent-ready-wins, no version chain" policy (`getById` above).
   * **Not part-scoped**: responses aren't tied to a specimen/part in the
   * write path today (found during this issue's own implementation, tracked
   * separately as issue #674) -- a case with two eligible parts recorded
   * against the *same* protocol will only surface the more recent of the
   * two here. Real response versioning/edit is issue #662's separate,
   * larger concern; this route does not attempt it.
   */
  @Get('v1/cases/:id/synoptic-responses')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: CaseSynopticResponseListDto, status: 200 })
  async listSynopticResponses(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<CaseSynopticResponseList> {
    const [caseRow] = await tx
      .select()
      .from(caseTable)
      .where(eq(caseTable.id, id))
      .limit(1);
    if (!caseRow) {
      throw new NotFoundException('Case not found');
    }

    const gridAnalyte = await findSynopticGridAnalyte(tx);
    if (!gridAnalyte) {
      return { responses: [] };
    }

    const orderedTestRows = await tx
      .select({ id: orderedTest.id })
      .from(orderedTest)
      .where(eq(orderedTest.orderId, caseRow.orderId));
    const orderedTestIds = orderedTestRows.map((row) => row.id);
    if (orderedTestIds.length === 0) {
      return { responses: [] };
    }

    // Issue #662: `supersededBy IS NULL` is the real chain-head filter now
    // that a real amendment_of/superseded_by chain exists (previously this
    // just took the newest row per key by timestamp, a heuristic that
    // happened to agree with the chain head in the common case but wasn't
    // provably correct). The `orderBy(createdAt desc)` + per-key dedup below
    // stays as defensive belt-and-suspenders against the acknowledged (and
    // accepted, proposal §6/§10 Q2) race where two concurrent recordings
    // could both legally chain onto the same predecessor, leaving more than
    // one non-superseded row for one key -- extremely unlikely, not
    // eliminated by this filter alone.
    const gridObservationRows = await tx
      .select()
      .from(observation)
      .where(
        and(
          inArray(observation.orderedTestId, orderedTestIds),
          eq(observation.analyteId, gridAnalyte.id),
          eq(observation.dataType, 'table'),
          isNull(observation.supersededBy),
        ),
      )
      .orderBy(desc(observation.createdAt));

    // Issue #674: per (specimenId, synopticProtocolVersionId), not
    // (orderedTestId, synopticProtocolVersionId) -- orderedTestId alone
    // can't distinguish two eligible parts recorded against the same
    // protocol (there is no per-part ordered test in this schema).
    // specimenId is nullable (NULL for any response recorded before this
    // issue landed); every NULL-specimenId row still groups together
    // under one key, matching the pre-#674 behavior exactly for that
    // transitional data. Rows are already newest-first, so the first one
    // seen per key is kept (see comment above on why more than one
    // non-superseded row is possible in theory).
    const seenKeys = new Set<string>();
    const latestByKey: (typeof gridObservationRows)[number][] = [];
    for (const row of gridObservationRows) {
      const payload = row.valueJson as {
        synopticProtocolVersionId: string;
        results: unknown[];
      } | null;
      if (!payload?.synopticProtocolVersionId || !row.orderedTestId) continue;
      const key = `${row.specimenId ?? 'null'}:${payload.synopticProtocolVersionId}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      latestByKey.push(row);
    }
    if (latestByKey.length === 0) {
      return { responses: [] };
    }

    const versionIds = [
      ...new Set(
        latestByKey.map(
          (row) =>
            (row.valueJson as { synopticProtocolVersionId: string })
              .synopticProtocolVersionId,
        ),
      ),
    ];
    const versionRows = await tx
      .select({
        id: synopticProtocolVersion.id,
        synopticProtocolId: synopticProtocolVersion.synopticProtocolId,
      })
      .from(synopticProtocolVersion)
      .where(inArray(synopticProtocolVersion.id, versionIds));
    const protocolIdByVersionId = new Map(
      versionRows.map((row) => [row.id, row.synopticProtocolId]),
    );

    const protocolIds = [...new Set(protocolIdByVersionId.values())];
    const protocolRows =
      protocolIds.length > 0
        ? await tx
            .select({ id: synopticProtocol.id, name: synopticProtocol.name })
            .from(synopticProtocol)
            .where(inArray(synopticProtocol.id, protocolIds))
        : [];
    const protocolNameById = new Map(
      protocolRows.map((row) => [row.id, row.name]),
    );

    return {
      responses: latestByKey.map((row) => {
        const payload = row.valueJson as {
          synopticProtocolVersionId: string;
          results: CaseSynopticResponseList['responses'][number]['results'];
        };
        const synopticProtocolId =
          protocolIdByVersionId.get(payload.synopticProtocolVersionId) ?? '';
        return {
          orderedTestId: row.orderedTestId as string,
          specimenId: row.specimenId,
          synopticProtocolId,
          synopticProtocolVersionId: payload.synopticProtocolVersionId,
          protocolName:
            protocolNameById.get(synopticProtocolId) ?? 'Unknown protocol',
          tableObservationId: row.id,
          recordedAt: row.createdAt.toISOString(),
          amendmentOf: row.amendmentOf,
          results: payload.results,
        };
      }),
    };
  }

  /**
   * Issue #648 (proposal §5.1/§5.3). A pure read of already-signed, immutable
   * content -- no new `report` row, no `@Audit()`, `GET` not `POST` (a
   * deliberate divergence from `POST /v1/ordered-tests/:id/report`'s own
   * write-and-audit shape, since re-rendering this PDF records no new fact).
   * Same `JwtAuthGuard`-only gate as `listReportVersions` above (proposal
   * §10 Q1) -- RLS via `TenantContextInterceptor` is the real tenant
   * boundary, matching every other read-only case route this session.
   */
  @Get('v1/cases/:id/report-versions/:versionId/pdf')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  async getReportVersionPdf(
    @Param(new ZodValidationPipe(reportVersionPdfParamSchema))
    { id, versionId }: ReportVersionPdfParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<StreamableFile> {
    const [caseRow] = await tx
      .select()
      .from(caseTable)
      .where(eq(caseTable.id, id))
      .limit(1);
    if (!caseRow) {
      throw new NotFoundException('Case not found');
    }

    const [versionRow] = await tx
      .select()
      .from(caseReportVersion)
      .where(eq(caseReportVersion.id, versionId))
      .limit(1);
    if (!versionRow || versionRow.caseId !== id) {
      throw new NotFoundException('Report version not found');
    }

    const content = await assembleCaseReportContent(
      tx,
      versionRow.includedContent as Parameters<
        typeof assembleCaseReportContent
      >[1],
    );
    const pdf = await renderCaseReportPdf({
      caseAccessionNumber: caseRow.accessionNumber,
      caseStatus: caseRow.status,
      content,
      version: {
        versionNumber: versionRow.versionNumber,
        status: versionRow.status,
        signedByRole: versionRow.signedByRole,
        signedAt: versionRow.signedAt.toISOString(),
        reason: versionRow.reason,
      },
    });

    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="case-report-${id}-v${versionRow.versionNumber}.pdf"`,
    });
  }

  /**
   * Pilot-readiness audit follow-up (email delivery, deliberately deferred
   * at #698, now built per explicit human decision -- Gmail SMTP with an
   * app password, `apps/api/src/email/email.client.ts`). Renders the exact
   * same PDF `getReportVersionPdf` above does (same already-signed,
   * immutable content -- no new fact recorded about the report itself) and
   * emails it as an attachment.
   *
   * `manage_specimens` (not `verify`) -- same capability every other
   * routine AP workflow action in this controller uses
   * (`screen`/`addBlock`/`addSlide`), not the higher `verify` bar
   * `finalize`/`amend` require. Sending an already-signed, immutable
   * report externally is a distribution action on content a
   * `manage_specimens`-capable user can already read in full via
   * `getReportVersionPdf` above (same capability gate) -- it doesn't
   * itself alter or attest to anything new, unlike `finalize`/`amend`'s
   * own diagnostic-release actions. No `@RequireStepUp()` for the same
   * reason `screen()`'s own header comment gives: this isn't the actual
   * diagnostic release ADR-0051 scopes step-up to.
   *
   * `to` is optional in the request body -- when omitted, resolves the
   * case's own order's patient's on-file email (`patient.email`, FEAT-066).
   * A patient with no email on file AND no explicit `to` is a real 400,
   * not a silent no-op.
   */
  @Post('v1/cases/:id/report-versions/:versionId/send-email')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'case.report_emailed', resourceType: 'case_report_version' })
  async sendReportVersionEmail(
    @Param(new ZodValidationPipe(reportVersionPdfParamSchema))
    { id, versionId }: ReportVersionPdfParamDto,
    @Body(new ZodValidationPipe(caseReportSendEmailRequestSchema))
    body: CaseReportSendEmailRequestDto,
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

    const [versionRow] = await tx
      .select()
      .from(caseReportVersion)
      .where(eq(caseReportVersion.id, versionId))
      .limit(1);
    if (!versionRow || versionRow.caseId !== id) {
      throw new NotFoundException('Report version not found');
    }

    let recipient = body.to;
    if (!recipient) {
      const [orderRow] = await tx
        .select()
        .from(order)
        .where(eq(order.id, caseRow.orderId))
        .limit(1);
      if (orderRow) {
        const [patientRow] = await tx
          .select()
          .from(patient)
          .where(eq(patient.id, orderRow.patientId))
          .limit(1);
        recipient = patientRow?.email ?? undefined;
      }
    }
    if (!recipient) {
      throw new BadRequestException(
        'This patient has no email on file — enter a recipient address.',
      );
    }

    const content = await assembleCaseReportContent(
      tx,
      versionRow.includedContent as Parameters<
        typeof assembleCaseReportContent
      >[1],
    );
    const pdf = await renderCaseReportPdf({
      caseAccessionNumber: caseRow.accessionNumber,
      caseStatus: caseRow.status,
      content,
      version: {
        versionNumber: versionRow.versionNumber,
        status: versionRow.status,
        signedByRole: versionRow.signedByRole,
        signedAt: versionRow.signedAt.toISOString(),
        reason: versionRow.reason,
      },
    });

    await sendEmail({
      to: recipient,
      subject: `Pathology report — case ${caseRow.accessionNumber}`,
      text: `The signed pathology report for case ${caseRow.accessionNumber} (version ${versionRow.versionNumber}) is attached.`,
      attachments: [
        {
          filename: `case-report-${id}-v${versionRow.versionNumber}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });

    return {
      resourceId: versionRow.id,
      after: { sentTo: recipient },
    };
  }

  /**
   * FEAT-063 (docs/plans/feat-063-cytology-two-tier-workflow.md, §10 Q1/Q2).
   * Transitions a case that requires cytopathologist two-tier review
   * (case-tiering.ts's `requiresTwoTierReview`, derived from specimen type)
   * from `accessioned`/`in_process` to `pending_review`, gating `finalize`
   * below (AC #1). Rejects a case that doesn't require two-tier review at
   * all (nothing to screen -- histology goes straight to `finalize`,
   * unchanged) and a case whose lineage isn't yet complete (same
   * `assertCompleteLineage` gate `finalize` itself uses).
   *
   * `manage_specimens` (not `verify`) -- granted to both `technologist` and
   * `verifier`, the same capability every other AP mutation route in this
   * controller uses. `finalize` staying `verify`-only (unchanged) is what
   * makes AC #2 ("a cytotechnologist cannot sign out") true by construction:
   * no new capability needed. No `@RequireStepUp()` here -- ADR-0051 scopes
   * step-up + digital signature to the actual diagnostic release
   * (`finalize`/`amend`), not this routine tier transition.
   */
  @Post('v1/cases/:id/screen')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'case.screen', resourceType: 'case' })
  async screen(
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
    if (caseRow.status !== 'accessioned' && caseRow.status !== 'in_process') {
      throw new BadRequestException(
        `Case ${id} cannot be screened from its current status (status: ${caseRow.status})`,
      );
    }

    const { specimenRows, blockRows, slideRows } = await loadCaseLineage(
      tx,
      id,
    );
    if (!requiresTwoTierReview(specimenRows.map((row) => row.specimenType))) {
      throw new BadRequestException(
        `Case ${id} does not require screening (no cytopathologist two-tier review needed)`,
      );
    }
    assertCompleteLineage(specimenRows, blockRows, slideRows);

    const [after] = await tx
      .update(caseTable)
      .set({ status: 'pending_review' })
      .where(eq(caseTable.id, id))
      .returning();

    return {
      resourceId: after.id,
      before: toCaseDto(caseRow),
      after: toCaseDto(after),
    };
  }

  /**
   * Issue #639. The reverse of `screen()` above -- a cytopathologist
   * reviewing a `pending_review` case sends it back for correction.
   * `verify` (not `manage_specimens`): a reviewer's own decision, the same
   * actor category as `finalize`/`amend`, not a routine technologist
   * action. No `@RequireStepUp()` -- same "routine tier transition, not the
   * actual diagnostic release" reasoning `screen()`'s own header comment
   * already establishes. Transitions to `in_process`, the same re-entry
   * status `screen()` itself accepts (`accessioned` OR `in_process`), so a
   * corrected case can be re-screened via the existing route unchanged.
   */
  @Post('v1/cases/:id/return-to-screening')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('verify')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'case.return_to_screening', resourceType: 'case' })
  async returnToScreening(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @Body(new ZodValidationPipe(caseReturnToScreeningRequestSchema))
    body: CaseReturnToScreeningRequestDto,
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
    if (caseRow.status !== 'pending_review') {
      throw new BadRequestException(
        `Case ${id} cannot be returned to screening from its current status (status: ${caseRow.status})`,
      );
    }

    const [after] = await tx
      .update(caseTable)
      .set({ status: 'in_process' })
      .where(eq(caseTable.id, id))
      .returning();

    return {
      resourceId: after.id,
      before: toCaseDto(caseRow),
      after: toCaseDto(after),
      reason: body.reason,
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
    assertCompleteLineage(specimenRows, blockRows, slideRows);

    // FEAT-063 (AC #1): a case requiring cytopathologist two-tier review
    // must have been screened first -- caseRow.status here is whatever it
    // was before this transaction (accessioned/in_process/pending_review),
    // not yet updated to signed_out below.
    if (
      requiresTwoTierReview(specimenRows.map((row) => row.specimenType)) &&
      caseRow.status !== 'pending_review'
    ) {
      throw new BadRequestException(
        `Case ${id} requires screening before sign-out (status: ${caseRow.status})`,
      );
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
