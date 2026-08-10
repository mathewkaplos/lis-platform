import { describe, expect, it } from 'vitest';
import { TemplateProvider } from './providers/template-provider';
import type { InferenceProviderInput } from './inference-provider.interface';

/**
 * FEAT-044 (docs/plans/feat-044-ai-evaluation-harness.md): output-safety and
 * grounding invariants for every real capability's own AI layer
 * (`TemplateProvider`), distinct from `template-provider.spec.ts`'s own
 * exact-match correctness tests (16 morphology combinations, trend-direction
 * correctness) -- this file checks properties that must hold across *every*
 * known-good input, plus known-bad/adversarial inputs that must degrade
 * safely rather than crash or produce unbounded output. Runs via the
 * existing `pnpm test` -- no new CI step, no Postgres dependency
 * (`TemplateProvider` is a pure function of its input, see proposal §5).
 */

const NARRATIVE_DRAFTING_CAPABILITY =
  'narrative-drafting.peripheral-film-morphology';
const CUMULATIVE_SUMMARY_CAPABILITY = 'summarization.cumulative-trend';

// A generous but real ceiling -- catches a future change that, say, lists
// every entry's own value in the output instead of a bounded summary (the
// 10,000-entry known-bad case below would otherwise blow this silently).
const MAX_OUTPUT_LENGTH = 600;

const INTERPOLATION_ARTIFACTS = ['undefined', '[object Object]', 'NaN'];

async function complete(input: InferenceProviderInput): Promise<string> {
  const provider = new TemplateProvider();
  const result = await provider.complete(input);
  return result.output;
}

function assertSafeAndGrounded(output: string, mustMention?: string) {
  expect(output.length).toBeGreaterThan(0);
  expect(output.length).toBeLessThan(MAX_OUTPUT_LENGTH);
  for (const artifact of INTERPOLATION_ARTIFACTS) {
    expect(output).not.toContain(artifact);
  }
  if (mustMention) {
    expect(output.toLowerCase()).toContain(mustMention.toLowerCase());
  }
}

describe('AI evaluation harness: known-good invariants (grounding + safety)', () => {
  const morphologyCases = [
    { analyteDisplay: 'Anisocytosis', grade: 'none' },
    { analyteDisplay: 'Anisocytosis', grade: '3+' },
    { analyteDisplay: 'Poikilocytosis', grade: '1+' },
    { analyteDisplay: 'Polychromasia', grade: '2+' },
    { analyteDisplay: 'Platelet Estimate', grade: '2+' },
  ];

  it.each(morphologyCases)(
    'narrative-drafting: $analyteDisplay at $grade is safe and names the analyte',
    async ({ analyteDisplay, grade }) => {
      const output = await complete({
        capability: NARRATIVE_DRAFTING_CAPABILITY,
        prompt: 'irrelevant for this test',
        minimizedContext: { analyteDisplay, grade },
      });
      // Morphology templates describe the condition by its own name (e.g.
      // "anisocytosis noted") -- Platelet Estimate's own templates say
      // "Platelet" rather than the full display string, so check the first
      // word only, a robust grounding signal without an over-fitted exact
      // match (that's template-provider.spec.ts's own job).
      assertSafeAndGrounded(output, analyteDisplay.split(' ')[0]);
    },
  );

  const trendCases = [
    {
      label: 'upward trend',
      entries: [
        {
          value: '4.1',
          unit: 'mmol/L',
          flags: [],
          isCritical: false,
          producedAt: 'Jan 1, 2026',
        },
        {
          value: '5.6',
          unit: 'mmol/L',
          flags: ['H'],
          isCritical: false,
          producedAt: 'Jun 1, 2026',
        },
      ],
    },
    {
      label: 'single result',
      entries: [
        {
          value: '4.2',
          unit: 'mmol/L',
          flags: [],
          isCritical: false,
          producedAt: 'Jan 1, 2026',
        },
      ],
    },
    {
      label: 'zero history',
      entries: [] as unknown[],
    },
    {
      label: 'non-numeric (coded) history',
      entries: [
        {
          value: 'positive',
          unit: '',
          flags: [],
          isCritical: false,
          producedAt: 'Jan 1, 2026',
        },
        {
          value: 'negative',
          unit: '',
          flags: [],
          isCritical: false,
          producedAt: 'Jun 1, 2026',
        },
      ],
    },
  ];

  it.each(trendCases)(
    'summarization.cumulative-trend: $label is safe and names the analyte',
    async ({ entries }) => {
      const output = await complete({
        capability: CUMULATIVE_SUMMARY_CAPABILITY,
        prompt: 'irrelevant for this test',
        minimizedContext: { analyteDisplay: 'Potassium', entries },
      });
      assertSafeAndGrounded(output, 'Potassium');
    },
  );
});

