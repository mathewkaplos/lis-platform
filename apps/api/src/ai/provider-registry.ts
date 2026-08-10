import type { InferenceProvider } from './inference-provider.interface';
import { StubProvider } from './providers/stub-provider';
import { TemplateProvider } from './providers/template-provider';

// Config-driven provider selection (FEAT-041 AC #2: "provider can be
// swapped via configuration without touching feature code"). FEAT-042
// added `template` (deterministic, rule-based -- no real model vendor,
// decided directly by the human, FEAT-042 proposal §10 Q1) and made it the
// default: 'stub' stays registered and selectable but no longer ships as
// the default now that a real capability (narrative-drafting) needs real
// text. Kept in its own file, separate from ai.module.ts, so it stays
// importable by a plain unit spec without pulling in the real `db`
// singleton (../auth/db throws at import time if APP_DATABASE_URL isn't
// set -- fine under this repo's real-Postgres e2e harness, which sources
// .env, but not under the plain `vitest run` unit config, which doesn't).
export const PROVIDERS: Record<string, () => InferenceProvider> = {
  stub: () => new StubProvider(),
  template: () => new TemplateProvider(),
};

export function selectProvider(): InferenceProvider {
  const providerId = process.env.AI_PROVIDER ?? 'template';
  const factory = PROVIDERS[providerId];
  if (!factory) {
    throw new Error(
      `Unknown AI_PROVIDER '${providerId}' -- known providers: ${Object.keys(PROVIDERS).join(', ')}`,
    );
  }
  return factory();
}
