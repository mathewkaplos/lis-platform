import type {
  OperationalReportQuery,
  RejectionRateReport,
  TatReport,
  WorkloadReport,
} from '@lis/domain';
import type { createDb } from '@lis/db';
import {
  observation,
  order,
  orderedTest,
  slaTarget,
  specimen,
  testDefinition,
} from '@lis/db';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

type Tx = Parameters<
  Parameters<ReturnType<typeof createDb>['transaction']>[0]
>[0];

/** Exported for direct unit testing -- the DB-querying functions below need
 * a real transaction (`engineering/testing` Skill entry #1: real-Postgres
 * checks are e2e specs, not Vitest units), but this pure math doesn't. */
export function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * FEAT-034 (docs/plans/feat-034-operational-reports-tat-workload.md finding
 * #4). TAT is scoped to `ordered_test` (KB-02's own "chemistry = per panel"
 * reporting unit, already resolved by TASK-059). A panel's own "done"
 * moment is `MAX(verifiedAt)` across its own current, verified
 * observations -- the exact aggregation `report-assembly.ts`'s own
 * `assembleAndPersistReport` already performs for its verifier block
 * (FEAT-016), reused here rather than inventing a second definition of
 * "when did this panel finish." §10 Q3 (resolved, corrected during
 * implementation -- see this function's own real finding below): "verified"
 * as the completion bar is expressed via `observation.status` (the column
 * that's actually ever set to that literal value), not `ordered_test.status`
 * (which never is) -- matches the verified-only bar this session already
 * applied twice (FEAT-016's report, FEAT-033's cumulative report), just on
 * the right column.
 *
 * Aggregated in application code, not SQL `GROUP BY`/percentile functions
 * (matching this repo's own established "separate queries + in-memory
 * maps" convention, extended here to aggregation) -- simpler and more
 * directly testable for a first version; §6's own noted risk (an
 * unindexed date-range scan at real volume) is a real, separate concern
 * from this choice, checked at §8 via `EXPLAIN`, not solved by a different
 * aggregation strategy here.
 */
export async function computeTatReport(
  tx: Tx,
  params: { query: OperationalReportQuery },
): Promise<TatReport> {
  const from = new Date(params.query.from);
  const to = new Date(params.query.to);

  // Real finding, found via this task's own e2e test: `ordered_test.status`
  // never actually reaches a literal `'verified'` value anywhere in this
  // codebase -- TASK-056's own rollup only ever advances it to `'resulted'`
  // (every analyte at least finalized) or further to `'reported'`;
  // verification itself is tracked per-analyte on `observation.status`, not
  // rolled up onto `ordered_test`. No status filter here at all -- the
  // `maxVerifiedAtByOrderedTestId` lookup below (built only from `status =
  // 'verified'` observation rows) already excludes any ordered_test with no
  // verified observation via its own `if (!completedAt) continue` guard;
  // adding a redundant, always-false `ordered_test.status` filter here
  // would silently return zero rows forever, not a stricter, correct
  // filter.
  const testRows = await tx
    .select({
      id: orderedTest.id,
      orderId: orderedTest.orderId,
      testDefinitionId: orderedTest.testDefinitionId,
      createdAt: orderedTest.createdAt,
    })
    .from(orderedTest)
    .where(
      and(gte(orderedTest.createdAt, from), lte(orderedTest.createdAt, to)),
    );
  if (testRows.length === 0) {
    return { byPriority: [], byTest: [] };
  }
  const orderedTestIds = testRows.map((row) => row.id);

  const orderIds = Array.from(new Set(testRows.map((row) => row.orderId)));
  const orderRows = await tx
    .select({ id: order.id, priority: order.priority })
    .from(order)
    .where(inArray(order.id, orderIds));
  const priorityByOrderId = new Map(
    orderRows.map((row) => [row.id, row.priority]),
  );

  const testDefIds = Array.from(
    new Set(testRows.map((row) => row.testDefinitionId)),
  );
  const testDefRows = await tx
    .select({ id: testDefinition.id, displayName: testDefinition.displayName })
    .from(testDefinition)
    .where(inArray(testDefinition.id, testDefIds));
  const displayNameByTestDefId = new Map(
    testDefRows.map((row) => [row.id, row.displayName]),
  );

  const observationRows = await tx
    .select({
      orderedTestId: observation.orderedTestId,
      verifiedAt: observation.verifiedAt,
    })
    .from(observation)
    .where(
      and(
        inArray(observation.orderedTestId, orderedTestIds),
        eq(observation.status, 'verified'),
        isNull(observation.supersededBy),
      ),
    );
  const maxVerifiedAtByOrderedTestId = new Map<string, Date>();
  for (const row of observationRows) {
    if (!row.orderedTestId || !row.verifiedAt) continue;
    const current = maxVerifiedAtByOrderedTestId.get(row.orderedTestId);
    if (!current || row.verifiedAt > current) {
      maxVerifiedAtByOrderedTestId.set(row.orderedTestId, row.verifiedAt);
    }
  }

  const slaTargetRows = await tx
    .select({
      priority: slaTarget.priority,
      targetMinutes: slaTarget.targetMinutes,
    })
    .from(slaTarget);
  const targetMinutesByPriority = new Map(
    slaTargetRows.map((row) => [row.priority, row.targetMinutes]),
  );

  const tatMinutesByPriority = new Map<string, number[]>();
  const tatMinutesByTest = new Map<string, number[]>();
  for (const row of testRows) {
    const completedAt = maxVerifiedAtByOrderedTestId.get(row.id);
    if (!completedAt) continue; // no verified observation found -- defensive, not expected
    const tatMinutes =
      (completedAt.getTime() - row.createdAt.getTime()) / 60_000;

    const priority = priorityByOrderId.get(row.orderId) ?? 'routine';
    const byPriorityBucket = tatMinutesByPriority.get(priority) ?? [];
    byPriorityBucket.push(tatMinutes);
    tatMinutesByPriority.set(priority, byPriorityBucket);

    const byTestBucket = tatMinutesByTest.get(row.testDefinitionId) ?? [];
    byTestBucket.push(tatMinutes);
    tatMinutesByTest.set(row.testDefinitionId, byTestBucket);
  }

  const byPriority = Array.from(tatMinutesByPriority.entries()).map(
    ([priority, values]) => {
      const target = targetMinutesByPriority.get(priority);
      const withinTargetPct =
        target === undefined
          ? null
          : (values.filter((v) => v <= target).length / values.length) * 100;
      return {
        priority,
        count: values.length,
        meanMinutes: mean(values),
        medianMinutes: median(values),
        withinTargetPct,
      };
    },
  );

  const byTest = Array.from(tatMinutesByTest.entries()).map(
    ([testDefinitionId, values]) => ({
      testDefinitionId,
      testDisplayName:
        displayNameByTestDefId.get(testDefinitionId) ?? 'Unknown test',
      count: values.length,
      meanMinutes: mean(values),
      medianMinutes: median(values),
    }),
  );

  return { byPriority, byTest };
}

/**
 * Per observation, not per ordered_test (proposal §5) -- an operator's own
 * workload is measured by when they finalized results (`producedAt`), a
 * verifier's by when they verified (`verifiedAt`); the two are counted
 * against their own relevant timestamp, not conflated into one.
 */
export async function computeWorkloadReport(
  tx: Tx,
  params: { query: OperationalReportQuery },
): Promise<WorkloadReport> {
  const from = new Date(params.query.from);
  const to = new Date(params.query.to);

  const operatorRows = await tx
    .select({ operatorUserId: observation.operatorUserId })
    .from(observation)
    .where(
      and(gte(observation.producedAt, from), lte(observation.producedAt, to)),
    );
  const verifierRows = await tx
    .select({ verifierUserId: observation.verifierUserId })
    .from(observation)
    .where(
      and(gte(observation.verifiedAt, from), lte(observation.verifiedAt, to)),
    );

  const operatorCountByUserId = new Map<string, number>();
  for (const row of operatorRows) {
    if (!row.operatorUserId) continue;
    operatorCountByUserId.set(
      row.operatorUserId,
      (operatorCountByUserId.get(row.operatorUserId) ?? 0) + 1,
    );
  }
  const verifierCountByUserId = new Map<string, number>();
  for (const row of verifierRows) {
    if (!row.verifierUserId) continue;
    verifierCountByUserId.set(
      row.verifierUserId,
      (verifierCountByUserId.get(row.verifierUserId) ?? 0) + 1,
    );
  }

  const userIds = new Set([
    ...operatorCountByUserId.keys(),
    ...verifierCountByUserId.keys(),
  ]);
  const entries = Array.from(userIds).map((userId) => ({
    userId,
    operatorCount: operatorCountByUserId.get(userId) ?? 0,
    verifierCount: verifierCountByUserId.get(userId) ?? 0,
  }));

  return { entries };
}

/**
 * `receivedAt` is the anchor for both numerator and denominator -- a
 * specimen's rejection is only ever assessed at receipt (`specimen.ts`'s
 * own state-machine comment: "rejected(reason) reachable from receipt"),
 * so a still-in-transit specimen (no `receivedAt` yet) hasn't had a chance
 * to be rejected and would understate the rate if counted in the
 * denominator.
 */
export async function computeRejectionRateReport(
  tx: Tx,
  params: { query: OperationalReportQuery },
): Promise<RejectionRateReport> {
  const from = new Date(params.query.from);
  const to = new Date(params.query.to);

  const rows = await tx
    .select({
      status: specimen.status,
      rejectionReason: specimen.rejectionReason,
    })
    .from(specimen)
    .where(and(gte(specimen.receivedAt, from), lte(specimen.receivedAt, to)));

  const countByReason = new Map<string, number>();
  let rejectedTotal = 0;
  for (const row of rows) {
    if (row.status !== 'rejected') continue;
    rejectedTotal += 1;
    const reason = row.rejectionReason ?? 'unspecified';
    countByReason.set(reason, (countByReason.get(reason) ?? 0) + 1);
  }

  return {
    totalSpecimens: rows.length,
    rejectedTotal,
    byReason: Array.from(countByReason.entries()).map(([reason, count]) => ({
      reason,
      count,
    })),
  };
}
