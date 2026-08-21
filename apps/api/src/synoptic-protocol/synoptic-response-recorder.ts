import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
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
import {
  parseInstanceResponseKey,
  type ConditionNode,
  type SynopticResponseResult,
  type SynopticResponseResultEntry,
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
  // Issue #674: a case with two synoptic-eligible parts recorded against
  // the same protocol otherwise produces two structurally-indistinguishable
  // grid Observations (both share the same orderedTestId -- there is no
  // per-part ordered test in this schema). `observation.specimenId`
  // (ADR-0015) already exists for exactly this; the recorder simply never
  // wrote it until now.
  specimenId: string;
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

// Exported for the read path (issue #659, case.controller.ts's
// listSynopticResponses) -- the same shared grid analyte, read-side, so
// there is exactly one place that knows this internal identifier.
export async function findSynopticGridAnalyte(
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
    specimenId,
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
  const elementById = new Map(elements.map((e) => [e.id, e]));

  // Issue #666: nearest ancestor with repeatable=true, or undefined if this
  // element isn't inside a repeating group. Repeatable roots are pure
  // grouping headers -- the search starts at the element's own parent, so a
  // repeatable root is never its own answer.
  function findRepeatableRoot(
    element: (typeof elements)[number],
  ): (typeof elements)[number] | undefined {
    let current = element.parentElementId
      ? elementById.get(element.parentElementId)
      : undefined;
    while (current) {
      if (current.repeatable) return current;
      current = current.parentElementId
        ? elementById.get(current.parentElementId)
        : undefined;
    }
    return undefined;
  }

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

  // Issue #666: split into top-level (non-repeatable-descendant) answers,
  // keyed by their plain element key exactly as before, and per-instance
  // answers grouped by (repeatableRootId, instanceKey). `context` and the
  // outbox event payload below stay top-level-only, flat, plain-keyed --
  // FEAT-064's reflex subscription (and every other flat-context consumer)
  // is unaffected by repeating groups.
  const topLevelResponseByKey = new Map<string, unknown>();
  const instanceValuesByRootId = new Map<
    string,
    Map<string, Record<string, unknown>>
  >();
  for (const [rawKey, value] of responseByKey) {
    const { elementKey: baseKey, instanceKey } =
      parseInstanceResponseKey(rawKey);
    const element = elementByKey.get(baseKey);
    if (!element) continue; // unknown key, rejected in the validation loop below
    const root = findRepeatableRoot(element);
    if (root && instanceKey) {
      let instances = instanceValuesByRootId.get(root.id);
      if (!instances) {
        instances = new Map();
        instanceValuesByRootId.set(root.id, instances);
      }
      let instanceValues = instances.get(instanceKey);
      if (!instanceValues) {
        instanceValues = {};
        instances.set(instanceKey, instanceValues);
      }
      instanceValues[baseKey] = value;
    } else {
      topLevelResponseByKey.set(baseKey, value);
    }
  }
  const context: Record<string, unknown> = Object.fromEntries(
    topLevelResponseByKey,
  );

  const missingRequired: string[] = [];
  for (const element of elements) {
    // Issue #664: 'conditional' shares 'required''s own enforcement --
    // only 'recommended' is genuinely optional. A label distinction, not a
    // new validation branch.
    if (element.requirement === 'recommended') continue;
    if (element.repeatable) {
      // Issue #666: group presence itself is optional by default (a
      // multifocal-tumor protocol legitimately has single-focus cases) --
      // only 'required'/'conditional' on the root demands at least one
      // instance, and only when the root itself isn't hidden by its own
      // visibilityCondition (same rule every non-repeating element already
      // follows).
      const hidden = element.visibilityCondition
        ? !evaluateCondition(
            element.visibilityCondition as ConditionNode,
            context,
          )
        : false;
      const instances = instanceValuesByRootId.get(element.id);
      if (!hidden && (!instances || instances.size === 0)) {
        missingRequired.push(element.key);
      }
      continue;
    }
    if (findRepeatableRoot(element)) continue; // validated per-instance below
    const hidden = element.visibilityCondition
      ? !evaluateCondition(
          element.visibilityCondition as ConditionNode,
          context,
        )
      : false;
    if (!hidden && !topLevelResponseByKey.has(element.key)) {
      missingRequired.push(element.key);
    }
  }
  // Issue #666: per-instance required/visibility validation -- a
  // descendant's own visibilityCondition can reference a sibling within the
  // same instance (merged context = top-level answers + this instance's
  // own answers, both plain-keyed) exactly like a non-repeating field
  // references a top-level sibling today.
  for (const rootElement of elements) {
    if (!rootElement.repeatable) continue;
    const instances = instanceValuesByRootId.get(rootElement.id);
    if (!instances) continue;
    for (const [instanceKey, instanceValues] of instances) {
      const mergedContext = { ...context, ...instanceValues };
      for (const element of elements) {
        if (findRepeatableRoot(element)?.id !== rootElement.id) continue;
        if (element.requirement === 'recommended') continue;
        const hidden = element.visibilityCondition
          ? !evaluateCondition(
              element.visibilityCondition as ConditionNode,
              mergedContext,
            )
          : false;
        if (!hidden && !(element.key in instanceValues)) {
          missingRequired.push(`${element.key}@${instanceKey}`);
        }
      }
    }
  }
  if (missingRequired.length > 0) {
    throw new BadRequestException(
      `Missing required element(s): ${missingRequired.join(', ')}`,
    );
  }

  const invalid: string[] = [];
  for (const [key, value] of responseByKey) {
    const { elementKey: baseKey, instanceKey } = parseInstanceResponseKey(key);
    const element = elementByKey.get(baseKey);
    if (!element) {
      invalid.push(`${key}: unknown element`);
      continue;
    }
    if (element.repeatable) {
      invalid.push(
        `${key}: a repeatable group header is not directly answerable`,
      );
      continue;
    }
    if (instanceKey && !findRepeatableRoot(element)) {
      invalid.push(`${key}: instance suffix on a non-repeating element`);
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

  const gridAnalyte = await findSynopticGridAnalyte(tx);
  if (!gridAnalyte) {
    throw new ConflictException(
      `Synoptic report grid analyte (${SYNOPTIC_GRID_CODE_SYSTEM}/${SYNOPTIC_GRID_CODE}) is not seeded -- run \`pnpm db:reset\``,
    );
  }

  // Issue #662: the current (non-superseded) predecessor grid Observation
  // for this exact key, if one exists -- its own valueJson.results already
  // has {elementKey, observationId} per element from the prior recording,
  // giving an elementKey -> predecessor-observationId map with no extra
  // query shape needed. Matches the read path's own (#659) selection key.
  // Issue #674: scoped by specimenId too -- without this, two parts
  // sharing the same orderedTestId (there is no per-part ordered test)
  // would each treat the other's grid as their own predecessor,
  // incorrectly marking one part's data superseded when the other part is
  // recorded.
  const [predecessorGrid] = await tx
    .select({ id: observation.id, valueJson: observation.valueJson })
    .from(observation)
    .where(
      and(
        eq(observation.orderedTestId, orderedTestId),
        eq(observation.specimenId, specimenId),
        eq(observation.analyteId, gridAnalyte.id),
        eq(observation.dataType, 'table'),
        isNull(observation.supersededBy),
      ),
    )
    .orderBy(desc(observation.createdAt))
    .limit(1);
  const predecessorObservationIdByKey = new Map<string, string>(
    (
      (
        predecessorGrid?.valueJson as {
          results?: SynopticResponseResultEntry[];
        }
      )?.results ?? []
    ).map((r) => [r.elementKey, r.observationId]),
  );

  const now = new Date();
  const discreteResults: SynopticResponseResultEntry[] = [];
  for (const [key, value] of responseByKey) {
    const { elementKey: baseKey } = parseInstanceResponseKey(key);
    const element = elementByKey.get(baseKey);
    if (!element) continue; // already rejected above if truly unknown
    // Issue #662: `fn_observation_supersede` (db/migrations/0007) fires
    // unconditionally on any insert with amendmentOf set -- archives the
    // predecessor into result_history and sets its own supersededBy,
    // atomically, in the same transaction. No manual UPDATE needed here.
    const [inserted] = await tx
      .insert(observation)
      .values({
        tenantId,
        orderedTestId,
        specimenId,
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
        amendmentOf: predecessorObservationIdByKey.get(key),
      })
      .returning();
    discreteResults.push({
      elementKey: key,
      elementLabel: element.label,
      value,
      observationId: inserted.id,
    });
  }

  const [tableObs] = await tx
    .insert(observation)
    .values({
      tenantId,
      orderedTestId,
      specimenId,
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
      amendmentOf: predecessorGrid?.id,
    })
    .returning();

  // One action, one audit entry -- the discrete Observations are folded into
  // `after`, matching `antibiogram-assembly.ts`'s own precedent for a single
  // human action producing multiple related rows. `amendmentOf` included so
  // a re-recording's own audit trail names what it corrected (issue #662).
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
      amendmentOf: predecessorGrid?.id ?? null,
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
    amendmentOf: predecessorGrid?.id ?? null,
    results: discreteResults,
  };
}
