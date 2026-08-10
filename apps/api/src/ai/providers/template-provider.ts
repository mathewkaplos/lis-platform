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

/**
 * ADR-0037/FEAT-042: a deterministic, rule-based provider -- no real model
 * vendor (decided directly by the human, FEAT-042 proposal §10 Q1). Only
 * `narrative-drafting.peripheral-film-morphology` has a real template;
 * every other capability falls back to StubProvider's own canned message,
 * same "not yet covered" honesty this repo's Skills already practice.
 * Establishes the per-capability template-registry shape any future
 * capability's own template would extend (ai/governed-inference Skill).
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
    return this.fallback.complete(input).then((result) => ({
      ...result,
      providerId: this.providerId,
    }));
  }
}
