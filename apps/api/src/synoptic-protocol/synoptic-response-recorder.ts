import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { createDb } from '@lis/db';
import {
  analyte,
  codeSystemValue,
  observation,
  order,
  orderedTest,
  synopticElement,
  synopticElementResponseOption,
  synopticProtocolVersion,
  writeAuditEvent,
  writeOutboxEvent,
} from '@lis/db';
import { evaluateCondition } from '../workflow/workflow-condition-evaluator';
import type {
  ConditionNode,
  SynopticResponseResult,
  SynopticResponseResultEntry,
} from '@lis/domain';

type Tx = Parameters<
  Parameters<ReturnType<typeof createDb>['transaction']>[0]
>[0];

export interface RecordSynopticResponseEntryInput {
  elementKey: string;
  value: string | number | string[];
}

export interface RecordSynopticResponseParams {
  tenantId: string;
  orderedTestId: string;
  synopticProtocolVersionId: string;
  responses: RecordSynopticResponseEntryInput[];
  actorPrincipalId: string;
  actorRole: string;
}

// A single, shared table-typed analyte every protocol's grid Observation
// attaches to, mirroring FEAT-053's own single "Antibiogram (MIC)" analyte
// reused regardless of which organism -- ADR-0050 §Decision 4's "one writer
// for every protocol" applies equally to the analyte it writes the grid
// under. Internal identifier, not a claimed LOINC/SNOMED binding (proposal
// §5/§10: real coding-system mapping is deferred, not fabricated now).
const SYNOPTIC_GRID_CODE_SYSTEM = 'ICCR-SYNOPTIC';
const SYNOPTIC_GRID_CODE = 'synoptic-report-grid';

async function findSynopticGridAnalyte(
  tx: Tx,
): Promise<{ id: string } | undefined> {
  const [row] = await tx
    .select({ id: analyte.id })
    .from(analyte)
    .innerJoin(
      codeSystemValue,
      eq(analyte.codeSystemValueId, codeSystemValue.id),
    )
    .where(
      and(
        eq(codeSystemValue.system, SYNOPTIC_GRID_CODE_SYSTEM),
        eq(codeSystemValue.code, SYNOPTIC_GRID_CODE),
      ),
    )
    .limit(1);
  return row;
}

/**
 * FEAT-058 (ADR-0050 §Decision 4, docs/plans/feat-058-generic-synoptic-protocol-engine.md).
 * Generalizes `antibiogram-assembly.ts`'s (FEAT-053) dual-emission shape:
 * resolve -> validate -> one discrete Observation per element -> one grid
 * Observation -> one audit event. One function for every protocol,
 * parameterized by `synopticProtocolVersionId` -- never branches on
 * organ/protocol identity (AC #3).
 *
 * All-or-nothing on a missing required element or an invalid coded value
 * (proposal §8): a partially-recorded synoptic dataset is a worse safety
 * outcome than a clear upfront rejection, the same discipline FEAT-053's
 * own unmatched-breakpoint rejection already established.
 */
