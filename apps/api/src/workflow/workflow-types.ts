import type { ConditionNode } from '@lis/domain';

/**
 * FEAT-029 (ADR-0029). `WorkflowRule`/`ConditionNode` are the persisted
 * shape of `workflow_definition.rules` (jsonb) -- KB-25's own
 * trigger -> when -> do model, with `when` resolved to ADR-0029's fixed
 * JSON tree (never a parsed string).
 *
 * `ConditionNode`/`ConditionLeaf`/`ConditionOp`/`CONDITION_OPS`/
 * `isConditionLeaf` moved to `@lis/domain` (FEAT-047) so apps/web's report
 * designer can share the exact same condition-tree schema apps/api enforces;
 * re-exported here unchanged so every existing import in this module stays
 * valid.
 */
export {
  CONDITION_OPS,
  isConditionLeaf,
  type ConditionLeaf,
  type ConditionNode,
  type ConditionOp,
} from '@lis/domain';

// Explicit allow-list -- ADR-0029's own point: a field not in this list is
// rejected at publish time (the guardrail validator), never silently
// evaluated as undefined. `ObservationVerified`/`ObservationFinalized`
// share the exact `toObservationDto` payload shape, which is why one flat
// list originally covered every event this engine consumed with no
// event-specific field set needed. FEAT-029 (remainder, SLA timers) is the
// first event (`SlaBreached`) with a genuinely different payload shape
// (`priority`/`targetMinutes`, not an observation at all) -- rather than
// making this validator event-type-aware (a real, larger change; `on`
// itself is what already filters which rules apply to which event at
// *evaluation* time, not at *publish-time validation*), `priority`/
// `targetMinutes` are folded into this same flat list. The accepted
// tradeoff, same class ADR-0029 already named for the `(tenant)`-only
// scope: a rule authored against the wrong event type could reference an
// allow-listed field its own event never actually populates, silently
// evaluating as `undefined` at runtime rather than being rejected at
// publish time -- a real but modest gap, not a safety boundary (Skill
// entry #9: `when` is never the safety boundary regardless).
//
// `result` added by FEAT-052 for `CultureGrowthDetected`'s own payload
// (`@lis/domain`'s `cultureGrowthDetectedEventPayloadSchema`) -- same "fold
// the new event's genuinely different field into this one flat list"
// treatment `priority`/`targetMinutes` already got for `SlaBreached`.
export const ALLOWED_FIELDS = [
  'analyteId',
  'valueNum',
  'unit',
  'flags',
  'status',
  'source',
  'dataType',
  'priority',
  'targetMinutes',
  'result',
] as const;
export type AllowedField = (typeof ALLOWED_FIELDS)[number];

export interface WorkflowRule {
  id: string;
  on: string; // event type, e.g. 'ObservationVerified' | 'ObservationFinalized'
  when: ConditionNode;
  do: { command: string; [key: string]: unknown };
  // FEAT-031 (ADR-0031): when true, the engine still invokes the matched
  // command's handler (so it can run its own real checks and log the true
  // outcome), but the handler itself must skip any mutating write -- see
  // WorkflowCommandHandler's own `firingContext` parameter.
  dryRun?: boolean;
}
