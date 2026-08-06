import {
  ConflictException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { observation, orderedTest, testAnalyte } from '@lis/db';
import { and, arrayOverlaps, eq, inArray, ne, sql } from 'drizzle-orm';
import { from, firstValueFrom, type Observable } from 'rxjs';
import { db } from '../auth/db';
import type { RequestWithAuthContext } from '../auth/jwt-auth.guard';

type RequestWithOrderedTestParam = RequestWithAuthContext & {
  params: { id: string };
};

/**
 * TASK-056 (FEAT-015 revision, #115): the `ordered_test.status -> 'resulted'`
 * roll-up, plus its new Constitution Law #3 guard ("does this ordered test
 * have any observation with critical flags that isn't yet verified?"), moved
 * OUT of `finalize()`'s own request transaction and run here instead, as a
 * second, independently-committed transaction.
 *
 * Why this needs its own interceptor rather than just more code inside
 * `finalize()` (proposal §10 Q1's resolved transactional sub-question):
 * `TenantContextInterceptor` wraps the entire request (the analyte's own
 * `upsertObservation` write, `maybeComputeDependents`, and `AuditInterceptor`'s
 * own `audit_event` insert) in exactly one `db.transaction(...)` — commit on
 * a normal return, rollback on any thrown exception. If this guard's 409 were
 * thrown from inside that same transaction, the whole thing (including the
 * observation the technologist just typed in) would roll back with it, which
 * the resolved decision explicitly rejects: "a technologist never loses a
 * real typed value because the panel can't yet close out." Placed FIRST
 * (outermost) in `finalize()`'s own `@UseInterceptors(...)` list, this
 * interceptor's own code after `next.handle()` only runs once the inner
 * `TenantContextInterceptor`'s `db.transaction()` promise has resolved —
 * which drizzle only does after a real Postgres COMMIT — so a 409 thrown
 * from here can never unwind that already-committed write. (A mid-transaction
 * raw `COMMIT`/`BEGIN` splice inside one shared transaction was considered
 * and rejected as far more fragile than composing two ordinary,
 * independently-committed transactions this way.)
 *
 * Runs on every `finalize()` call, not just the one that completes a panel —
 * cheap no-op (`allFinalized` false, or already `'resulted'`) for every call
 * that isn't the panel's last remaining analyte, matching
 * `loadWriteContext`'s own `ENTERABLE_ORDERED_TEST_STATUSES` guard, which
 * already means no `finalize()` call ever reaches this point after the panel
 * is `'resulted'`.
 */
@Injectable()
export class FinalizationRollupInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithOrderedTestParam>();
    const orderedTestId = request.params.id;
    const tenantId = request.authContext.tenantId;

    return from(
      (async () => {
        // Explicit `unknown` breaks CallHandler.handle()'s `Observable<any>`
        // typing from flowing into this callback's inferred return type
        // (same reasoning as TenantContextInterceptor's identical cast).
        const result: unknown = await firstValueFrom(next.handle());

        await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
          );

          const [orderedTestRow] = await tx
            .select({
              id: orderedTest.id,
              testDefinitionId: orderedTest.testDefinitionId,
              status: orderedTest.status,
            })
            .from(orderedTest)
            .where(eq(orderedTest.id, orderedTestId))
            .limit(1);
          // finalize() (inside next.handle(), just above) already proved this
          // row exists via loadWriteContext -- absence here would mean it
          // vanished mid-request, which RLS/FK make effectively impossible.
          // Defensive only, not a real expected path.
          if (!orderedTestRow) return;
          if (orderedTestRow.status === 'resulted') return;

          const requiredLinks = await tx
            .select({ analyteId: testAnalyte.analyteId })
            .from(testAnalyte)
            .where(
              eq(testAnalyte.testDefinitionId, orderedTestRow.testDefinitionId),
            );
          const requiredAnalyteIds = requiredLinks.map(
            (link) => link.analyteId,
          );

          // Real finding made while implementing this task: an analyte whose
          // observation has already been verified (TASK-055's verify(), which
          // has no ordered-test-status gate of its own and can run before the
          // rest of the panel finishes) no longer reads back with
          // status = 'preliminary' -- finalize()'s original allFinalized
          // check (status = 'preliminary' only) would then never see the
          // panel as complete, permanently, even once every analyte has a
          // result. 'verified' strictly follows 'preliminary' in this
          // lifecycle (never skipped, never reversed), so both count as
          // "this analyte has been finalized."
          const finalizedObservations = await tx
            .select({ analyteId: observation.analyteId })
            .from(observation)
            .where(
              and(
                eq(observation.orderedTestId, orderedTestId),
                inArray(observation.status, ['preliminary', 'verified']),
              ),
            );
          const finalizedAnalyteIds = new Set(
            finalizedObservations.map((o) => o.analyteId),
          );
          const allFinalized = requiredAnalyteIds.every((id) =>
            finalizedAnalyteIds.has(id),
          );
          if (!allFinalized) return;

          // TASK-056's own new guard (Constitution Law #3): reuses the
          // already-GIN-indexed `flags` column (`ix_obs_flags`, TASK-050) and
          // TASK-055's own `verify()` as the sole acknowledgement signal
          // (proposal §10 Q2) -- no new column, no new index.
          const unverifiedCriticals = await tx
            .select({ id: observation.id })
            .from(observation)
            .where(
              and(
                eq(observation.orderedTestId, orderedTestId),
                arrayOverlaps(observation.flags, ['HH', 'LL']),
                ne(observation.status, 'verified'),
              ),
            );
          if (unverifiedCriticals.length > 0) {
            throw new ConflictException(
              `Cannot complete: ${unverifiedCriticals.length} critical result(s) pending verification (Constitution Law #3)`,
            );
          }

          await tx
            .update(orderedTest)
            .set({ status: 'resulted' })
            .where(eq(orderedTest.id, orderedTestId));
        });

        return result;
      })(),
    );
  }
}
