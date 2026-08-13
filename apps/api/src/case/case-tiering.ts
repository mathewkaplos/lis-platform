/**
 * FEAT-063 (docs/plans/feat-063-cytology-two-tier-workflow.md, §5/§10 Q1).
 * A fixed, in-code v1 default -- not tenant-configurable metadata -- which
 * specimen types require cytopathologist two-tier review vs.
 * cytotechnologist-only screening. Issue #552 explicitly defers real
 * tenant-configurability to a later feature; this is deliberately the
 * smaller, working v1 answer, mirroring `reflex-guardrails.ts`'s own "pure
 * gate, DB-free" split so it's unit-testable without a database.
 */

export const CYTOLOGY_SPECIMEN_TYPES = ['cervical_cytology'] as const;

/**
 * A case requires two-tier review if ANY of its parts' specimen types is a
 * cytology type. An empty list (a case with no parts, structurally rejected
 * elsewhere by `finalize()`'s own lineage check) is not two-tier.
 */
export function requiresTwoTierReview(specimenTypes: string[]): boolean {
  return specimenTypes.some((type) =>
    (CYTOLOGY_SPECIMEN_TYPES as readonly string[]).includes(type),
  );
}