export async function assembleAndPersistSynopticResponse(
  tx: Tx,
  params: RecordSynopticResponseParams,
): Promise<SynopticResponseResult> {
  const {
    tenantId,
    orderedTestId,
    synopticProtocolVersionId,
    responses,
    actorPrincipalId,
    actorRole,
  } = params;

  const [orderedTestRow] = await tx
    .select()
    .from(orderedTest)
    .where(eq(orderedTest.id, orderedTestId))
    .limit(1);
  if (!orderedTestRow) {
    throw new NotFoundException('Ordered test not found');
  }

  const [versionRow] = await tx
    .select()
    .from(synopticProtocolVersion)
    .where(eq(synopticProtocolVersion.id, synopticProtocolVersionId))
    .limit(1);
  if (!versionRow) {
    throw new BadRequestException(
      `Unknown synoptic protocol version id: ${synopticProtocolVersionId}`,
    );
  }
  if (versionRow.status !== 'published') {
    throw new ConflictException(
      `Synoptic protocol version ${synopticProtocolVersionId} is not published (status: ${versionRow.status})`,
    );
  }

  const elements = await tx
    .select()
    .from(synopticElement)
    .where(
      eq(synopticElement.synopticProtocolVersionId, synopticProtocolVersionId),
    );
  if (elements.length === 0) {
    throw new ConflictException(
      `Synoptic protocol version ${synopticProtocolVersionId} has no elements`,
    );
  }
  const elementByKey = new Map(elements.map((e) => [e.key, e]));

  const responseOptionRows = await tx
    .select()
    .from(synopticElementResponseOption)
    .where(
      inArray(
        synopticElementResponseOption.synopticElementId,
        elements.map((e) => e.id),
      ),
    );
  const responseOptionsByElementId = new Map<
    string,
    typeof responseOptionRows
  >();
  for (const row of responseOptionRows) {
    const existing =
      responseOptionsByElementId.get(row.synopticElementId) ?? [];
    existing.push(row);
    responseOptionsByElementId.set(row.synopticElementId, existing);
  }

  const responseByKey = new Map(responses.map((r) => [r.elementKey, r.value]));
  const context: Record<string, unknown> = Object.fromEntries(responseByKey);

  const missingRequired: string[] = [];
  for (const element of elements) {
    if (element.requirement !== 'required') continue;
    const hidden = element.visibilityCondition
      ? !evaluateCondition(
          element.visibilityCondition as ConditionNode,
          context,
        )
      : false;
    if (!hidden && !responseByKey.has(element.key)) {
      missingRequired.push(element.key);
    }
  }
  if (missingRequired.length > 0) {
    throw new BadRequestException(
      `Missing required element(s): ${missingRequired.join(', ')}`,
    );
  }

  const invalid: string[] = [];
  for (const [key, value] of responseByKey) {
    const element = elementByKey.get(key);
    if (!element) {
      invalid.push(`${key}: unknown element`);
      continue;
    }
    if (element.dataType === 'coded') {
      const options = responseOptionsByElementId.get(element.id) ?? [];
      if (
        typeof value !== 'string' ||
        !options.some((o) => o.value === value)
      ) {
        invalid.push(`${key}: not a permitted response option`);
      }
    } else if (element.dataType === 'coded_multi') {
      // issue #645: all-or-nothing, matching 'coded''s own discipline --
      // every selected value must be a permitted response option.
      const options = responseOptionsByElementId.get(element.id) ?? [];
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        !value.every(
          (v) => typeof v === 'string' && options.some((o) => o.value === v),
        )
      ) {
        invalid.push(`${key}: not a permitted set of response options`);
      }
    } else if (element.dataType === 'quantity') {
      if (typeof value !== 'number') {
        invalid.push(`${key}: expected a numeric value`);
      }
    }
  }
  if (invalid.length > 0) {
    throw new BadRequestException(`Invalid response(s): ${invalid.join('; ')}`);
  }

  const [orderRow] = await tx
    .select()
    .from(order)
    .where(eq(order.id, orderedTestRow.orderId))
    .limit(1);
  if (!orderRow) {
    throw new ConflictException('Ordered test has no associated order');
  }

  const now = new Date();
  const discreteResults: SynopticResponseResultEntry[] = [];
  for (const [key, value] of responseByKey) {
    const element = elementByKey.get(key);
    if (!element) continue; // already rejected above if truly unknown
    const [inserted] = await tx
      .insert(observation)
      .values({
        tenantId,
        orderedTestId,
        analyteId: element.analyteId,
        patientId: orderRow.patientId,
        isControl: false,
        dataType:
          element.dataType === 'quantity'
            ? 'quantity'
            : element.dataType === 'text'
              ? 'text'
              : element.dataType === 'coded_multi'
                ? 'structured'
                : 'coded',
        valueNum: element.dataType === 'quantity' ? String(value) : undefined,
        valueCode: element.dataType === 'coded' ? String(value) : undefined,
        valueText: element.dataType === 'text' ? String(value) : undefined,
        // issue #645 (proposal §5.1): a coded_multi element's selected-value
        // array is stored via the existing observation.dataType='structured'
        // variant, not a new column -- ck_observation_structured_value
        // already requires valueJson for that dataType.
        valueJson: element.dataType === 'coded_multi' ? value : undefined,
        status: 'preliminary',
        source: 'manual',
        operatorUserId: actorPrincipalId,
        producedAt: now,
      })
      .returning();
    discreteResults.push({
      elementKey: key,
      elementLabel: element.label,
      value,
      observationId: inserted.id,
    });
  }

  const gridAnalyte = await findSynopticGridAnalyte(tx);
  if (!gridAnalyte) {
    throw new ConflictException(
      `Synoptic report grid analyte (${SYNOPTIC_GRID_CODE_SYSTEM}/${SYNOPTIC_GRID_CODE}) is not seeded -- run \`pnpm db:reset\``,
    );
  }

  const [tableObs] = await tx
    .insert(observation)
    .values({
      tenantId,
      orderedTestId,
      analyteId: gridAnalyte.id,
      patientId: orderRow.patientId,
      isControl: false,
      dataType: 'table',
      valueJson: {
        synopticProtocolVersionId,
        results: discreteResults,
      },
      status: 'preliminary',
      source: 'manual',
      operatorUserId: actorPrincipalId,
      producedAt: now,
    })
    .returning();

  // One action, one audit entry -- the discrete Observations are folded into
  // `after`, matching `antibiogram-assembly.ts`'s own precedent for a single
  // human action producing multiple related rows.
  await writeAuditEvent(tx, {
    tenantId,
    actorPrincipalId,
    actorRole,
    actorType: 'human',
    action: 'synoptic.record',
    resourceType: 'observation',
    resourceId: tableObs.id,
    after: {
      synopticProtocolVersionId,
      tableObservationId: tableObs.id,
      results: discreteResults,
    },
  });

  // FEAT-064 (docs/plans/feat-064-cytology-reflex-ascus-hpv.md). Unconditional,
  // every protocol, every call -- never branches on which protocol or which
  // element was recorded (this function's own protocol-agnostic invariant,
  // ADR-0050 §Decision 4, preserved exactly). `context` is the same flat
  // `Record<elementKey, value>` already built above for visibilityCondition
  // evaluation, reused verbatim as the event payload body -- a guideline
  // reflex rule (e.g. ASC-US -> HPV) filters on a specific element/value
  // entirely via its own `when`, never here.
  await writeOutboxEvent(tx, {
    tenantId,
    eventType: 'SynopticResponseRecorded',
    payload: { orderedTestId, ...context },
  });

  return {
    synopticProtocolVersionId,
    tableObservationId: tableObs.id,
    results: discreteResults,
  };
}
