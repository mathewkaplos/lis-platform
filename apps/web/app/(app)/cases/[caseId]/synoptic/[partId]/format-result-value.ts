import {
  parseInstanceResponseKey,
  type SynopticElement,
  type SynopticResponseResultEntry,
} from '@lis/domain';

/**
 * Issue #767 (pilot-readiness audit). The "recorded" confirmation view was
 * echoing back the raw stored enum code (e.g. `low_anterior_resection`,
 * `pT3`) for `coded`/`coded_multi` elements instead of the human-readable
 * label the input form itself shows (`option.display`, e.g. "Low anterior
 * resection") -- confirmed live 2026-08-27. `entry.elementKey` may be a
 * repeatable element's composite `baseKey@instanceKey` (synoptic-response-
 * recorder.ts's own `elementKey: key` at result-build time), so this strips
 * the instance suffix via the same `parseInstanceResponseKey` the form's own
 * visibility evaluation already uses before looking the element up.
 *
 * Split into its own module (not defined inline in protocol-form.tsx, which
 * imports a `'use server'` actions file) so this pure formatting logic is
 * unit-testable without pulling in that server-only import chain.
 */
export function formatResultValue(
  entry: SynopticResponseResultEntry,
  elementByKey: Map<string, SynopticElement>,
): string {
  const { elementKey: baseKey } = parseInstanceResponseKey(entry.elementKey);
  const element = elementByKey.get(baseKey);
  const toLabel = (raw: string): string =>
    element?.responseOptions.find((option) => option.value === raw)?.display ?? raw;
  return Array.isArray(entry.value) ? entry.value.map(toLabel).join(', ') : toLabel(String(entry.value));
}
