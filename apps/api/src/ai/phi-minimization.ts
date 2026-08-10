/**
 * ADR-0033's own precedent (workflow engine: "allowed fields stays one flat
 * list, not type/event-scoped") applied here: `allowedFields` is a flat list
 * of dot-paths, deny-by-default. A field not explicitly named never reaches
 * the model provider or the audit log -- see FEAT-041 proposal §5/§7. Empty
 * `allowedFields` denies everything.
 */
export function minimize(
  input: Record<string, unknown>,
  allowedFields: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const path of allowedFields) {
    const segments = path.split('.');
    const value = getPath(input, segments);
    if (value !== undefined) {
      setPath(result, segments, value);
    }
  }
  return result;
}

function getPath(source: unknown, segments: readonly string[]): unknown {
  let current = source;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setPath(
  target: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
): void {
  let current = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const existing = current[segment];
    if (typeof existing !== 'object' || existing === null) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = value;
}
