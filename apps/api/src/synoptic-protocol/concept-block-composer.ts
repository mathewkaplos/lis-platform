import { eq } from 'drizzle-orm';
import type { createDb } from '@lis/db';
import {
  conceptBlockElement,
  conceptBlockElementResponseOption,
  conceptBlockVersion,
  synopticElement,
  synopticElementResponseOption,
} from '@lis/db';
import type { ConditionNode } from '@lis/domain';

type Tx = Parameters<
  Parameters<ReturnType<typeof createDb>['transaction']>[0]
>[0];

export interface ComposeConceptBlockVersionParams {
  conceptBlockVersionId: string;
  targetProtocolVersionId: string;
  // Root-level composed elements attach here (null = top-level, same as
  // any other synopticElement).
  parentElementId: string | null;
  // Required, not defaulted -- composing the same block twice into one
  // protocol version (e.g. two lymph-node regions) needs distinct
  // prefixes to satisfy ux_synoptic_element_version_key. Pass '' for the
  // common single-composition case.
  keyPrefix: string;
  // Keeps composed elements sorted as a contiguous block rather than
  // interleaving with hand-authored ones at their original, typically
  // small, displayOrder values.
  displayOrderOffset: number;
}

/**
 * Issue #667 (docs/plans/task-667-synoptic-concept-block-library.md).
 * Compose-by-copy, not live reference: copies a concept block version's
 * full element tree + response options into fresh `synoptic_element`/
 * `synoptic_element_response_option` rows scoped to
 * `targetProtocolVersionId`, remapping `parentElementId` links from
 * block-element ids to their newly-inserted counterparts. Zero change to
 * `synoptic_element` itself -- composed elements are ordinary elements
 * afterward, recordable/readable through the existing, unmodified
 * recorder (#658) and read path (#659).
 */
export async function composeConceptBlockVersion(
  tx: Tx,
  params: ComposeConceptBlockVersionParams,
): Promise<{ rootElementIds: string[] }> {
  const {
    conceptBlockVersionId,
    targetProtocolVersionId,
    parentElementId,
    keyPrefix,
    displayOrderOffset,
  } = params;

  const [versionRow] = await tx
    .select()
    .from(conceptBlockVersion)
    .where(eq(conceptBlockVersion.id, conceptBlockVersionId))
    .limit(1);
  if (!versionRow) {
    throw new Error(
      `Unknown concept block version id: ${conceptBlockVersionId}`,
    );
  }

  const blockElements = await tx
    .select()
    .from(conceptBlockElement)
    .where(
      eq(conceptBlockElement.conceptBlockVersionId, conceptBlockVersionId),
    );
  if (blockElements.length === 0) {
    throw new Error(
      `Concept block version ${conceptBlockVersionId} has no elements`,
    );
  }

  const allOptions = await tx.select().from(conceptBlockElementResponseOption);
  const optionsByBlockElementId = new Map<string, typeof allOptions>();
  for (const row of allOptions) {
    if (!blockElements.some((e) => e.id === row.conceptBlockElementId))
      continue;
    const existing =
      optionsByBlockElementId.get(row.conceptBlockElementId) ?? [];
    existing.push(row);
    optionsByBlockElementId.set(row.conceptBlockElementId, existing);
  }

  // Insert in tree order (parents before children) so parentElementId can
  // always be remapped from an already-inserted id -- blockElements has no
  // guaranteed order, so this walks the tree explicitly rather than
  // assuming array order matches hierarchy.
  const childrenByParentId = new Map<string | null, typeof blockElements>();
  for (const el of blockElements) {
    const key = el.parentElementId;
    const existing = childrenByParentId.get(key) ?? [];
    existing.push(el);
    childrenByParentId.set(key, existing);
  }

  const composedIdByBlockElementId = new Map<string, string>();
  const rootElementIds: string[] = [];

  // A composed field's own visibilityCondition may reference a *sibling
  // within the same block* (e.g. the CAP lymph-node variant's
  // number_of_lymph_nodes_with_tumor is conditional on
  // regional_lymph_node_status) -- that reference must be prefixed too, or
  // it silently stops matching once both fields are copied under a
  // keyPrefix. Only rewrites fields that are actually block-local keys;
  // a condition referencing something outside the block (not used by any
  // seeded block today, but not assumed impossible) passes through
  // unchanged.
  const blockKeys = new Set(blockElements.map((e) => e.key));
  function rewriteCondition(node: ConditionNode): ConditionNode {
    if ('and' in node) return { and: node.and.map(rewriteCondition) };
    if ('or' in node) return { or: node.or.map(rewriteCondition) };
    if ('not' in node) return { not: rewriteCondition(node.not) };
    return {
      ...node,
      field: blockKeys.has(node.field)
        ? `${keyPrefix}${node.field}`
        : node.field,
    };
  }

  async function insertSubtree(
    blockElement: (typeof blockElements)[number],
    newParentElementId: string | null,
  ): Promise<void> {
    const [inserted] = await tx
      .insert(synopticElement)
      .values({
        synopticProtocolVersionId: targetProtocolVersionId,
        parentElementId: newParentElementId,
        key: `${keyPrefix}${blockElement.key}`,
        label: blockElement.label,
        dataType: blockElement.dataType,
        requirement: blockElement.requirement,
        analyteId: blockElement.analyteId,
        unitId: blockElement.unitId,
        visibilityCondition: blockElement.visibilityCondition
          ? rewriteCondition(blockElement.visibilityCondition as ConditionNode)
          : null,
        displayOrder: displayOrderOffset + blockElement.displayOrder,
        repeatable: blockElement.repeatable,
        identityElementKey: blockElement.identityElementKey
          ? `${keyPrefix}${blockElement.identityElementKey}`
          : null,
      })
      .returning();
    composedIdByBlockElementId.set(blockElement.id, inserted.id);

    const options = optionsByBlockElementId.get(blockElement.id) ?? [];
    for (const option of options) {
      await tx.insert(synopticElementResponseOption).values({
        synopticElementId: inserted.id,
        value: option.value,
        display: option.display,
        displayOrder: option.displayOrder,
      });
    }

    for (const child of childrenByParentId.get(blockElement.id) ?? []) {
      await insertSubtree(child, inserted.id);
    }
  }

  for (const rootBlockElement of childrenByParentId.get(null) ?? []) {
    await insertSubtree(rootBlockElement, parentElementId);
    rootElementIds.push(composedIdByBlockElementId.get(rootBlockElement.id)!);
  }

  return { rootElementIds };
}

