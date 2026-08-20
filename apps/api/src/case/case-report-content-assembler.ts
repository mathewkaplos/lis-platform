import { inArray } from 'drizzle-orm';
import type { createDb } from '@lis/db';
import {
  block,
  observation,
  synopticElement,
  synopticProtocol,
  synopticProtocolVersion,
} from '@lis/db';
import type { CaseReportContent } from '@lis/db';

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

export interface AssembledSynopticGroup {
  protocolName: string;
  responses: AssembledSynopticResponse[];
}

export interface AssembledCaseReportContent {
  parts: AssembledCaseReportPart[];
  narrative: { label: string; value: string }[];
  synopticGroups: AssembledSynopticGroup[];
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
    const elementRows =
      analyteIds.length > 0
        ? await tx
            .select()
            .from(synopticElement)
            .where(inArray(synopticElement.analyteId, analyteIds))
        : [];
    const elementByAnalyteId = new Map(
      elementRows.map((e) => [e.analyteId, e]),
    );

    const versionIds = [
      ...new Set(elementRows.map((e) => e.synopticProtocolVersionId)),
    ];
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

    const responsesByProtocolName = new Map<
      string,
      AssembledSynopticResponse[]
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

      const bucket = responsesByProtocolName.get(protocolName) ?? [];
      bucket.push({
        elementLabel: elementRow?.label ?? UNAVAILABLE,
        value: formatObservationValue(obsRow),
      });
      responsesByProtocolName.set(protocolName, bucket);
    }
    for (const [protocolName, responses] of responsesByProtocolName) {
      synopticGroups.push({ protocolName, responses });
    }
  }

  return { parts, narrative, synopticGroups };
}
