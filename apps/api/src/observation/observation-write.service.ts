import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ResultEntryInput } from '@lis/domain';
import {
  analyte,
  codeSystemValue,
  computeFlags,
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
import { and, eq } from 'drizzle-orm';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';

type Tx = RequestWithTx['tx'];
type ObservationRow = typeof observation.$inferSelect;

const ENTERABLE_ORDERED_TEST_STATUSES = ['received', 'in_process'] as const;

/**
 * ADR-0027: the observation write path (context resolution, range/flag
 * resolution, upsert) extracted out of `ObservationController`'s own private
 * methods (TASK-051 onward) so both the human-facing controller (`draft()`/
 * `finalize()`) and analyzer ingestion (FEAT-027, `gateway-ingest`) call
 * exactly one implementation -- KB-29's own explicit requirement that an
 * analyzer-ingested result gets identical range resolution, delta check, and
 * critical detection to a human-typed one. See ADR-0027 for why this is a
 * shared service rather than two independent copies.
 *
 * Deliberately does NOT include `maybeComputeDependents`/
 * `findAnalyteByLoincCode` (calculated-field cascading) -- those stay on
 * `ObservationController`, scoped to its own `finalize()` flow; FEAT-027's
 * proposal does not extend calculated-field cascading to analyzer-ingested
 * results (a real, separate scope decision left for whenever that's
 * actually needed, not assumed here).
 */
@Injectable()
export class ObservationWriteService {
  /**
   * Resolves and validates the orderedTest/analyte/specimen/patient context
   * a result write needs. Throws the same errors every write-path caller
   * would need to throw on its own.
   */
  async loadWriteContext(
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
   * write, draft or final -- live flags, not deferred. Only `'quantity'`
   * gets a resolved range; `'coded'`/`'text'` have no reference-range
   * concept (KB-15).
   *
   * FEAT-025 (ADR-0023): `resolveDeltaCheck` runs alongside the range/flag
   * resolution above, same "every write" cadence -- `previousObservationId`
   * is returned here so callers can set it on the same insert/update that
   * already carries `flags`, rather than a second write.
   */
  async resolveRangeAndFlags(
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

  async upsertObservation(
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
       * 'calculated' instead. FEAT-027 (analyzer ingestion) passes
       * 'analyzer'. Never touched on an UPDATE (sharedFields doesn't include
       * it), matching the column's own "set once at creation" nature. */
      source: 'manual' | 'calculated' | 'analyzer';
      /** FEAT-027 (ADR-0026/analyzer-integration Skill entry #3): the
       * driver-computed idempotency key, set only on analyzer-originated
       * writes -- undefined for manual/calculated writes, matching the
       * column's own nullable shape. Real, DB-enforced dedupe (a unique
       * constraint), not the in-memory stub FEAT-026 shipped. */
      sourceIdempotencyKey?: string;
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
    // every caller of upsertObservation (draft, finalize, the calculated-
    // dependent write, and analyzer ingestion) uniformly, since none of them
    // may ever mutate a verified row in place; a correction must insert a
    // new row with amendment_of set instead.
    if (existing && existing.status === 'verified') {
      throw new ConflictException(
        `Observation ${existing.id} is verified and append-only (Constitution Law #2); ` +
          'a correction must create a new version, not update this one',
      );
    }

    // FEAT-024 (ADR-0025 decision 1/3): 'ordinal' shares valueCode's column
    // with 'coded' (both are KB-14 valueCode-backed dataTypes) but is the
    // only branch that also ever sets notes -- narrative *in addition* to
    // the graded value, never a substitute for it.
    const valueFields = {
      valueNum:
        params.body.dataType === 'quantity'
          ? String(params.body.valueNum)
          : null,
      valueCode:
        params.body.dataType === 'coded' || params.body.dataType === 'ordinal'
          ? params.body.valueCode
          : null,
      valueText: params.body.dataType === 'text' ? params.body.valueText : null,
      notes:
        params.body.dataType === 'ordinal' ? (params.body.notes ?? null) : null,
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
      // TASK-053 (FEAT-014 revision) real finding: re-`draft`ing or
      // re-`finalize`ing the SAME analyte twice crashed with a 500 --
      // `existing.createdAt` (read back as a millisecond-precision JS
      // `Date`) never round-trips exactly back to the real
      // microsecond-precision `timestamptz` Postgres actually stored, so
      // `eq(observation.createdAt, existing.createdAt)` matched zero rows.
      // Fixed by keying the UPDATE on `id` alone (a random UUID, globally
      // unique in practice, zero precision-loss risk) -- loses `created_at`'s
      // partition-pruning benefit (ADR-0008), an efficiency cost only.
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
        sourceIdempotencyKey: params.sourceIdempotencyKey ?? null,
        ...sharedFields,
      })
      .returning();
    return inserted;
  }

  /**
   * FEAT-031: the raw verification UPDATE, hoisted out of
   * `ObservationController.verify()`'s own body so both the human HTTP route
   * and `AutoVerifyObservation` (system-triggered, no HTTP request) call the
   * identical write -- a small, surgical extraction (unlike ADR-0027's),
   * since `verify()`'s own 404/409 precondition checks stay exactly where
   * they are; only this final UPDATE moves. `verifierUserId` is left
   * `null` for a system verification -- there is no human to attribute it
   * to; the audit trail's own `actorType: 'service'` carries that instead.
   */
  async applyVerification(
    tx: Tx,
    existing: ObservationRow,
    verifierUserId: string | null,
  ): Promise<ObservationRow> {
    const [updated] = await tx
      .update(observation)
      .set({
        status: 'verified',
        verifierUserId,
        verifiedAt: new Date(),
      })
      .where(eq(observation.id, existing.id))
      .returning();
    return updated;
  }
}
