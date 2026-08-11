import type { ReportTemplateDefinition, TemplateFieldDefinition } from '@lis/domain';

export interface PreviewAnalyteOption {
  id: string;
  display: string;
  unit: string | null;
}

const SAMPLE_NUMERIC = '5.4';
const SAMPLE_CODED = 'Positive';
const SAMPLE_RANGE = '3.5 – 5.5';

function analyteLabel(id: string, analyteOptions: PreviewAnalyteOption[]): string {
  const analyte = analyteOptions.find((a) => a.id === id);
  return analyte ? analyte.display : 'Unknown analyte';
}

function ConditionalBadge({ field }: { field: TemplateFieldDefinition }) {
  if (!field.visibilityCondition) return null;
  return (
    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      conditional
    </span>
  );
}

function FieldPreview({
  field,
  analyteOptions,
}: {
  field: TemplateFieldDefinition;
  analyteOptions: PreviewAnalyteOption[];
}) {
  switch (field.type) {
    case 'numeric': {
      const analyte = analyteOptions.find((a) => a.id === field.analyteBinding);
      return (
        <div className="flex items-baseline justify-between border-b border-border py-1 text-sm">
          <span className="text-foreground">
            {field.label}
            <ConditionalBadge field={field} />
          </span>
          <span className="font-mono text-foreground">
            {SAMPLE_NUMERIC} {analyte?.unit ?? ''}
          </span>
        </div>
      );
    }
    case 'coded':
      return (
        <div className="flex items-baseline justify-between border-b border-border py-1 text-sm">
          <span className="text-foreground">
            {field.label}
            <ConditionalBadge field={field} />
          </span>
          <span className="text-foreground">{SAMPLE_CODED}</span>
        </div>
      );
    case 'referenceRangeDisplay':
      return (
        <div className="flex items-baseline justify-between border-b border-border py-1 text-sm">
          <span className="text-foreground">
            {field.label}
            <ConditionalBadge field={field} />
          </span>
          <span className="text-text-secondary">{SAMPLE_RANGE}</span>
        </div>
      );
    case 'richText':
      return (
        <p className="py-1 text-sm text-foreground">
          {field.content && field.content.length > 0 ? (
            field.content
          ) : (
            <span className="italic text-text-secondary">(empty richText content)</span>
          )}
        </p>
      );
    case 'table': {
      const bound = field.analyteBindings ?? [];
      return (
        <div className="py-1">
          <p className="mb-1 text-sm font-medium text-foreground">{field.label}</p>
          {bound.length === 0 ? (
            <p className="text-sm italic text-text-secondary">(no analytes bound yet)</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {bound.map((id) => (
                    <th
                      key={id}
                      className="border-b border-border pb-1 text-left font-medium text-text-secondary"
                    >
                      {analyteLabel(id, analyteOptions)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {bound.map((id) => (
                    <td key={id} className="pt-1 font-mono text-foreground">
                      {SAMPLE_NUMERIC}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

/**
 * ADR-0042 §4: a client-side mock renderer, no server call and no real
 * order/observation data -- walks the same section/field tree the canvas
 * edits, rendering one sample value per field type. Deliberately can
 * diverge from the real PDF output (proposal §6 risk #1); it exists so an
 * admin can see the template's rough shape while designing, not as a
 * pixel-accurate preview of `report-render.ts`'s real output.
 */
export function ReportTemplatePreview({
  definition,
  analyteOptions,
}: {
  definition: ReportTemplateDefinition;
  analyteOptions: PreviewAnalyteOption[];
}) {
  if (definition.sections.length === 0) {
    return <p className="text-sm text-text-secondary">Add a section to see a preview.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {definition.sections.map((section, index) => (
        <div key={index}>
          <h4 className="mb-1 text-sm font-semibold text-foreground">{section.title}</h4>
          <div className="flex flex-col">
            {section.fields.map((field, fieldIndex) => (
              <FieldPreview key={fieldIndex} field={field} analyteOptions={analyteOptions} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
