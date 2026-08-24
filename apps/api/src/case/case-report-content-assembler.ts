import { and, eq, inArray } from 'drizzle-orm';
import type { createDb } from '@lis/db';
import {
  block,
  observation,
  order,
  patient,
  referringFacility,
  synopticElement,
  synopticProtocol,
  synopticProtocolVersion,
} from '@lis/db';
import type { CaseReportContent } from '@lis/db';
import { parseInstanceResponseKey } from '@lis/domain';

type Tx = Parameters<
  Parameters<ReturnType<typeof createDb>['transaction']>[0]
>[0];

const UNAVAILABLE = '[data unavailable]';

export interface AssembledCaseReportPart {
  accessionNumber: string;
  blockCodes: string[];
}

export interface AssembledSynopticResponse {
  elementLabel: string;
  value: string;
}

// Issue #669: one repeating-group root's own recorded instances, each
// under a distinguishing ordinal label ("Instance 1", not the raw
// client-generated instanceKey, meaningless to a report reader).
export interface AssembledSynopticRepeatingInstance {
  instanceLabel: string;
  responses: AssembledSynopticResponse[];
}
export interface AssembledSynopticRepeatingGroup {
  rootLabel: string;
  instances: AssembledSynopticRepeatingInstance[];
}

export interface AssembledSynopticGroup {
  protocolName: string;
  responses: AssembledSynopticResponse[];
  repeatingGroups: AssembledSynopticRepeatingGroup[];
}

export interface AssembledCaseReportContent {
  parts: AssembledCaseReportPart[];
  narrative: { label: string; value: string }[];
  synopticGroups: AssembledSynopticGroup[];
}

export interface AssembledCaseReportPatientContext {
  patient: {
    name: string;
    mrn: string;
    dateOfBirth: string | null;
    sex: string;
  };
  referringFacilityName: string | null;
  orderingProviderName: string | null;
}

/**
 * Pilot-readiness audit fix (P0): the signed case-level PDF/email never
 * identified a patient at all -- confirmed missing by grep, unlike the
 * per-ordered-test path's own `report-assembly.ts`/`report-render.ts`,
 * which already resolves this exact order -> patient join
 * (`loadReportContext`). Mirrors that pattern rather than inventing a new
 * one: same `order` -> `patient` join, plus `order.referringFacilityId` /
 * `order.orderingProviderName` already on the order row. Deliberately not
 * part of `assembleCaseReportContent`'s own `content` rejoin above --
 * `content` is the signed, hash-covered `case_report_version.includedContent`
 * snapshot; patient identity is live/current-state context about the case's
 * order, the same way `caseAccessionNumber`/`caseStatus` already are in the
 * render input, not part of what was actually signed.
 */
export async function loadCaseReportPatientContext(
  tx: Tx,
  orderId: string,
): Promise<AssembledCaseReportPatientContext> {
  const [orderRow] = await tx
    .select()
    .from(order)
    .where(eq(order.id, orderId))
    .limit(1);
  if (!orderRow) {
    return {
      patient: {
        name: UNAVAILABLE,
        mrn: UNAVAILABLE,
        dateOfBirth: null,
        sex: UNAVAILABLE,
      },
      referringFacilityName: null,
      orderingProviderName: null,
    };
  }

  const [patientRow] = await tx
    .select()
    .from(patient)
    .where(eq(patient.id, orderRow.patientId))
    .limit(1);

  let referringFacilityName: string | null = null;
  if (orderRow.referringFacilityId) {
    const [facilityRow] = await tx
      .select({ name: referringFacility.name })
      .from(referringFacility)
      .where(eq(referringFacility.id, orderRow.referringFacilityId))
      .limit(1);
    referringFacilityName = facilityRow?.name ?? null;
  }

  return {
    patient: patientRow
      ? {
          name: `${patientRow.firstName} ${patientRow.lastName}`,
          mrn: patientRow.mrn,
          dateOfBirth: patientRow.birthDate
            ? patientRow.birthDate.toISOString().slice(0, 10)
            : null,
          sex: patientRow.sex,
        }
      : {
          name: UNAVAILABLE,
          mrn: UNAVAILABLE,
          dateOfBirth: null,
          sex: UNAVAILABLE,
        },
    referringFacilityName,
    orderingProviderName: orderRow.orderingProviderName ?? null,
  };
}

function formatObservationValue(row: typeof observation.$inferSelect): string {
  switch (row.dataType) {
    case 'quantity':
      return row.valueNum !== null ? String(row.valueNum) : UNAVAILABLE;
    case 'coded':
      return row.valueCode ?? UNAVAILABLE;
    case 'text':
      return row.valueText ?? UNAVAILABLE;
    case 'structured':
      return Array.isArray(row.valueJson)
        ? (row.valueJson as unknown[]).map(String).join(', ')
        : UNAVAILABLE;
    default:
      return UNAVAILABLE;
  }
}