export interface ComposeProtocolVersionElementsParams {
  sourceProtocolVersionId: string;
  targetProtocolVersionId: string;
  parentElementId: string | null;
  keyPrefix: string;
  displayOrderOffset: number;
}

/**
 * Issue #668 (docs/plans/task-668-biomarker-panel-linking.md). ICCR's
 * "inline" biomarker-panel embedding shape, sibling to
 * `composeConceptBlockVersion`: copies one protocol version's own element
 * tree into another (e.g. a biomarker panel's tree embedded directly into
 * an organ protocol version) -- same compose-by-copy discipline, same
 * cross-field visibilityCondition rewrite. A separate function rather than
 * a generalization of `composeConceptBlockVersion`: the two source tables
 * (`synopticElement` vs. `conceptBlockElement`) are structurally identical
 * but distinct Drizzle-typed tables, and forcing one generic function
 * through that type boundary is more complexity than two similar, direct
 * functions.
 */
export async function composeProtocolVersionElements(
  tx: Tx,
  params: ComposeProtocolVersionElementsParams,
): Promise<{ rootElementIds: string[] }> {
  const {
    sourceProtocolVersionId,
    targetProtocolVersionId,
    parentElementId,
    keyPrefix,
    displayOrderOffset,
  } = params;

  const sourceElements = await tx
    .select()
    .from(synopticElement)
    .where(
      eq(synopticElement.synopticProtocolVersionId, sourceProtocolVersionId),
    );
  if (sourceElements.length === 0) {
    throw new Error(
      `Protocol version ${sourceProtocolVersionId} has no elements`,
    );
  }

  const allOptions = await tx.select().from(synopticElementResponseOption);
  const optionsBySourceElementId = new Map<string, typeof allOptions>();
  for (const row of allOptions) {
    if (!sourceElements.some((e) => e.id === row.synopticElementId)) continue;
    const existing = optionsBySourceElementId.get(row.synopticElementId) ?? [];
    existing.push(row);
    optionsBySourceElementId.set(row.synopticElementId, existing);
  }

  const childrenByParentId = new Map<string | null, typeof sourceElements>();
  for (const el of sourceElements) {
    const key = el.parentElementId;
    const existing = childrenByParentId.get(key) ?? [];
    existing.push(el);
    childrenByParentId.set(key, existing);
  }

  const composedIdBySourceElementId = new Map<string, string>();
  const rootElementIds: string[] = [];

  const sourceKeys = new Set(sourceElements.map((e) => e.key));
  function rewriteCondition(node: ConditionNode): ConditionNode {
    if ('and' in node) return { and: node.and.map(rewriteCondition) };
    if ('or' in node) return { or: node.or.map(rewriteCondition) };
    if ('not' in node) return { not: rewriteCondition(node.not) };
    return {
      ...node,
      field: sourceKeys.has(node.field)
        ? `${keyPrefix}${node.field}`
        : node.field,
    };
  }

  async function insertSubtree(
    sourceElement: (typeof sourceElements)[number],
    newParentElementId: string | null,
  ): Promise<void> {
    const [inserted] = await tx
      .insert(synopticElement)
      .values({
        synopticProtocolVersionId: targetProtocolVersionId,
        parentElementId: newParentElementId,
        key: `${keyPrefix}${sourceElement.key}`,
        label: sourceElement.label,
        dataType: sourceElement.dataType,
        requirement: sourceElement.requirement,
        analyteId: sourceElement.analyteId,
        unitId: sourceElement.unitId,
        visibilityCondition: sourceElement.visibilityCondition
          ? rewriteCondition(sourceElement.visibilityCondition as ConditionNode)
          : null,
        displayOrder: displayOrderOffset + sourceElement.displayOrder,
        repeatable: sourceElement.repeatable,
        identityElementKey: sourceElement.identityElementKey
          ? `${keyPrefix}${sourceElement.identityElementKey}`
          : null,
      })
      .returning();
    composedIdBySourceElementId.set(sourceElement.id, inserted.id);

    const options = optionsBySourceElementId.get(sourceElement.id) ?? [];
    for (const option of options) {
      await tx.insert(synopticElementResponseOption).values({
        synopticElementId: inserted.id,
        value: option.value,
        display: option.display,
        displayOrder: option.displayOrder,
      });
    }

    for (const child of childrenByParentId.get(sourceElement.id) ?? []) {
      await insertSubtree(child, inserted.id);
    }
  }

  for (const rootSourceElement of childrenByParentId.get(null) ?? []) {
    await insertSubtree(rootSourceElement, parentElementId);
    rootElementIds.push(composedIdBySourceElementId.get(rootSourceElement.id)!);
  }

  return { rootElementIds };
}
