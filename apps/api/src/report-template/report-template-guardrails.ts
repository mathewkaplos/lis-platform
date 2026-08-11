import {
  ANALYTE_BOUND_FIELD_TYPES,
  TEMPLATE_ALLOWED_FIELDS,
  type ReportTemplateDefinition,
  type TemplateFieldDefinition,
} from '@lis/domain';
import { findUnallowedFields } from '../workflow/workflow-condition-evaluator';

/**
 * Runs before a report_template_version may ever reach `status: 'published'`
 * (ReportTemplateController.publish, the only code path that sets that
 * status -- never bypassable by a direct write). Mirrors
 * `workflow-guardrails.ts`'s exact shape (FEAT-032 proposal finding #5).
 *
 * KB-12's own guardrail, read literally: "any field representing a
 * measurable/codeable clinical datum must declare an analyte binding...
 * warns/blocks on unbound clinical fields" -- enforced here server-side at
 * publish time (no designer UI exists in this proposal's scope to warn
 * interactively, per §10 Q2).
 *
 * `validAnalyteIds` is the target test_definition's own `test_analyte` set,
 * supplied by the caller (this function stays a pure, DB-free tree-walk,
 * matching `validateWorkflowDefinition`'s own testable-without-DB shape) --
 * a binding to an analyte outside that set is rejected even if the analyte
 * itself is real, since it isn't part of the panel this template renders.
 */
export function validateReportTemplateDefinition(
  definition: ReportTemplateDefinition,
  validAnalyteIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  const seenKeys = new Set<string>();

  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (seenKeys.has(field.key)) {
        errors.push(`Field key '${field.key}' is used more than once`);
      }
      seenKeys.add(field.key);

      validateField(field, validAnalyteIds, errors);
    }
  }

  return errors;
}

function validateField(
  field: TemplateFieldDefinition,
  validAnalyteIds: ReadonlySet<string>,
  errors: string[],
): void {
  if (ANALYTE_BOUND_FIELD_TYPES.includes(field.type)) {
    if (!field.analyteBinding) {
      errors.push(
        `Field '${field.key}' (type '${field.type}') must declare an analyteBinding -- ` +
          "unbound clinical fields are not permitted (KB-12's own guardrail against free-text results)",
      );
    } else if (!validAnalyteIds.has(field.analyteBinding)) {
      errors.push(
        `Field '${field.key}': analyteBinding '${field.analyteBinding}' is not one of this test's own analytes`,
      );
    }
  }

  if (field.type === 'table') {
    if (!field.analyteBindings || field.analyteBindings.length === 0) {
      errors.push(
        `Field '${field.key}' (type 'table') must declare at least one analyteBindings entry`,
      );
    } else {
      for (const analyteId of field.analyteBindings) {
        if (!validAnalyteIds.has(analyteId)) {
          errors.push(
            `Field '${field.key}': analyteBindings entry '${analyteId}' is not one of this test's own analytes`,
          );
        }
      }
    }
  }

  if (field.visibilityCondition) {
    if (field.type === 'table' || field.type === 'richText') {
      errors.push(
        `Field '${field.key}' (type '${field.type}') cannot declare a visibilityCondition -- ` +
          'conditional visibility only applies to a single-analyte-bound field',
      );
    } else {
      const unallowed = findUnallowedFields(
        field.visibilityCondition,
        TEMPLATE_ALLOWED_FIELDS,
      );
      if (unallowed.length > 0) {
        errors.push(
          `Field '${field.key}': visibilityCondition references field(s) not in the allow-list: ${unallowed.join(', ')}`,
        );
      }
    }
  }
}
