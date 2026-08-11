import { z } from 'zod';
import { conditionNodeSchema } from '@lis/domain';

// Moved to @lis/domain (FEAT-047) so apps/web's report designer shares the
// exact same condition-tree schema; re-exported here so every existing
// import of `conditionNodeSchema` from this module stays valid.
export { conditionNodeSchema };

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