/**
 * Issue #648 (proposal §5.2). Rejoins a signed `case_report_version.includedContent`
 * snapshot against live data at view/download time -- `narrative` is already
 * a full value snapshot (issue #636) and passes through unchanged;
 * `parts`/`blockIds` and `synopticResponses` are ids-only and need a real
 * join. Every rejoin target that can't be found renders as the literal
 * `"[data unavailable]"` string (proposal §10 Q3) -- never silently dropped,
 * never throws.
 */
export async function assembleCaseReportContent(
  tx: Tx,
  content: CaseReportContent,
): Promise<AssembledCaseReportContent> {
  const rawParts = (content.parts ?? []) as {
    id: string;
    accessionNumber: string;
    blockIds: string[];
  }[];
  const allBlockIds = rawParts.flatMap((p) => p.blockIds);
  const blockRows =
    allBlockIds.length > 0
      ? await tx
          .select({ id: block.id, code: block.code })
          .from(block)
          .where(inArray(block.id, allBlockIds))
      : [];
  const blockCodeById = new Map(blockRows.map((b) => [b.id, b.code]));

  const parts: AssembledCaseReportPart[] = rawParts.map((part) => ({
    accessionNumber: part.accessionNumber ?? UNAVAILABLE,
    blockCodes: part.blockIds.map((id) => blockCodeById.get(id) ?? UNAVAILABLE),
  }));

  const rawNarrative = (content.narrative ?? null) as {
    grossDescription: string | null;
    microscopicDescription: string | null;
    diagnosis: string | null;
  } | null;
  const narrative: { label: string; value: string }[] = [];
  if (rawNarrative?.grossDescription) {
    narrative.push({
      label: 'Gross description',
      value: rawNarrative.grossDescription,
    });
  }
  if (rawNarrative?.microscopicDescription) {
    narrative.push({
      label: 'Microscopic description',
      value: rawNarrative.microscopicDescription,
    });
  }
  if (rawNarrative?.diagnosis) {
    narrative.push({ label: 'Diagnosis', value: rawNarrative.diagnosis });
  }

  const rawSynopticResponses = (content.synopticResponses ?? []) as {
    id: string;
    createdAt: string;
  }[];
  const synopticGroups: AssembledSynopticGroup[] = [];
  if (rawSynopticResponses.length > 0) {
    const observationRows = await tx
      .select()
      .from(observation)
      .where(
        inArray(
          observation.id,
          rawSynopticResponses.map((r) => r.id),
        ),
      );
    const observationById = new Map(observationRows.map((o) => [o.id, o]));

    const analyteIds = observationRows.map((o) => o.analyteId);
    const answeredElementRows =
      analyteIds.length > 0
        ? await tx
            .select()
            .from(synopticElement)
            .where(inArray(synopticElement.analyteId, analyteIds))
        : [];
    const versionIds = [
      ...new Set(answeredElementRows.map((e) => e.synopticProtocolVersionId)),
    ];
    // Issue #669: the *full* element tree per relevant protocol version,
    // not just the answered elements -- a repeatable root is never
    // directly answerable (#666), so it never appears in
    // answeredElementRows, but its own `label` is needed to head each
    // instance group; walking parentElementId up requires every ancestor,
    // not only the leaf that was actually answered.
    const elementRows =
      versionIds.length > 0
        ? await tx
            .select()
            .from(synopticElement)
            .where(
              inArray(synopticElement.synopticProtocolVersionId, versionIds),
            )
        : [];
    const elementByAnalyteId = new Map(
      elementRows.map((e) => [e.analyteId, e]),
    );
    const elementById = new Map(elementRows.map((e) => [e.id, e]));
    function findRepeatableRoot(
      element: (typeof elementRows)[number],
    ): (typeof elementRows)[number] | undefined {
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

    const versionRows =
      versionIds.length > 0
        ? await tx
            .select()
            .from(synopticProtocolVersion)
            .where(inArray(synopticProtocolVersion.id, versionIds))
        : [];
    const versionById = new Map(versionRows.map((v) => [v.id, v]));

    const protocolIds = [
      ...new Set(versionRows.map((v) => v.synopticProtocolId)),
    ];
    const protocolRows =
      protocolIds.length > 0
        ? await tx
            .select()
            .from(synopticProtocol)
            .where(inArray(synopticProtocol.id, protocolIds))
        : [];
    const protocolById = new Map(protocolRows.map((p) => [p.id, p]));

    // Issue #669: a discrete Observation row has no stored composite
    // elementKey@instanceKey -- that mapping exists only in the grid
    // Observation's own valueJson.results (the same shape #659's read
    // path already returns verbatim). Scanning every grid for the same
    // ordered tests (any status -- a pure reverse lookup by observationId,
    // not filtered by which grid is "current") recovers it.
    const orderedTestIds = [
      ...new Set(
        observationRows
          .map((o) => o.orderedTestId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const gridRows =
      orderedTestIds.length > 0
        ? await tx
            .select({ valueJson: observation.valueJson })
            .from(observation)
            .where(
              and(
                inArray(observation.orderedTestId, orderedTestIds),
                eq(observation.dataType, 'table'),
              ),
            )
        : [];
    const compositeKeyByObservationId = new Map<string, string>();
    for (const grid of gridRows) {
      const results =
        (
          grid.valueJson as {
            results?: { elementKey: string; observationId: string }[];
          } | null
        )?.results ?? [];
      for (const r of results) {
        compositeKeyByObservationId.set(r.observationId, r.elementKey);
      }
    }

    const responsesByProtocolName = new Map<
      string,
      AssembledSynopticResponse[]
    >();
    // protocolName -> repeatableRootElementId -> instanceKey -> responses,
    // preserving first-seen instanceKey order for ordinal labeling
    // ("Instance 1", not the raw client-generated instanceKey).
    const repeatingByProtocolName = new Map<
      string,
      Map<
        string,
        {
          rootLabel: string;
          instanceOrder: string[];
          byInstance: Map<string, AssembledSynopticResponse[]>;
        }
      >
    >();
    for (const ref of rawSynopticResponses) {
      const obsRow = observationById.get(ref.id);
      if (!obsRow) {
        const bucket = responsesByProtocolName.get(UNAVAILABLE) ?? [];
        bucket.push({ elementLabel: UNAVAILABLE, value: UNAVAILABLE });
        responsesByProtocolName.set(UNAVAILABLE, bucket);
        continue;
      }
      const elementRow = elementByAnalyteId.get(obsRow.analyteId);
      const versionRow = elementRow
        ? versionById.get(elementRow.synopticProtocolVersionId)
        : undefined;
      const protocolRow = versionRow
        ? protocolById.get(versionRow.synopticProtocolId)
        : undefined;
      const protocolName = protocolRow?.name ?? UNAVAILABLE;
      const response: AssembledSynopticResponse = {
        elementLabel: elementRow?.label ?? UNAVAILABLE,
        value: formatObservationValue(obsRow),
      };

      const compositeKey = compositeKeyByObservationId.get(ref.id);
      const { instanceKey } = compositeKey
        ? parseInstanceResponseKey(compositeKey)
        : { instanceKey: null };
      const root = elementRow ? findRepeatableRoot(elementRow) : undefined;
      if (instanceKey && root) {
        const rootsByProtocol =
          repeatingByProtocolName.get(protocolName) ??
          new Map<
            string,
            {
              rootLabel: string;
              instanceOrder: string[];
              byInstance: Map<string, AssembledSynopticResponse[]>;
            }
          >();
        repeatingByProtocolName.set(protocolName, rootsByProtocol);
        const rootEntry = rootsByProtocol.get(root.id) ?? {
          rootLabel: root.label,
          instanceOrder: [],
          byInstance: new Map<string, AssembledSynopticResponse[]>(),
        };
        rootsByProtocol.set(root.id, rootEntry);
        if (!rootEntry.byInstance.has(instanceKey)) {
          rootEntry.instanceOrder.push(instanceKey);
          rootEntry.byInstance.set(instanceKey, []);
        }
        rootEntry.byInstance.get(instanceKey)!.push(response);
        continue;
      }

      const bucket = responsesByProtocolName.get(protocolName) ?? [];
      bucket.push(response);
      responsesByProtocolName.set(protocolName, bucket);
    }

    const protocolNames = new Set([
      ...responsesByProtocolName.keys(),
      ...repeatingByProtocolName.keys(),
    ]);
    for (const protocolName of protocolNames) {
      const rootsByProtocol = repeatingByProtocolName.get(protocolName);
      const repeatingGroups: AssembledSynopticRepeatingGroup[] = rootsByProtocol
        ? [...rootsByProtocol.values()].map((rootEntry) => ({
            rootLabel: rootEntry.rootLabel,
            instances: rootEntry.instanceOrder.map((instanceKey, index) => ({
              instanceLabel: `Instance ${index + 1}`,
              responses: rootEntry.byInstance.get(instanceKey)!,
            })),
          }))
        : [];
      synopticGroups.push({
        protocolName,
        responses: responsesByProtocolName.get(protocolName) ?? [],
        repeatingGroups,
      });
    }
  }

  return { parts, narrative, synopticGroups };
}
