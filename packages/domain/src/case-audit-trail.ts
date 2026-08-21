import { z } from "zod";

/**
 * Issue #714 (EPIC #697). Case sign-out already records real, structured
 * audit data (`context.step_up: { authTime, method }`, `case.controller.ts`'s
 * own `finalize()`/`amend()`) -- confirmed via the pilot-readiness audit's
 * own API response inspection, but no screen existed anywhere to review it;
 * a user could only see it by reading a raw API response. This is that
 * screen's response shape: the case's own directly-audited actions
 * (accession, add block/slide, record narrative, screen,
 * return-to-screening -- `resourceType: 'case'`) plus its report-version
 * lifecycle events (sign-out, amend -- `resourceType: 'case_report_version'`,
 * scoped to that case's own report versions), merged and time-ordered. Not
 * every block/slide's own individually-audited row (those carry their own
 * `resourceType: 'block'`/`'slide'` with a *different* resourceId than the
 * case) -- out of this issue's scope; this is the case-lifecycle trail the
 * issue itself names, not a full recursive audit of every child entity.
 */
export const caseAuditEventSchema = z.object({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  action: z.string(),
  actorPrincipalId: z.uuid(),
  actorRole: z.string(),
  reason: z.string().nullable(),
  stepUp: z
    .object({
      authTime: z.number(),
      method: z.string(),
    })
    .nullable(),
});
export type CaseAuditEvent = z.infer<typeof caseAuditEventSchema>;

export const caseAuditTrailResponseSchema = z.object({
  items: z.array(caseAuditEventSchema),
});
export type CaseAuditTrailResponse = z.infer<typeof caseAuditTrailResponseSchema>;
