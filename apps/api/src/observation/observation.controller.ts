import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ageYearsAt,
  calculatedAnalytesDependingOn,
  isSuppressed,
  observationSchema,
  priorObservationSchema,
  PRIOR_OBSERVATION_LIMIT,
  resultEntrySchema,
  type ObservationResult,
  type PriorObservation,
  type ResultEntryInput,
} from '@lis/domain';
import {
  analyte,
  codeSystemValue,
  computeFlags,
  criticalNotification,
  mergeDeltaFlag,
  observation,
  order,
  orderedTest,
  patient,
  resolveDeltaCheck,
  resolveObservationRange,
  specimenFulfillment,
  testAnalyte,
  unit,
} from '@lis/db';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
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
import { FinalizationRollupInterceptor } from './finalization-rollup.interceptor';

const orderedTestIdParamSchema = z.object({ id: z.uuid() });
const resultParamSchema = z.object({ id: z.uuid(), analyteId: z.uuid() });

class OrderedTestIdParamDto extends createZodDto(orderedTestIdParamSchema) {}
class ResultParamDto extends createZodDto(resultParamSchema) {}
class ObservationDto extends createZodDto(observationSchema) {}
class PriorObservationDto extends createZodDto(priorObservationSchema) {}

// `class X extends createZodDto(resultEntrySchema) {}` fails to typecheck
// for a discriminatedUnion (its inferred type is a union of object types,
// not one the `extends` clause can resolve to a single base) -- real gap
// found during TASK-052 (the OpenAPI doc silently had no request body for
// either write route below, `requestBody?: never` in the generated SDK
// schema, since `@Body() body: ResultEntryInput`'s plain type alias gives
// `@nestjs/swagger`'s reflection nothing to introspect). Fixed the same way
// nestjs-zod's own docs show for non-extendable schemas: bind the DTO as a
// value, not via `extends`, then alias the type to its instance shape --
// `@nestjs/swagger` reflects the real runtime class either way.
const ResultEntryDto = createZodDto(resultEntrySchema);
type ResultEntryDto = InstanceType<typeof ResultEntryDto>;

type Tx = RequestWithTx['tx'];
type ObservationRow = typeof observation.$inferSelect;

const ENTERABLE_ORDERED_TEST_STATUSES = ['received', 'in_process'] as const;

function toObservationDto(row: ObservationRow): ObservationResult {
  return {
    id: row.id,
    // orderedTestId is nullable on the row per ADR-0015 (QC rows have none)
    // -- but every route that calls this mapper (draft/finalize/verify/list)
    // only ever reads patient-flow rows (isControl = false), never a QC row,
    // so it's always actually present here.
    orderedTestId: row.orderedTestId!,
    analyteId: row.analyteId,
    dataType: row.dataType as ObservationResult['dataType'], // restricted to this task's 3 dataTypes by the write path itself
    valueNum: row.valueNum === null ? null : Number(row.valueNum),
    valueCode: row.valueCode,
    valueText: row.valueText,
    unit: row.unit,
    refLow: row.refLow === null ? null : Number(row.refLow),
    refHigh: row.refHigh === null ? null : Number(row.refHigh),
    refCondition: row.refCondition,
    refSource: row.refSource,
    flags: row.flags,
    status: row.status as ObservationResult['status'], // TASK-055: now also 'verified', set only by verify() below
    source: row.source,
    producedAt: row.producedAt ? row.producedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    // TASK-057 (FEAT-015 revision §2/§10 Q4): both already-existing columns,
    // null on every row draft()/finalize() ever write; only verify() sets them.
    verifierUserId: row.verifierUserId,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
  };
}