describe('AI evaluation harness: known-bad inputs degrade safely, never crash or explode', () => {
  it('a NaN-parseable value falls back to the non-numeric branch, never surfaces "NaN"', async () => {
    const output = await complete({
      capability: CUMULATIVE_SUMMARY_CAPABILITY,
      prompt: 'irrelevant for this test',
      minimizedContext: {
        analyteDisplay: 'Potassium',
        entries: [
          {
            value: 'not-a-number',
            unit: 'mmol/L',
            flags: [],
            isCritical: false,
            producedAt: 'Jan 1, 2026',
          },
          {
            value: '4.5',
            unit: 'mmol/L',
            flags: [],
            isCritical: false,
            producedAt: 'Jun 1, 2026',
          },
        ],
      },
    });
    assertSafeAndGrounded(output);
    expect(output).not.toContain('trending');
  });

  it('an Infinity-parseable value falls back to the non-numeric branch, never surfaces "Infinity" as a claimed value', async () => {
    const output = await complete({
      capability: CUMULATIVE_SUMMARY_CAPABILITY,
      prompt: 'irrelevant for this test',
      minimizedContext: {
        analyteDisplay: 'Potassium',
        entries: [
          {
            value: 'Infinity',
            unit: 'mmol/L',
            flags: [],
            isCritical: false,
            producedAt: 'Jan 1, 2026',
          },
          {
            value: '4.5',
            unit: 'mmol/L',
            flags: [],
            isCritical: false,
            producedAt: 'Jun 1, 2026',
          },
        ],
      },
    });
    assertSafeAndGrounded(output);
    expect(output).not.toContain('ranging from');
  });

  it('a 10,000-entry history completes without hanging and stays within the length ceiling', async () => {
    const entries = Array.from({ length: 10_000 }, (_, i) => ({
      value: String(4 + (i % 3) * 0.1),
      unit: 'mmol/L',
      flags: [],
      isCritical: false,
      producedAt: 'Jan 1, 2026',
    }));
    const start = Date.now();
    const output = await complete({
      capability: CUMULATIVE_SUMMARY_CAPABILITY,
      prompt: 'irrelevant for this test',
      minimizedContext: { analyteDisplay: 'Potassium', entries },
    });
    expect(Date.now() - start).toBeLessThan(1000);
    assertSafeAndGrounded(output, 'Potassium');
    expect(output).toContain('10000 verified');
  });

  it("script-like content in analyteDisplay never throws -- output escaping is the frontend renderer's job, not this layer's", async () => {
    const analyteDisplay = '<script>alert(1)</script>';
    await expect(
      complete({
        capability: CUMULATIVE_SUMMARY_CAPABILITY,
        prompt: 'irrelevant for this test',
        minimizedContext: { analyteDisplay, entries: [] },
      }),
    ).resolves.toBeTypeOf('string');
  });

  it('an unrecognized capability falls back to the stub message, never throws', async () => {
    const output = await complete({
      capability: 'some-future-capability-not-yet-built',
      prompt: 'irrelevant for this test',
      minimizedContext: {},
    });
    expect(output).toContain('no live model configured');
  });

  it('empty/missing minimizedContext for a known capability falls back safely, never throws', async () => {
    const morphologyOutput = await complete({
      capability: NARRATIVE_DRAFTING_CAPABILITY,
      prompt: 'irrelevant for this test',
      minimizedContext: {},
    });
    expect(morphologyOutput).toContain('no live model configured');

    const trendOutput = await complete({
      capability: CUMULATIVE_SUMMARY_CAPABILITY,
      prompt: 'irrelevant for this test',
      minimizedContext: {},
    });
    expect(trendOutput).toContain('no live model configured');
  });
});
