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

const CUMULATIVE_SUMMARY_CAPABILITY = 'summarization.cumulative-trend';

describe('TemplateProvider (FEAT-043, deterministic cumulative-trend summarization)', () => {
  async function summarize(entries: unknown[]): Promise<string> {
    const provider = new TemplateProvider();
    const result = await provider.complete({
      capability: CUMULATIVE_SUMMARY_CAPABILITY,
      prompt: 'irrelevant for this test',
      minimizedContext: { analyteDisplay: 'Potassium', entries },
    });
    return result.output;
  }

  it('states no fabricated trend when there are zero results', async () => {
    const output = await summarize([]);
    expect(output).toContain('No verified Potassium results');
    expect(output.toLowerCase()).not.toContain('trend');
  });

  it('never claims a trend for exactly one result', async () => {
    const output = await summarize([
      {
        value: '4.2',
        unit: 'mmol/L',
        flags: [],
        isCritical: false,
        producedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    expect(output).toContain('One verified Potassium result');
    expect(output).toContain('4.2 mmol/L');
    expect(output.toLowerCase()).not.toContain('trend');
  });

  it('correctly states an upward trend from real numeric values', async () => {
    const output = await summarize([
      {
        value: '4.1',
        unit: 'mmol/L',
        flags: [],
        isCritical: false,
        producedAt: '2026-01-01T00:00:00Z',
      },
      {
        value: '4.6',
        unit: 'mmol/L',
        flags: [],
        isCritical: false,
        producedAt: '2026-03-01T00:00:00Z',
      },
      {
        value: '5.6',
        unit: 'mmol/L',
        flags: ['H'],
        isCritical: false,
        producedAt: '2026-06-01T00:00:00Z',
      },
    ]);
    expect(output).toContain('trending upward');
    expect(output).toContain('3 verified Potassium results');
    expect(output).toContain('ranging from 4.1 to 5.6 mmol/L');
    expect(output).toContain('1 of 3 result(s) were flagged abnormal');
  });

  it('correctly states a downward trend', async () => {
    const output = await summarize([
      {
        value: '5.6',
        unit: 'mmol/L',
        flags: [],
        isCritical: false,
        producedAt: '2026-01-01T00:00:00Z',
      },
      {
        value: '4.1',
        unit: 'mmol/L',
        flags: [],
        isCritical: false,
        producedAt: '2026-03-01T00:00:00Z',
      },
    ]);
    expect(output).toContain('trending downward');
  });

  it('states stable, not a fabricated direction, when first and last values are equal', async () => {
    const output = await summarize([
      {
        value: '4.5',
        unit: 'mmol/L',
        flags: [],
        isCritical: false,
        producedAt: '2026-01-01T00:00:00Z',
      },
      {
        value: '4.5',
        unit: 'mmol/L',
        flags: [],
        isCritical: false,
        producedAt: '2026-03-01T00:00:00Z',
      },
    ]);
    expect(output).toContain('stable across this period');
  });

  it('states critical-flag count distinctly from ordinary flags', async () => {
    const output = await summarize([
      {
        value: '4.1',
        unit: 'mmol/L',
        flags: [],
        isCritical: false,
        producedAt: '2026-01-01T00:00:00Z',
      },
      {
        value: '7.2',
        unit: 'mmol/L',
        flags: ['HH'],
        isCritical: true,
        producedAt: '2026-03-01T00:00:00Z',
      },
    ]);
    expect(output).toContain('1 of 2 result(s) were flagged critical');
  });

  it('never states a numeric trend for a non-numeric (coded/text) analyte history', async () => {
    const output = await summarize([
      {
        value: 'positive',
        unit: '',
        flags: [],
        isCritical: false,
        producedAt: '2026-01-01T00:00:00Z',
      },
      {
        value: 'negative',
        unit: '',
        flags: [],
        isCritical: false,
        producedAt: '2026-03-01T00:00:00Z',
      },
    ]);
    expect(output).not.toContain('trending');
    expect(output).not.toContain('ranging from');
    expect(output).toContain('2 verified Potassium results');
  });
});
