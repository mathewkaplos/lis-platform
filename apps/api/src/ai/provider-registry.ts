import type { InferenceProvider } from './inference-provider.interface';
import { StubProvider } from './providers/stub-provider';

// Config-driven provider selection (FEAT-041 AC #2: "provider can be
// swapped via configuration without touching feature code"). Only 'stub'
// ships -- see ADR-0037 / FEAT-041 proposal §5 for why a real provider is
// deliberately out of this feature's scope. Kept in its own file, separate
// from ai.module.ts, so it stays importable by a plain unit spec without
// pulling in the real `db` singleton (../auth/db throws at import time if
// APP_DATABASE_URL isn't set -- fine under this repo's real-Postgres e2e
// harness, which sources .env, but not under the plain `vitest run` unit
// config, which doesn't).
export const PROVIDERS: Record<string, () => InferenceProvider> = {
  stub: () => new StubProvider(),
};

export function selectProvider(): InferenceProvider {
  const providerId = process.env.AI_PROVIDER ?? 'stub';
  const factory = PROVIDERS[providerId];
  if (!factory) {
    throw new Error(
      `Unknown AI_PROVIDER '${providerId}' -- known providers: ${Object.keys(PROVIDERS).join(', ')}`,
    );
  }
  return factory();
}
