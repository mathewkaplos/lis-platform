import type {
  InferenceProvider,
  InferenceProviderInput,
  InferenceProviderOutput,
} from '../inference-provider.interface';
import { StubProvider } from './stub-provider';

// FEAT-042: standard peripheral-blood-smear morphology reporting phrasing
// for the 4 analytes seeded by db/seed/haematology-catalog.sql (FEAT-024/
// ADR-0025) at each of the 4 morphologyGradeSchema grades. Real hematology-
// reporting language, NOT yet lab-reviewed by a design partner -- same
// "real but unreviewed" flag as this repo's chemistry golden dataset
// (issue #171). See ai/governed-inference Skill and domain/haematology
// Skill for the sourcing and the review status.
const MORPHOLOGY_TEMPLATES: Record<string, Record<string, string>> = {
  Anisocytosis: {
    none: 'Red cell size is uniform; no significant anisocytosis noted.',
    '1+': 'Mild anisocytosis noted, with occasional red cells showing slight size variation.',
    '2+': 'Moderate anisocytosis noted, with a mixed population of microcytes and macrocytes.',
    '3+': 'Marked anisocytosis noted, with pronounced variation in red cell size throughout the smear.',
  },
  Poikilocytosis: {
    none: 'Red cell shape is unremarkable; no significant poikilocytosis noted.',
    '1+': 'Mild poikilocytosis noted, with occasional irregularly shaped red cells.',
    '2+': 'Moderate poikilocytosis noted, with a mixed population of teardrop cells and elliptocytes.',
    '3+': 'Marked poikilocytosis noted, with numerous bizarre-shaped red cells throughout the smear.',
  },
  Polychromasia: {
    none: 'No polychromasia noted; red cell staining is uniform.',
    '1+': 'Mild polychromasia noted, with occasional faintly basophilic red cells consistent with early reticulocytes.',
    '2+': 'Moderate polychromasia noted, with an increased proportion of polychromatophilic red cells.',
    '3+': 'Marked polychromasia noted, with numerous polychromatophilic red cells suggesting active erythropoiesis.',
  },
  'Platelet Estimate': {
    none: 'Platelet count and morphology appear unremarkable on smear review.',
    '1+': 'Platelets are mildly decreased on smear estimate relative to the automated count; morphology unremarkable.',
    '2+': 'Platelets are moderately decreased on smear estimate; occasional giant platelets noted.',
    '3+': 'Platelets are markedly decreased on smear estimate; morphology review recommended to exclude clumping artifact.',
  },
};

const NARRATIVE_DRAFTING_CAPABILITY =
  'narrative-drafting.peripheral-film-morphology';
const CUMULATIVE_SUMMARY_CAPABILITY = 'summarization.cumulative-trend';

interface CumulativeSummaryEntry {
  value: string;
  unit: string;
  flags: string[];
  isCritical: boolean;
  producedAt: string;
}

// FEAT-043: purely computed from the caller-supplied entries -- never a
// fixed sentence lookup like MORPHOLOGY_TEMPLATES above, since a trend
// summary must actually reflect the real numbers passed in (the literal
// "no unsupported claims" AC). Only ever states a numeric trend when every
// entry's `value` parses as a finite number; a coded/text analyte history
// gets count/date-range/flag information only, never a fabricated trend.
// `entries` is assumed already chronological (assembleCumulativeReport's
// own ordering, unchanged here). `producedAt` arrives already formatted
// by `report-assembly.ts`'s own `formatDateTime` (e.g. "Aug 10, 2026, 9:14
// PM") -- an opaque display string, not ISO -- used as-is, never re-parsed
// or sliced (a real, caught-before-shipping bug: an earlier version of
// this function assumed ISO and sliced the first 10 characters, which on
// this actual format silently produced garbage like "Aug 10, 20").
function computeCumulativeSummary(
  analyteDisplay: string,
  entries: readonly CumulativeSummaryEntry[],
): string {
  if (entries.length === 0) {
    return `No verified ${analyteDisplay} results are available yet for this patient.`;
  }

  const flaggedCount = entries.filter((e) => e.flags.length > 0).length;
  const criticalCount = entries.filter((e) => e.isCritical).length;
  const flagSummary =
    criticalCount > 0
      ? ` ${criticalCount} of ${entries.length} result(s) were flagged critical.`
      : flaggedCount > 0
        ? ` ${flaggedCount} of ${entries.length} result(s) were flagged abnormal.`
        : '';

  if (entries.length === 1) {
    const only = entries[0];
    return (
      `One verified ${analyteDisplay} result on ${only.producedAt}: ` +
      `${only.value}${only.unit ? ` ${only.unit}` : ''}.${flagSummary}`
    );
  }

  const numericValues = entries.map((e) => Number(e.value));
  const allNumeric = numericValues.every((v) => Number.isFinite(v));
  const startDate = entries[0].producedAt;
  const endDate = entries[entries.length - 1].producedAt;

  if (!allNumeric) {
    return (
      `${entries.length} verified ${analyteDisplay} results from ${startDate} to ${endDate}.` +
      `${flagSummary}`
    );
  }

  const first = numericValues[0];
  const last = numericValues[numericValues.length - 1];
  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const unit = entries[0].unit;
  const direction =
    last > first
      ? 'trending upward'
      : last < first
        ? 'trending downward'
        : 'stable across this period';

  return (
    `${entries.length} verified ${analyteDisplay} results from ${startDate} to ${endDate}, ` +
    `ranging from ${min} to ${max}${unit ? ` ${unit}` : ''}, ${direction} ` +
    `(first ${first}, most recent ${last}${unit ? ` ${unit}` : ''}).${flagSummary}`
  );
}

/**
 * ADR-0037/FEAT-042/FEAT-043: a deterministic, rule-based provider -- no
 * real model vendor (decided directly by the human, FEAT-042 proposal §10
 * Q1, inherited by FEAT-043 as an even clearer fit for its own "no
 * unsupported claims" AC). Dispatches per `capability`:
 * `narrative-drafting.peripheral-film-morphology` (fixed sentence lookup)
 * and `summarization.cumulative-trend` (computed from real entries, never
 * a fixed lookup). Every other capability falls back to StubProvider's own
 * canned message, same "not yet covered" honesty this repo's Skills
 * already practice.
 */
export class TemplateProvider implements InferenceProvider {
  readonly providerId = 'template';
  private readonly fallback = new StubProvider();

  complete(input: InferenceProviderInput): Promise<InferenceProviderOutput> {
    if (input.capability === NARRATIVE_DRAFTING_CAPABILITY) {
      const { analyteDisplay, grade } = input.minimizedContext as {
        analyteDisplay?: string;
        grade?: string;
      };
      const byGrade = analyteDisplay
        ? MORPHOLOGY_TEMPLATES[analyteDisplay]
        : undefined;
      const sentence = byGrade && grade ? byGrade[grade] : undefined;
      if (sentence) {
        return Promise.resolve({
          output: sentence,
          providerId: this.providerId,
        });
      }
    }
    if (input.capability === CUMULATIVE_SUMMARY_CAPABILITY) {
      const { analyteDisplay, entries } = input.minimizedContext as {
        analyteDisplay?: string;
        entries?: CumulativeSummaryEntry[];
      };
      if (analyteDisplay && Array.isArray(entries)) {
        return Promise.resolve({
          output: computeCumulativeSummary(analyteDisplay, entries),
          providerId: this.providerId,
        });
      }
    }
    return this.fallback.complete(input).then((result) => ({
      ...result,
      providerId: this.providerId,
    }));
  }
}
