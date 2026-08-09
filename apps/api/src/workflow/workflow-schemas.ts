import { z } from 'zod';
import { CONDITION_OPS, type ConditionNode } from './workflow-types';

const conditionOpSchema = z.enum(CONDITION_OPS);

const conditionLeafSchema = z.object({
  field: z.string().min(1),
  op: conditionOpSchema,
  value: z.unknown(),
});

// Recursive schema -- z.lazy() is required since ConditionNode references
// itself (and/or/not each contain more ConditionNodes).
const conditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    z.object({ and: z.array(conditionNodeSchema).min(1) }),
    z.object({ or: z.array(conditionNodeSchema).min(1) }),
    z.object({ not: conditionNodeSchema }),
    conditionLeafSchema,
  ]),
);

const workflowRuleSchema = z.object({
  id: z.string().min(1),
  on: z.string().min(1),
  when: conditionNodeSchema,
  do: z.object({ command: z.string().min(1) }).catchall(z.unknown()),
  dryRun: z.boolean().optional(),
});

export const workflowDefinitionCreateSchema = z.object({
  rules: z.array(workflowRuleSchema).min(1),
});
