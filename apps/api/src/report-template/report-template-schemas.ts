import { z } from 'zod';
import { conditionNodeSchema } from '../workflow/workflow-schemas';
import { TEMPLATE_FIELD_TYPES } from './report-template-types';

const templateFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(TEMPLATE_FIELD_TYPES),
  analyteBinding: z.uuid().optional(),
  analyteBindings: z.array(z.uuid()).optional(),
  content: z.string().optional(),
  visibilityCondition: conditionNodeSchema.optional(),
});

const templateSectionSchema = z.object({
  title: z.string().min(1),
  fields: z.array(templateFieldSchema).min(1),
});

export const reportTemplateDefinitionSchema = z.object({
  sections: z.array(templateSectionSchema).min(1),
});

export const reportTemplateCreateSchema = z.object({
  testDefinitionId: z.uuid(),
  definition: reportTemplateDefinitionSchema,
});

export const reportTemplateVersionCreateSchema = z.object({
  definition: reportTemplateDefinitionSchema,
});
