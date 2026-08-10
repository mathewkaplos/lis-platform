import type {
  InferenceProvider,
  InferenceProviderInput,
  InferenceProviderOutput,
} from '../inference-provider.interface';

/**
 * The only provider this repo ships until a real consumer needs a live
 * model call (ADR-0037, FEAT-041 proposal §5). Deterministic, no network
 * call -- proves the provider-abstraction/config-swap mechanism without
 * taking on a real vendor dependency this feature doesn't need.
 */
export class StubProvider implements InferenceProvider {
  readonly providerId = 'stub';

  complete(input: InferenceProviderInput): Promise<InferenceProviderOutput> {
    return Promise.resolve({
      output: `[stub:${input.capability}] no live model configured`,
      providerId: this.providerId,
    });
  }
}