function toPriorObservationDto(row: ObservationRow): PriorObservation {
  return {
    id: row.id,
    // orderedTestId is nullable on the row per ADR-0015 (QC rows have none)
    // -- but prior() only ever reads patient-flow rows, same reasoning as
    // toObservationDto above.
    orderedTestId: row.orderedTestId!,
    valueNum: row.valueNum === null ? null : Number(row.valueNum),
    valueCode: row.valueCode,
    valueText: row.valueText,
    unit: row.unit,
    flags: row.flags,
    producedAt: row.producedAt ? row.producedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * TASK-051 (FEAT-014 revision). First real writer to `observation` — the
 * schema every prior FEAT-014 task treats as the system's central table.
 * `enter_result` capability already existed (TASK-032, proven ahead of any
 * real feature needing it) — this is its first real consumer, no new
 * capability or ADR needed (proposal §1 finding #1).
 *
 * Two write routes per analyte, not one with a `status` body field (proposal
 * §10 Q1): `PUT .../results/:analyteId` (draft, unaudited, live flags) and
 * `POST .../results/:analyteId/finalize` (audited). NestJS's `@Audit()`
 * decorator applies per method, not per call — splitting the routes is the
 * only way to audit finalize without also auditing every high-frequency
 * autosave, without inventing a manual `writeAuditEvent()` call this repo
 * has never used elsewhere.
 *
 * Every `@Body()`/`@Query()`/`@Param()` below explicitly instantiates `new
 * ZodValidationPipe(schema)`, matching every other controller in this repo
 * (`engineering/api-design` entry #8).
 */
@Controller('v1/ordered-tests/:id')
export class ObservationController {
  /**
   * Shared by both write routes (proposal §2): resolves and validates the
   * orderedTest/analyte/specimen/patient context a result write needs.
   * Throws the same errors either route would need to throw on its own.
   */
  private async loadWriteContext(
    tx: Tx,
    orderedTestId: string,
    analyteId: string,
    body: ResultEntryInput,
  ) {
    const [orderedTestRow] = await tx
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.id, orderedTestId))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible (engineering/api-design entry #7).
    if (!orderedTestRow) {
      throw new NotFoundException('Ordered test not found');
    }

    if (
      !ENTERABLE_ORDERED_TEST_STATUSES.includes(
        orderedTestRow.status as (typeof ENTERABLE_ORDERED_TEST_STATUSES)[number],
      )
    ) {
      throw new ConflictException(
        `Ordered test status '${orderedTestRow.status}' does not accept result entry (must be 'received' or 'in_process')`,
      );
    }

    const [analyteRow] = await tx
      .select()
      .from(analyte)
      .where(eq(analyte.id, analyteId))
      .limit(1);
    if (!analyteRow) {
      throw new BadRequestException(`Unknown analyte id: ${analyteId}`);
    }

    const [linkRow] = await tx
      .select({ id: testAnalyte.id })
      .from(testAnalyte)
      .where(
        and(
          eq(testAnalyte.testDefinitionId, orderedTestRow.testDefinitionId),
          eq(testAnalyte.analyteId, analyteId),
        ),
      )
      .limit(1);
    if (!linkRow) {
      throw new BadRequestException(
        `Analyte ${analyteId} is not part of this ordered test's test definition`,
      );
    }

    if (body.dataType !== analyteRow.dataType) {
      throw new BadRequestException(
        `dataType mismatch: analyte is '${analyteRow.dataType}', request was '${body.dataType}'`,
      );
    }

    const [fulfillmentRow] = await tx
      .select({ specimenId: specimenFulfillment.specimenId })
      .from(specimenFulfillment)
      .where(eq(specimenFulfillment.orderedTestId, orderedTestId))
      .limit(1);
    if (!fulfillmentRow) {
      // Should be unreachable given the status guard above (TASK-047 only
      // ever sets 'received' when a specimen_fulfillment row is created in
      // the same transaction) -- a real inconsistency, not a validation gap.
      throw new ConflictException(
        'Ordered test has no associated specimen (specimen_fulfillment) despite its status',
      );
    }

    const [orderRow] = await tx
      .select({ patientId: order.patientId })
      .from(order)
      .where(eq(order.id, orderedTestRow.orderId))
      .limit(1);
    if (!orderRow) {
      throw new ConflictException('Ordered test has no associated order');
    }

    const [patientRow] = await tx
      .select({ sex: patient.sex, birthDate: patient.birthDate })
      .from(patient)
      .where(eq(patient.id, orderRow.patientId))
      .limit(1);
    if (!patientRow) {
      throw new ConflictException('Order has no associated patient');
    }

    return {
      orderedTestRow,
      analyteRow,
      specimenId: fulfillmentRow.specimenId,
      patientId: orderRow.patientId,
      patientSex: patientRow.sex as 'M' | 'F' | 'U',
      patientBirthDate: patientRow.birthDate,
    };
  }

  /**
   * `resolveObservationRange`/`computeFlags` (TASK-049/050) run on every
   * write, draft or final (proposal §5) -- live flags, not deferred. Only
   * `'quantity'` gets a resolved range; `'coded'`/`'text'` have no
   * reference-range concept (KB-15).
   *
   * FEAT-025 (ADR-0023): `resolveDeltaCheck` runs alongside the range/flag
   * resolution above, same "every write" cadence -- `previousObservationId`
   * is returned here so callers can set it on the same insert/update that
   * already carries `flags`, rather than a second write.
   */
  private async resolveRangeAndFlags(
    tx: Tx,
    body: ResultEntryInput,
    analyteRow: typeof analyte.$inferSelect,
    patientId: string,
    patientSex: 'M' | 'F' | 'U',
    patientBirthDate: Date | null,
    at: Date,
  ) {
    if (body.dataType !== 'quantity' || !analyteRow.defaultUnitId) {
      return {
        flags: [] as string[],
        unitId: null as string | null,
        unitDisplay: null as string | null,
        refLow: null,
        refHigh: null,
        refCondition: null,
        refSource: null,
        previousObservationId: null as string | null,
      };
    }

    const [unitRow] = await tx
      .select({
        code: codeSystemValue.code,
        displayOverride: unit.displayOverride,
      })
      .from(unit)
      .innerJoin(
        codeSystemValue,
        eq(unit.codeSystemValueId, codeSystemValue.id),
      )
      .where(eq(unit.id, analyteRow.defaultUnitId))
      .limit(1);

    const range = await resolveObservationRange(tx, {
      analyteId: analyteRow.id,
      unitId: analyteRow.defaultUnitId,
      patientSex,
      patientBirthDate,
      at,
    });
    const severityFlags = computeFlags(
      body.valueNum,
      range.normal,
      range.critical,
    );

    const deltaCheck = await resolveDeltaCheck(tx, {
      patientId,
      analyteId: analyteRow.id,
      valueNum: body.valueNum,
    });
    const flags = mergeDeltaFlag(severityFlags, deltaCheck.flagged);

    return {
      flags,
      unitId: analyteRow.defaultUnitId,
      unitDisplay: unitRow ? (unitRow.displayOverride ?? unitRow.code) : null,
      refLow: range.normal.matched ? range.normal.low : null,
      refHigh: range.normal.matched ? range.normal.high : null,
      refCondition: range.normal.matched ? range.normal.condition : null,
      refSource: range.normal.matched ? range.normal.source : null,
      previousObservationId: deltaCheck.previousObservationId,
    };
  }

  private async upsertObservation(
    tx: Tx,
    params: {
      tenantId: string;
      orderedTestId: string;
      analyteId: string;
      patientId: string;
      specimenId: string;
      operatorUserId: string;
      status: 'registered' | 'preliminary';
      body: ResultEntryInput;
      flags: string[];
      unitId: string | null;
      unitDisplay: string | null;
      refLow: string | null;
      refHigh: string | null;
      refCondition: string | null;
      refSource: string | null;
      // FEAT-025 (ADR-0023): the row this write's delta check compared
      // against, or null if none was eligible. Part of sharedFields (below),
      // so it's recomputed on every write, draft or final, same cadence as
      // `flags` -- previousObservationCreatedAt is filled in automatically by
      // the fn_observation_link_created_at trigger (observation.ts's own
      // comment), never set directly here.
      previousObservationId: string | null;
      /** TASK-053 (FEAT-014 revision §2): was hardcoded 'manual' on insert;
       * the calculated-dependent write (maybeComputeDependents) passes
       * 'calculated' instead. Never touched on an UPDATE (sharedFields
       * doesn't include it), matching the column's own "set once at
       * creation" nature -- an existing manual observation never becomes
       * 'calculated' by being re-drafted, and vice versa. */
      source: 'manual' | 'calculated';
    },
  ): Promise<ObservationRow> {
    const [existing] = await tx
      .select()
      .from(observation)
      .where(
        and(
          eq(observation.orderedTestId, params.orderedTestId),
          eq(observation.analyteId, params.analyteId),
        ),
      )
      .limit(1);

    // TASK-055 (FEAT-015 revision §1 finding #3): `fn_observation_append_only`
    // (0007 migration) rejects any top-level UPDATE to a row whose current
    // status is 'verified', with exactly one narrow, system-internal
    // exception this call never takes (fn_observation_supersede's own nested
    // superseded_by backfill). Without this pre-check, calling the UPDATE
    // branch below against an already-verified row would surface as an
    // unhandled 500 from the trigger's RAISE EXCEPTION -- this turns that
    // into the proper 409 the DB constraint is really expressing. Applies to
    // every caller of upsertObservation (draft, finalize, and the calculated-
    // dependent write in maybeComputeDependents) uniformly, since none of
    // them may ever mutate a verified row in place; a correction must insert
    // a new row with amendment_of set instead (not built by this task -- see
    // the trigger-proof e2e test / proposal §10 Q3).
    if (existing && existing.status === 'verified') {
      throw new ConflictException(
        `Observation ${existing.id} is verified and append-only (Constitution Law #2); ` +
          'a correction must create a new version, not update this one',
      );
    }

    const valueFields = {
      valueNum:
        params.body.dataType === 'quantity'
          ? String(params.body.valueNum)
          : null,
      valueCode:
        params.body.dataType === 'coded' ? params.body.valueCode : null,
      valueText: params.body.dataType === 'text' ? params.body.valueText : null,
    };

    const sharedFields = {
      dataType: params.body.dataType,
      ...valueFields,
      unitId: params.unitId,
      unit: params.unitDisplay,
      refLow: params.refLow,
      refHigh: params.refHigh,
      refCondition: params.refCondition,
      refSource: params.refSource,
      flags: params.flags,
      previousObservationId: params.previousObservationId,
      status: params.status,
      operatorUserId: params.operatorUserId,
      producedAt: new Date(),
    };

    if (existing) {
      // TASK-053 (FEAT-014 revision) real finding, not part of this task's
      // own scope but directly blocking it: re-`draft`ing or re-`finalize`ing
      // the SAME analyte twice (any analyte, unrelated to calculated fields)
      // crashed with a 500 -- `existing.createdAt` (read back as a
      // millisecond-precision JS `Date`) never round-trips exactly back to
      // the real microsecond-precision `timestamptz` Postgres actually
      // stored (from `defaultNow()`), so `eq(observation.createdAt,
      // existing.createdAt)` matched zero rows and `.returning()` returned
      // `undefined`. No existing TASK-051/052 test ever called draft/finalize
      // twice on the same (orderedTestId, analyteId) pair, so this was a
      // real, latent, previously-unexercised bug in already-merged code, not
      // something this task introduced. Fixed by keying the UPDATE on `id`
      // alone (a random UUID, globally unique in practice, zero precision-
      // loss risk) -- loses `created_at`'s partition-pruning benefit
      // (ADR-0008), an efficiency cost only, not a correctness one, and not
      // a real cost at this data scale (same "don't build ahead of a real
      // need" precedent used elsewhere in this repo).
      const [updated] = await tx
        .update(observation)
        .set(sharedFields)
        .where(eq(observation.id, existing.id))
        .returning();
      return updated;
    }

    const [inserted] = await tx
      .insert(observation)
      .values({
        tenantId: params.tenantId,
        orderedTestId: params.orderedTestId,
        analyteId: params.analyteId,
        specimenId: params.specimenId,
        patientId: params.patientId,
        source: params.source,
        ...sharedFields,
      })
      .returning();
    return inserted;
  }

  /**
   * TASK-053 (FEAT-014 revision §1 finding #3/§10 Q2): runs only from
   * `finalize()` (never `draft`) -- a calculated write derives from
   * *committed*, audited inputs only, never a speculative draft. Every
   * calculated analyte in this revision's registry lives on the same
   * `test_definition` as its own input(s) (revision §1 finding #3), so this
   * never needs to look outside `ctx.orderedTestRow`'s own ordered test.
   *
   * TASK-072 (FEAT-023) widened this from "compute the one dependent" to
   * "compute every dependent" -- a real, load-bearing bug found during
   * implementation, not anticipated by the FEAT-023 proposal: the five new
   * differential-absolute-count formulas all share WBC Count as an input,
   * the first time more than one registry definition depends on the same
   * trigger LOINC code (eGFR/LDL's own three trigger codes each mapped to
   * exactly one definition). The prior version destructured only
   * `calculatedAnalytesDependingOn(...)`'s first result -- finalizing WBC
   * after all five percentages were already entered would have silently
   * computed only one of five absolute counts. Returns an array (possibly
   * empty) instead of a single nullable result; each element is skipped
   * independently (not seeded/linked on this ordered test, not every input
   * finalized yet, or the formula itself suppresses, e.g. Friedewald's
   * triglyceride guard or a non-positive WBC) -- every one of these is a
   * real, expected state, not an error.
   */
  private async maybeComputeDependents(
    tx: Tx,
    ctx: Awaited<ReturnType<ObservationController['loadWriteContext']>>,
    tenantId: string,
    operatorUserId: string,
    at: Date,
  ): Promise<
    {
      before: ObservationResult | null;
      after: ObservationRow;
    }[]
  > {
    const [triggeringCsv] = await tx
      .select({ code: codeSystemValue.code })
      .from(codeSystemValue)
      .where(eq(codeSystemValue.id, ctx.analyteRow.codeSystemValueId))
      .limit(1);
    if (!triggeringCsv) return [];

    const definitions = calculatedAnalytesDependingOn(triggeringCsv.code);
    if (definitions.length === 0) return [];

    const results: {
      before: ObservationResult | null;
      after: ObservationRow;
    }[] = [];

    for (const definition of definitions) {
      const outputAnalyteRow = await this.findAnalyteByLoincCode(
        tx,
        definition.outputLoincCode,
      );
      if (!outputAnalyteRow) continue; // not seeded -- real gap, not a crash

      const [outputLinkRow] = await tx
        .select({ id: testAnalyte.id })
        .from(testAnalyte)
        .where(
          and(
            eq(
              testAnalyte.testDefinitionId,
              ctx.orderedTestRow.testDefinitionId,
            ),
            eq(testAnalyte.analyteId, outputAnalyteRow.id),
          ),
        )
        .limit(1);
      if (!outputLinkRow) continue; // this ordered test's own panel doesn't include this calculated analyte

      const inputsByCode: Record<string, number> = {};
      let missingInput = false;
      for (const inputCode of definition.inputLoincCodes) {
        const inputAnalyteRow = await this.findAnalyteByLoincCode(
          tx,
          inputCode,
        );
        if (!inputAnalyteRow) {
          missingInput = true;
          break;
        }

        const [inputObservationRow] = await tx
          .select({
            valueNum: observation.valueNum,
            status: observation.status,
          })
          .from(observation)
          .where(
            and(
              eq(observation.orderedTestId, ctx.orderedTestRow.id),
              eq(observation.analyteId, inputAnalyteRow.id),
            ),
          )
          .limit(1);
        if (
          !inputObservationRow ||
          inputObservationRow.status !== 'preliminary' ||
          inputObservationRow.valueNum === null
        ) {
          missingInput = true; // not every input finalized yet -- real, expected state
          break;
        }
        inputsByCode[inputCode] = Number(inputObservationRow.valueNum);
      }
      if (missingInput) continue;

      const ageYears = ctx.patientBirthDate
        ? ageYearsAt(ctx.patientBirthDate, at)
        : null;
      const result = definition.compute(inputsByCode, {
        sex: ctx.patientSex,
        ageYears,
      });
      if (isSuppressed(result)) {
        continue; // KB-15's "no_range never faked as normal," applied to calculated values (revision §5)
      }

      const [existingCalculated] = await tx
        .select()
        .from(observation)
        .where(
          and(
            eq(observation.orderedTestId, ctx.orderedTestRow.id),
            eq(observation.analyteId, outputAnalyteRow.id),
          ),
        )
        .limit(1);
      const before = existingCalculated
        ? toObservationDto(existingCalculated)
        : null;

      const syntheticBody: ResultEntryInput = {
        dataType: 'quantity',
        valueNum: result.value,
      };
      const rangeAndFlags = await this.resolveRangeAndFlags(
        tx,
        syntheticBody,
        outputAnalyteRow,
        ctx.patientId,
        ctx.patientSex,
        ctx.patientBirthDate,
        at,
      );

      const after = await this.upsertObservation(tx, {
        tenantId,
        orderedTestId: ctx.orderedTestRow.id,
        analyteId: outputAnalyteRow.id,
        patientId: ctx.patientId,
        specimenId: ctx.specimenId,
        operatorUserId,
        status: 'preliminary',
        body: syntheticBody,
        source: 'calculated',
        ...rangeAndFlags,
      });

      results.push({ before, after });
    }

    return results;
  }

  /** TASK-053 (FEAT-014 revision §2): two sequential queries, not a joined
   * one -- avoids the nested-vs-flat drizzle select-shape ambiguity a join
   * would introduce here, and this repo's own established preference for
   * separate queries over `.innerJoin()` for multi-table reads
   * (`engineering/api-design` entry #7). */
  private async findAnalyteByLoincCode(
    tx: Tx,
    loincCode: string,
  ): Promise<typeof analyte.$inferSelect | undefined> {
    const [csv] = await tx
      .select({ id: codeSystemValue.id })
      .from(codeSystemValue)
      .where(
        and(
          eq(codeSystemValue.system, 'LOINC'),
          eq(codeSystemValue.code, loincCode),
        ),
      )
      .limit(1);
    if (!csv) return undefined;

    const [analyteRow] = await tx
      .select()
      .from(analyte)
      .where(eq(analyte.codeSystemValueId, csv.id))
      .limit(1);
    return analyteRow;
  }

  /**
   * Draft save: `status: 'registered'` (proposal §1 finding #2), no
   * `@Audit()`, upserts in place (an `UPDATE`, not a new row per save --
   * Constitution invariant #2 scopes append-only to *verified* data, which
   * this isn't yet). Advances `orderedTest.status` `'received' →
   * 'in_process'` on the first draft only.
   */
  @Put('results/:analyteId')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('enter_result')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: ObservationDto, status: 200 })
  async draft(
    @Param(new ZodValidationPipe(resultParamSchema))
    { id, analyteId }: ResultParamDto,
    @Body(new ZodValidationPipe(resultEntrySchema)) body: ResultEntryDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<ObservationResult> {
    const ctx = await this.loadWriteContext(tx, id, analyteId, body);
    const at = new Date();
    const rangeAndFlags = await this.resolveRangeAndFlags(
      tx,
      body,
      ctx.analyteRow,
      ctx.patientId,
      ctx.patientSex,
      ctx.patientBirthDate,
      at,
    );

    const row = await this.upsertObservation(tx, {
      tenantId: user.tenantId,
      orderedTestId: id,
      analyteId,
      patientId: ctx.patientId,
      specimenId: ctx.specimenId,
      operatorUserId: user.sub,
      status: 'registered',
      body,
      source: 'manual',
      ...rangeAndFlags,
    });

    if (ctx.orderedTestRow.status === 'received') {
      await tx
        .update(orderedTest)
        .set({ status: 'in_process' })
        .where(eq(orderedTest.id, id));
    }

    return toObservationDto(row);
  }

  /**
   * Finalize: `status: 'preliminary'` (proposal §1 finding #2), audited.
   * Accepts the same body as draft (a keyboard-only user can type-and-
   * finalize in one call, no prior draft required — FEAT-014's own AC).
   *
   * TASK-056 (FEAT-015 revision, #115): this method itself no longer decides
   * whether `orderedTest.status` advances to `'resulted'` — that roll-up,
   * plus the new Constitution Law #3 guard blocking it while any critical on
   * the panel is unacknowledged, moved to `FinalizationRollupInterceptor`
   * (see its own doc comment for why: it needs to run in a transaction that
   * commits *after*, and independently of, this method's own observation
   * write, so a 409 from the guard can never unwind the write that triggered
   * it). `FinalizationRollupInterceptor` is listed first (outermost) below so
   * its post-`next.handle()` code runs only once `TenantContextInterceptor`'s
   * own transaction — wrapping this method's write, `maybeComputeDependents`,
   * and `AuditInterceptor`'s own audit insert — has actually committed.
   */
  @Post('results/:analyteId/finalize')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('enter_result')
  @UseInterceptors(
    FinalizationRollupInterceptor,
    TenantContextInterceptor,
    AuditInterceptor,
  )
  @Audit({ action: 'observation.finalize', resourceType: 'observation' })
  async finalize(
    @Param(new ZodValidationPipe(resultParamSchema))
    { id, analyteId }: ResultParamDto,
    @Body(new ZodValidationPipe(resultEntrySchema)) body: ResultEntryDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ) {
    const ctx = await this.loadWriteContext(tx, id, analyteId, body);
    const at = new Date();

    const [existingBefore] = await tx
      .select()
      .from(observation)
      .where(
        and(
          eq(observation.orderedTestId, id),
          eq(observation.analyteId, analyteId),
        ),
      )
      .limit(1);
    const before = existingBefore ? toObservationDto(existingBefore) : null;

    const rangeAndFlags = await this.resolveRangeAndFlags(
      tx,
      body,
      ctx.analyteRow,
      ctx.patientId,
      ctx.patientSex,
      ctx.patientBirthDate,
      at,
    );

    const row = await this.upsertObservation(tx, {
      tenantId: user.tenantId,
      orderedTestId: id,
      analyteId,
      patientId: ctx.patientId,
      specimenId: ctx.specimenId,
      operatorUserId: user.sub,
      status: 'preliminary',
      body,
      source: 'manual',
      ...rangeAndFlags,
    });

    // TASK-053 (FEAT-014 revision §1 finding #3/§4/§10 Q2): runs only here,
    // never from draft() -- a calculated write derives from a committed,
    // audited input. Folded into this SAME audit event (finding #4) rather
    // than a second, independent `writeAuditEvent()` call, which would be a
    // genuinely new pattern this repo has deliberately avoided so far.
    const calculated = await this.maybeComputeDependents(
      tx,
      ctx,
      user.tenantId,
      user.sub,
      at,
    );

    // TASK-053 (FEAT-014 revision §1 finding #4): `before`/`after` are now
    // always `{ observation, calculatedDependents }` -- a uniform shape
    // whether or not this call actually cascaded, so the audit trail (and
    // this route's one caller, apps/web's `finalizeResult`) never has to
    // branch on whether a dependent computation happened.
    // TASK-072 (FEAT-023): pluralized from `calculatedDependent` (singular,
    // nullable) to `calculatedDependents` (array, possibly empty) --
    // `maybeComputeDependents` can now return more than one cascaded write
    // in a single call (see its own comment). Not `@ZodResponse`-bound (same
    // as QC's `recordResult()` precedent), so this rename needs no
    // openapi.json/schema.ts regeneration -- its only consumer is this
    // repo's own `apps/web` `finalizeResult`, updated in the same change.
    //
    // TASK-054 (FEAT-015 proposal §10 Q1/Q2): `criticalDetected` folds a
    // documented critical-detection signal into this SAME already-audited
    // event, rather than a second `writeAuditEvent()` call site -- same
    // "fold into the existing event" precedent TASK-053 set for
    // `calculatedDependents` immediately above. Reflects only the
    // just-finalized observation's own flags (`row`, the analyte this call
    // actually finalized) -- not `calculated`'s (a dependent computed
    // value's own criticality is that dependent's own finalize event, once
    // it's finalized itself, not this one's).
    const criticalDetected =
      row.flags.includes('HH') || row.flags.includes('LL');

    // TASK-065 (FEAT-021, ADR-0016): a plain, synchronous insert inside this
    // SAME transaction -- no event bus, no queue (domain/critical-values
    // Skill entry #4: no infra exists to build one ahead of FEAT-028). At
    // most one 'pending'/'escalated' notification exists per observation at
    // a time -- a re-finalize of an already-critical, not-yet-acknowledged
    // analyte (e.g. a corrected value still HH/LL) reuses the existing row
    // rather than spawning a duplicate the acknowledge flow would then have
    // to disambiguate between. Deliberately does NOT touch
    // FinalizationRollupInterceptor's existing gate (ADR-0016 Decision) --
    // that widening is TASK-066's scope, not this one's.
    let criticalNotificationId: string | null = null;
    if (criticalDetected) {
      const [existingNotification] = await tx
        .select({ id: criticalNotification.id })
        .from(criticalNotification)
        .where(
          and(
            eq(criticalNotification.observationId, row.id),
            ne(criticalNotification.status, 'acknowledged'),
          ),
        )
        .limit(1);

      if (existingNotification) {
        criticalNotificationId = existingNotification.id;
      } else {
        // observationCreatedAt is a server-side subquery, not `row.createdAt`
        // (proposal §2/ADR-0016 didn't anticipate this): drizzle parses a
        // returned timestamptz into a JS Date, which only has millisecond
        // resolution, while Postgres's own `now()` (this column's default)
        // carries microsecond precision -- writing the JS-truncated value
        // back would never exactly match the row Postgres actually stored,
        // breaking this composite FK's exact-equality lookup. Same class of
        // bug TASK-053 already found and fixed around elsewhere on this
        // exact table (upsertObservation's own `existing.createdAt` note,
        // above) -- confirmed here the same way, a real failed insert, not
        // assumed from that precedent alone.
        const [insertedNotification] = await tx
          .insert(criticalNotification)
          .values({
            tenantId: user.tenantId,
            observationId: row.id,
            observationCreatedAt: sql`(SELECT created_at FROM observation WHERE id = ${row.id})`,
          })
          .returning({ id: criticalNotification.id });
        criticalNotificationId = insertedNotification.id;
      }
    }

    return {
      resourceId: row.id,
      before: {
        observation: before,
        calculatedDependents: calculated.map((c) => c.before),
      },
      after: {
        observation: toObservationDto(row),
        calculatedDependents: calculated.map((c) => toObservationDto(c.after)),
        criticalDetected,
        criticalNotificationId,
      },
    };
  }

  /**
   * TASK-055 (FEAT-015 revision): verification action sub-resource. Bare
   * `POST .../verify`, no request body (proposal §10 Q1) -- mirrors
   * `finalize()`'s own bare-action shape exactly, same reasoning as `engineering/
   * api-design` entry #11's slash-verb convention. Gated by the existing
   * `verify` capability (already granted only to `verifier`, proposal §10
   * Q2/finding #4) -- not `enter_result`. Audited (`@Audit`), matching
   * `finalize()`'s own precedent: this is a mutating, clinically significant
   * action (Constitution Law #5), not a bare read.
   *
   * Only a `'preliminary'` observation may be verified -- anything else
   * (no result yet, already verified, or some other status) is rejected
   * with 409, the same convention `loadWriteContext`'s own ordered-test
   * status guard already uses for an out-of-order transition. Once this
   * succeeds, `fn_observation_append_only` (0007 migration) makes the row
   * immutable; `upsertObservation`'s own pre-check above is what turns any
   * later draft/finalize attempt against the same analyte into a 409
   * instead of an unhandled 500.
   */
  @Post('results/:analyteId/verify')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('verify')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'observation.verify', resourceType: 'observation' })
  async verify(
    @Param(new ZodValidationPipe(resultParamSchema))
    { id, analyteId }: ResultParamDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ) {
    const [orderedTestRow] = await tx
      .select({ id: orderedTest.id })
      .from(orderedTest)
      .where(eq(orderedTest.id, id))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible (engineering/api-design entry #7).
    if (!orderedTestRow) {
      throw new NotFoundException('Ordered test not found');
    }

    const [existing] = await tx
      .select()
      .from(observation)
      .where(
        and(
          eq(observation.orderedTestId, id),
          eq(observation.analyteId, analyteId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new NotFoundException(
        `No result exists for analyte ${analyteId} on this ordered test`,
      );
    }
    if (existing.status !== 'preliminary') {
      throw new ConflictException(
        `Observation status '${existing.status}' cannot be verified (must be 'preliminary')`,
      );
    }

    const before = toObservationDto(existing);
    const [updated] = await tx
      .update(observation)
      .set({
        status: 'verified',
        verifierUserId: user.sub,
        verifiedAt: new Date(),
      })
      .where(eq(observation.id, existing.id))
      .returning();

    return {
      resourceId: updated.id,
      before: { observation: before },
      after: { observation: toObservationDto(updated) },
    };
  }

  /**
   * TASK-057 (FEAT-015 revision §1 finding #3/§2, §10 Q1): the patient's own
   * prior result(s) for this analyte -- not this ordered test's own result,
   * a *different* ordered test's result for the same (patientId, analyteId)
   * pair, most recent first, capped at `PRIOR_OBSERVATION_LIMIT`. No delta/
   * comparison computed (out of scope, §10 Q1); no `@Audit()` -- an
   * unmutating read (`engineering/api-design` entry #6).
   *
   * Two separate queries (`orderedTest` -> `order.patientId`), not a
   * three-table join -- this repo's established preference for separate
   * queries over `.innerJoin()` for a multi-table read (mirrors
   * `loadWriteContext`'s own shape above, and `order.controller.ts`'s
   * `search()`). Once the *current* ordered test's own `patientId` is known,
   * the prior lookup itself needs no join at all: `observation.patientId` is
   * already a real column on every row (set by `upsertObservation` at write
   * time), and `ix_obs_trend` (`packages/db/src/schema/observation.ts`) is
   * already a composite index on exactly
   * `(tenantId, patientId, analyteId, producedAt)` -- built for precisely
   * this "prior result for this patient/analyte" read, before this task ever
   * needed it.
   */
  @Get('results/:analyteId/prior')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [PriorObservationDto], status: 200 })
  async prior(
    @Param(new ZodValidationPipe(resultParamSchema))
    { id, analyteId }: ResultParamDto,
    @DbTx() tx: Tx,
  ): Promise<PriorObservation[]> {
    const [orderedTestRow] = await tx
      .select({ orderId: orderedTest.orderId })
      .from(orderedTest)
      .where(eq(orderedTest.id, id))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible (engineering/api-design entry #7).
    if (!orderedTestRow) {
      throw new NotFoundException('Ordered test not found');
    }

    const [orderRow] = await tx
      .select({ patientId: order.patientId })
      .from(order)
      .where(eq(order.id, orderedTestRow.orderId))
      .limit(1);
    if (!orderRow) {
      throw new ConflictException('Ordered test has no associated order');
    }

    const rows = await tx
      .select()
      .from(observation)
      .where(
        and(
          eq(observation.patientId, orderRow.patientId),
          eq(observation.analyteId, analyteId),
          ne(observation.orderedTestId, id),
          isNull(observation.supersededBy),
        ),
      )
      .orderBy(desc(observation.producedAt), desc(observation.createdAt))
      .limit(PRIOR_OBSERVATION_LIMIT);

    return rows.map(toPriorObservationDto);
  }

  /** Read: current observations (draft and final) for TASK-052's grid UI.
   * No `@Audit()` -- an unmutating read (`engineering/api-design` entry #6:
   * only mutating, operationally significant actions are audited). */
  @Get('results')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [ObservationDto], status: 200 })
  async list(
    @Param(new ZodValidationPipe(orderedTestIdParamSchema))
    { id }: OrderedTestIdParamDto,
    @DbTx() tx: Tx,
  ): Promise<ObservationResult[]> {
    const [orderedTestRow] = await tx
      .select({ id: orderedTest.id })
      .from(orderedTest)
      .where(eq(orderedTest.id, id))
      .limit(1);
    if (!orderedTestRow) {
      throw new NotFoundException('Ordered test not found');
    }
    const rows = await tx
      .select()
      .from(observation)
      .where(eq(observation.orderedTestId, id));
    return rows.map(toObservationDto);
  }
}
