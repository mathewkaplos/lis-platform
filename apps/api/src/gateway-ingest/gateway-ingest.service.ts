import { Inject, Injectable } from '@nestjs/common';
import { rawResultIdempotencyKey, type RawResult } from '@lis/domain';
import { observationIdempotencyKey, orderedTest } from '@lis/db';
import { and, eq } from 'drizzle-orm';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { ObservationWriteService } from '../observation/observation-write.service';
import {
  AnalyzerCorrelationService,
  type UnmatchedReason,
} from './analyzer-correlation.service';

type Tx = RequestWithTx['tx'];

export type IngestResult =
  | {
      matched: true;
      idempotencyKey: string;
      duplicate: boolean;
      observationId: string;
    }
  | { matched: false; reason: UnmatchedReason };

/**
 * FEAT-027: correlates, maps, dedupes, and writes an analyzer-ingested raw
 * result — see `GatewayIngestController`'s own header comment for the full
 * picture. Runs inside the caller's transaction (`TenantContextInterceptor`
 * on the controller), so the dedupe-key insert and the Observation write
 * commit or roll back together.
 */
@Injectable()
export class GatewayIngestService {
  constructor(
    @Inject(AnalyzerCorrelationService)
    private readonly correlation: AnalyzerCorrelationService,
    @Inject(ObservationWriteService)
    private readonly writeService: ObservationWriteService,
  ) {}

  async ingest(
    tx: Tx,
    tenantId: string,
    operatorUserId: string,
    rawResult: RawResult,
  ): Promise<IngestResult> {
    const key = rawResultIdempotencyKey(rawResult);

    const [existingKey] = await tx
      .select({ observationId: observationIdempotencyKey.observationId })
      .from(observationIdempotencyKey)
      .where(
        and(
          eq(observationIdempotencyKey.tenantId, tenantId),
          eq(observationIdempotencyKey.sourceIdempotencyKey, key),
        ),
      )
      .limit(1);
    if (existingKey) {
      return {
        matched: true,
        idempotencyKey: key,
        duplicate: true,
        observationId: existingKey.observationId,
      };
    }

    const correlated = await this.correlation.correlate(
      tx,
      tenantId,
      rawResult,
    );
    if (!correlated.matched) {
      return { matched: false, reason: correlated.reason };
    }

    // Same shape a human draft() call sends -- ObservationWriteService knows
    // nothing about "analyzer" vs. "human", only ResultEntryInput.
    const body = {
      dataType: 'quantity' as const,
      valueNum: correlated.valueNum,
    };
    const at = new Date();

    const ctx = await this.writeService.loadWriteContext(
      tx,
      correlated.orderedTestId,
      correlated.analyteId,
      body,
    );
    const rangeAndFlags = await this.writeService.resolveRangeAndFlags(
      tx,
      body,
      ctx.analyteRow,
      ctx.patientId,
      ctx.patientSex,
      ctx.patientBirthDate,
      at,
    );

    // Status 'registered' -- the same status a human draft() call sets, not
    // 'preliminary'/finalized. No auto-verification exists yet (FEAT-031,
    // still "Not Started") -- an analyzer result awaits the same human
    // review every result requires today (FEAT-027 proposal §5).
    // Deliberately unaudited, same as draft() itself (`@Audit()` is only on
    // finalize()/verify() -- a per-channel analyzer write is the
    // high-frequency case draft()'s own precedent already exempts from
    // audit noise, not a gap introduced here).
    const row = await this.writeService.upsertObservation(tx, {
      tenantId,
      orderedTestId: correlated.orderedTestId,
      analyteId: correlated.analyteId,
      patientId: ctx.patientId,
      specimenId: ctx.specimenId,
      operatorUserId,
      status: 'registered',
      body,
      source: 'analyzer',
      sourceIdempotencyKey: key,
      ...rangeAndFlags,
    });

    await tx.insert(observationIdempotencyKey).values({
      tenantId,
      sourceIdempotencyKey: key,
      observationId: row.id,
    });

    // Same 'received' -> 'in_process' advance draft() performs on first entry.
    if (ctx.orderedTestRow.status === 'received') {
      await tx
        .update(orderedTest)
        .set({ status: 'in_process' })
        .where(eq(orderedTest.id, correlated.orderedTestId));
    }

    return {
      matched: true,
      idempotencyKey: key,
      duplicate: false,
      observationId: row.id,
    };
  }
}
