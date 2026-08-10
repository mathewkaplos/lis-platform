import { describe, expect, it } from 'vitest';
import { TemplateProvider } from './template-provider';

const NARRATIVE_DRAFTING_CAPABILITY =
  'narrative-drafting.peripheral-film-morphology';
const ANALYTES = [
  'Anisocytosis',
  'Poikilocytosis',
  'Polychromasia',
  'Platelet Estimate',
];
const GRADES = ['none', '1+', '2+', '3+'];

describe('TemplateProvider (FEAT-042, deterministic morphology narrative drafting)', () => {
  it.each(
    ANALYTES.flatMap((analyteDisplay) =>
      GRADES.map((grade) => ({ analyteDisplay, grade })),
    ),
  )(
    'returns a distinct, non-empty sentence for $analyteDisplay at grade $grade',
    async ({ analyteDisplay, grade }) => {
      const provider = new TemplateProvider();
      const result = await provider.complete({
        capability: NARRATIVE_DRAFTING_CAPABILITY,
        prompt: 'irrelevant for this test',
        minimizedContext: { analyteDisplay, grade },
      });
      expect(result.providerId).toBe('template');
      expect(result.output.length).toBeGreaterThan(10);
    },
  );

  it('all 16 analyte/grade combinations produce distinct sentences', async () => {
    const provider = new TemplateProvider();
    const outputs = new Set<string>();
    for (const analyteDisplay of ANALYTES) {
      for (const grade of GRADES) {
        const result = await provider.complete({
          capability: NARRATIVE_DRAFTING_CAPABILITY,
          prompt: 'irrelevant for this test',
          minimizedContext: { analyteDisplay, grade },
        });
        outputs.add(result.output);
      }
    }
    expect(outputs.size).toBe(16);
  });

  it('falls back to the stub message for a capability with no template', async () => {
    const provider = new TemplateProvider();
    const result = await provider.complete({
      capability: 'some-future-capability',
      prompt: 'irrelevant for this test',
      minimizedContext: {},
    });
    expect(result.providerId).toBe('template');
    expect(result.output).toContain('some-future-capability');
    expect(result.output).toContain('no live model configured');
  });

  it('falls back to the stub message for an unrecognized analyte/grade pair', async () => {
    const provider = new TemplateProvider();
    const result = await provider.complete({
      capability: NARRATIVE_DRAFTING_CAPABILITY,
      prompt: 'irrelevant for this test',
      minimizedContext: { analyteDisplay: 'Not A Real Analyte', grade: 'none' },
    });
    expect(result.output).toContain('no live model configured');
  });
});
