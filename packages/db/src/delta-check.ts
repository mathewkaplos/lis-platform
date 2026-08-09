import { and, desc, eq, isNull } from "drizzle-orm";
import type { createDb } from "./client";
import { observation } from "./schema/observation";
import { deltaCheckRule } from "./schema/delta-check-rule";

type Db = ReturnType<typeof createDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

export interface DeltaCheckParams {
  patientId: string;
  analyteId: string;
  valueNum: number;
}

export interface DeltaCheckResult {
  flagged: boolean;
  previousObservationId: string | null;
  priorValue: number | null;
  percentChange: number | null;
}

/**
 * KB-14 pipeline step 4 / ADR-0023: compares `valueNum` to the patient's
 * most recent prior **verified** Observation for the same analyte (never
 * `preliminary` -- an unverified prior could itself still be corrected, so
 * comparing against it has no real clinical grounding; a deliberately
 * different eligibility question from `domain/result-verification` Skill
 * entry #8's "has this analyte been finalized" `IN ('preliminary',
 * 'verified')` check, which answers a different question about the *current*
 * write, not about what's trustworthy to compare *against*). `supersededBy
 * IS NULL` excludes a verified-then-corrected row in favor of its current
 * replacement, mirroring `prior()`'s own read-only endpoint
 * (`observation.controller.ts`).
 *
 * `previousObservationId` in the return value is set whenever an eligible
 * prior exists at all -- populating the dormant trend-chain column
 * (`observation.ts` comment: "delta/trend chain") for the first time --
 * independent of whether a `delta_check_rule` is configured or the change
 * actually exceeds it. `flagged`/`percentChange` are the two things that
 * genuinely depend on a configured rule.
 *
 * No explicit `tenantId` predicate on either query, matching every other
 * tenant-scoped read in this repo (`reference-range.ts`'s own doc comment):
 * relies on the caller having already bound the tenant session
 * (`SET LOCAL app.tenant_id`), which `observation`'s and `delta_check_rule`'s
 * own `tenant_isolation` RLS policies enforce.
 */
export async function resolveDeltaCheck(db: DbOrTx, params: DeltaCheckParams): Promise<DeltaCheckResult> {
  const [prior] = await db
    .select({ id: observation.id, valueNum: observation.valueNum })
    .from(observation)
    .where(
      and(
        eq(observation.patientId, params.patientId),
        eq(observation.analyteId, params.analyteId),
        eq(observation.status, "verified"),
        isNull(observation.supersededBy),
      ),
    )
    .orderBy(desc(observation.producedAt), desc(observation.createdAt))
    .limit(1);

  if (!prior || prior.valueNum === null) {
    return { flagged: false, previousObservationId: null, priorValue: null, percentChange: null };
  }

  const priorValue = Number(prior.valueNum);
  if (priorValue === 0) {
    // Percent change is undefined when the prior value is exactly 0 -- avoid
    // fabricating an infinite/NaN percentChange (still links the trend chain).
    return { flagged: false, previousObservationId: prior.id, priorValue, percentChange: null };
  }

  const percentChange = ((params.valueNum - priorValue) / Math.abs(priorValue)) * 100;

  const [rule] = await db
    .select({ thresholdPercent: deltaCheckRule.thresholdPercent })
    .from(deltaCheckRule)
    .where(eq(deltaCheckRule.analyteId, params.analyteId))
    .limit(1);

  if (!rule) {
    // No configured rule -- never a fabricated flag (same "no_range... never
    // silently treated as normal" discipline `reference-range.ts` applies).
    return { flagged: false, previousObservationId: prior.id, priorValue, percentChange };
  }

  // Boundary inclusive (proposal §5, mirrors flagging.ts's own precedent).
  const flagged = Math.abs(percentChange) >= Number(rule.thresholdPercent);
  return { flagged, previousObservationId: prior.id, priorValue, percentChange };
}
